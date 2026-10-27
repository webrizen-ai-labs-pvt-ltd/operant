import { allPermissions, type ViewerOrg } from "@operant/core";
import * as client from "openid-client";
import { z } from "zod";
import { memberRoles } from "./directory.ts";
import type { Env } from "./env.ts";
import type { SessionData } from "./session.ts";

/** members:manage lets Operant read the people directory and send invitations as the signed-in person. */
export const SCOPES = "openid profile email organization offline_access members:manage";

let configPromise: Promise<client.Configuration> | null = null;

/** Discovery is cached per process (serverless instances reuse it while warm). */
export function getConfig(env: Env) {
  if (!env.WEBRIZEN_SSO_CLIENT_ID || !env.WEBRIZEN_SSO_CLIENT_SECRET) {
    throw new Error("Webrizen SSO is not configured");
  }
  const issuer = new URL(env.WEBRIZEN_SSO_ISSUER);
  // A local accounts server runs on plain http. Production always needs https.
  const insecure = issuer.protocol === "http:" && !env.isProd;
  configPromise ??= client
    // Webrizen SSO registers confidential clients for client_secret_basic (secret in the Authorization header).
    .discovery(
      issuer,
      env.WEBRIZEN_SSO_CLIENT_ID,
      undefined,
      client.ClientSecretBasic(env.WEBRIZEN_SSO_CLIENT_SECRET),
      insecure ? { execute: [client.allowInsecureRequests] } : undefined,
    )
    .catch((err) => {
      configPromise = null;
      throw err;
    });
  return configPromise;
}

/** Webrizen SSO v2: the organization signed in to, with the person's role in it. */
const orgClaim = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    role: z.string(),
  })
  .nullable()
  .optional();

const identityClaims = z.object({
  sub: z.string(),
  email: z.string().default(""),
  name: z.string().optional(),
  picture: z.string().nullable().optional(),
  org: orgClaim,
});

/** Map ID token / userinfo claims to our session shape. */
export function claimsToIdentity(raw: unknown): Pick<SessionData, "user" | "org"> {
  const c = identityClaims.parse(raw);
  const org: ViewerOrg | null = c.org
    ? {
        id: c.org.id,
        name: c.org.name,
        slug: c.org.slug,
        logo: null,
        roles: memberRoles(c.org.role),
        // Owners and admins control everything. Everyone else gets their Operant role's permissions,
        // which live in our database and are resolved on each request (see requireOrg).
        permissions: memberRoles(c.org.role).length ? allPermissions() : {},
        useOrgRole: memberRoles(c.org.role).length === 0,
      }
    : null;
  return {
    user: { id: c.sub, email: c.email, name: c.name ?? c.email, image: c.picture ?? null },
    org,
  };
}

/**
 * Identity from the ID token, topped up from the userinfo endpoint when the
 * token leaves out profile fields (name, email, picture) or has no ID token at all.
 */
export async function identityFromTokens(config: client.Configuration, tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers, subject: string) {
  const claims = tokens.claims();
  const info = claims?.name && claims.email ? null : await client.fetchUserInfo(config, tokens.access_token, claims?.sub ?? subject);
  // ID token claims win (they carry the org the user signed in to); userinfo fills the gaps.
  const merged: Record<string, unknown> = { ...info };
  for (const [k, v] of Object.entries(claims ?? {})) if (v !== undefined && v !== null && v !== "") merged[k] = v;
  return claimsToIdentity(merged);
}

export function tokensToSession(tokens: client.TokenEndpointResponse, identity: Pick<SessionData, "user" | "org">, previous?: SessionData): SessionData {
  return {
    ...identity,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
    idToken: tokens.id_token ?? previous?.idToken,
    expiresAt: Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600),
  };
}

/**
 * Renew an expiring session with the refresh token, re-reading the org claim so
 * role and permission changes reach the app within the access-token lifetime.
 */
export async function refreshSession(env: Env, session: SessionData): Promise<SessionData | null> {
  if (!session.refreshToken) return null;
  try {
    const config = await getConfig(env);
    const tokens = await client.refreshTokenGrant(config, session.refreshToken);
    return tokensToSession(tokens, await identityFromTokens(config, tokens, session.user.id), session);
  } catch (err) {
    console.warn("Session refresh failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Only same-origin relative paths are allowed as post-login destinations. */
export function safeReturnTo(value: string | undefined | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
