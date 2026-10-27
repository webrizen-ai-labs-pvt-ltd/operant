import { describe, expect, it } from "vitest";
import { claimsToIdentity, safeReturnTo } from "./oidc.ts";
import { deriveKey, seal, unseal } from "./session.ts";

describe("safeReturnTo", () => {
  it("allows same-origin paths only", () => {
    expect(safeReturnTo("/work?x=1")).toBe("/work?x=1");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
  });
});

describe("claimsToIdentity", () => {
  it("maps the Webrizen SSO org and roles claims to permissions", () => {
    const id = claimsToIdentity({
      sub: "u1",
      email: "ravi@spiceroute.in",
      name: "Ravi Kumar",
      picture: null,
      org: { id: "o1", name: "Spice Route", slug: "spice-route", role: "member" },
      roles: ["accounts", "unknown"],
    });
    expect(id.user).toEqual({ id: "u1", email: "ravi@spiceroute.in", name: "Ravi Kumar", image: null });
    expect(id.org?.roles).toEqual(["accounts", "unknown"]);
    expect(id.org?.permissions.invoice).toContain("send");
    expect(id.org?.permissions.settings).toBeUndefined();
  });

  it("gives organization owners and admins every permission", () => {
    const id = claimsToIdentity({ sub: "u1", org: { id: "o1", name: "A", slug: "a", role: "admin" }, roles: [] });
    expect(id.org?.roles).toEqual(["admin"]);
    expect(id.org?.permissions.settings).toEqual(["manage"]);
  });

  it("handles users without an organization", () => {
    expect(claimsToIdentity({ sub: "u1", email: "a@b.c", org: null }).org).toBeNull();
  });
});

describe("session sealing", () => {
  it("round-trips and rejects the wrong key", async () => {
    const key = await deriveKey("a".repeat(40));
    const token = await seal({ hello: "world" }, key, 60);
    expect(await unseal<{ hello: string }>(token, key)).toMatchObject({ hello: "world" });
    expect(await unseal(token, await deriveKey("b".repeat(40)))).toBeNull();
    expect(await unseal("garbage", key)).toBeNull();
  });
});
