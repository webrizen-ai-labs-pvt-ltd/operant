import { INDIAN_STATES, isValidGstin, stateOfGstin } from "@operant/core";
import { clientContacts, clients, financeSettings, invoices, items, taxRates } from "@operant/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit } from "../audit.ts";
import type { AppEnv } from "../context.ts";
import { notFound } from "../helpers.ts";
import { requirePermission } from "../middleware.ts";
import { likePattern, validate } from "../validate.ts";
import { loadSettings } from "./service.ts";
import { deliver, MAIL_REASON, renderEmail } from "./email.ts";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email"))
  .nullish()
  .or(z.literal("").transform(() => null));
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidGstin, "That GSTIN isn't valid")
  .nullish()
  .or(z.literal("").transform(() => null));
const stateCode = z
  .string()
  .refine((s) => s in INDIAN_STATES, "Unknown state")
  .nullish();
const rate = z.number().min(0).max(100);

function isUnique(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.cause?.code ?? e?.code) === "23505";
}

/** About 300 KB of image, base64-encoded. */
const MAX_LOGO_CHARS = 400_000;

const settingsInput = z
  .object({
    legalName: text(200),
    gstin,
    pan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "That PAN isn't valid")
      .nullish()
      .or(z.literal("").transform(() => null)),
    stateCode,
    address: text(500),
    email,
    phone: text(32),
    /** A small PNG, JPEG or WebP as a data URL (no SVG: it can carry scripts). Null removes it. */
    logo: z
      .string()
      .max(MAX_LOGO_CHARS, "Use a smaller logo (under 300 KB)")
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, "Upload a PNG, JPEG or WebP image")
      .nullable(),
    invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,6}$/, "Up to 6 letters or digits"),
    quotePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,6}$/, "Up to 6 letters or digits"),
    creditNotePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,6}$/, "Up to 6 letters or digits"),
    receiptPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,6}$/, "Up to 6 letters or digits"),
    defaultDueDays: z.number().int().min(0).max(365),
    terms: text(4000),
    notes: text(2000),
    bank: z.object({
      accountName: text(120),
      accountNumber: text(34),
      ifsc: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "That IFSC isn't valid")
        .nullish()
        .or(z.literal("").transform(() => null)),
      bankName: text(120),
      upiId: text(100),
    }),
    roundOff: z.boolean(),
    razorpayKeyId: text(64),
    /** Write-only: send to set, null to clear, omit to keep. */
    razorpayKeySecret: z.string().trim().max(128).nullable(),
    razorpayWebhookSecret: z.string().trim().max(128).nullable(),
  })
  .partial();

const contactInput = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  phone: text(32),
  designation: text(80),
  isPrimary: z.boolean().default(false),
});

const clientInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(160),
  legalName: text(200),
  gstin,
  email,
  phone: text(32),
  billingAddress: text(500),
  stateCode,
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a 2-letter country code")
    .default("IN"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default("INR"),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
  notes: text(2000),
  contacts: z.array(contactInput).max(20).optional(),
});

/** GSTIN implies the state; a client abroad has no state. */
function normalizeClient<T extends { gstin?: string | null; stateCode?: string | null; country?: string }>(c: T): T {
  const out = { ...c };
  if (out.gstin) out.stateCode = stateOfGstin(out.gstin);
  if (out.country && out.country !== "IN") out.stateCode = null;
  return out;
}

export const financeSetupRoutes = new Hono<AppEnv>()

  /* ---------------- Settings ---------------- */

  .get("/finance/settings", requirePermission("invoice", "read"), async (c) => {
    const s = await loadSettings(c.get("deps").db, c.get("org").id);
    const { razorpayKeySecretEnc, razorpayWebhookSecretEnc, ...safe } = s;
    return c.json({
      settings: { ...safe, razorpayConnected: Boolean(s.razorpayKeyId && razorpayKeySecretEnc), webhookConfigured: Boolean(razorpayWebhookSecretEnc) },
      webhookUrl: `${c.get("deps").appUrl.replace(/\/$/, "")}/api/v1/public/razorpay/${c.get("org").id}/webhook`,
      email: { enabled: c.get("deps").mailer.enabled, from: c.get("deps").mailer.from ?? null },
    });
  })

  /** Send a sample invoice email to yourself, to check email delivery end to end. */
  .post("/finance/settings/test-email", requirePermission("settings", "manage"), async (c) => {
    const deps = c.get("deps");
    const viewer = c.get("viewer")!;
    const s = await loadSettings(deps.db, c.get("org").id);
    const seller = s.legalName ?? c.get("org").name;
    const { html, text } = renderEmail({
      greeting: `Hello ${viewer.name},`,
      lead: `This is a test from Operant. If you're reading it, invoice emails from ${seller} will reach your clients, and their replies will go to ${s.email ?? "the address in Finance settings (none set yet)"}.`,
      rows: [
        ["Sent from", deps.mailer.from ?? "(not configured)"],
        ["Replies go to", s.email ?? "(not set)"],
      ],
      signOff: `Thank you,\n${seller}`,
    });
    const result = await deliver(deps.mailer, { to: viewer.email, subject: `Test email from ${seller}`, html, text, replyTo: s.email });
    return c.json({ to: viewer.email, ...result, message: result.sent ? null : MAIL_REASON[result.reason] + (result.error ? `: ${result.error}` : "") });
  })

  .patch("/finance/settings", requirePermission("settings", "manage"), validate("json", settingsInput), async (c) => {
    const { razorpayKeySecret, razorpayWebhookSecret, ...input } = c.req.valid("json");
    const { db, secrets } = c.get("deps");
    const org = c.get("org");
    await loadSettings(db, org.id);
    const values: Record<string, unknown> = { ...input };
    if (input.gstin) values.stateCode = stateOfGstin(input.gstin);
    if (razorpayKeySecret !== undefined) values.razorpayKeySecretEnc = razorpayKeySecret ? await secrets.encrypt(razorpayKeySecret) : null;
    if (razorpayWebhookSecret !== undefined) values.razorpayWebhookSecretEnc = razorpayWebhookSecret ? await secrets.encrypt(razorpayWebhookSecret) : null;
    await db.update(financeSettings).set(values).where(eq(financeSettings.orgId, org.id));
    await audit(c, "finance.settings_updated", { type: "org", id: org.id }, { fields: Object.keys(c.req.valid("json")) });
    return c.json({ ok: true });
  })

  /* ---------------- Tax rates ---------------- */

  .get("/finance/tax-rates", requirePermission("invoice", "read"), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    await loadSettings(db, org.id);
    let rows = await db.select().from(taxRates).where(and(eq(taxRates.orgId, org.id), isNull(taxRates.archivedAt))).orderBy(asc(taxRates.rate));
    if (!rows.length) {
      // GST slabs after the 2025 rationalisation; organisations can add others.
      await db.insert(taxRates).values([
        { orgId: org.id, name: "GST 0%", rate: 0 },
        { orgId: org.id, name: "GST 5%", rate: 5 },
        { orgId: org.id, name: "GST 18%", rate: 18, isDefault: true },
        { orgId: org.id, name: "GST 40%", rate: 40 },
      ]);
      rows = await db.select().from(taxRates).where(and(eq(taxRates.orgId, org.id), isNull(taxRates.archivedAt))).orderBy(asc(taxRates.rate));
    }
    return c.json({ taxRates: rows });
  })

  .post("/finance/tax-rates", requirePermission("settings", "manage"), validate("json", z.object({ name: z.string().trim().min(1).max(40), rate, isDefault: z.boolean().default(false) })), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const input = c.req.valid("json");
    if (input.isDefault) await db.update(taxRates).set({ isDefault: false }).where(eq(taxRates.orgId, org.id));
    const [row] = await db.insert(taxRates).values({ ...input, orgId: org.id }).returning();
    return c.json({ taxRate: row }, 201);
  })

  .delete("/finance/tax-rates/:id", requirePermission("settings", "manage"), async (c) => {
    const { db } = c.get("deps");
    const [row] = await db
      .update(taxRates)
      .set({ archivedAt: new Date() })
      .where(and(eq(taxRates.orgId, c.get("org").id), eq(taxRates.id, c.req.param("id"))))
      .returning({ id: taxRates.id });
    if (!row) notFound();
    return c.json({ ok: true });
  })

  /* ---------------- Items ---------------- */

  .get("/finance/items", requirePermission("invoice", "read"), async (c) => {
    const { db } = c.get("deps");
    const rows = await db.select().from(items).where(and(eq(items.orgId, c.get("org").id), isNull(items.archivedAt))).orderBy(asc(items.name));
    return c.json({ items: rows });
  })

  .post(
    "/finance/items",
    requirePermission("invoice", "create"),
    validate(
      "json",
      z.object({
        name: z.string().trim().min(1).max(160),
        description: text(1000),
        hsnSac: z.string().trim().regex(/^\d{4,8}$/, "HSN/SAC codes are 4 to 8 digits").nullish().or(z.literal("").transform(() => null)),
        unit: z.string().trim().min(1).max(20).default("unit"),
        unitPrice: z.number().int().min(0),
        taxRate: rate.default(18),
      }),
    ),
    async (c) => {
      const { db } = c.get("deps");
      const [row] = await db.insert(items).values({ ...c.req.valid("json"), orgId: c.get("org").id }).returning();
      return c.json({ item: row }, 201);
    },
  )

  .delete("/finance/items/:id", requirePermission("invoice", "create"), async (c) => {
    const { db } = c.get("deps");
    const [row] = await db
      .update(items)
      .set({ archivedAt: new Date() })
      .where(and(eq(items.orgId, c.get("org").id), eq(items.id, c.req.param("id"))))
      .returning({ id: items.id });
    if (!row) notFound();
    return c.json({ ok: true });
  })

  /* ---------------- Clients ---------------- */

  .get(
    "/clients",
    requirePermission("client", "read"),
    validate("query", z.object({ q: z.string().trim().max(100).optional(), archived: z.enum(["true", "false"]).default("false") })),
    async (c) => {
      const { q, archived } = c.req.valid("query");
      const { db } = c.get("deps");
      const org = c.get("org");
      const rows = await db
        .select({
          id: clients.id,
          name: clients.name,
          legalName: clients.legalName,
          gstin: clients.gstin,
          email: clients.email,
          phone: clients.phone,
          stateCode: clients.stateCode,
          country: clients.country,
          currency: clients.currency,
          archivedAt: clients.archivedAt,
          billed: sql<number>`coalesce(sum(${invoices.total}) filter (where ${invoices.kind} = 'invoice' and ${invoices.status} not in ('draft', 'void')), 0)`.mapWith(Number),
          outstanding: sql<number>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}) filter (where ${invoices.kind} = 'invoice' and ${invoices.status} in ('sent', 'partially_paid')), 0)`.mapWith(Number),
          overdue: sql<number>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}) filter (where ${invoices.kind} = 'invoice' and ${invoices.status} in ('sent', 'partially_paid') and ${invoices.dueDate} < current_date), 0)`.mapWith(Number),
        })
        .from(clients)
        .leftJoin(invoices, eq(invoices.clientId, clients.id))
        .where(
          and(
            eq(clients.orgId, org.id),
            archived === "true" ? sql`${clients.archivedAt} is not null` : isNull(clients.archivedAt),
            q ? sql`(${clients.name} ilike ${likePattern(q)} or ${clients.gstin} ilike ${likePattern(q)} or ${clients.email} ilike ${likePattern(q)})` : undefined,
          ),
        )
        .groupBy(clients.id)
        .orderBy(asc(clients.name));
      return c.json({ clients: rows });
    },
  )

  .get("/clients/:id", requirePermission("client", "read"), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const [client] = await db.select().from(clients).where(and(eq(clients.orgId, org.id), eq(clients.id, c.req.param("id"))));
    if (!client) notFound("Client not found");
    const contacts = await db.select().from(clientContacts).where(eq(clientContacts.clientId, client.id)).orderBy(asc(clientContacts.name));
    return c.json({ client, contacts });
  })

  .post("/clients", requirePermission("client", "create"), validate("json", clientInput), async (c) => {
    const { contacts = [], ...input } = normalizeClient(c.req.valid("json"));
    const { db } = c.get("deps");
    const org = c.get("org");
    try {
      const [row] = await db.insert(clients).values({ ...input, orgId: org.id }).returning({ id: clients.id });
      if (contacts.length) await db.insert(clientContacts).values(contacts.map((ct) => ({ ...ct, orgId: org.id, clientId: row!.id })));
      await audit(c, "client.created", { type: "client", id: row!.id }, { name: input.name });
      return c.json({ client: row }, 201);
    } catch (err) {
      if (isUnique(err)) throw new HTTPException(409, { message: "A client with that name already exists" });
      throw err;
    }
  })

  .patch(
    "/clients/:id",
    requirePermission("client", "update"),
    validate("json", clientInput.partial().extend({ archived: z.boolean().optional() })),
    async (c) => {
      const { contacts, archived, ...input } = normalizeClient(c.req.valid("json"));
      const { db } = c.get("deps");
      const org = c.get("org");
      const id = c.req.param("id");
      try {
        const [row] = await db
          .update(clients)
          .set({ ...input, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) })
          .where(and(eq(clients.orgId, org.id), eq(clients.id, id)))
          .returning({ id: clients.id });
        if (!row) notFound("Client not found");
      } catch (err) {
        if (isUnique(err)) throw new HTTPException(409, { message: "A client with that name already exists" });
        throw err;
      }
      if (contacts) {
        await db.delete(clientContacts).where(eq(clientContacts.clientId, id));
        if (contacts.length) await db.insert(clientContacts).values(contacts.map((ct) => ({ ...ct, orgId: org.id, clientId: id })));
      }
      await audit(c, archived ? "client.archived" : "client.updated", { type: "client", id }, { fields: Object.keys(input) });
      return c.json({ ok: true });
    },
  );
