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

/** Organization owners and admins (from Webrizen, or the offline edition) can do everything. */
export const isOrgAdminRole = (roles: readonly string[]) => roles.includes("owner") || roles.includes("admin");

/** Keep only real resource/action pairs, so stored roles can't grant something that doesn't exist. */
export function cleanPermissions(input: Record<string, readonly string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(PERMISSIONS)) {
    const allowed = (input[resource] ?? []).filter((a) => (actions as readonly string[]).includes(a));
    if (allowed.length) out[resource] = [...new Set(allowed)];
  }
  return out;
}

export interface StarterRole {
  key: string;
  name: string;
  description: string;
  permissions: PermissionSet;
  isDefault?: boolean;
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

/** Roles every new organization starts with. Each business can rename, change or delete them. */
export const STARTER_ROLES: StarterRole[] = [
  { key: "manager", name: "Manager", description: "Runs projects and approves the team's work and leave.", permissions: ROLE_PRESETS.manager! },
  { key: "staff", name: "Staff", description: "Works on assigned tasks, logs time and requests leave.", permissions: ROLE_PRESETS.member!, isDefault: true },
  { key: "accounts", name: "Accounts", description: "Invoices, payments and client billing.", permissions: ROLE_PRESETS.accountant! },
  {
    key: "hr",
    name: "HR",
    description: "Team records, departments, leave and attendance.",
    permissions: {
      employee: ["read", "create", "update", "archive"],
      department: ["read", "manage"],
      leave: ["read", "request", "approve"],
      channel: ["read", "create"],
      report: ["read_work"],
    },
  },
];
