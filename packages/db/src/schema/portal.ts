import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "@operant/core";
import { clients, invoices } from "./finance.ts";
import { members, orgs } from "./foundation.ts";
import { projects } from "./work.ts";

/*
 * The client portal: a separate app where an organization's clients sign in with an
 * email code, request listed services, talk to the team, share documents and follow
 * their projects and invoices. Everything here is scoped to one organization.
 */

const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);
const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const PRICE_TYPES = ["fixed", "from", "quote"] as const;
export const SERVICE_BILLING = ["one_time", "monthly", "quarterly", "yearly"] as const;

export interface RequiredDoc {
  name: string;
  hint?: string | null;
}

/** What the organization offers its clients. */
export const services = pgTable(
  "services",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    /** One line for cards and the directory. */
    summary: text("summary"),
    description: text("description"),
    category: text("category"),
    /** fixed: "₹5,000"; from: "From ₹5,000"; quote: price on request. */
    priceType: text("price_type", { enum: PRICE_TYPES }).notNull().default("quote"),
    price: bigint("price", { mode: "number" }),
    billing: text("billing", { enum: SERVICE_BILLING }).notNull().default("one_time"),
    /** Typical turnaround, shown to clients. */
    deliveryDays: integer("delivery_days"),
    /** Documents the client is asked for when they request it. */
    requiredDocs: jsonb("required_docs").$type<RequiredDoc[]>().notNull().default([]),
    /** A project to copy (stages, milestones, tasks) when work starts. */
    templateProjectId: uuid("template_project_id").references(() => projects.id, { onDelete: "set null" }),
    /** Who looks after new requests (a sign-in account id); otherwise owners and admins. */
    ownerUserId: text("owner_user_id"),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [index("services_org_idx").on(t.orgId, t.active, t.position)],
).enableRLS();

/** A client's person: signs in to the portal with an email code. */
export const portalUsers = pgTable(
  "portal_users",
  {
    id: id(),
    orgId: orgId(),
    email: text("email").notNull(),
    name: text("name"),
    phone: text("phone"),
    /** The client (company) they act for; created or matched on their first request. */
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("portal_users_org_email_key").on(t.orgId, sql`lower(${t.email})`), index("portal_users_client_idx").on(t.clientId)],
).enableRLS();

/** One-time sign-in codes (only a hash is kept). */
export const portalCodes = pgTable(
  "portal_codes",
  {
    id: id(),
    orgId: orgId(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("portal_codes_email_idx").on(t.orgId, t.email, t.createdAt)],
).enableRLS();

export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: id(),
    orgId: orgId(),
    portalUserId: uuid("portal_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("portal_sessions_token_key").on(t.tokenHash)],
).enableRLS();

export const REQUEST_STATUSES = ["new", "in_discussion", "quoted", "accepted", "started", "declined", "withdrawn"] as const;

/** A client asking for a service. Becomes a project when work starts. */
export const serviceRequests = pgTable(
  "service_requests",
  {
    id: id(),
    orgId: orgId(),
    /** Per-org number, shown as REQ-12. */
    number: integer("number").notNull(),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    portalUserId: uuid("portal_user_id").references(() => portalUsers.id, { onDelete: "set null" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    details: text("details"),
    status: text("status", { enum: REQUEST_STATUSES }).notNull().default("new"),
    /** Who on the team is handling it (a sign-in account id). */
    assigneeUserId: text("assignee_user_id"),
    quoteId: uuid("quote_id").references(() => invoices.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    declineReason: text("decline_reason"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("service_requests_org_number_key").on(t.orgId, t.number),
    index("service_requests_org_status_idx").on(t.orgId, t.status),
    index("service_requests_client_idx").on(t.clientId),
    index("service_requests_project_idx").on(t.projectId),
  ],
).enableRLS();

export const MESSAGE_AUTHORS = ["client", "staff", "system"] as const;

/**
 * The conversation between a client and the team, on a request and then on the project
 * it became. Separate from internal chat, so nothing internal reaches a client by mistake.
 */
export const portalMessages = pgTable(
  "portal_messages",
  {
    id: id(),
    orgId: orgId(),
    requestId: uuid("request_id").references(() => serviceRequests.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    authorKind: text("author_kind", { enum: MESSAGE_AUTHORS }).notNull(),
    portalUserId: uuid("portal_user_id").references(() => portalUsers.id, { onDelete: "set null" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** When the other side first saw it. */
    seenByClientAt: timestamp("seen_by_client_at", { withTimezone: true }),
    seenByStaffAt: timestamp("seen_by_staff_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("portal_messages_request_idx").on(t.requestId, t.createdAt), index("portal_messages_project_idx").on(t.projectId, t.createdAt)],
).enableRLS();

export const CLIENT_DOC_STATUSES = ["requested", "uploaded", "accepted", "rejected"] as const;

/** A document the team needs from the client: a checklist item with uploads. */
export const clientDocuments = pgTable(
  "client_documents",
  {
    id: id(),
    orgId: orgId(),
    requestId: uuid("request_id").references(() => serviceRequests.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hint: text("hint"),
    status: text("status", { enum: CLIENT_DOC_STATUSES }).notNull().default("requested"),
    /** Why it was sent back. */
    note: text("note"),
    requestedBy: text("requested_by"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("client_documents_request_idx").on(t.requestId), index("client_documents_project_idx").on(t.projectId)],
).enableRLS();

export const COUNTER_OFFER_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;

/**
 * A client's proposed price for a quote (the total, including GST), made from the portal.
 * The team approves it, which issues a revised quote at that price in place of the old one,
 * or rejects it with a reason. One pending proposal per quote.
 */
export const quoteCounterOffers = pgTable(
  "quote_counter_offers",
  {
    id: id(),
    orgId: orgId(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    portalUserId: uuid("portal_user_id").references(() => portalUsers.id, { onDelete: "set null" }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    note: text("note"),
    status: text("status", { enum: COUNTER_OFFER_STATUSES }).notNull().default("pending"),
    /** The team's reply when rejecting. */
    response: text("response"),
    /** The revised quote issued on approval. */
    revisedQuoteId: uuid("revised_quote_id").references(() => invoices.id, { onDelete: "set null" }),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("quote_counter_offers_quote_idx").on(t.quoteId, t.createdAt),
    uniqueIndex("quote_counter_offers_pending_key").on(t.quoteId).where(sql`${t.status} = 'pending'`),
  ],
).enableRLS();
