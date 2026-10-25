import { addDays, formatMoney, scaleLinesToTotal, todayIn } from "@operant/core";
import { type Db, invoiceLines, invoices, portalMessages, portalUsers, quoteCounterOffers, serviceRequests } from "@operant/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ApiDeps } from "../context.ts";
import { orgWorkSettings } from "../helpers.ts";
import { emailClientPeople } from "../portal/shared.ts";
import { type Invoice, issue, loadSettings, writeLines } from "./service.ts";

/*
 * Counter-offers: a client proposes a different price for a quote from the portal, and the
 * team approves it (a revised quote at that price replaces the old one, already accepted,
 * since the client named the price) or rejects it with a reason.
 */

export type CounterOffer = typeof quoteCounterOffers.$inferSelect;

/** Proposals on a quote, newest first, with who made them. */
export async function counterOffersFor(db: Db, quoteId: string) {
  return db
    .select({
      id: quoteCounterOffers.id,
      amount: quoteCounterOffers.amount,
      note: quoteCounterOffers.note,
      status: quoteCounterOffers.status,
      response: quoteCounterOffers.response,
      revisedQuoteId: quoteCounterOffers.revisedQuoteId,
      decidedAt: quoteCounterOffers.decidedAt,
      createdAt: quoteCounterOffers.createdAt,
      byName: portalUsers.name,
      byEmail: portalUsers.email,
    })
    .from(quoteCounterOffers)
    .leftJoin(portalUsers, eq(portalUsers.id, quoteCounterOffers.portalUserId))
    .where(eq(quoteCounterOffers.quoteId, quoteId))
    .orderBy(desc(quoteCounterOffers.createdAt));
}

/** The latest proposal on each quote, as the client sees it. */
export async function latestCounterOffers(db: Db, quoteIds: string[]) {
  if (!quoteIds.length) return new Map<string, { amount: number; status: CounterOffer["status"]; response: string | null; createdAt: Date }>();
  const rows = await db
    .select({ quoteId: quoteCounterOffers.quoteId, amount: quoteCounterOffers.amount, status: quoteCounterOffers.status, response: quoteCounterOffers.response, createdAt: quoteCounterOffers.createdAt })
    .from(quoteCounterOffers)
    .where(inArray(quoteCounterOffers.quoteId, quoteIds))
    .orderBy(asc(quoteCounterOffers.createdAt));
  return new Map(rows.map(({ quoteId, ...r }) => [quoteId, r]));
}

async function loadPending(db: Db, quote: Invoice, offerId: string) {
  const [offer] = await db.select().from(quoteCounterOffers).where(and(eq(quoteCounterOffers.id, offerId), eq(quoteCounterOffers.quoteId, quote.id)));
  if (!offer) throw new HTTPException(404, { message: "Counter-offer not found" });
  if (offer.status !== "pending") throw new HTTPException(409, { message: "This counter-offer has already been answered" });
  if (quote.status !== "sent" || quote.amountPaid > 0) throw new HTTPException(409, { message: "This quote can no longer be changed" });
  return offer;
}

async function tellClient(deps: ApiDeps, quote: Invoice, offer: CounterOffer, message: string, subject: string) {
  const [request] = await deps.db.select({ id: serviceRequests.id }).from(serviceRequests).where(eq(serviceRequests.quoteId, quote.id));
  if (request) await deps.db.insert(portalMessages).values({ orgId: quote.orgId, requestId: request.id, authorKind: "system", body: message });
  await emailClientPeople(deps, quote.orgId, { clientId: quote.clientId, portalUserId: offer.portalUserId }, { subject, lead: message, path: "/billing", cta: "Open your portal" });
  return request ?? null;
}

/** Approve: issue a revised quote at the client's price, accepted, in place of the old one. */
export async function approveCounterOffer(deps: ApiDeps, quote: Invoice, offerId: string, userId: string) {
  const { db } = deps;
  const offer = await loadPending(db, quote, offerId);
  const settings = await loadSettings(db, quote.orgId);
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, quote.id)).orderBy(asc(invoiceLines.position));
  // Price the lines as they'll be saved (no GST without a GSTIN), so the total lands on the offer.
  const effective = lines.map((l) => ({ ...l, taxRate: settings.gstin ? l.taxRate : 0 }));
  const repriced = scaleLinesToTotal(effective, quote.supplyType, { roundOff: settings.roundOff }, offer.amount);

  const { timezone } = await orgWorkSettings(db, quote.orgId);
  const today = todayIn(timezone);
  const [draft] = await db
    .insert(invoices)
    .values({
      orgId: quote.orgId,
      kind: "quote",
      clientId: quote.clientId,
      projectId: quote.projectId,
      milestoneId: quote.milestoneId,
      relatedId: quote.id,
      issueDate: today,
      dueDate: quote.dueDate && quote.dueDate >= today ? quote.dueDate : addDays(today, 30),
      currency: quote.currency,
      placeOfSupply: quote.placeOfSupply,
      supplyType: quote.supplyType,
      notes: quote.notes,
      terms: quote.terms,
      createdBy: userId,
    })
    .returning();
  await writeLines(db, quote.orgId, draft!.id, repriced, quote.supplyType, settings);
  const [fresh] = await db.select().from(invoices).where(eq(invoices.id, draft!.id));
  const { number } = await issue(deps, fresh!, settings);
  await db.update(invoices).set({ status: "accepted" }).where(eq(invoices.id, draft!.id));
  await db.update(invoices).set({ status: "void", voidedAt: new Date() }).where(eq(invoices.id, quote.id));
  await db
    .update(quoteCounterOffers)
    .set({ status: "approved", revisedQuoteId: draft!.id, decidedBy: userId, decidedAt: new Date() })
    .where(eq(quoteCounterOffers.id, offer.id));
  await db.update(serviceRequests).set({ quoteId: draft!.id }).where(eq(serviceRequests.quoteId, quote.id));
  await db.update(serviceRequests).set({ status: "accepted" }).where(and(eq(serviceRequests.quoteId, draft!.id), eq(serviceRequests.status, "quoted")));
  const total = fresh!.total;
  await tellClient(
    deps,
    quote,
    offer,
    `Your proposed price of ${formatMoney(offer.amount, quote.currency)} for quote ${quote.number} has been approved. Revised quote ${number} for ${formatMoney(total, quote.currency)} replaces it, and is accepted.`,
    `Your price is approved: quote ${number}`,
  );
  return { id: draft!.id, number, total };
}

/** Reject: the quote stands as it is; the client can accept it, decline it or propose again. */
export async function rejectCounterOffer(deps: ApiDeps, quote: Invoice, offerId: string, userId: string, reason: string | null) {
  const offer = await loadPending(deps.db, quote, offerId);
  await deps.db
    .update(quoteCounterOffers)
    .set({ status: "rejected", response: reason, decidedBy: userId, decidedAt: new Date() })
    .where(eq(quoteCounterOffers.id, offer.id));
  await tellClient(
    deps,
    quote,
    offer,
    `We can't agree to ${formatMoney(offer.amount, quote.currency)} for quote ${quote.number}.${reason ? ` ${reason}` : ""} The quote still stands at ${formatMoney(quote.total, quote.currency)}.`,
    `About your proposed price for quote ${quote.number}`,
  );
}
