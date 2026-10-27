import { cleanPermissions, isOrgAdminRole, PERMISSIONS } from "@operant/core";
import { members, roles } from "@operant/db";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { audit } from "../audit.ts";
import type { AppEnv } from "../context.ts";
import { notFound } from "../helpers.ts";
import { requirePermission } from "../middleware.ts";
import { ensureOrgRoles } from "../roles.ts";
import { validate } from "../validate.ts";

/*
 * Settings → Roles & access. Each organization defines its own roles (a name and what it can
 * do) and gives one to each person. Organization owners and admins come from Webrizen and can
 * always do everything.
 */

const roleInput = z.object({
  name: z.string().trim().min(1, "Give the role a name").max(60),
  description: z.string().trim().max(240).nullish(),
  permissions: z.record(z.string(), z.array(z.string())),
});

function keyFor(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "role"
  );
}

type Db = AppEnv["Variables"]["deps"]["db"];

async function roleIn(db: Db, orgId: string, id: string) {
  const [row] = await db.select().from(roles).where(and(eq(roles.orgId, orgId), eq(roles.id, id))).limit(1);
  if (!row) notFound("Role not found");
  return row;
}

async function uniqueKey(db: Db, orgId: string, name: string) {
  const base = keyFor(name);
  const taken = new Set((await db.select({ key: roles.key }).from(roles).where(eq(roles.orgId, orgId))).map((r) => r.key));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export const roleRoutes = new Hono<AppEnv>()
  /** Every role with how many people have it, plus the permission catalogue for the editor. */
  .get("/roles", async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    await ensureOrgRoles(db, org.id);
    const [rows, holders] = await Promise.all([
      db.select().from(roles).where(eq(roles.orgId, org.id)).orderBy(asc(roles.position), asc(roles.name)),
      db
        .select({ roleId: sql<string | null>`coalesce(${members.roleId}, (select id from roles where org_id = ${org.id} and is_default limit 1))`, n: count() })
        .from(members)
        .where(and(eq(members.orgId, org.id), eq(members.status, "active"), sql`not (${members.roles} && array['owner','admin']::text[])`))
        .groupBy(sql`1`),
    ]);
    return c.json({
      roles: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        isDefault: r.isDefault,
        people: Number(holders.find((h) => h.roleId === r.id)?.n ?? 0),
      })),
      catalogue: PERMISSIONS,
    });
  })

  .post("/roles", requirePermission("settings", "manage"), validate("json", roleInput), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const v = c.req.valid("json");
    const [{ max } = { max: 0 }] = await db.select({ max: sql<number>`coalesce(max(${roles.position}), -1)::int` }).from(roles).where(eq(roles.orgId, org.id));
    const [row] = await db
      .insert(roles)
      .values({
        orgId: org.id,
        key: await uniqueKey(db, org.id, v.name),
        name: v.name,
        description: v.description ?? null,
        permissions: cleanPermissions(v.permissions),
        position: Number(max) + 1,
      })
      .returning({ id: roles.id });
    await audit(c, "role.created", { type: "role", id: row!.id }, { name: v.name });
    return c.json({ id: row!.id }, 201);
  })

  .patch("/roles/:id", requirePermission("settings", "manage"), validate("json", roleInput.partial()), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const role = await roleIn(db, org.id, c.req.param("id"));
    const v = c.req.valid("json");
    await db
      .update(roles)
      .set({
        ...(v.name !== undefined ? { name: v.name } : {}),
        ...(v.description !== undefined ? { description: v.description ?? null } : {}),
        ...(v.permissions !== undefined ? { permissions: cleanPermissions(v.permissions) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(roles.id, role.id));
    await audit(c, "role.updated", { type: "role", id: role.id }, { fields: Object.keys(v) });
    return c.json({ ok: true });
  })

  /** New people (and anyone without a role) get the default role. */
  .post("/roles/:id/default", requirePermission("settings", "manage"), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const role = await roleIn(db, org.id, c.req.param("id"));
    await db.transaction(async (tx) => {
      await tx.update(roles).set({ isDefault: false }).where(eq(roles.orgId, org.id));
      await tx.update(roles).set({ isDefault: true }).where(eq(roles.id, role.id));
    });
    await audit(c, "role.made_default", { type: "role", id: role.id }, { name: role.name });
    return c.json({ ok: true });
  })

  /** People who had the role fall back to the default role. */
  .delete("/roles/:id", requirePermission("settings", "manage"), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const role = await roleIn(db, org.id, c.req.param("id"));
    if (role.isDefault) throw new HTTPException(409, { message: "This is the default role. Make another role the default first." });
    await db.delete(roles).where(eq(roles.id, role.id));
    await audit(c, "role.deleted", { type: "role", id: role.id }, { name: role.name });
    return c.json({ ok: true });
  })

  /** Everyone in the organization, with their role and whether Operant access is on. */
  .get("/access", requirePermission("settings", "manage"), async (c) => {
    const { db } = c.get("deps");
    const org = c.get("org");
    const rows = await db
      .select({
        id: members.id,
        userId: members.userId,
        name: members.name,
        email: members.email,
        image: members.image,
        roles: members.roles,
        roleId: members.roleId,
        status: members.status,
        lastSeenAt: members.lastSeenAt,
      })
      .from(members)
      .where(and(eq(members.orgId, org.id), inArray(members.status, ["active", "blocked"])))
      .orderBy(members.name)
      .limit(2000);
    return c.json({
      members: rows.map((m) => ({ ...m, orgRole: m.roles.includes("owner") ? "owner" : m.roles.includes("admin") ? "admin" : "member" })),
    });
  })

  .patch(
    "/access/:memberId",
    requirePermission("settings", "manage"),
    validate("json", z.object({ roleId: z.uuid().nullable().optional(), blocked: z.boolean().optional() })),
    async (c) => {
      const { db } = c.get("deps");
      const org = c.get("org");
      const v = c.req.valid("json");
      const [m] = await db
        .select({ id: members.id, userId: members.userId, email: members.email, roles: members.roles, status: members.status })
        .from(members)
        .where(and(eq(members.orgId, org.id), eq(members.id, c.req.param("memberId"))))
        .limit(1);
      if (!m) notFound("Person not found");
      if (isOrgAdminRole(m.roles)) {
        throw new HTTPException(409, { message: "Owners and admins can do everything in Operant. Change their organization role in Webrizen." });
      }
      if (v.roleId) await roleIn(db, org.id, v.roleId);
      if (v.blocked !== undefined) {
        if (m.userId === c.get("viewer")!.userId) throw new HTTPException(409, { message: "You can't turn off your own access." });
        if (m.status === "removed") throw new HTTPException(409, { message: "They've left the organization." });
      }
      await db
        .update(members)
        .set({
          ...(v.roleId !== undefined ? { roleId: v.roleId } : {}),
          ...(v.blocked !== undefined ? { status: v.blocked ? ("blocked" as const) : ("active" as const) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(members.id, m.id));
      if (v.roleId !== undefined) await audit(c, "member.role_changed", { type: "member", id: m.id }, { email: m.email, roleId: v.roleId });
      if (v.blocked !== undefined) await audit(c, v.blocked ? "member.blocked" : "member.unblocked", { type: "member", id: m.id }, { email: m.email });
      return c.json({ ok: true });
    },
  );
