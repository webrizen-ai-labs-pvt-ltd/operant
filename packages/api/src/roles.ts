import { type PermissionSet, STARTER_ROLES } from "@operant/core";
import { type Db, employees, members, roles } from "@operant/db";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";

/*
 * Each organization's own roles. Owners and admins (from Webrizen) can do everything; everyone
 * else has one Operant role, or the organization's default role until someone picks one.
 */

/** Give an organization the starter roles if it has none yet. Idempotent. */
export async function ensureOrgRoles(db: Db, orgId: string) {
  const [any] = await db.select({ id: roles.id }).from(roles).where(eq(roles.orgId, orgId)).limit(1);
  if (any) return;
  await db
    .insert(roles)
    .values(
      STARTER_ROLES.map((r, i) => ({
        orgId,
        key: r.key,
        name: r.name,
        description: r.description,
        permissions: r.permissions as Record<string, string[]>,
        isDefault: Boolean(r.isDefault),
        position: i,
      })),
    )
    .onConflictDoNothing();
}

/** The organization's default role (seeding the starter roles first if needed). */
export async function defaultRole(db: Db, orgId: string) {
  const find = () =>
    db
      .select({ id: roles.id, name: roles.name, permissions: roles.permissions })
      .from(roles)
      .where(eq(roles.orgId, orgId))
      .orderBy(sql`${roles.isDefault} desc`, asc(roles.position))
      .limit(1);
  let [row] = await find();
  if (!row) {
    await ensureOrgRoles(db, orgId);
    [row] = await find();
  }
  return row ?? null;
}

/** The role and permissions a non-admin member has right now. */
export async function memberRole(db: Db, orgId: string, userId: string): Promise<{ name: string; permissions: PermissionSet } | null> {
  const [row] = await db
    .select({ name: roles.name, permissions: roles.permissions })
    .from(members)
    .innerJoin(roles, eq(roles.id, members.roleId))
    .where(and(eq(members.orgId, orgId), eq(members.userId, userId)))
    .limit(1);
  return row ?? (await defaultRole(db, orgId));
}

/**
 * Roles chosen when inviting people from Operant, by email: they apply when that person first
 * shows up as a member. Only roles that still exist count.
 */
export async function invitedRoles(db: Db, orgId: string) {
  const rows = await db
    .select({ email: sql<string>`lower(${employees.workEmail})`, roleId: roles.id })
    .from(employees)
    .innerJoin(roles, and(eq(roles.orgId, employees.orgId), sql`${roles.id}::text = ${employees.invitedRole}`))
    .where(and(eq(employees.orgId, orgId), isNotNull(employees.workEmail), isNotNull(employees.invitedRole)));
  return new Map(rows.map((r) => [r.email, r.roleId]));
}
