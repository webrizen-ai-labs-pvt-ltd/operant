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
  async roles() {
    return ["staff", "manager", "admin"];
  },
  async invite(input) {
    sent.push(input);
    if (input.email === "taken@acme.test") return { ok: false, code: "already_member", message: "Already a member" };
    if (input.role === "nonsense") return { ok: false, code: "invalid_role", message: "There's no role called nonsense in this organization" };
    return { ok: true, expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString() };
  },
};

let t: Awaited<ReturnType<typeof createTestApi>>;
let moRecord = "";
const add = async (fullName: string, workEmail?: string) =>
  (await t.call<{ employee: { id: string } }>("hana", "/employees", { fullName, ...(workEmail ? { workEmail } : {}) })).json.employee.id;
type Row = { id: string; signIn: string; invitedAt: string | null };
const row = async (id: string) => (await t.call<{ employee: Row }>("hana", `/employees/${id}`)).json.employee;

beforeAll(async () => {
  t = await createTestApi(viewers, { directory });
  for (const v of Object.keys(viewers)) await t.call(v, "/me");
}, 60_000);

afterAll(async () => t?.close());

describe("inviting employees to sign in", () => {
  it("sends the invitation through Webrizen on behalf of the person clicking", async () => {
    const id = await add("Ravi Kumar", "ravi@acme.test");
    expect((await row(id)).signIn).toBe("none");
    const r = await t.call<{ expiresAt: string }>("hana", `/employees/${id}/invite`, { role: "member" });
    expect(r.status).toBe(200);
    expect(sent.at(-1)).toEqual({ email: "ravi@acme.test", name: "Ravi Kumar", role: "member", accessToken: "hana-token" });
    const after = await row(id);
    expect(after.signIn).toBe("invited");
    expect(after.invitedAt).toBeTruthy();
  });

  it("needs a work email, and the right to add people", async () => {
    expect((await t.call("hana", `/employees/${await add("No Email")}/invite`, {})).status).toBe(422);
    const id = await add("Asha", "asha@acme.test");
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
    const bad = await t.call<{ error: string }>("hana", `/employees/${await add("Odd Role", "odd@acme.test")}/invite`, { role: "nonsense" });
    expect(bad.status).toBe(422);
  });

  it("offers Webrizen's roles for Operant, default first, never owner", async () => {
    const r = await t.call<{ roles: string[]; available: boolean }>("hana", "/employees/invite-roles");
    expect(r.json.available).toBe(true);
    expect(r.json.roles).toEqual(["staff", "manager", "admin"]);
  });
});
