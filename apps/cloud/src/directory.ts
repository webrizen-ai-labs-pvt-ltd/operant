import type { DirectoryInviter, MemberSnapshot } from "@operant/api";
import { z } from "zod";
import type { Env } from "./env.ts";

/**
 * Webrizen SSO management API (/v1/org/*). It acts as the signed-in person, with their access
 * token, in the organization they signed in to. Reading works for every member; inviting needs
 * an organization owner or admin.
 */

const INVITE_TTL_DAYS = 7;

const apiMember = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  orgRole: z.string(),
  roles: z.array(z.string()).default([]),
});

const membersPage = z.object({ members: z.array(apiMember), hasMore: z.boolean() });
const rolesList = z.object({ roles: z.array(z.object({ key: z.string(), isDefault: z.boolean().optional() })) });

/** Operant's member roles: the Webrizen org role when it's owner or admin, then Operant's own roles. */
export function memberRoles(orgRole: string, appRoles: string[]) {
  return orgRole === "owner" || orgRole === "admin" ? [orgRole, ...appRoles] : appRoles;
}

export function toSnapshot(m: z.infer<typeof apiMember>): MemberSnapshot {
  return { userId: m.userId, email: m.email, name: m.name || m.email, image: m.image ?? null, roles: memberRoles(m.orgRole, m.roles) };
}

class WebrizenApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call(env: Env, accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`${env.WEBRIZEN_SSO_ISSUER.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new WebrizenApiError(res.status, String(body.code ?? res.status), String(body.message ?? res.statusText));
  return body;
}

/** Everyone in the person's organization who can use Operant. */
export async function listAllMembers(env: Env, accessToken: string) {
  const members: MemberSnapshot[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = membersPage.parse(await call(env, accessToken, `/v1/org/members?limit=200&offset=${offset}`));
    members.push(...page.members.map(toSnapshot));
    if (!page.hasMore) break;
  }
  return members;
}

async function appRoles(env: Env, accessToken: string) {
  return rolesList.parse(await call(env, accessToken, "/v1/org/roles")).roles;
}

/** Invitations through Webrizen: it emails the person a link to join the organization. */
export function webrizenInviter(env: Env): DirectoryInviter {
  return {
    async roles(accessToken) {
      const roles = await appRoles(env, accessToken);
      const sorted = [...roles.filter((r) => r.isDefault), ...roles.filter((r) => !r.isDefault)];
      return [...sorted.map((r) => r.key), "admin"];
    },

    async invite({ email, name, role, accessToken }) {
      try {
        // "admin" makes them an organization admin; Webrizen still wants one Operant role, so use the default.
        const roles =
          role === "admin" || role === "member"
            ? [((await appRoles(env, accessToken)).find((r) => r.isDefault) ?? { key: "staff" }).key]
            : [role];
        const result = await call(env, accessToken, "/v1/org/invitations", {
          method: "POST",
          body: JSON.stringify({ email, name, roles, admin: role === "admin" }),
        });
        if (result.kind === "member_updated") {
          return { ok: false, code: "already_member", message: "They're already in the organization." };
        }
        return { ok: true, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString() };
      } catch (err) {
        if (!(err instanceof WebrizenApiError)) throw err;
        const code = err.status === 403 ? "not_allowed" : err.code === "unknown_role" ? "invalid_role" : err.code;
        return { ok: false, code, message: err.message };
      }
    },
  };
}
