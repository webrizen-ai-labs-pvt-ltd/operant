import { todayIn } from "@operant/core";
import { clients, installments, invoiceLines, invoices, notifications, orgSettings, orgs, payments } from "@operant/db";
import { formatMoney } from "@operant/core";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../context.ts";
import { hmacSha256Hex, safeEqual, sha256Hex } from "../secrets.ts";
import { activePlan, installmentPaymentLink, payInstallment, planView } from "./installments.ts";
import { createPaymentLink, emailReceipt, loadSettings, OPEN_QUOTE, receiptsFor, recordPayment } from "./service.ts";

async function orgToday(db: AppEnv["Variables"]["deps"]["db"], orgId: string) {
  const [s] = await db.select({ tz: orgSettings.timezone }).from(orgSettings).where(eq(orgSettings.orgId, orgId));
  return todayIn(s?.tz ?? "Asia/Kolkata");
}

/*
 * Unauthenticated routes. The client-facing invoice page is reached with an
 * unguessable link token; Razorpay webhooks are verified by signature.
 */

async function byToken(db: AppEnv["Variables"]["deps"]["db"], token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HTTPException(404, { message: "This link isn't valid" });
  const [inv] = await db.select().from(invoices).where(eq(invoices.publicTokenHash, await sha256Hex(token)));
  if (!inv || inv.status === "draft") throw new HTTPException(404, { message: "This link isn't valid" });
  return inv;
}

export const financePublicRoutes = new Hono<AppEnv>()

  .get("/public/invoices/:token", async (c) => {
    const { db } = c.get("deps");
    const inv = await byToken(db, c.req.param("token"));
    const settings = await loadSettings(db, inv.orgId);
    const [org] = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, inv.orgId));
    const [client] = await db.select().from(clients).where(eq(clients.id, inv.clientId));
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.position));
    const schedule = inv.kind === "invoice" ? await planView(db, inv.id) : null;
    const online = Boolean(settings.razorpayKeyId && settings.razorpayKeySecretEnc);
    // A quote's receipts; a final invoice lists the receipts that settled it.
    const [source] = inv.kind === "invoice" && inv.relatedId ? await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id, inv.relatedId), eq(invoices.kind, "quote"))) : [];
    const quoteId = inv.kind === "quote" ? inv.id : (source?.id ?? null);
    const openQuote = inv.kind === "quote" && (OPEN_QUOTE as readonly string[]).includes(inv.status);
    c.header("cache-control", "no-store");
    c.header("x-robots-tag", "noindex");
    return c.json({
      document: {
        kind: inv.kind,
        number: inv.number,
        status: inv.status,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        currency: inv.currency,
        placeOfSupply: inv.placeOfSupply,
        supplyType: inv.supplyType,
        subtotal: inv.subtotal,
        discountTotal: inv.discountTotal,
        taxableTotal: inv.taxableTotal,
        cgst: inv.cgst,
        sgst: inv.sgst,
        igst: inv.igst,
        roundOff: inv.roundOff,
        total: inv.total,
        amountPaid: inv.amountPaid,
        notes: inv.notes,
        terms: inv.terms,
      },
      receipts: quoteId ? (await receiptsFor(db, quoteId)).filter((r) => !r.voidedAt).map(({ voidedAt: _, ...r }) => r) : [],
      /** On a quote: what the team has asked the client to pay now (an advance), else the balance. */
      amountRequested: openQuote ? (inv.paymentLinkAmount ?? inv.total - inv.amountPaid) : null,
      lines: lines.map(({ orgId: _, invoiceId: __, itemId: ___, ...l }) => l),
      client: {
        name: client!.name,
        legalName: client!.legalName,
        gstin: client!.gstin,
        billingAddress: client!.billingAddress,
        stateCode: client!.stateCode,
        country: client!.country,
      },
      seller: {
        name: org!.name,
        legalName: settings.legalName,
        gstin: settings.gstin,
        pan: settings.pan,
        stateCode: settings.stateCode,
        address: settings.address,
        email: settings.email,
        phone: settings.phone,
        logo: settings.logo,
        bank: settings.bank,
      },
      installments: schedule
        ? {
            count: schedule.plan.count,
            annualRate: schedule.plan.annualRate,
            frequency: schedule.plan.frequency,
            rows: schedule.installments.map((r) => ({ id: r.id, seq: r.seq, dueDate: r.dueDate, principal: r.principal, interest: r.interest, interestTax: r.interestTax, total: r.total, amountPaid: r.amountPaid, status: r.status })),
          }
        : null,
      // With a plan, the client pays instalment by instalment (only those already billed).
      canPayOnline:
        online &&
        (openQuote || (inv.kind === "invoice" && ["sent", "partially_paid"].includes(inv.status) && (schedule?.plan.status === "active" ? schedule.installments.some((r) => r.status === "billed") : true))),
    });
  })

  .post("/public/invoices/:token/pay", async (c) => {
    const deps = c.get("deps");
    const inv = await byToken(deps.db, c.req.param("token"));
    const plan = await activePlan(deps.db, inv.id);
    if (plan) {
      // Pay the earliest billed instalment that's still open.
      const [next] = await deps.db
        .select()
        .from(installments)
        .where(and(eq(installments.planId, plan.id), inArray(installments.status, ["billed"])))
        .orderBy(asc(installments.seq))
        .limit(1);
      if (!next) throw new HTTPException(409, { message: "Nothing is due yet. You'll get an email when the next instalment is due." });
      return c.json({ url: await installmentPaymentLink(deps, next, await loadSettings(deps.db, inv.orgId), await orgToday(deps.db, inv.orgId)) });
    }
    // Reuse a link created for the current balance; otherwise make a new one.
    const url = inv.paymentLinkUrl ?? (await createPaymentLink(deps, inv, await loadSettings(deps.db, inv.orgId)));
    return c.json({ url });
  })

  .post("/public/razorpay/:orgId/webhook", async (c) => {
    const { db, secrets } = c.get("deps");
    const orgId = c.req.param("orgId");
    if (!z.uuid().safeParse(orgId).success) return c.text("Not found", 404);
    const settings = await loadSettings(db, orgId).catch(() => null);
    if (!settings?.razorpayWebhookSecretEnc) return c.text("Webhook not configured", 404);

    const raw = await c.req.text();
    const signature = c.req.header("x-razorpay-signature") ?? "";
    const expected = await hmacSha256Hex(await secrets.decrypt(settings.razorpayWebhookSecretEnc), raw);
    if (!safeEqual(signature, expected)) return c.text("Invalid signature", 401);

    const event = JSON.parse(raw) as {
      event: string;
      payload?: {
        payment_link?: { entity?: { id?: string; notes?: Record<string, string> } };
        payment?: { entity?: { id?: string; amount?: number; method?: string; created_at?: number } };
      };
    };
    if (event.event !== "payment_link.paid") return c.body(null, 204);

    const link = event.payload?.payment_link?.entity;
    const pay = event.payload?.payment?.entity;
    if (!link?.id || !pay?.id || !pay.amount) return c.body(null, 204);
    const deps = c.get("deps");
    const paidOnDate = new Date((pay.created_at ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10);

    // An instalment's link: split between its interest invoice and the original invoice.
    const [inst] = await db.select().from(installments).where(and(eq(installments.orgId, orgId), eq(installments.paymentLinkId, link.id)));
    if (inst) {
      if (inst.status === "paid" || inst.status === "cancelled") return c.body(null, 204);
      await payInstallment(
        c.get("deps"),
        inst,
        { amount: pay.amount, method: "razorpay", paidOn: paidOnDate, reference: pay.id, notes: pay.method ? `Paid online by ${pay.method}` : "Paid online", gatewayPaymentId: pay.id, createdBy: "razorpay" },
        await orgToday(db, orgId),
      ).catch((e) => console.error("Instalment payment from Razorpay failed", e));
      return c.body(null, 204);
    }
    // The current link, or an older one for the same document (its notes name the document).
    const noted = link.notes?.invoice_id && z.uuid().safeParse(link.notes.invoice_id).success ? link.notes.invoice_id : null;
    const [inv] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), noted ? or(eq(invoices.paymentLinkId, link.id), eq(invoices.id, noted)) : eq(invoices.paymentLinkId, link.id)));
    if (!inv) return c.body(null, 204);

    const payment = await recordPayment(db, inv, {
      amount: pay.amount,
      method: "razorpay",
      paidOn: paidOnDate,
      reference: pay.id,
      notes: pay.method ? `Paid online by ${pay.method}` : "Paid online",
      gatewayPaymentId: pay.id,
      createdBy: "razorpay",
    });
    if (payment) {
      if (payment.receiptNumber) await emailReceipt(deps, inv, payment);
      if (inv.createdBy && inv.createdBy !== "system") {
        await db.insert(notifications).values({
          orgId,
          recipientId: inv.createdBy,
          type: "payment.received",
          title: `Payment received for ${inv.number}`,
          body: `${formatMoney(pay.amount, inv.currency)} paid online${payment.receiptNumber ? `, receipt ${payment.receiptNumber}` : ""}`,
          link: `/finance/invoices/${inv.id}`,
        });
      }
    }
    return c.body(null, 204);
  });

