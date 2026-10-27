import { allPermissions, ROLE_PRESETS } from "@operant/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DirectoryInviter } from "./context.ts";
import { createTestApi, viewer } from "./test-utils.ts";

/* Acme: Hana (owner), Mo (member, can't add people). */
const viewers = {
  hana: { ...viewer("hana", "acme", ["owner"], allPermissions()), accessToken: "hana-token" },
  mo: { ...viewer("mo", "acme", ["member"], ROLE_PRESETS.member!), accessToken: "mo-token" },
};

// A stand-in for Webrizen: records invitations, and answers like the real API for a few addresses.
const sent: Parameters<DirectoryInviter["invite"]>[0][] = [];
const directory: DirectoryInviter = {
  async invite(input) {
    sent.push(input);
    if (input.email === "taken@acme.test") return { ok: false, code: "already_member", message: "Already a member" };
    if (input.email === "down@acme.test") return { ok: false, code: "500", message: "Webrizen is down" };
    return { ok: true, expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString() };
  },
  async removeFromOrganization() {
    return { ok: true };
  },
};

let t: Awaited<ReturnType<typeof createTestApi>>;
let moRecord = "";
const add = async (fullName: string, workEmail?: string) =>
  (await t.call<{ employee: { id: string } }>("hana", "/employees", { fullName, ...(workEmail ? { workEmail } : {}) })).json.employee.id;
type Row = { id: string; signIn: string; invitedAt: string | null };
const row = async (id: string) => (await t.call<{ employee: Row }>("hana", `/employees/${id}`)).json.employee;
type InviteRole = { id: string; name: string; isDefault: boolean };
const inviteRoles = async () => (await t.call<{ roles: InviteRole[]; available: boolean }>("hana", "/employees/invite-roles")).json;

beforeAll(async () => {
  t = await createTestApi(viewers, { directory });
  for (const v of Object.keys(viewers)) await t.call(v, "/me");
}, 60_000);

afterAll(async () => t?.close());

describe("inviting employees to sign in", () => {
  it("offers the organization's own roles, default first, and never Admin", async () => {
    const r = await inviteRoles();
    expect(r.available).toBe(true);
    expect(r.roles[0]).toMatchObject({ name: "Staff", isDefault: true });
    expect(r.roles.map((x) => x.name).sort()).toEqual(["Accounts", "HR", "Manager", "Staff"]);
  });

  it("sends the invitation through Webrizen and remembers the Operant role", async () => {
    const manager = (await inviteRoles()).roles.find((x) => x.name === "Manager")!;
    const id = await add("Ravi Kumar", "ravi@acme.test");
    expect((await row(id)).signIn).toBe("none");
    const r = await t.call<{ expiresAt: string }>("hana", `/employees/${id}/invite`, { role: manager.id });
    expect(r.status).toBe(200);
    // Webrizen only hears who to invite; the role stays in Operant.
    expect(sent.at(-1)).toEqual({ email: "ravi@acme.test", name: "Ravi Kumar", accessToken: "hana-token" });
    const after = await row(id);
    expect(after.signIn).toBe("invited");
    expect(after.invitedAt).toBeTruthy();
  });

  it("can't make anyone an organization admin", async () => {
    const before = sent.length;
    const r = await t.call("hana", `/employees/${await add("Priya", "priya@acme.test")}/invite`, { role: "admin" });
    expect(r.status).toBe(400);
    expect(sent.length).toBe(before);
  });

  it("needs a work email, a real role, and the right to add people", async () => {
    expect((await t.call("hana", `/employees/${await add("No Email")}/invite`, {})).status).toBe(422);
    const id = await add("Asha", "asha@acme.test");
    expect((await t.call("hana", `/employees/${id}/invite`, { role: "00000000-0000-7000-8000-000000000000" })).status).toBe(422);
    expect((await t.call("mo", `/employees/${id}/invite`, {})).status).toBe(403);
  });

  it("treats someone who's already a member as able to sign in", async () => {
    // Mo signed in, so a record with Mo's email is already "active", with nothing to send.
    const id = (moRecord = await add("Mo Again", "mo@acme.test"));
    expect((await row(id)).signIn).toBe("active");
    const before = sent.length;
    expect((await t.call("hana", `/employees/${id}/invite`, {})).status).toBe(409);
    expect(sent.length).toBe(before);
  });

  it("can invite someone again after they were removed in Webrizen", async () => {
    await t.db.execute(`update members set status = 'removed' where user_id = 'mo'`);
    // The record that counted as "can sign in" before.
    expect((await row(moRecord)).signIn).toBe("none");
  });

  it("explains Webrizen's refusals", async () => {
    const taken = await t.call<{ error: string }>("hana", `/employees/${await add("Taken", "taken@acme.test")}/invite`, {});
    expect(taken.status).toBe(409);
    expect(taken.json.error).toContain("can sign in now");
    const down = await t.call<{ error: string }>("hana", `/employees/${await add("Down", "down@acme.test")}/invite`, {});
    expect(down.status).toBe(502);
  });
});
