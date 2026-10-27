import { isIsoDate, todayIn } from "@operant/core";
import {
  departments,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  employees,
  leaveRequests,
  members,
  onboardingRuns,
  orgs,
  teamMembers,
  teams,
} from "@operant/db";
import { and, asc, count, eq, gte, ilike, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit } from "../../audit.ts";
import type { AppEnv } from "../../context.ts";
import { hasPermission, nextSequence, notFound, orgWorkSettings, viewerEmployee } from "../../helpers.ts";
import { requirePermission } from "../../middleware.ts";
import { likePattern, validate } from "../../validate.ts";

const isoDate = z.string().refine(isIsoDate, "Use a valid date (YYYY-MM-DD)");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const employeeInput = z.object({
  fullName: z.string().trim().min(1, "Enter a name").max(120),
  workEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email"))
    .nullish()
    .or(z.literal("").transform(() => null)),
  phone: optionalText(32),
  jobTitle: optionalText(120),
  departmentId: z.uuid().nullish(),
  managerId: z.uuid().nullish(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("full_time"),
  status: z.enum(EMPLOYEE_STATUSES).default("active"),
  joinDate: isoDate.nullish(),
  location: optionalText(120),
  birthday: isoDate.nullish(),
  memberId: z.uuid().nullish(),
});

const manager = alias(employees, "manager");

/** Columns every list/detail view gets. Phone and birthday are added only for privileged viewers. */
const baseColumns = {
  id: employees.id,
  employeeCode: employees.employeeCode,
  fullName: employees.fullName,
  workEmail: employees.workEmail,
  jobTitle: employees.jobTitle,
  departmentId: employees.departmentId,
  departmentName: departments.name,
  departmentColor: departments.color,
  managerId: employees.managerId,
  managerName: manager.fullName,
  employmentType: employees.employmentType,
  status: employees.status,
  joinDate: employees.joinDate,
  exitDate: employees.exitDate,
  location: employees.location,
  memberId: employees.memberId,
  image: members.image,
  userId: members.userId,
  invitedAt: employees.invitedAt,
  /**
   * Can they sign in? "active" while they're an active member (linked, or with the same email and
   * not signed in yet; someone removed in Webrizen can't), "invited" while an invitation is open
   * (48 hours), "expired" after.
   */
  signIn: sql<"active" | "invited" | "expired" | "none">`case
    when exists (select 1 from members m where m.org_id = "employees"."org_id" and m.status = 'active'
      and (m.id = "employees"."member_id" or lower(m.email) = lower("employees"."work_email"))) then 'active'
    when "employees"."invited_at" > now() - interval '48 hours' then 'invited'
    when "employees"."invited_at" is not null then 'expired'
    else 'none' end`,
};

function listQuery(db: AppEnv["Variables"]["deps"]["db"]) {
  return db
    .select(baseColumns)
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(manager, eq(manager.id, employees.managerId))
    .leftJoin(members, eq(members.id, employees.memberId));
}

/** Rejects a manager assignment that would create a reporting loop. */
async function assertNoManagerCycle(db: AppEnv["Variables"]["deps"]["db"], orgId: string, employeeId: string, managerId: string) {
  if (employeeId === managerId) throw new HTTPException(422, { message: "Someone can't be their own manager" });
  const rows = await db.execute<{ id: string }>(sql`
    with recursive chain as (
      select id, manager_id from employees where id = ${managerId} and org_id = ${orgId}
      union all
      select e.id, e.manager_id from employees e join chain c on e.id = c.manager_id where e.org_id = ${orgId}
    ) select id from chain where id = ${employeeId} limit 1`);
  const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
  if (list.length > 0) throw new HTTPException(422, { message: "That would create a reporting loop" });
}

async function assertInOrg(db: AppEnv["Variables"]["deps"]["db"], orgId: string, refs: { departmentId?: string | null; managerId?: string | null; memberId?: string | null }) {
  if (refs.departmentId) {
    const [d] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, refs.departmentId), eq(departments.orgId, orgId)));
    if (!d) throw new HTTPException(422, { message: "Unknown department" });
  }
  if (refs.managerId) {
    const [m] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, refs.managerId), eq(employees.orgId, orgId)));
    if (!m) throw new HTTPException(422, { message: "Unknown manager" });
  }
  if (refs.memberId) {
    const [m] = await db.select({ id: members.id }).from(members).where(and(eq(members.id, refs.memberId), eq(members.orgId, orgId)));
    if (!m) throw new HTTPException(422, { message: "Unknown account" });
  }
}

export const employeeRoutes = new Hono<AppEnv>()

  .get("/people/summary", requirePermission("employee", "read"), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const { timezone } = await orgWorkSettings(db, org.id);
    const today = todayIn(timezone);
    const monthStart = `${today.slice(0, 7)}-01`;

    const [head] = await db
      .select({ total: count() })
      .from(employees)
      .where(and(eq(employees.orgId, org.id), ne(employees.status, "offboarded")));
    const byDepartment = await db
      .select({ id: departments.id, name: departments.name, color: departments.color, count: count(employees.id) })
      .from(departments)
      .leftJoin(employees, and(eq(employees.departmentId, departments.id), ne(employees.status, "offboarded")))
      .where(eq(departments.orgId, org.id))
      .groupBy(departments.id)
      .orderBy(asc(departments.name));
    const joiners = await db
      .select({ id: employees.id, fullName: employees.fullName, jobTitle: employees.jobTitle, joinDate: employees.joinDate })
      .from(employees)
      .where(and(eq(employees.orgId, org.id), gte(employees.joinDate, monthStart)))
      .orderBy(asc(employees.joinDate))
      .limit(10);
    const onLeave = await db
      .select({ id: employees.id, fullName: employees.fullName, endDate: leaveRequests.endDate, image: members.image })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .leftJoin(members, eq(members.id, employees.memberId))
      .where(
        and(
          eq(leaveRequests.orgId, org.id),
          eq(leaveRequests.status, "approved"),
          lte(leaveRequests.startDate, today),
          gte(leaveRequests.endDate, today),
        ),
      );
    // Pending requests this viewer can act on: everyone else's (approvers) or their reports' (managers).
    const me = await viewerEmployee(c);
    const [pending] = await db
      .select({ n: count() })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .where(
        and(
          eq(leaveRequests.orgId, org.id),
          eq(leaveRequests.status, "pending"),
          me ? ne(leaveRequests.employeeId, me.id) : undefined,
          hasPermission(c, "leave", "approve") ? undefined : me ? eq(employees.managerId, me.id) : sql`false`,
        ),
      );
    const [onboarding] = await db
      .select({ n: count() })
      .from(onboardingRuns)
      .where(and(eq(onboardingRuns.orgId, org.id), isNull(onboardingRuns.completedAt)));

    return c.json({
      today,
      headcount: head?.total ?? 0,
      byDepartment,
      joinersThisMonth: joiners,
      onLeaveToday: onLeave,
      pendingLeave: pending?.n ?? 0,
      activeOnboarding: onboarding?.n ?? 0,
    });
  })

  .get(
    "/employees",
    requirePermission("employee", "read"),
    validate(
      "query",
      z.object({
        q: z.string().trim().max(100).optional(),
        departmentId: z.uuid().optional(),
        managerId: z.uuid().optional(),
        status: z.enum([...EMPLOYEE_STATUSES, "current", "all"]).default("current"),
      }),
    ),
    async (c) => {
      const { q, departmentId, managerId, status } = c.req.valid("query");
      const { db } = c.get("deps");
      const org = c.get("org");
      const rows = await listQuery(db)
        .where(
          and(
            eq(employees.orgId, org.id),
            status === "all" ? undefined : status === "current" ? ne(employees.status, "offboarded") : eq(employees.status, status),
            departmentId ? eq(employees.departmentId, departmentId) : undefined,
            managerId ? eq(employees.managerId, managerId) : undefined,
            q
              ? or(
                  ilike(employees.fullName, likePattern(q)),
                  ilike(employees.workEmail, likePattern(q)),
                  ilike(employees.jobTitle, likePattern(q)),
                  ilike(employees.employeeCode, likePattern(q)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(employees.fullName))
        .limit(2000);
      return c.json({ employees: rows });
    },
  )

  .get("/employees/me", async (c) => {
    const me = await viewerEmployee(c);
    return c.json({ employee: me ? { id: me.id, fullName: me.fullName, managerId: me.managerId } : null });
  })

  /** Roles someone can be invited with: Webrizen's roles for Operant, else the organization's roles in use. Never owner. */
  .get("/employees/invite-roles", requirePermission("employee", "create"), async (c) => {
    const { db, directory } = c.get("deps");
    const token = c.get("viewer")?.accessToken;
    if (directory && token) {
      const roles = await directory.roles(token).catch(() => null);
      if (roles?.length) return c.json({ roles, available: true });
    }
    const rows = await db
      .selectDistinct({ role: sql<string>`unnest(${members.roles})` })
      .from(members)
      .where(and(eq(members.orgId, c.get("org").id), eq(members.status, "active")));
    const roles = [...new Set(["member", "admin", ...rows.map((r) => r.role)])].filter((r) => r !== "owner");
    return c.json({ roles, available: Boolean(c.get("deps").directory) });
  })

  .get("/org-chart", requirePermission("employee", "read"), async (c) => {
    const { db } = c.get("deps");
    const rows = await db
      .select({
        id: employees.id,
        fullName: employees.fullName,
        jobTitle: employees.jobTitle,
        managerId: employees.managerId,
        departmentName: departments.name,
        departmentColor: departments.color,
        image: members.image,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(members, eq(members.id, employees.memberId))
      .where(and(eq(employees.orgId, c.get("org").id), ne(employees.status, "offboarded")))
      .orderBy(asc(employees.fullName));
    return c.json({ employees: rows });
  })

  .get("/employees/:id", requirePermission("employee", "read"), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const id = c.req.param("id");
    const [row] = await listQuery(db)
      .where(and(eq(employees.orgId, org.id), eq(employees.id, id)))
      .limit(1);
    if (!row) notFound("Employee not found");

    const me = await viewerEmployee(c);
    const privileged = hasPermission(c, "employee", "update") || me?.id === id;
    const [privateFields] = privileged
      ? await db.select({ phone: employees.phone, birthday: employees.birthday }).from(employees).where(eq(employees.id, id))
      : [{ phone: null, birthday: null }];

    const reports = await db
      .select({ id: employees.id, fullName: employees.fullName, jobTitle: employees.jobTitle, image: members.image })
      .from(employees)
      .leftJoin(members, eq(members.id, employees.memberId))
      .where(and(eq(employees.orgId, org.id), eq(employees.managerId, id), ne(employees.status, "offboarded")))
      .orderBy(asc(employees.fullName));
    const memberOf = await db
      .select({ id: teams.id, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teamMembers.orgId, org.id), eq(teamMembers.employeeId, id)));

    return c.json({
      employee: { ...row, ...privateFields },
      reports,
      teams: memberOf,
      access: {
        isSelf: me?.id === id,
        canEdit: hasPermission(c, "employee", "update"),
        canArchive: hasPermission(c, "employee", "archive"),
        seesPrivate: privileged,
      },
    });
  })

  .post("/employees", requirePermission("employee", "create"), validate("json", employeeInput), async (c) => {
    const input = c.req.valid("json");
    const { db } = c.get("deps");
    const org = c.get("org");
    await assertInOrg(db, org.id, input);

    let memberId = input.memberId ?? null;
    if (!memberId && input.workEmail) {
      const [m] = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.orgId, org.id), sql`lower(${members.email}) = ${input.workEmail}`));
      memberId = m?.id ?? null;
    }
    if (memberId) {
      const [taken] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.orgId, org.id), eq(employees.memberId, memberId)));
      if (taken) throw new HTTPException(409, { message: "That account is already linked to another employee" });
    }

    const code = `EMP-${String(await nextSequence(db, org.id, "employee")).padStart(4, "0")}`;
    const [row] = await db
      .insert(employees)
      .values({ ...input, memberId, orgId: org.id, employeeCode: code, createdBy: c.get("viewer")!.userId })
      .returning({ id: employees.id, employeeCode: employees.employeeCode });
    await audit(c, "employee.created", { type: "employee", id: row!.id }, { name: input.fullName, code });
    return c.json({ employee: row }, 201);
  })

  .patch("/employees/:id", requirePermission("employee", "update"), validate("json", employeeInput.partial()), async (c) => {
    const input = c.req.valid("json");
    const { db } = c.get("deps");
    const org = c.get("org");
    const id = c.req.param("id");
    await assertInOrg(db, org.id, input);
    if (input.managerId) await assertNoManagerCycle(db, org.id, id, input.managerId);

    const [row] = await db
      .update(employees)
      .set(input)
      .where(and(eq(employees.orgId, org.id), eq(employees.id, id)))
      .returning({ id: employees.id });
    if (!row) notFound("Employee not found");
    await audit(c, "employee.updated", { type: "employee", id }, { fields: Object.keys(input) });
    return c.json({ ok: true });
  })

  .post(
    "/employees/:id/offboard",
    requirePermission("employee", "archive"),
    validate("json", z.object({ exitDate: isoDate })),
    async (c) => {
      const { exitDate } = c.req.valid("json");
      const { db } = c.get("deps");
      const org = c.get("org");
      const id = c.req.param("id");
      const [row] = await db
        .update(employees)
        .set({ status: "offboarded", exitDate })
        .where(and(eq(employees.orgId, org.id), eq(employees.id, id)))
        .returning({ id: employees.id });
      if (!row) notFound("Employee not found");
      // Their direct reports move up to the next manager.
      await db.execute(sql`
        update employees set manager_id = (select manager_id from employees where id = ${id})
        where org_id = ${org.id} and manager_id = ${id}`);
      await audit(c, "employee.offboarded", { type: "employee", id }, { exitDate });
      return c.json({ ok: true });
    },
  )

  /** Ask Webrizen to email them an invitation to the organization, so they can sign in. */
  .post(
    "/employees/:id/invite",
    requirePermission("employee", "create"),
    validate("json", z.object({ role: z.string().trim().min(1).max(64).default("member") })),
    async (c) => {
      const { db, directory } = c.get("deps");
      const org = c.get("org");
      const { role } = c.req.valid("json");
      const [e] = await listQuery(db)
        .where(and(eq(employees.orgId, org.id), eq(employees.id, c.req.param("id"))))
        .limit(1);
      if (!e) notFound("Employee not found");
      if (!e.workEmail) throw new HTTPException(422, { message: "Add their work email first. The invitation goes there." });
      if (e.signIn === "active") throw new HTTPException(409, { message: `${e.fullName} can already sign in.` });
      if (e.status === "offboarded") throw new HTTPException(409, { message: "This person has been offboarded." });
      const accessToken = c.get("viewer")?.accessToken;
      if (!directory || !accessToken) throw new HTTPException(501, { message: "Invitations need Webrizen sign-in, which isn't set up here." });

      const result = await directory.invite({ email: e.workEmail, name: e.fullName, role, accessToken });
      if (!result.ok) {
        const status = result.code === "already_member" ? 409 : result.code === "not_allowed" || result.code === "not_a_member" ? 403 : result.code === "invalid_role" ? 422 : 502;
        const message =
          result.code === "already_member"
            ? `${e.workEmail} is already in your Webrizen organization, so they can sign in now.`
            : status === 403
              ? "Your Webrizen role doesn't allow inviting people. Ask an owner or admin."
              : status === 422
                ? result.message
                : `Webrizen couldn't send the invitation: ${result.message}`;
        throw new HTTPException(status as 403 | 409 | 422 | 502, { message });
      }
      await db.update(employees).set({ invitedAt: new Date(), invitedRole: role }).where(eq(employees.id, e.id));
      await audit(c, "employee.invited", { type: "employee", id: e.id }, { email: e.workEmail, role });
      return c.json({ invitedAt: new Date().toISOString(), expiresAt: result.expiresAt });
    },
  )

  .post("/employees/import-members", requirePermission("employee", "create"), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const unlinked = await db
      .select({ id: members.id, name: members.name, email: members.email })
      .from(members)
      .leftJoin(employees, and(eq(employees.memberId, members.id), eq(employees.orgId, org.id)))
      .where(and(eq(members.orgId, org.id), eq(members.status, "active"), isNull(employees.id)))
      .orderBy(asc(members.name));

    let created = 0;
    for (const m of unlinked) {
      const code = `EMP-${String(await nextSequence(db, org.id, "employee")).padStart(4, "0")}`;
      await db.insert(employees).values({
        orgId: org.id,
        memberId: m.id,
        fullName: m.name,
        workEmail: m.email.toLowerCase(),
        employeeCode: code,
        createdBy: c.get("viewer")!.userId,
      });
      created++;
    }
    if (created) await audit(c, "employee.imported", undefined, { count: created });
    return c.json({ created });
  });
