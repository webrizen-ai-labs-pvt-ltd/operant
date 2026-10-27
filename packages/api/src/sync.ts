import type { Viewer } from "@operant/core";
import { type Db, members, orgSettings, orgs } from "@operant/db";
import { and, eq, sql } from "drizzle-orm";
import type { ActiveOrg } from "./context.ts";
import { seedOrgDefaults } from "./defaults.ts";
import { invitedRoles } from "./roles.ts";

/** Back to active, unless someone turned off their access in Operant (offboarding). */
const keepBlocked = sql`case when ${members.status} = 'blocked' then 'blocked' else 'active' end`;

/**
 * Make sure the viewer's org and membership exist locally, and refresh their
 * name/roles. Called on every sign-in and whenever a request arrives for an
 * org we haven't seen yet. Idempotent.
 */
export async function syncViewer(db: Db, viewer: Viewer): Promise<ActiveOrg | null> {
  if (!viewer.org) return null;
  const o = viewer.org;

  const [org] = await db
    .insert(orgs)
    .values({ externalId: o.id, name: o.name, slug: o.slug, logo: o.logo })
    .onConflictDoUpdate({
      target: orgs.externalId,
      // A null logo means the identity provider didn't send one: keep ours.
      set: { name: o.name, slug: o.slug, logo: sql`coalesce(${o.logo}, ${orgs.logo})`, updatedAt: new Date() },
    })
    .returning({ id: orgs.id, name: orgs.name, slug: orgs.slug });
  if (!org) throw new Error("Failed to upsert org");

  const created = await db.insert(orgSettings).values({ orgId: org.id }).onConflictDoNothing().returning({ orgId: orgSettings.orgId });
  if (created.length > 0) await seedOrgDefaults(db, org.id);

  // A role picked when they were invited from Operant applies the first time they show up.
  const invitedRole = (await invitedRoles(db, org.id)).get(viewer.email.toLowerCase()) ?? null;
  await db
    .insert(members)
    .values({
      orgId: org.id,
      userId: viewer.userId,
      email: viewer.email,
      name: viewer.name,
      image: viewer.image,
      roles: o.roles,
      roleId: invitedRole,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [members.orgId, members.userId],
      set: {
        email: viewer.email,
        name: viewer.name,
        image: viewer.image,
        roles: o.roles,
        status: keepBlocked,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    });

  return org;
}

/** Look up our org row for the viewer's SSO org without writing. */
export async function findOrg(db: Db, externalId: string): Promise<ActiveOrg | null> {
  const [row] = await db
    .select({ id: orgs.id, name: orgs.name, slug: orgs.slug })
    .from(orgs)
    .where(eq(orgs.externalId, externalId))
    .limit(1);
  return row ?? null;
}

export interface MemberSnapshot {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  roles: string[];
}

/**
 * Replace an org's member list with a full snapshot from the identity provider
 * (list-org-members endpoint). Members missing from the snapshot are marked removed.
 */
export async function reconcileMembers(db: Db, orgId: string, snapshot: MemberSnapshot[]) {
  const invited = await invitedRoles(db, orgId);
  await db.transaction(async (tx) => {
    for (const m of snapshot) {
      await tx
        .insert(members)
        .values({ orgId, ...m, roleId: invited.get(m.email.toLowerCase()) ?? null })
        .onConflictDoUpdate({
          target: [members.orgId, members.userId],
          set: { email: m.email, name: m.name, image: m.image, roles: m.roles, status: keepBlocked, updatedAt: new Date() },
        });
    }
    const keep = snapshot.map((m) => m.userId);
    await tx
      .update(members)
      .set({ status: "removed", updatedAt: new Date() })
      .where(
        and(
          eq(members.orgId, orgId),
          keep.length ? sql`${members.userId} <> all(${sql.param(keep)}::text[])` : sql`true`,
        ),
      );
  });
}
