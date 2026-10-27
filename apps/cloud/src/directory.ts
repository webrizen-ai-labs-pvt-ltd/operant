import type { DirectoryInviter, MemberSnapshot } from "@operant/api";
import { z } from "zod";
import type { Env } from "./env.ts";

/**
 * Webrizen SSO management API (/v1/org/*). It acts as the signed-in person, with their access
 * token, in the organization they signed in to. Reading works for every member; inviting and
 * removing people needs an organization owner or admin.
 *
 * Operant manages its own roles (Webrizen sends none for it), so this is only about who is in
 * the organization.
 */

const INVITE_TTL_DAYS = 7;

const apiMember = z.object({
  memberId: z.string(),
  userId: z.string(),
  email: z.string(),
  name: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  orgRole: z.string(),
});

const membersPage = z.object({ members: z.array(apiMember), hasMore: z.boolean() });

/** Operant's member markers: the Webrizen organization role when it's owner or admin. */
export function memberRoles(orgRole: string) {
  return orgRole === "owner" || orgRole === "admin" ? [orgRole] : [];
}

export function toSnapshot(m: z.infer<typeof apiMember>): MemberSnapshot {
  return { userId: m.userId, email: m.email, name: m.name || m.email, image: m.image ?? null, roles: memberRoles(m.orgRole) };
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

async function listPages(env: Env, accessToken: string, q?: string) {
  const members: z.infer<typeof apiMember>[] = [];
  const search = q ? `&q=${encodeURIComponent(q)}` : "";
  for (let offset = 0; ; offset += 200) {
    const page = membersPage.parse(await call(env, accessToken, `/v1/org/members?all=true&limit=200&offset=${offset}${search}`));
    members.push(...page.members);
    if (!page.hasMore) break;
  }
  return members;
}

/** Everyone in the person's organization (all of them can open Operant). */
export async function listAllMembers(env: Env, accessToken: string): Promise<MemberSnapshot[]> {
  return (await listPages(env, accessToken)).map(toSnapshot);
}

function failure(err: unknown) {
  if (!(err instanceof WebrizenApiError)) throw err;
  return { ok: false as const, code: err.status === 403 ? "not_allowed" : err.code, message: err.message };
}

/** Invitations and removals through Webrizen, as the signed-in person. */
export function webrizenInviter(env: Env): DirectoryInviter {
  return {
    async invite({ email, name, admin, accessToken }) {
      try {
        const result = await call(env, accessToken, "/v1/org/invitations", {
          method: "POST",
          body: JSON.stringify({ email, name, roles: [], admin }),
        });
        if (result.kind === "member_updated") {
          return { ok: false, code: "already_member", message: "They're already in the organization." };
        }
        return { ok: true, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString() };
      } catch (err) {
        return failure(err);
      }
    },

    async removeFromOrganization({ email, accessToken }) {
      try {
        const match = (await listPages(env, accessToken, email)).find((m) => m.email.toLowerCase() === email.toLowerCase());
        if (!match) return { ok: true };
        await call(env, accessToken, `/v1/org/members/${encodeURIComponent(match.memberId)}`, { method: "DELETE" });
        return { ok: true };
      } catch (err) {
        return failure(err);
      }
    },
  };
}
