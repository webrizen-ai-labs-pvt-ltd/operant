import { can } from "@operant/core";
import { Avatar, Badge, Button, Card, Checkbox, cn, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton, Textarea } from "@operant/ui";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldCheck, Star, Trash2, UserCheck, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "../components/app-shell.tsx";
import { api, type Me } from "../lib/api.ts";
import { useApiMutation } from "../lib/people.ts";

/*
 * Settings → Roles & access. Each business makes its own roles here and gives one to each
 * person. Webrizen only decides who is in the organization; its owners and admins can always
 * do everything.
 */

type Perms = Record<string, string[]>;
interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: Perms;
  isDefault: boolean;
  people: number;
}
interface Person {
  id: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  roleId: string | null;
  status: "active" | "blocked";
  orgRole: "owner" | "admin" | "member";
}

const KEYS = ["roles", "access", "me"];

/** What each permission means, in plain words. */
const AREAS: { resource: string; label: string; actions: Record<string, string> }[] = [
  { resource: "employee", label: "People", actions: { read: "See profiles", create: "Add people and invite them", update: "Edit profiles", archive: "Offboard people" } },
  { resource: "department", label: "Departments and teams", actions: { read: "See them", manage: "Set them up" } },
  { resource: "leave", label: "Leave", actions: { read: "See leave", request: "Request leave", approve: "Approve leave" } },
  { resource: "project", label: "Projects", actions: { read: "See projects", create: "Start projects", update: "Edit projects", archive: "Archive projects" } },
  { resource: "task", label: "Tasks", actions: { read: "See tasks", create: "Create tasks", update: "Update tasks", assign: "Assign tasks", delete: "Delete tasks" } },
  { resource: "channel", label: "Channels", actions: { read: "Read channels", create: "Start channels", manage: "Manage any channel" } },
  { resource: "client", label: "Clients", actions: { read: "See clients", create: "Add clients", update: "Edit clients" } },
  { resource: "invoice", label: "Invoices and quotes", actions: { read: "See them", create: "Create", update: "Edit", send: "Send", void: "Cancel" } },
  { resource: "payment", label: "Payments", actions: { read: "See payments", record: "Record payments", refund: "Refund" } },
  { resource: "report", label: "Reports", actions: { read_work: "Work reports", read_finance: "Finance reports" } },
  { resource: "audit", label: "Audit log", actions: { read: "See the audit log" } },
  { resource: "settings", label: "Settings", actions: { manage: "Change settings, roles and access" } },
];

const count = (p: Perms) => Object.values(p).reduce((n, a) => n + a.length, 0);

function RoleDialog({ role, onClose }: { role: Role | "new"; onClose: () => void }) {
  const existing = role === "new" ? null : role;
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [perms, setPerms] = useState<Perms>(existing?.permissions ?? {});
  const save = useApiMutation(
    () =>
      api(existing ? `roles/${existing.id}` : "roles", {
        method: existing ? "PATCH" : "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, permissions: perms }),
      }),
    { invalidate: KEYS, success: existing ? "Role saved" : `${name.trim()} role created`, onSuccess: onClose },
  );
  const toggle = (resource: string, action: string, on: boolean) =>
    setPerms((cur) => {
      const next = new Set(cur[resource] ?? []);
      if (on) next.add(action);
      else next.delete(action);
      // Doing anything with something means you can see it.
      if (on && action !== "read" && AREAS.find((a) => a.resource === resource)?.actions.read) next.add("read");
      return { ...cur, [resource]: [...next] };
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={existing ? `Edit ${existing.name}` : "New role"}
        icon={KeyRound}
        description="Pick what people with this role can do. Owners and admins can always do everything."
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate(undefined)} disabled={!name.trim() || save.isPending}>
              {existing ? "Save role" : "Create role"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Site supervisor" maxLength={60} autoFocus />
          </Field>
          <Field label="What it's for (optional)">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={240} />
          </Field>
          <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            {AREAS.map((area) => (
              <div key={area.resource} className="rounded-lg bg-secondary px-4 py-3">
                <div className="mb-2 text-sm font-semibold">{area.label}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(area.actions).map(([action, label]) => (
                    <Checkbox
                      key={action}
                      label={label}
                      isSelected={(perms[area.resource] ?? []).includes(action)}
                      onChange={(on) => toggle(area.resource, action, on)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RolesCard({ roles, canManage }: { roles: Role[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const makeDefault = useApiMutation((id: string) => api(`roles/${id}/default`, { method: "POST" }), { invalidate: KEYS, success: "Default role changed" });
  const remove = useApiMutation((id: string) => api(`roles/${id}`, { method: "DELETE" }), { invalidate: KEYS, success: "Role deleted" });

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Roles</h2>
          <p className="mt-1 text-sm text-tertiary">Your own roles, with what each can do. People who join without a role get the default one.</p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> New role
          </Button>
        ) : null}
      </div>
      <ul className="mt-4 divide-y divide-secondary">
        {roles.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{r.name}</span>
                {r.isDefault ? (
                  <Badge tone="brand" pill>
                    Default
                  </Badge>
                ) : null}
              </div>
              <div className="truncate text-sm text-tertiary">
                {r.description ? `${r.description} · ` : ""}
                {r.people} {r.people === 1 ? "person" : "people"} · {count(r.permissions)} permissions
              </div>
            </div>
            {canManage ? (
              <div className="flex gap-1">
                {!r.isDefault ? (
                  <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(r.id)} title="Make this the default role">
                    <Star className="size-4" />
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                  Edit
                </Button>
                {!r.isDefault ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Delete role"
                    onClick={() => {
                      if (confirm(`Delete ${r.name}? ${r.people ? `${r.people} ${r.people === 1 ? "person goes" : "people go"} back to the default role.` : ""}`)) remove.mutate(r.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {editing ? <RoleDialog role={editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function PeopleCard({ roles, me }: { roles: Role[]; me: Me }) {
  const { data, isLoading } = useQuery({ queryKey: ["access"], queryFn: () => api<{ members: Person[] }>("access") });
  const [q, setQ] = useState("");
  const setRole = useApiMutation(({ id, roleId }: { id: string; roleId: string }) => api(`access/${id}`, { method: "PATCH", body: JSON.stringify({ roleId }) }), {
    invalidate: KEYS,
    success: "Role changed. It applies straight away.",
  });
  const setBlocked = useApiMutation(({ id, blocked }: { id: string; blocked: boolean }) => api(`access/${id}`, { method: "PATCH", body: JSON.stringify({ blocked }) }), {
    invalidate: KEYS,
  });
  const defaultRole = roles.find((r) => r.isDefault);
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.members ?? []).filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle));
  }, [data, q]);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">People</h2>
          <p className="mt-1 text-sm text-tertiary">
            Everyone in {me.org.name} can open Operant. Choose what each person can do, or turn their access off.
          </p>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="w-full sm:w-56" />
      </div>
      {isLoading ? (
        <Skeleton className="mt-4 h-40" />
      ) : people.length === 0 ? (
        <EmptyState title="No one here yet" description="Invite people from their profile under People." />
      ) : (
        <ul className="mt-4 divide-y divide-secondary">
          {people.map((m) => {
            const admin = m.orgRole !== "member";
            const self = m.userId === me.user.id;
            return (
              <li key={m.id} className={cn("flex flex-wrap items-center gap-3 py-3", m.status === "blocked" && "opacity-60")}>
                <Avatar name={m.name} src={m.image} className="size-8" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {m.name}
                    {self ? <span className="text-tertiary"> (you)</span> : null}
                  </div>
                  <div className="truncate text-sm text-tertiary">{m.email}</div>
                </div>
                {admin ? (
                  <Badge tone="brand" pill title="Set in Webrizen. Owners and admins can do everything.">
                    <ShieldCheck className="mr-1 size-3.5" />
                    {m.orgRole === "owner" ? "Owner" : "Admin"}
                  </Badge>
                ) : (
                  <>
                    {m.status === "blocked" ? <Badge tone="warning">Access off</Badge> : null}
                    <Select
                      aria-label={`Role for ${m.name}`}
                      className="w-44"
                      value={m.roleId ?? defaultRole?.id ?? ""}
                      onChange={(e) => setRole.mutate({ id: m.id, roleId: e.target.value })}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {r.isDefault && !m.roleId ? " (default)" : ""}
                        </option>
                      ))}
                    </Select>
                    {!self ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        title={m.status === "blocked" ? "Turn access back on" : "Turn off their access to Operant"}
                        onClick={() => setBlocked.mutate({ id: m.id, blocked: m.status !== "blocked" })}
                      >
                        {m.status === "blocked" ? <UserCheck className="size-4" /> : <UserX className="size-4" />}
                      </Button>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function RolesSettingsPage({ me }: { me: Me }) {
  const canManage = can(me.org.permissions, "settings", "manage");
  const { data, isLoading } = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: Role[] }>("roles") });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title="Roles & access"
        description="Who can do what in Operant. People join your organization through Webrizen; everything about their access here is up to you."
      />
      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <RolesCard roles={data.roles} canManage={canManage} />
          {canManage ? <PeopleCard roles={data.roles} me={me} /> : null}
        </>
      )}
    </div>
  );
}
