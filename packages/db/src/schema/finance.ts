import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "@operant/core";
import { orgs } from "./foundation.ts";

/*
 * Amounts are integer paise (bigint, read as JS numbers: safe up to ~₹90 lakh crore).
 * Quotes, invoices and credit notes share one table and line format.
 *
 * A quote is what the client pays against: every payment on it gets a numbered receipt
 * (a GST receipt voucher), and once it's fully paid the final tax invoice is generated
 * from it. Invoices issued directly (retainers, milestones, ad hoc) are paid as before.
 */

const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);
const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());
const money = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);

export interface BankDetails {
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  upiId?: string;
}

export const financeSettings = pgTable("finance_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  legalName: text("legal_name"),
  gstin: text("gstin"),
  pan: text("pan"),
  /** GST state code of the business, e.g. "27" (Maharashtra). */
  stateCode: text("state_code"),
  address: text("address"),
  email: text("email"),
  phone: text("phone"),
  /** Company logo for invoices, receipts and quotes: a small PNG, JPEG or WebP as a data URL. */
  logo: text("logo"),
  invoicePrefix: text("invoice_prefix").notNull().default("INV"),
  quotePrefix: text("quote_prefix").notNull().default("QT"),
  creditNotePrefix: text("credit_note_prefix").notNull().default("CN"),
  /** Receipts for payments received against a quote (advances and part payments). */
  receiptPrefix: text("receipt_prefix").notNull().default("RCPT"),
  defaultDueDays: integer("default_due_days").notNull().default(15),
  terms: text("terms"),
  notes: text("notes"),
  bank: jsonb("bank").$type<BankDetails>().notNull().default({}),
  roundOff: boolean("round_off").notNull().default(true),
  /** Razorpay keys; secrets are encrypted at rest and never returned to browsers. */
  razorpayKeyId: text("razorpay_key_id"),
  razorpayKeySecretEnc: text("razorpay_key_secret_enc"),
  razorpayWebhookSecretEnc: text("razorpay_webhook_secret_enc"),
  updatedAt: updatedAt(),
}).enableRLS();

export const clients = pgTable(
  "clients",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    gstin: text("gstin"),
    email: text("email"),
    phone: text("phone"),
    billingAddress: text("billing_address"),
    /** Place of supply (GST state code); null for clients abroad. */
    stateCode: text("state_code"),
    country: text("country").notNull().default("IN"),
    currency: text("currency").notNull().default("INR"),
    paymentTermsDays: integer("payment_terms_days"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_org_idx").on(t.orgId), uniqueIndex("clients_org_name_key").on(t.orgId, sql`lower(${t.name})`)],
).enableRLS();

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: id(),
    orgId: orgId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    designation: text("designation"),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [index("client_contacts_client_idx").on(t.clientId)],
).enableRLS();

export const taxRates = pgTable(
  "tax_rates",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    rate: numeric("rate", { precision: 5, scale: 2, mode: "number" }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("tax_rates_org_idx").on(t.orgId)],
).enableRLS();

export const items = pgTable(
  "items",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    /** HSN (goods) or SAC (services) code. */
    hsnSac: text("hsn_sac"),
    unit: text("unit").notNull().default("unit"),
    unitPrice: money("unit_price"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(18),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("items_org_idx").on(t.orgId)],
).enableRLS();

export const DOCUMENT_KINDS = ["quote", "invoice", "credit_note"] as const;
export const DOCUMENT_STATUSES = ["draft", "sent", "partially_paid", "paid", "accepted", "declined", "void"] as const;
export const SUPPLY_TYPES = ["intra", "inter", "export"] as const;

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    orgId: orgId(),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull().default("invoice"),
    /** Assigned when issued, gap-free per financial year (e.g. INV/26-27/0001). */
    number: text("number"),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    milestoneId: uuid("milestone_id"),
    /** Credit note → the invoice it adjusts; invoice → the quote it came from. */
    relatedId: uuid("related_id"),
    status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("draft"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    currency: text("currency").notNull().default("INR"),
    placeOfSupply: text("place_of_supply"),
    supplyType: text("supply_type", { enum: SUPPLY_TYPES }).notNull().default("intra"),
    subtotal: money("subtotal"),
    discountTotal: money("discount_total"),
    taxableTotal: money("taxable_total"),
    cgst: money("cgst"),
    sgst: money("sgst"),
    igst: money("igst"),
    roundOff: money("round_off"),
    total: money("total"),
    amountPaid: money("amount_paid"),
    notes: text("notes"),
    terms: text("terms"),
    /** SHA-256 of the client-facing link token. */
    publicTokenHash: text("public_token_hash"),
    paymentLinkId: text("payment_link_id"),
    paymentLinkUrl: text("payment_link_url"),
    /** What the current payment link asks for (an advance on a quote can be less than the balance). */
    paymentLinkAmount: bigint("payment_link_amount", { mode: "number" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    recurringId: uuid("recurring_id"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("invoices_org_kind_status_idx").on(t.orgId, t.kind, t.status),
    index("invoices_client_idx").on(t.clientId),
    index("invoices_project_idx").on(t.projectId),
    uniqueIndex("invoices_org_number_key").on(t.orgId, t.kind, t.number).where(sql`${t.number} is not null`),
    uniqueIndex("invoices_public_token_key").on(t.publicTokenHash).where(sql`${t.publicTokenHash} is not null`),
  ],
).enableRLS();

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    orgId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    itemId: uuid("item_id"),
    description: text("description").notNull(),
    hsnSac: text("hsn_sac"),
    quantity: numeric("quantity", { precision: 12, scale: 3, mode: "number" }).notNull(),
    unit: text("unit"),
    unitPrice: money("unit_price"),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    /** Taxable value of the line, after discount. */
    amount: money("amount"),
    taxAmount: money("tax_amount"),
  },
  (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId, t.position)],
).enableRLS();

export const PAYMENT_METHODS = ["bank_transfer", "upi", "cash", "cheque", "card", "razorpay", "credit_note", "other"] as const;

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orgId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    amount: money("amount"),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    paidOn: date("paid_on").notNull(),
    reference: text("reference"),
    notes: text("notes"),
    /** Gateway payment id (e.g. Razorpay pay_…); unique so webhooks can't double-count. */
    gatewayPaymentId: text("gateway_payment_id"),
    /** Set when the payment was for an instalment of a plan (see installments). */
    installmentId: uuid("installment_id"),
    /**
     * Payments against a quote get a receipt: numbered per financial year, with the GST
     * contained in the amount (the quote's tax, in proportion). Null for invoice payments.
     */
    receiptNumber: text("receipt_number"),
    receiptCgst: bigint("receipt_cgst", { mode: "number" }),
    receiptSgst: bigint("receipt_sgst", { mode: "number" }),
    receiptIgst: bigint("receipt_igst", { mode: "number" }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_invoice_idx").on(t.invoiceId),
    index("payments_org_paid_idx").on(t.orgId, t.paidOn),
    index("payments_installment_idx").on(t.installmentId),
    uniqueIndex("payments_gateway_key").on(t.orgId, t.gatewayPaymentId).where(sql`${t.gatewayPaymentId} is not null`),
    uniqueIndex("payments_receipt_key").on(t.orgId, t.receiptNumber).where(sql`${t.receiptNumber} is not null`),
  ],
).enableRLS();

export interface RecurringLine {
  itemId?: string | null;
  description: string;
  hsnSac?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice: number;
  discountPct?: number;
  taxRate: number;
}

export const RECURRING_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;

export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: id(),
    orgId: orgId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    name: text("name").notNull(),
    frequency: text("frequency", { enum: RECURRING_FREQUENCIES }).notNull().default("monthly"),
    nextIssueDate: date("next_issue_date").notNull(),
    endDate: date("end_date"),
    dueDays: integer("due_days").notNull().default(15),
    lines: jsonb("lines").$type<RecurringLine[]>().notNull().default([]),
    notes: text("notes"),
    /** Issue and email automatically; otherwise a draft is created for review. */
    autoSend: boolean("auto_send").notNull().default(false),
    active: boolean("active").notNull().default(true),
    lastIssuedAt: timestamp("last_issued_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("recurring_invoices_due_idx").on(t.active, t.nextIssueDate)],
).enableRLS();

export const INSTALLMENT_FREQUENCIES = ["monthly", "quarterly"] as const;
export const PLAN_STATUSES = ["active", "completed", "cancelled"] as const;
export const INSTALLMENT_STATUSES = ["scheduled", "billed", "paid", "cancelled"] as const;

/**
 * An issued invoice's balance, repaid in instalments with reducing-balance interest.
 * The invoice itself never changes; each instalment's interest is billed on its own
 * GST invoice when the instalment falls due.
 */
export const installmentPlans = pgTable(
  "installment_plans",
  {
    id: id(),
    orgId: orgId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    /** The invoice balance the plan repays. */
    principal: money("principal"),
    annualRate: numeric("annual_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    count: integer("count").notNull(),
    frequency: text("frequency", { enum: INSTALLMENT_FREQUENCIES }).notNull().default("monthly"),
    firstDueDate: date("first_due_date").notNull(),
    /** GST on the interest (interest on deferred payment is part of the value of supply). */
    interestTaxRate: numeric("interest_tax_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(18),
    /** The invoice's due date before the plan, restored if the plan is cancelled. */
    originalDueDate: date("original_due_date"),
    status: text("status", { enum: PLAN_STATUSES }).notNull().default("active"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    index("installment_plans_invoice_idx").on(t.invoiceId),
    uniqueIndex("installment_plans_active_key").on(t.invoiceId).where(sql`${t.status} = 'active'`),
  ],
).enableRLS();

export const installments = pgTable(
  "installments",
  {
    id: id(),
    orgId: orgId(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => installmentPlans.id, { onDelete: "cascade" }),
    /** The invoice being repaid (the plan's invoice). */
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    dueDate: date("due_date").notNull(),
    principal: money("principal"),
    interest: money("interest"),
    /** The GST invoice for this instalment's interest, issued when it's billed. */
    interestInvoiceId: uuid("interest_invoice_id"),
    status: text("status", { enum: INSTALLMENT_STATUSES }).notNull().default("scheduled"),
    /** Received so far (interest invoice first, then principal), from payments. */
    amountPaid: money("amount_paid"),
    billedAt: timestamp("billed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentLinkId: text("payment_link_id"),
    paymentLinkUrl: text("payment_link_url"),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("installments_plan_seq_key").on(t.planId, t.seq),
    index("installments_org_due_idx").on(t.orgId, t.status, t.dueDate),
    index("installments_invoice_idx").on(t.invoiceId),
    index("installments_interest_invoice_idx").on(t.interestInvoiceId),
    index("installments_link_idx").on(t.paymentLinkId),
  ],
).enableRLS();
