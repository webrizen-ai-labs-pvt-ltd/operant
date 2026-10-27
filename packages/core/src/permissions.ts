/**
 * Operant permission catalogue.
 *
 * The same list is registered in Webrizen SSO as this app's resources (cloud) and
 * used by the built-in role editor (offline). Code always checks permissions,
 * never role names, so organizations can reshape roles without code changes.
 */
export const PERMISSIONS = {
  employee: ["read", "create", "update", "archive"],
  department: ["read", "manage"],
  leave: ["read", "request", "approve"],
  project: ["read", "create", "update", "archive"],
  task: ["read", "create", "update", "assign", "delete"],
  channel: ["read", "create", "manage"],
  client: ["read", "create", "update"],
  invoice: ["read", "create", "update", "send", "void"],
  payment: ["read", "record", "refund"],
  report: ["read_work", "read_finance"],
  audit: ["read"],
  settings: ["manage"],
} as const;

export type Resource = keyof typeof PERMISSIONS;
export type Action<R extends Resource = Resource> = (typeof PERMISSIONS)[R][number];

/** Resolved permissions for a member: resource → allowed actions. */
export type PermissionSet = Partial<Record<string, readonly string[]>>;

export function can<R extends Resource>(perms: PermissionSet, resource: R, action: Action<R>): boolean {
  return perms[resource]?.includes(action) ?? false;
}

/** Every permission, used for the owner role and for local development. */
export function allPermissions(): PermissionSet {
  const out: Record<string, readonly string[]> = {};
  for (const [resource, actions] of Object.entries(PERMISSIONS)) out[resource] = [...actions];
  return out;
}

/**
 * What each of Operant's roles in Webrizen SSO can do (cloud). Webrizen sends the role keys;
 * the permissions live here. Organization owners and admins get everything.
 */
export const WEBRIZEN_ROLE_PERMISSIONS: Record<string, PermissionSet> = {
  partner: allPermissions(),
  manager: {
    employee: ["read"],
    department: ["read"],
    leave: ["read", "request", "approve"],
    project: ["read", "create", "update", "archive"],
    task: ["read", "create", "update", "assign", "delete"],
    channel: ["read", "create", "manage"],
    client: ["read"],
    report: ["read_work"],
  },
  staff: {
    employee: ["read"],
    department: ["read"],
    leave: ["read", "request"],
    project: ["read"],
    task: ["read", "create", "update"],
    channel: ["read", "create"],
  },
  accounts: {
    employee: ["read"],
    client: ["read", "create", "update"],
    invoice: ["read", "create", "update", "send", "void"],
    payment: ["read", "record", "refund"],
    report: ["read_finance"],
  },
  hr: {
    employee: ["read", "create", "update", "archive"],
    department: ["read", "manage"],
    leave: ["read", "request", "approve"],
    channel: ["read", "create"],
    report: ["read_work"],
  },
};

/** Permissions for a Webrizen organization role plus this app's roles (unknown roles add nothing). */
export function permissionsForRoles(orgRole: string, appRoles: readonly string[]): PermissionSet {
  if (orgRole === "owner" || orgRole === "admin") return allPermissions();
  const out: Record<string, Set<string>> = {};
  for (const role of appRoles) {
    for (const [resource, actions] of Object.entries(WEBRIZEN_ROLE_PERMISSIONS[role] ?? {})) {
      for (const a of actions ?? []) (out[resource] ??= new Set()).add(a);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([r, s]) => [r, [...s]]));
}

/** Built-in role presets for the offline edition's role editor. */
export const ROLE_PRESETS: Record<string, PermissionSet> = {
  owner: allPermissions(),
  admin: allPermissions(),
  manager: {
    employee: ["read"],
    department: ["read"],
    leave: ["read", "request", "approve"],
    project: ["read", "create", "update", "archive"],
    task: ["read", "create", "update", "assign", "delete"],
    channel: ["read", "create", "manage"],
    client: ["read"],
    report: ["read_work"],
  },
  member: {
    employee: ["read"],
    department: ["read"],
    leave: ["read", "request"],
    project: ["read"],
    task: ["read", "create", "update"],
    channel: ["read", "create"],
  },
  accountant: {
    employee: ["read"],
    client: ["read", "create", "update"],
    invoice: ["read", "create", "update", "send", "void"],
    payment: ["read", "record", "refund"],
    report: ["read_finance"],
  },
};
