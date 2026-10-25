import { formatMoney, INDIAN_STATES, isValidGstin, stateOfGstin, uuidv7 } from "@operant/core";
import {
  attachments,
  clientContacts,
  clientDocuments,
  clients,
  employees,
  financeSettings,
  invoices,
  members,
  milestones,
  orgSettings,
  orgs,
  portalCodes,
  portalMessages,
  portalSessions,
  portalUsers,
  projectMembers,
  projects,
  quoteCounterOffers,
  serviceRequests,
  services,
  tasks,
} from "@operant/db";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv, PortalViewer } from "../context.ts";
import { deliver, renderEmail } from "../finance/email.ts";
import { effectiveDueDate } from "../finance/installments.ts";
import { latestCounterOffers } from "../finance/counter-offers.ts";
import { linkToken } from "../finance/service.ts";
import { MAX_UPLOAD_BYTES } from "../routes/files.ts";
import { nextSequence } from "../helpers.ts";
import { randomToken, sha256Hex } from "../secrets.ts";
import { validate } from "../validate.ts";
import { conversation, documentChecklist, markSeen, notifyStaff, priceLabel, REQUEST_LABEL, type Scope, staffCards, staffRecipients } from "./shared.ts";

/*
 * Client portal API. Clients sign in per organization with a one-time email code;
 * every route below /portal/orgs/:slug is scoped to that organization, and a client
 * only ever sees their own company's requests, projects, documents and invoices.
 */

const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_CODES_PER_15_MIN = 5;
const MAX_ATTEMPTS = 5;

const cookieName = (orgId: string) => `hp_${orgId.replace(/-/g, "")}`;
const secure = (c: Context<AppEnv>) => c.get("deps").appUrl.startsWith("https://");

const email = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email"));

/** Resolve the organization from the URL slug. */
const portalOrg = createMiddleware<AppEnv>(async (c, next) => {
  const slug = c.req.param("slug") ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(slug)) throw new HTTPException(404, { message: "This portal doesn't exist" });
  const [org] = await c.get("deps").db.select({ id: orgs.id, name: orgs.name, slug: orgs.slug }).from(orgs).where(eq(orgs.slug, slug));
  if (!org) throw new HTTPException(404, { message: "This portal doesn't exist" });
  c.set("org", org);
  await next();
});

async function sessionUser(c: Context<AppEnv>): Promise<PortalViewer | null> {
  const token = getCookie(c, cookieName(c.get("org").id));
  if (!token || token.length > 100) return null;
  const { db } = c.get("deps");
  const [row] = await db
    .select({ id: portalUsers.id, email: portalUsers.email, name: portalUsers.name, phone: portalUsers.phone, clientId: portalUsers.clientId })
    .from(portalSessions)
    .innerJoin(portalUsers, eq(portalUsers.id, portalSessions.portalUserId))
    .where(and(eq(portalSessions.tokenHash, await sha256Hex(token)), eq(portalSessions.orgId, c.get("org").id), gt(portalSessions.expiresAt, new Date())));
  return row ?? null;
}

const requireClient = createMiddleware<AppEnv>(async (c, next) => {
  const user = await sessionUser(c);
  if (!user) throw new HTTPException(401, { message: "Sign in to continue" });
  c.set("portalUser", user);
  await next();
});

/** Requests this person can see: their own, and their company's. */
const myRequests = (u: PortalViewer) => or(eq(serviceRequests.portalUserId, u.id), u.clientId ? eq(serviceRequests.clientId, u.clientId) : sql`false`);

async function loadRequest(c: Context<AppEnv>, id: string) {
  if (!z.uuid().safeParse(id).success) throw new HTTPException(404, { message: "Request not found" });
  const [r] = await c
    .get("deps")
    .db.select()
    .from(serviceRequests)
    .where(and(eq(serviceRequests.orgId, c.get("org").id), eq(serviceRequests.id, id), myRequests(c.get("portalUser"))));
  if (!r) throw new HTTPException(404, { message: "Request not found" });
  return r;
}

async function loadProject(c: Context<AppEnv>, id: string) {
  const u = c.get("portalUser");
  if (!u.clientId || !z.uuid().safeParse(id).success) throw new HTTPException(404, { message: "Project not found" });
  const [p] = await c
    .get("deps")
    .db.select()
    .from(projects)
    .where(and(eq(projects.orgId, c.get("org").id), eq(projects.id, id), eq(projects.clientId, u.clientId), ne(projects.status, "archived")));
  if (!p) throw new HTTPException(404, { message: "Project not found" });
  return p;
}

/** An existing client whose email, or one of whose contacts' emails, is this one. */
async function clientByEmail(db: AppEnv["Variables"]["deps"]["db"], orgId: string, email: string) {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .leftJoin(clientContacts, eq(clientContacts.clientId, clients.id))
    .where(and(eq(clients.orgId, orgId), isNull(clients.archivedAt), or(sql`lower(${clients.email}) = ${email}`, sql`lower(${clientContacts.email}) = ${email}`)))
    .limit(1);
  return row?.id;
}

/**
 * The client (company) this person acts for. Linked by email to an existing client when
 * there is one; otherwise a new client with just a name. Billing details come later.
 */
async function ensureClient(c: Context<AppEnv>, companyName?: string | null) {
  const u = c.get("portalUser");
  if (u.clientId) return u.clientId;
  const { db } = c.get("deps");
  const orgId = c.get("org").id;
  let clientId = await clientByEmail(db, orgId, u.email);
  if (!clientId) {
    const [cur] = await db.select({ currency: orgSettings.currency }).from(orgSettings).where(eq(orgSettings.orgId, orgId));
    const base = (companyName?.trim() || u.name?.trim() || u.email).slice(0, 150);
    for (const name of [base, `${base} (${u.email})`.slice(0, 160)]) {
      const [row] = await db
        .insert(clients)
        .values({ orgId, name, email: u.email, phone: u.phone, currency: cur?.currency ?? "INR", notes: "Joined through the client portal." })
        .onConflictDoNothing()
        .returning({ id: clients.id });
      if (row) {
        clientId = row.id;
        break;
      }
    }
    if (!clientId) throw new HTTPException(409, { message: "Couldn't set up your company. Try a different company name." });
  }
  await db.update(portalUsers).set({ clientId }).where(eq(portalUsers.id, u.id));
  c.set("portalUser", { ...u, clientId });
  return clientId;
}

/** A quote issued to this person's company. */
async function loadQuote(c: Context<AppEnv>, id: string) {
  const u = c.get("portalUser");
  if (!u.clientId || !z.uuid().safeParse(id).success) throw new HTTPException(404, { message: "Quote not found" });
  const [q] = await c
    .get("deps")
    .db.select()
    .from(invoices)
    .where(and(eq(invoices.orgId, c.get("org").id), eq(invoices.id, id), eq(invoices.clientId, u.clientId), eq(invoices.kind, "quote"), ne(invoices.status, "draft")));
  if (!q) throw new HTTPException(404, { message: "Quote not found" });
  return q;
}

/** Who on the team hears about a client's answer to a quote: the request's handler, else whoever made it. */
async function quoteWatchers(c: Context<AppEnv>, quote: typeof invoices.$inferSelect) {
  const { db } = c.get("deps");
  const [request] = await db.select().from(serviceRequests).where(eq(serviceRequests.quoteId, quote.id));
  const maker = quote.createdBy && !["system", "razorpay"].includes(quote.createdBy) ? quote.createdBy : null;
  return { request: request ?? null, recipients: await staffRecipients(db, quote.orgId, [request?.assigneeUserId, maker]) };
}

/** Accept or decline a quote. Accepting needs billing details, so the invoice can be made out. */
async function respondToQuote(c: Context<AppEnv>, quote: typeof invoices.$inferSelect, decision: "accept" | "decline") {
  const deps = c.get("deps");
  const { db } = deps;
  if (quote.status !== "sent") throw new HTTPException(409, { message: "There's no quote waiting for an answer" });
  if (decision === "accept") {
    const [client] = await db.select().from(clients).where(eq(clients.id, quote.clientId));
    if (!billingComplete(client)) throw new HTTPException(409, { res: Response.json({ error: "Add your billing details first", code: "billing_required" }, { status: 409 }) });
  }
  await db.update(invoices).set({ status: decision === "accept" ? "accepted" : "declined" }).where(eq(invoices.id, quote.id));
  // Answering the quote as it stands settles any price still being discussed.
  await db.update(quoteCounterOffers).set({ status: "withdrawn", decidedAt: new Date() }).where(and(eq(quoteCounterOffers.quoteId, quote.id), eq(quoteCounterOffers.status, "pending")));
  const { request, recipients } = await quoteWatchers(c, quote);
  const who = c.get("portalUser").name ?? c.get("portalUser").email;
  if (request) {
    await db.update(serviceRequests).set({ status: decision === "accept" ? "accepted" : "in_discussion" }).where(eq(serviceRequests.id, request.id));
    await db.insert(portalMessages).values({ orgId: quote.orgId, requestId: request.id, authorKind: "system", body: `${who} ${decision === "accept" ? "accepted" : "declined"} quote ${quote.number}.` });
  }
  await notifyStaff(
    deps,
    quote.orgId,
    recipients,
    {
      type: "portal.quote",
      title: `Quote ${quote.number} ${decision === "accept" ? "accepted" : "declined"}`,
      body: request ? `${REQUEST_LABEL(request.number)}: ${request.title}` : `By ${who}`,
      link: request ? `/work/requests/${request.id}` : `/finance/invoices/${quote.id}`,
    },
    { email: decision === "accept" },
  );
}

/** Billing details are complete enough to invoice. */
const billingComplete = (cl: typeof clients.$inferSelect | undefined) => Boolean(cl && (cl.legalName || cl.name) && cl.billingAddress && (cl.country !== "IN" || cl.stateCode));

async function staffForProject(c: Context<AppEnv>, projectId: string) {
  const { db } = c.get("deps");
  const rows = await db
    .select({ userId: members.userId })
    .from(projects)
    .innerJoin(employees, eq(employees.id, projects.leadEmployeeId))
    .innerJoin(members, eq(members.id, employees.memberId))
    .where(eq(projects.id, projectId));
  return rows.map((r) => r.userId);
}

async function postMessage(c: Context<AppEnv>, scope: Scope & { requestId?: string; projectId?: string }, body: string) {
  const { db } = c.get("deps");
  const [m] = await db
    .insert(portalMessages)
    .values({
      orgId: c.get("org").id,
      requestId: "requestId" in scope ? scope.requestId : null,
      projectId: "projectId" in scope ? scope.projectId : null,
      authorKind: "client",
      portalUserId: c.get("portalUser").id,
      body,
    })
    .returning({ id: portalMessages.id });
  return m!.id;
}

const messageInput = z.object({ body: z.string().trim().max(10_000).default("") });

export const portalClientRoutes = new Hono<AppEnv>()

  /* ---------------- Public ---------------- */

  /** The directory: organizations that chose to be listed and offer at least one service. */
  .get("/portal/orgs", validate("query", z.object({ q: z.string().trim().max(80).optional() })), async (c) => {
    const { q } = c.req.valid("query");
    const { db } = c.get("deps");
    const rows = await db
      .select({
        id: orgs.id,
        name: orgs.name,
        slug: orgs.slug,
        logo: orgs.logo,
        tagline: orgSettings.portalTagline,
        services: sql<number>`count(${services.id})`.mapWith(Number),
        categories: sql<string[]>`coalesce(array_agg(distinct ${services.category}) filter (where ${services.category} is not null), '{}')`,
        names: sql<string[]>`(array_agg(${services.name} order by ${services.position}))[1:4]`,
      })
      .from(orgs)
      .innerJoin(orgSettings, and(eq(orgSettings.orgId, orgs.id), eq(orgSettings.portalListed, true)))
      .innerJoin(services, and(eq(services.orgId, orgs.id), eq(services.active, true)))
      .where(q ? sql`(${orgs.name} ilike ${`%${q.replace(/[%_\\]/g, "\\$&")}%`} or ${services.name} ilike ${`%${q.replace(/[%_\\]/g, "\\$&")}%`})` : undefined)
      .groupBy(orgs.id, orgSettings.portalTagline)
      .orderBy(asc(orgs.name))
      .limit(200);
    c.header("cache-control", "public, max-age=60");
    return c.json({ orgs: rows });
  })

  .get("/portal/orgs/:slug", portalOrg, async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const [info] = await db
      .select({ logo: orgs.logo, tagline: orgSettings.portalTagline, currency: orgSettings.currency, legalName: financeSettings.legalName, email: financeSettings.email, phone: financeSettings.phone, address: financeSettings.address })
      .from(orgs)
      .leftJoin(orgSettings, eq(orgSettings.orgId, orgs.id))
      .leftJoin(financeSettings, eq(financeSettings.orgId, orgs.id))
      .where(eq(orgs.id, org.id));
    const list = await db
      .select()
      .from(services)
      .where(and(eq(services.orgId, org.id), eq(services.active, true)))
      .orderBy(asc(services.position), asc(services.name));
    const currency = info?.currency ?? "INR";
    return c.json({
      org: { name: org.name, slug: org.slug, logo: info?.logo ?? null, tagline: info?.tagline ?? null, legalName: info?.legalName ?? null, email: info?.email ?? null, phone: info?.phone ?? null, address: info?.address ?? null },
      services: list.map((s) => ({
        id: s.id,
        name: s.name,
        summary: s.summary,
        description: s.description,
        category: s.category,
        priceType: s.priceType,
        price: s.price,
        billing: s.billing,
        priceLabel: priceLabel(s, currency),
        deliveryDays: s.deliveryDays,
        requiredDocs: s.requiredDocs,
      })),
    });
  })

  /* ---------------- Sign-in ---------------- */

  .post("/portal/orgs/:slug/auth/code", portalOrg, validate("json", z.object({ email })), async (c) => {
    const deps = c.get("deps");
    const org = c.get("org");
    const { email: to } = c.req.valid("json");
    const [recent] = await deps.db
      .select({ n: count() })
      .from(portalCodes)
      .where(and(eq(portalCodes.orgId, org.id), eq(portalCodes.email, to), gte(portalCodes.createdAt, new Date(Date.now() - 15 * 60_000))));
    if ((recent?.n ?? 0) >= MAX_CODES_PER_15_MIN) throw new HTTPException(429, { message: "Too many codes. Wait a few minutes, then try again." });

    const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
    await deps.db.insert(portalCodes).values({
      orgId: org.id,
      email: to,
      codeHash: await deps.secrets.sign(`portal-code:${org.id}:${to}:${code}`),
      expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
    });
    const [fs] = await deps.db.select({ legalName: financeSettings.legalName }).from(financeSettings).where(eq(financeSettings.orgId, org.id));
    const seller = fs?.legalName ?? org.name;
    const { html, text } = renderEmail({
      greeting: "Hello,",
      lead: `Your sign-in code for ${seller}'s client portal is ${code}. It works for ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`,
      rows: [["Code", code]],
      signOff: seller,
    });
    const mail = await deliver(deps.mailer, { to, subject: `${code} is your sign-in code for ${seller}`, html, text });
    // In development without an email service, the code is printed in the API's console.
    if (!mail.sent && mail.reason === "failed") throw new HTTPException(502, { message: "We couldn't send the email. Try again in a moment." });
    return c.json({ sent: true, emailConfigured: deps.mailer.enabled });
  })

  .post("/portal/orgs/:slug/auth/verify", portalOrg, validate("json", z.object({ email, code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") })), async (c) => {
    const { db, secrets } = c.get("deps");
    const org = c.get("org");
    const input = c.req.valid("json");
    const [latest] = await db
      .select()
      .from(portalCodes)
      .where(and(eq(portalCodes.orgId, org.id), eq(portalCodes.email, input.email), isNull(portalCodes.usedAt), gt(portalCodes.expiresAt, new Date())))
      .orderBy(desc(portalCodes.createdAt))
      .limit(1);
    const wrong = () => new HTTPException(400, { message: "That code isn't right, or it has expired. Ask for a new one." });
    if (!latest || latest.attempts >= MAX_ATTEMPTS) throw wrong();
    if (latest.codeHash !== (await secrets.sign(`portal-code:${org.id}:${input.email}:${input.code}`))) {
      await db.update(portalCodes).set({ attempts: latest.attempts + 1 }).where(eq(portalCodes.id, latest.id));
      throw wrong();
    }
    const [used] = await db
      .update(portalCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(portalCodes.id, latest.id), isNull(portalCodes.usedAt)))
      .returning({ id: portalCodes.id });
    if (!used) throw wrong();

    await db.insert(portalUsers).values({ orgId: org.id, email: input.email }).onConflictDoNothing();
    const [existing] = await db.select({ clientId: portalUsers.clientId }).from(portalUsers).where(and(eq(portalUsers.orgId, org.id), sql`lower(${portalUsers.email}) = ${input.email}`));
    // Someone the team already bills (by their verified email) sees their quotes and invoices straight away.
    const linked = existing?.clientId ? undefined : await clientByEmail(db, org.id, input.email);
    const [user] = await db
      .update(portalUsers)
      .set({ lastSignInAt: new Date(), ...(linked ? { clientId: linked } : {}) })
      .where(and(eq(portalUsers.orgId, org.id), sql`lower(${portalUsers.email}) = ${input.email}`))
      .returning();
    const token = randomToken();
    await db.insert(portalSessions).values({ orgId: org.id, portalUserId: user!.id, tokenHash: await sha256Hex(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) });
    setCookie(c, cookieName(org.id), token, { httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
    return c.json({ user: { email: user!.email, name: user!.name, needsName: !user!.name } });
  })

  .post("/portal/orgs/:slug/auth/sign-out", portalOrg, async (c) => {
    const token = getCookie(c, cookieName(c.get("org").id));
    if (token) await c.get("deps").db.delete(portalSessions).where(eq(portalSessions.tokenHash, await sha256Hex(token)));
    deleteCookie(c, cookieName(c.get("org").id), { path: "/" });
    return c.json({ ok: true });
  })

  /* ---------------- Account ---------------- */

  .get("/portal/orgs/:slug/me", portalOrg, requireClient, async (c) => {
    const u = c.get("portalUser");
    const [client] = u.clientId ? await c.get("deps").db.select().from(clients).where(eq(clients.id, u.clientId)) : [];
    return c.json({
      user: { email: u.email, name: u.name, phone: u.phone },
      company: client
        ? { name: client.name, legalName: client.legalName, gstin: client.gstin, billingAddress: client.billingAddress, stateCode: client.stateCode, country: client.country, billingComplete: billingComplete(client) }
        : null,
    });
  })

  .patch(
    "/portal/orgs/:slug/me",
    portalOrg,
    requireClient,
    validate("json", z.object({ name: z.string().trim().min(1, "Enter your name").max(120).optional(), phone: z.string().trim().max(32).nullish() })),
    async (c) => {
      await c.get("deps").db.update(portalUsers).set(c.req.valid("json")).where(eq(portalUsers.id, c.get("portalUser").id));
      return c.json({ ok: true });
    },
  )

  /** Billing details: asked for only when they're needed (accepting a quote, paying). */
  .put(
    "/portal/orgs/:slug/billing",
    portalOrg,
    requireClient,
    validate(
      "json",
      z.object({
        legalName: z.string().trim().min(1, "Enter the name to invoice").max(200),
        gstin: z
          .string()
          .trim()
          .toUpperCase()
          .refine(isValidGstin, "That GSTIN isn't valid")
          .nullish()
          .or(z.literal("").transform(() => null)),
        billingAddress: z.string().trim().min(1, "Enter the billing address").max(500),
        stateCode: z
          .string()
          .refine((s) => s in INDIAN_STATES, "Choose a state")
          .nullish(),
        country: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/)
          .default("IN"),
      }),
    ),
    async (c) => {
      const input = c.req.valid("json");
      if (input.country === "IN" && !input.gstin && !input.stateCode) throw new HTTPException(422, { message: "Choose your state" });
      const clientId = await ensureClient(c, input.legalName);
      await c
        .get("deps")
        .db.update(clients)
        .set({
          legalName: input.legalName,
          gstin: input.gstin ?? null,
          billingAddress: input.billingAddress,
          country: input.country,
          stateCode: input.country !== "IN" ? null : input.gstin ? stateOfGstin(input.gstin) : input.stateCode,
        })
        .where(eq(clients.id, clientId));
      return c.json({ ok: true });
    },
  )

  /* ---------------- Home ---------------- */

  .get("/portal/orgs/:slug/home", portalOrg, requireClient, async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const u = c.get("portalUser");
    const reqs = await db
      .select({
        id: serviceRequests.id,
        number: serviceRequests.number,
        title: serviceRequests.title,
        status: serviceRequests.status,
        projectId: serviceRequests.projectId,
        updatedAt: serviceRequests.updatedAt,
        unread: sql<number>`(select count(*) from portal_messages m where m.request_id = ${serviceRequests.id} and m.author_kind <> 'client' and m.seen_by_client_at is null)`.mapWith(Number),
        docsNeeded: sql<number>`(select count(*) from client_documents d where d.request_id = ${serviceRequests.id} and d.project_id is null and d.status in ('requested','rejected'))`.mapWith(Number),
        quoteStatus: invoices.status,
      })
      .from(serviceRequests)
      .leftJoin(invoices, eq(invoices.id, serviceRequests.quoteId))
      .where(and(eq(serviceRequests.orgId, org.id), myRequests(u)))
      .orderBy(desc(serviceRequests.updatedAt))
      .limit(50);
    const projs = u.clientId
      ? await db
          .select({
            id: projects.id,
            name: projects.name,
            status: projects.status,
            dueDate: projects.dueDate,
            done: sql<number>`(select count(*) from tasks t where t.project_id = "projects"."id" and t.parent_id is null and t.status = 'done')`.mapWith(Number),
            total: sql<number>`(select count(*) from tasks t where t.project_id = "projects"."id" and t.parent_id is null)`.mapWith(Number),
            unread: sql<number>`(select count(*) from portal_messages m where m.project_id = "projects"."id" and m.author_kind <> 'client' and m.seen_by_client_at is null)`.mapWith(Number),
            docsNeeded: sql<number>`(select count(*) from client_documents d where d.project_id = "projects"."id" and d.status in ('requested','rejected'))`.mapWith(Number),
          })
          .from(projects)
          .where(and(eq(projects.orgId, org.id), eq(projects.clientId, u.clientId), ne(projects.status, "archived")))
          .orderBy(desc(projects.updatedAt))
      : [];
    const due = u.clientId
      ? await db
          .select({ n: count(), amount: sql<number>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}), 0)`.mapWith(Number), currency: sql<string>`min(${invoices.currency})` })
          .from(invoices)
          .where(and(eq(invoices.orgId, org.id), eq(invoices.clientId, u.clientId), eq(invoices.kind, "invoice"), inArray(invoices.status, ["sent", "partially_paid"])))
      : [];

    // What needs the client: documents to upload, quotes to answer, invoices to pay, replies to read.
    const attention: { kind: string; title: string; detail?: string; path: string }[] = [];
    for (const r of reqs) {
      if (r.status === "quoted" && r.quoteStatus === "sent") attention.push({ kind: "quote", title: `Review the quote for ${r.title}`, path: `/requests/${r.id}` });
      if (r.docsNeeded && !r.projectId) attention.push({ kind: "documents", title: `${r.docsNeeded} document${r.docsNeeded === 1 ? "" : "s"} needed for ${r.title}`, path: `/requests/${r.id}` });
      if (r.unread && !r.projectId) attention.push({ kind: "message", title: `New message about ${r.title}`, path: `/requests/${r.id}` });
    }
    for (const p of projs) {
      if (p.docsNeeded) attention.push({ kind: "documents", title: `${p.docsNeeded} document${p.docsNeeded === 1 ? "" : "s"} needed for ${p.name}`, path: `/projects/${p.id}` });
      if (p.unread) attention.push({ kind: "message", title: `New message on ${p.name}`, path: `/projects/${p.id}` });
    }
    if (due[0]?.n) attention.push({ kind: "invoice", title: `${due[0].n} invoice${due[0].n === 1 ? "" : "s"} to pay`, detail: String(due[0].amount), path: "/billing" });
    // Payments the team has asked for against quotes (advances): each gets a receipt.
    const requested = u.clientId
      ? await db
          .select({ number: invoices.number, amount: invoices.paymentLinkAmount })
          .from(invoices)
          .where(and(eq(invoices.orgId, org.id), eq(invoices.clientId, u.clientId), eq(invoices.kind, "quote"), inArray(invoices.status, ["sent", "accepted", "partially_paid"]), sql`${invoices.paymentLinkAmount} is not null`))
      : [];
    for (const q of requested) attention.push({ kind: "invoice", title: `Payment requested for quote ${q.number}`, detail: String(q.amount), path: "/billing" });

    return c.json({
      attention,
      requests: reqs.map(({ quoteStatus: _, ...r }) => ({ ...r, label: REQUEST_LABEL(r.number) })),
      projects: projs,
      due: due[0] ? { count: due[0].n, amount: due[0].amount, currency: due[0].currency ?? "INR" } : { count: 0, amount: 0, currency: "INR" },
    });
  })

  /* ---------------- Requests ---------------- */

  .post(
    "/portal/orgs/:slug/requests",
    portalOrg,
    requireClient,
    validate(
      "json",
      z
        .object({
          serviceId: z.uuid().nullish(),
          title: z.string().trim().max(160).nullish(),
          details: z.string().trim().max(10_000).nullish(),
          name: z.string().trim().min(1).max(120).nullish(),
          phone: z.string().trim().max(32).nullish(),
          companyName: z.string().trim().max(150).nullish(),
        })
        .refine((v) => v.serviceId || v.title, { message: "Choose a service or describe what you need", path: ["title"] }),
    ),
    async (c) => {
      const deps = c.get("deps");
      const { db } = deps;
      const org = c.get("org");
      const input = c.req.valid("json");
      let service: typeof services.$inferSelect | undefined;
      if (input.serviceId) {
        [service] = await db.select().from(services).where(and(eq(services.orgId, org.id), eq(services.id, input.serviceId), eq(services.active, true)));
        if (!service) throw new HTTPException(422, { message: "That service isn't offered any more" });
      }
      const u = c.get("portalUser");
      if (input.name || input.phone) {
        await db.update(portalUsers).set({ ...(input.name ? { name: input.name } : {}), ...(input.phone ? { phone: input.phone } : {}) }).where(eq(portalUsers.id, u.id));
        c.set("portalUser", { ...u, name: input.name ?? u.name, phone: input.phone ?? u.phone });
      }
      const clientId = await ensureClient(c, input.companyName);
      const number = await nextSequence(db, org.id, "service_request");
      const [req] = await db
        .insert(serviceRequests)
        .values({
          orgId: org.id,
          number,
          serviceId: service?.id ?? null,
          portalUserId: u.id,
          clientId,
          title: service?.name ?? input.title!,
          details: input.details ?? null,
          assigneeUserId: service?.ownerUserId ?? null,
        })
        .returning();
      if (service?.requiredDocs.length) {
        await db.insert(clientDocuments).values(service.requiredDocs.map((d) => ({ orgId: org.id, requestId: req!.id, name: d.name, hint: d.hint ?? null, requestedBy: "service" })));
      }
      const who = c.get("portalUser").name ?? u.email;
      await notifyStaff(
        deps,
        org.id,
        await staffRecipients(db, org.id, [service?.ownerUserId]),
        { type: "portal.request", title: `New request: ${req!.title}`, body: `${REQUEST_LABEL(number)} from ${who}`, link: `/work/requests/${req!.id}` },
        { email: true },
      );
      return c.json({ request: { id: req!.id, number, label: REQUEST_LABEL(number) } }, 201);
    },
  )

  .get("/portal/orgs/:slug/requests/:id", portalOrg, requireClient, async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const r = await loadRequest(c, c.req.param("id"));
    const scope = { requestId: r.id };
    const [service] = r.serviceId ? await db.select().from(services).where(eq(services.id, r.serviceId)) : [];
    const [quote] = r.quoteId ? await db.select().from(invoices).where(eq(invoices.id, r.quoteId)) : [];
    const staff = await staffCards(db, org.id, [r.assigneeUserId]);
    const [project] = r.projectId ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, r.projectId)) : [];
    const [cur] = await db.select({ currency: orgSettings.currency }).from(orgSettings).where(eq(orgSettings.orgId, org.id));
    const messages = await conversation(db, org.id, scope);
    const documents = await documentChecklist(db, org.id, scope);
    await markSeen(db, org.id, scope, "client");
    return c.json({
      request: {
        id: r.id,
        label: REQUEST_LABEL(r.number),
        title: r.title,
        details: r.details,
        status: r.status,
        declineReason: r.declineReason,
        createdAt: r.createdAt,
        service: service ? { name: service.name, priceLabel: priceLabel(service, cur?.currency), deliveryDays: service.deliveryDays } : null,
        handler: r.assigneeUserId ? (staff.get(r.assigneeUserId) ?? null) : null,
        quote:
          quote && quote.status !== "draft" && quote.status !== "void"
            ? {
                id: quote.id,
                number: quote.number,
                status: quote.status,
                total: quote.total,
                currency: quote.currency,
                validUntil: quote.dueDate,
                url: `${c.get("deps").appUrl.replace(/\/$/, "")}/i/${await linkToken(c.get("deps"), quote.id)}`,
                counterOffer: (await latestCounterOffers(db, [quote.id])).get(quote.id) ?? null,
              }
            : null,
        project: project ?? null,
      },
      messages,
      documents,
    });
  })

  .post("/portal/orgs/:slug/requests/:id/messages", portalOrg, requireClient, validate("json", messageInput), async (c) => {
    const deps = c.get("deps");
    const r = await loadRequest(c, c.req.param("id"));
    if (r.projectId) throw new HTTPException(409, { message: "This request is now a project. Write on the project instead." });
    const id = await postMessage(c, { requestId: r.id }, c.req.valid("json").body);
    await notifyStaff(deps, r.orgId, await staffRecipients(deps.db, r.orgId, [r.assigneeUserId]), {
      type: "portal.message",
      title: `${c.get("portalUser").name ?? c.get("portalUser").email} wrote on ${REQUEST_LABEL(r.number)}`,
      body: c.req.valid("json").body.slice(0, 140),
      link: `/work/requests/${r.id}`,
    });
    return c.json({ message: { id } }, 201);
  })

  .post("/portal/orgs/:slug/requests/:id/withdraw", portalOrg, requireClient, async (c) => {
    const r = await loadRequest(c, c.req.param("id"));
    if (!["new", "in_discussion", "quoted"].includes(r.status)) throw new HTTPException(409, { message: "This request can't be withdrawn now" });
    await c.get("deps").db.update(serviceRequests).set({ status: "withdrawn" }).where(eq(serviceRequests.id, r.id));
    await c
      .get("deps")
      .db.insert(portalMessages)
      .values({ orgId: r.orgId, requestId: r.id, authorKind: "system", body: `${c.get("portalUser").name ?? "The client"} withdrew this request.` });
    return c.json({ ok: true });
  })

  .post("/portal/orgs/:slug/requests/:id/quote/:decision", portalOrg, requireClient, async (c) => {
    const deps = c.get("deps");
    const { db } = deps;
    const decision = c.req.param("decision");
    if (decision !== "accept" && decision !== "decline") throw new HTTPException(404, { message: "Not found" });
    const r = await loadRequest(c, c.req.param("id"));
    const [quote] = r.quoteId ? await db.select().from(invoices).where(eq(invoices.id, r.quoteId)) : [];
    if (!quote) throw new HTTPException(409, { message: "There's no quote waiting for an answer" });
    await respondToQuote(c, quote, decision);
    return c.json({ ok: true });
  })

  /* ---------------- Quotes ---------------- */

  /** Propose a different price for a quote (the total, including GST). The team approves or rejects it. */
  .post(
    "/portal/orgs/:slug/quotes/:id/counter",
    portalOrg,
    requireClient,
    validate("json", z.object({ amount: z.number().int().positive().max(1e13), note: z.string().trim().max(1000).nullish() })),
    async (c) => {
      const deps = c.get("deps");
      const { db } = deps;
      const input = c.req.valid("json");
      const quote = await loadQuote(c, c.req.param("id"));
      if (quote.status !== "sent") throw new HTTPException(409, { message: "You can only propose a price for a quote that's waiting for your answer" });
      if (input.amount === quote.total) throw new HTTPException(422, { message: "That's the quote's price already. Accept the quote instead." });
      const [offer] = await db
        .insert(quoteCounterOffers)
        .values({ orgId: quote.orgId, quoteId: quote.id, portalUserId: c.get("portalUser").id, amount: input.amount, note: input.note || null })
        .onConflictDoNothing()
        .returning({ id: quoteCounterOffers.id });
      if (!offer) throw new HTTPException(409, { message: "You've already proposed a price for this quote. The team will get back to you." });
      const { request, recipients } = await quoteWatchers(c, quote);
      const who = c.get("portalUser").name ?? c.get("portalUser").email;
      if (request) {
        await db.insert(portalMessages).values({
          orgId: quote.orgId,
          requestId: request.id,
          authorKind: "system",
          body: `${who} proposed ${formatMoney(input.amount, quote.currency)} for quote ${quote.number}${input.note ? `: "${input.note}"` : "."}`,
        });
      }
      await notifyStaff(
        deps,
        quote.orgId,
        recipients,
        {
          type: "portal.counter_offer",
          title: `${who} proposed ${formatMoney(input.amount, quote.currency)} for quote ${quote.number}`,
          body: `Quoted ${formatMoney(quote.total, quote.currency)}${input.note ? ` · ${input.note.slice(0, 120)}` : ""}`,
          link: `/finance/invoices/${quote.id}`,
        },
        { email: true },
      );
      return c.json({ counterOffer: offer }, 201);
    },
  )

  .post("/portal/orgs/:slug/quotes/:id/:decision{accept|decline}", portalOrg, requireClient, async (c) => {
    const quote = await loadQuote(c, c.req.param("id"));
    await respondToQuote(c, quote, c.req.param("decision") as "accept" | "decline");
    return c.json({ ok: true });
  })

  /* ---------------- Projects ---------------- */

  .get("/portal/orgs/:slug/projects/:id", portalOrg, requireClient, async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const p = await loadProject(c, c.req.param("id"));
    const scope = { projectId: p.id };
    const [progress] = await db
      .select({ done: sql<number>`count(*) filter (where ${tasks.status} = 'done')`.mapWith(Number), total: count() })
      .from(tasks)
      .where(and(eq(tasks.projectId, p.id), isNull(tasks.parentId)));
    const ms = await db
      .select({ id: milestones.id, name: milestones.name, dueDate: milestones.dueDate, completedAt: milestones.completedAt })
      .from(milestones)
      .where(eq(milestones.projectId, p.id))
      .orderBy(asc(milestones.position));
    const team = await db
      .select({ employeeId: employees.id, userId: members.userId, name: employees.fullName, jobTitle: employees.jobTitle, image: members.image })
      .from(projectMembers)
      .innerJoin(employees, eq(employees.id, projectMembers.employeeId))
      .leftJoin(members, eq(members.id, employees.memberId))
      .where(eq(projectMembers.projectId, p.id))
      .orderBy(asc(employees.fullName));
    const messages = await conversation(db, org.id, scope);
    const documents = await documentChecklist(db, org.id, scope);
    await markSeen(db, org.id, scope, "client");
    return c.json({
      project: { id: p.id, name: p.name, description: p.description, status: p.status, startDate: p.startDate, dueDate: p.dueDate, done: progress?.done ?? 0, total: progress?.total ?? 0 },
      milestones: ms,
      team: team.map((t) => ({ name: t.name, jobTitle: t.jobTitle, image: t.image, lead: t.employeeId === p.leadEmployeeId })),
      messages,
      documents,
    });
  })

  .post("/portal/orgs/:slug/projects/:id/messages", portalOrg, requireClient, validate("json", messageInput), async (c) => {
    const deps = c.get("deps");
    const p = await loadProject(c, c.req.param("id"));
    const id = await postMessage(c, { projectId: p.id }, c.req.valid("json").body);
    const [req] = await deps.db.select({ assignee: serviceRequests.assigneeUserId }).from(serviceRequests).where(eq(serviceRequests.projectId, p.id));
    await notifyStaff(deps, p.orgId, await staffRecipients(deps.db, p.orgId, [...(await staffForProject(c, p.id)), req?.assignee]), {
      type: "portal.message",
      title: `${c.get("portalUser").name ?? c.get("portalUser").email} wrote on ${p.name}`,
      body: c.req.valid("json").body.slice(0, 140),
      link: `/work/projects/${p.id}?view=client`,
    });
    return c.json({ message: { id } }, 201);
  })

  /* ---------------- Documents and files ---------------- */

  /** Everything shared both ways: checklist uploads and files in conversations. */
  .get("/portal/orgs/:slug/documents", portalOrg, requireClient, async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const u = c.get("portalUser");
    const reqs = await db.select({ id: serviceRequests.id, title: serviceRequests.title, projectId: serviceRequests.projectId }).from(serviceRequests).where(and(eq(serviceRequests.orgId, org.id), myRequests(u)));
    const projs = u.clientId ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.orgId, org.id), eq(projects.clientId, u.clientId), ne(projects.status, "archived"))) : [];
    const groups = [];
    for (const p of projs) {
      const msgs = await conversation(db, org.id, { projectId: p.id });
      groups.push({ kind: "project", id: p.id, title: p.name, documents: await documentChecklist(db, org.id, { projectId: p.id }), shared: msgs.flatMap((m) => m.files.map((f) => ({ ...f, from: m.authorKind }))) });
    }
    for (const r of reqs.filter((r) => !r.projectId)) {
      const msgs = await conversation(db, org.id, { requestId: r.id });
      groups.push({ kind: "request", id: r.id, title: r.title, documents: await documentChecklist(db, org.id, { requestId: r.id }), shared: msgs.flatMap((m) => m.files.map((f) => ({ ...f, from: m.authorKind }))) });
    }
    return c.json({ groups: groups.filter((g) => g.documents.length || g.shared.length) });
  })

  .post(
    "/portal/orgs/:slug/files",
    portalOrg,
    requireClient,
    validate("form", z.object({ file: z.instanceof(File), ownerType: z.enum(["portal_message", "client_document"]), ownerId: z.uuid() })),
    async (c) => {
      const deps = c.get("deps");
      const { db } = deps;
      const org = c.get("org");
      const u = c.get("portalUser");
      const { file, ownerType, ownerId } = c.req.valid("form");
      if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) throw new HTTPException(413, { message: "Files must be between 1 byte and 25 MB" });
      const contentType = file.type || "application/octet-stream";
      if (/^(image\/svg\+xml|text\/html|application\/xhtml\+xml|application\/javascript|text\/javascript)$/.test(contentType) || /\.(svg|html?|xhtml|js|mjs)$/i.test(file.name)) {
        throw new HTTPException(415, { message: "This file type isn't allowed" });
      }

      let doc: typeof clientDocuments.$inferSelect | undefined;
      if (ownerType === "portal_message") {
        const [m] = await db.select().from(portalMessages).where(and(eq(portalMessages.orgId, org.id), eq(portalMessages.id, ownerId), eq(portalMessages.portalUserId, u.id)));
        if (!m) throw new HTTPException(404, { message: "Message not found" });
      } else {
        [doc] = await db.select().from(clientDocuments).where(and(eq(clientDocuments.orgId, org.id), eq(clientDocuments.id, ownerId)));
        if (!doc) throw new HTTPException(404, { message: "Document not found" });
        if (doc.projectId) await loadProject(c, doc.projectId);
        else if (doc.requestId) await loadRequest(c, doc.requestId);
        if (doc.status === "accepted") throw new HTTPException(409, { message: "This document has already been accepted" });
      }

      const name = file.name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
      const key = `${org.id}/${ownerType}/${uuidv7()}-${name}`;
      await deps.files.put(key, new Uint8Array(await file.arrayBuffer()), contentType);
      const [row] = await db
        .insert(attachments)
        .values({ orgId: org.id, ownerType, ownerId, fileKey: key, name, contentType, size: file.size, createdBy: `portal:${u.id}` })
        .returning({ id: attachments.id, name: attachments.name, contentType: attachments.contentType, size: attachments.size, createdAt: attachments.createdAt });

      if (doc) {
        await db.update(clientDocuments).set({ status: "uploaded", uploadedAt: new Date(), note: null }).where(eq(clientDocuments.id, doc.id));
        const [req] = doc.requestId ? await db.select().from(serviceRequests).where(eq(serviceRequests.id, doc.requestId)) : [];
        await notifyStaff(deps, org.id, await staffRecipients(db, org.id, [req?.assigneeUserId, ...(doc.projectId ? await staffForProject(c, doc.projectId) : [])]), {
          type: "portal.document",
          title: `${u.name ?? u.email} uploaded ${doc.name}`,
          link: doc.projectId ? `/work/projects/${doc.projectId}?view=client` : `/work/requests/${doc.requestId}`,
        });
      }
      return c.json({ attachment: row }, 201);
    },
  )

  .get("/portal/orgs/:slug/files/:id", portalOrg, requireClient, async (c) => {
    const { db, files } = c.get("deps");
    const org = c.get("org");
    const id = c.req.param("id");
    if (!z.uuid().safeParse(id).success) throw new HTTPException(404, { message: "File not found" });
    const [f] = await db.select().from(attachments).where(and(eq(attachments.orgId, org.id), eq(attachments.id, id), isNull(attachments.deletedAt)));
    if (!f || (f.ownerType !== "portal_message" && f.ownerType !== "client_document")) throw new HTTPException(404, { message: "File not found" });
    // The file is visible if its message or document is.
    const table = f.ownerType === "portal_message" ? portalMessages : clientDocuments;
    const [owner] = await db.select({ requestId: table.requestId, projectId: table.projectId }).from(table).where(eq(table.id, f.ownerId));
    if (!owner) throw new HTTPException(404, { message: "File not found" });
    if (owner.projectId) await loadProject(c, owner.projectId);
    else if (owner.requestId) await loadRequest(c, owner.requestId);
    return c.redirect(await files.getUrl(f.fileKey, 300), 302);
  })

  /* ---------------- Billing ---------------- */

  .get("/portal/orgs/:slug/invoices", portalOrg, requireClient, async (c) => {
    const deps = c.get("deps");
    const u = c.get("portalUser");
    if (!u.clientId) return c.json({ documents: [] });
    const rows = await deps.db
      .select({
        id: invoices.id,
        kind: invoices.kind,
        number: invoices.number,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: effectiveDueDate,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        currency: invoices.currency,
      })
      .from(invoices)
      .where(and(eq(invoices.orgId, c.get("org").id), eq(invoices.clientId, u.clientId), ne(invoices.status, "draft")))
      .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
      .limit(200);
    const base = deps.appUrl.replace(/\/$/, "");
    const offers = await latestCounterOffers(deps.db, rows.filter((r) => r.kind === "quote").map((r) => r.id));
    return c.json({ documents: await Promise.all(rows.map(async (r) => ({ ...r, url: `${base}/i/${await linkToken(deps, r.id)}`, counterOffer: offers.get(r.id) ?? null }))) });
  });
