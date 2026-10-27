import { DEFAULT_TERMS, PILLARS, type Terms } from "@operant/core";
import { auditEvents, members, notifications, orgSettings } from "@operant/db";
import { and, desc, eq, ilike, isNull, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "../audit.ts";
import type { AppEnv } from "../context.ts";
import { requireOrg, requirePermission } from "../middleware.ts";
import { likePattern, validate } from "../validate.ts";

export const coreRoutes = new Hono<AppEnv>()
  .get("/me", requireOrg, async (c) => {
    const viewer = c.get("viewer")!;
    const org = c.get("org");
    const { db, edition } = c.get("deps");
    const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.orgId, org.id));
    const terms: Terms = { ...DEFAULT_TERMS, ...(settings?.terms ?? {}) };
    return c.json({
      edition,
      user: { id: viewer.userId, email: viewer.email, name: viewer.name, image: viewer.image },
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: viewer.org?.logo ?? null,
        roles: viewer.org?.roles ?? [],
        /** Their Operant role's name; null for owners and admins (they can do everything). */
        roleName: viewer.org?.roleName ?? null,
        permissions: viewer.org?.permissions ?? {},
      },
      settings: {
        terms,
        enabledPillars: settings?.enabledPillars ?? [...PILLARS],
        timezone: settings?.timezone ?? "Asia/Kolkata",
        currency: settings?.currency ?? "INR",
        workWeek: settings?.workWeek ?? [1, 2, 3, 4, 5],
      },
    });
  })

  .get(
    "/members",
    requireOrg,
    validate("query", z.object({ q: z.string().trim().max(100).optional() })),
    async (c) => {
      const { q } = c.req.valid("query");
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
          lastSeenAt: members.lastSeenAt,
        })
        .from(members)
        .where(
          and(
            eq(members.orgId, org.id),
            eq(members.status, "active"),
            q ? or(ilike(members.name, likePattern(q)), ilike(members.email, likePattern(q))) : undefined,
          ),
        )
        .orderBy(members.name)
        .limit(500);
      return c.json({ members: rows });
    },
  )

  .patch(
    "/settings",
    requireOrg,
    requirePermission("settings", "manage"),
    validate(
      "json",
      z.object({
        terms: z
          .partialRecord(
            z.enum(["project", "task", "client", "employee"]),
            z.object({ one: z.string().trim().min(1).max(40), many: z.string().trim().min(1).max(40) }),
          )
          .optional(),
        enabledPillars: z.array(z.enum(PILLARS)).optional(),
        timezone: z.string().max(64).optional(),
        currency: z.string().length(3).optional(),
        workWeek: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const { db } = c.get("deps");
      const org = c.get("org");
      const [current] = await db.select({ terms: orgSettings.terms }).from(orgSettings).where(eq(orgSettings.orgId, org.id));
      const values = {
        ...body,
        // Renamed terms merge into the existing ones rather than replacing them all.
        terms: body.terms ? { ...(current?.terms ?? {}), ...body.terms } : undefined,
      };
      await db
        .insert(orgSettings)
        .values({ orgId: org.id, ...values })
        .onConflictDoUpdate({ target: orgSettings.orgId, set: { ...values, updatedAt: new Date() } });
      await audit(c, "settings.updated", { type: "org", id: org.id }, { fields: Object.keys(body) });
      return c.json({ ok: true });
    },
  )

  .get(
    "/audit",
    requireOrg,
    requirePermission("audit", "read"),
    validate("query", z.object({ before: z.iso.datetime().optional() })),
    async (c) => {
      const { before } = c.req.valid("query");
      const { db } = c.get("deps");
      const org = c.get("org");
      const rows = await db
        .select({
          id: auditEvents.id,
          actorId: auditEvents.actorId,
          action: auditEvents.action,
          targetType: auditEvents.targetType,
          targetId: auditEvents.targetId,
          metadata: auditEvents.metadata,
          ip: auditEvents.ip,
          createdAt: auditEvents.createdAt,
          actorName: members.name,
          actorImage: members.image,
        })
        .from(auditEvents)
        .leftJoin(members, and(eq(members.orgId, auditEvents.orgId), eq(members.userId, auditEvents.actorId)))
        .where(and(eq(auditEvents.orgId, org.id), before ? lt(auditEvents.createdAt, new Date(before)) : undefined))
        .orderBy(desc(auditEvents.createdAt))
        .limit(50);
      return c.json({ events: rows });
    },
  )

  .get("/notifications", requireOrg, async (c) => {
    const { db } = c.get("deps");
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.orgId, c.get("org").id), eq(notifications.recipientId, c.get("viewer")!.userId)))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return c.json({ notifications: rows });
  })

  .post("/notifications/:id/read", requireOrg, async (c) => {
    const { db } = c.get("deps");
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.orgId, c.get("org").id),
          eq(notifications.recipientId, c.get("viewer")!.userId),
          eq(notifications.id, c.req.param("id")),
        ),
      );
    return c.json({ ok: true });
  })

  .post("/notifications/read-all", requireOrg, async (c) => {
    const { db } = c.get("deps");
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.orgId, c.get("org").id),
          eq(notifications.recipientId, c.get("viewer")!.userId),
          isNull(notifications.readAt),
        ),
      );
    return c.json({ ok: true });
  });
