import type { PermissionSet, Pillar, Terms } from "@operant/core";
import { useQuery } from "@tanstack/react-query";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const res = await fetch(path.startsWith("/") ? path : `/api/v1/${path}`, { ...init, headers, credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: { path: string; message: string }[] };
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.issues);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Me {
  edition: "cloud" | "offline";
  user: { id: string; email: string; name: string; image: string | null };
  org: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    /** "owner" or "admin" from Webrizen; empty for everyone else. */
    roles: string[];
    /** Their Operant role; null for owners and admins, who can do everything. */
    roleName: string | null;
    permissions: PermissionSet;
  };
  settings: {
    terms: Terms;
    enabledPillars: Pillar[];
    timezone: string;
    currency: string;
    workWeek: number[];
  };
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("me"),
    retry: (count, err) => !(err instanceof ApiError && (err.status === 401 || err.status === 403)) && count < 2,
    staleTime: 60_000,
  });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ["auth-config"],
    queryFn: () => api<{ sso: boolean; devAuth: boolean }>("/auth/config"),
    staleTime: Infinity,
  });
}

export function signIn(returnTo = window.location.pathname + window.location.search, prompt?: string) {
  const params = new URLSearchParams({ returnTo });
  if (prompt) params.set("prompt", prompt);
  window.location.href = `/auth/login?${params}`;
}

export async function signOut() {
  const { redirect } = await api<{ redirect: string }>("/auth/logout", { method: "POST" });
  window.location.href = redirect;
}
