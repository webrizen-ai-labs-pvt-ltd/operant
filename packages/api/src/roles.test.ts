import { allPermissions, type Viewer } from "@operant/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DirectoryInviter } from "./context.ts";
import { reconcileMembers } from "./sync.ts";
import { createTestApi, viewer } from "./test-utils.ts";

/*
 * Cloud roles: Webrizen says who is in the organization (and who's an owner or admin);
 * Operant keeps each organization's roles and gives everyone else one of them.
 */

const member = (userId: string): Viewer => ({
  ...viewer(userId, "globex", [], {}),
  org: { id: "globex", name: "Globex", slug: "globex", logo: null, roles: [], permissions: {}, useOrgRole: true },
  accessToken: `${userId}-token`,
});

const viewers = {
  owner: { ...viewer("owner", "globex", ["owner"], allPermissions()), accessToken: "owner-token" },
  sam: member("sam"),
  lee: member("lee"),
  newbie: member("newbie"),
};

const removed: string[] = [];
const directory: DirectoryInviter = {
  async invite() {
    return { ok: true, expiresAt: new Date().toISOString() };
  },
  async removeFromOrganization({ email }) {
    removed.push(email);
    return { ok: true };
  },
};

let t: Awaited<ReturnType<typeof createTestApi>>;
type Role = { id: string; name: string; isDefault: boolean; people: number; permissions: Record<string, string[]> };
type Access = { id: string; userId: string; roleId: string | null; status: string; orgRole: string };
const listRoles = async () => (await t.call<{ roles: Role[] }>("owner", "/roles")).json.roles;
const access = async () => (await t.call<{ members: Access[] }>("owner", "/access")).json.members;
const me = async (who: string) => t.call<{ org: { roleName: string | null; permissions: Record<string, string[]> } }>(who, "/me");

beforeAll(async () => {
  t = await createTestApi(viewers, { directory });
  await t.call("owner", "/me");
}, 60_000);

afterAll(async () => t?.close());

describe("organization roles", () => {
  it("starts every organization with editable starter roles, Staff by default", async () => {
    const roles = await listRoles();
    expect(roles.map((r) => r.name)).toEqual(["Manager", "Staff", "Accounts", "HR"]);
    expect(roles.find((r) => r.isDefault)?.name).toBe("Staff");
  });

  it("gives people without a role the default role's permissions", async () => {
    const r = await me("sam");
    expect(r.status).toBe(200);
    expect(r.json.org.roleName).toBe("Staff");
    expect(r.json.org.permissions.task).toContain("create");
    expect(r.json.org.permissions.invoice).toBeUndefined();
    expect((await t.call("sam", "/finance/recurring")).status).toBe(403);
  });

  it("applies a role change on the very next request", async () => {
    const accounts = (await listRoles()).find((r) => r.name === "Accounts")!;
    const sam = (await access()).find((m) => m.userId === "sam")!;
    expect((await t.call("owner", `/access/${sam.id}`, { roleId: accounts.id }, "PATCH")).status).toBe(200);
    expect((await me("sam")).json.org.roleName).toBe("Accounts");
    expect((await me("sam")).json.org.permissions.invoice).toContain("send");
  });

  it("lets a business create, edit and delete its own roles", async () => {
    const created = await t.call<{ id: string }>("owner", "/roles", {
      name: "Site Supervisor",
      permissions: { task: ["read", "assign", "made-up"], project: ["read"], nonsense: ["read"] },
    });
    expect(created.status).toBe(201);
    let role = (await listRoles()).find((r) => r.id === created.json.id)!;
    // Only real permissions are kept.
    expect(role.permissions).toEqual({ task: ["read", "assign"], project: ["read"] });

    await t.call("owner", `/roles/${role.id}`, { name: "Supervisor" }, "PATCH");
    role = (await listRoles()).find((r) => r.id === created.json.id)!;
    expect(role.name).toBe("Supervisor");

    const lee = (await access()).find((m) => m.userId === "lee") ?? (await me("lee"), (await access()).find((m) => m.userId === "lee")!);
    await t.call("owner", `/access/${lee.id}`, { roleId: role.id }, "PATCH");
    expect((await me("lee")).json.org.roleName).toBe("Supervisor");

    // Deleting a role puts its people back on the default role.
    expect((await t.call("owner", `/roles/${role.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await me("lee")).json.org.roleName).toBe("Staff");
  });

  it("keeps one default role", async () => {
    const roles = await listRoles();
    const staff = roles.find((r) => r.isDefault)!;
    expect((await t.call("owner", `/roles/${staff.id}`, undefined, "DELETE")).status).toBe(409);
    const manager = roles.find((r) => r.name === "Manager")!;
    await t.call("owner", `/roles/${manager.id}/default`, {});
    expect((await listRoles()).filter((r) => r.isDefault).map((r) => r.name)).toEqual(["Manager"]);
    await t.call("owner", `/roles/${staff.id}/default`, {});
  });

  it("only lets people with settings access manage roles, and never owners' roles", async () => {
    expect((await t.call("sam", "/roles", { name: "Boss", permissions: {} })).status).toBe(403);
    const owner = (await access()).find((m) => m.userId === "owner")!;
    expect(owner.orgRole).toBe("owner");
    const staff = (await listRoles()).find((r) => r.isDefault)!;
    expect((await t.call("owner", `/access/${owner.id}`, { roleId: staff.id }, "PATCH")).status).toBe(409);
  });

  it("applies the role chosen at invitation when the person first shows up", async () => {
    const hr = (await listRoles()).find((r) => r.name === "HR")!;
    const e = await t.call<{ employee: { id: string } }>("owner", "/employees", { fullName: "New Bie", workEmail: "newbie@globex.test" });
    await t.call("owner", `/employees/${e.json.employee.id}/invite`, { role: hr.id });
    expect((await me("newbie")).json.org.roleName).toBe("HR");
  });
});

describe("turning off access", () => {
  it("blocks someone in Operant when they're offboarded, and keeps them blocked through syncs", async () => {
    const e = await t.call<{ employee: { id: string } }>("owner", "/employees", { fullName: "Lee", workEmail: "lee@globex.test" });
    const off = await t.call<{ accessTurnedOff: boolean; removal: unknown }>("owner", `/employees/${e.json.employee.id}/offboard`, { exitDate: "2026-10-31" });
    expect(off.json).toMatchObject({ accessTurnedOff: true, removal: null });
    const blocked = await me("lee");
    expect(blocked.status).toBe(403);
    expect(JSON.stringify(blocked.json)).toContain("turned off");

    // Webrizen still lists them (they're in the organization); a sync mustn't let them back in.
    const { rows } = (await t.db.execute(`select id from orgs where external_id = 'globex'`)) as unknown as { rows: { id: string }[] };
    const org = rows[0];
    const everyone = (await access()).map((m) => ({ userId: m.userId, email: `${m.userId}@globex.test`, name: m.userId, image: null, roles: [] }));
    await reconcileMembers(t.db, org!.id, everyone);
    expect((await me("lee")).status).toBe(403);
    expect(removed).toEqual([]);
  });

  it("can also remove them from the Webrizen organization", async () => {
    const e = await t.call<{ employee: { id: string } }>("owner", "/employees", { fullName: "Sam", workEmail: "sam@globex.test" });
    const off = await t.call<{ removal: { ok: boolean } }>("owner", `/employees/${e.json.employee.id}/offboard`, {
      exitDate: "2026-10-31",
      removeFromOrganization: true,
    });
    expect(off.json.removal).toEqual({ ok: true });
    expect(removed).toEqual(["sam@globex.test"]);
  });

  it("can turn access back on from Settings", async () => {
    const lee = (await access()).find((m) => m.userId === "lee")!;
    expect(lee.status).toBe("blocked");
    await t.call("owner", `/access/${lee.id}`, { blocked: false }, "PATCH");
    expect((await me("lee")).status).toBe(200);
  });
});
