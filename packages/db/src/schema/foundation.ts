import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "@operant/core";

/*
 * Conventions: UUID v7 ids generated in the app, org_id on every tenant table,
 * timestamps with time zone. RLS is enabled everywhere: the API connects as the
 * table owner, so RLS only blocks Supabase's public Data API (defense in depth).
 */

const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

export const orgs = pgTable(
  "orgs",
  {
    id: id(),
    /** Webrizen SSO organization id (cloud). Null in the offline edition. */
    externalId: text("external_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("orgs_external_id_key").on(t.externalId), uniqueIndex("orgs_slug_key").on(t.slug)],
).enableRLS();

export const orgSettings = pgTable("org_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  terms: jsonb("terms").$type<Record<string, { one: string; many: string }>>().notNull().default({}),
  enabledPillars: text("enabled_pillars")
    .array()
    .notNull()
    .default(sql`array['people','work','collab','finance']::text[]`),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  currency: text("currency").notNull().default("INR"),
  /** Working days, ISO numbering (1 = Monday … 7 = Sunday). */
  workWeek: integer("work_week").array().notNull().default(sql`array[1,2,3,4,5]::int[]`),
  /** Show this organization in the client portal's public directory. */
  portalListed: boolean("portal_listed").notNull().default(false),
  /** One line about the organization for the directory and its portal home. */
  portalTagline: text("portal_tagline"),
  updatedAt: updatedAt(),
}).enableRLS();

export const members = pgTable(
  "members",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** SSO `sub` (cloud) or local user id (offline). */
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    image: text("image"),
    /** The identity provider's organization role when it's owner or admin (they can do everything). */
    roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
    /** Their Operant role; null means the organization's default role. Ignored for owners and admins. */
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
    /** removed: gone from the organization. blocked: still in it, but turned off in Operant (offboarding). */
    status: text("status", { enum: ["active", "removed", "blocked"] }).notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("members_org_user_key").on(t.orgId, t.userId), index("members_org_idx").on(t.orgId)],
).enableRLS();

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_org_created_idx").on(t.orgId, t.createdAt)],
).enableRLS();

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** What the file is attached to, e.g. ("task", "<uuid>"). */
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    fileKey: text("file_key").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("attachments_owner_idx").on(t.orgId, t.ownerType, t.ownerId)],
).enableRLS();

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_recipient_idx").on(t.orgId, t.recipientId, t.createdAt)],
).enableRLS();

/** Gap-free per-org counters (invoice numbers etc.), incremented under a row lock. */
export const sequences = pgTable(
  "sequences",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
).enableRLS();

/** Delivered webhook ids, so duplicate deliveries are ignored. */
export const webhookReceipts = pgTable("webhook_receipts", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  type: text("type").notNull(),
  receivedAt: createdAt(),
}).enableRLS();

/* ---------- Offline edition only: local accounts ---------- */

export const localUsers = pgTable(
  "local_users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("local_users_email_key").on(sql`lower(${t.email})`)],
).enableRLS();

export const localSessions = pgTable(
  "local_sessions",
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => localUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("local_sessions_user_idx").on(t.userId)],
).enableRLS();

/** Each organization's own roles: a name and what it can do. Owners and admins don't need one. */
export const roles = pgTable(
  "roles",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    permissions: jsonb("permissions").$type<Record<string, string[]>>().notNull().default({}),
    isSystem: boolean("is_system").notNull().default(false),
    /** Given to people who join without a role. Exactly one per organization. */
    isDefault: boolean("is_default").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roles_org_key_key").on(t.orgId, t.key)],
).enableRLS();
