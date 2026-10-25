import { allPermissions, ROLE_PRESETS } from "@operant/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureMailer, createTestApi, viewer } from "./test-utils.ts";

/* Acme: Fia (owner), Max (manager), Mo (member). Globex: Gus. */
const viewers = {
  fia: viewer("fia", "acme", ["owner"], allPermissions()),
  max: viewer("max", "acme", ["manager"], ROLE_PRESETS.manager!),
  mo: viewer("mo", "acme", ["member"], ROLE_PRESETS.member!),
  gus: viewer("gus", "globex", ["owner"], allPermissions()),
};

const mail = captureMailer();
let t: Awaited<ReturnType<typeof createTestApi>>;

/** A client's browser: keeps the portal cookie between calls. */
function browser() {
  let cookie = "";
  return {
    async call<T = unknown>(path: string, body?: unknown, method?: string) {
      const res = await t.app.request(path, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return { status: res.status, json: (await res.json().catch(() => null)) as T, res };
    },
    async upload(path: string, form: FormData) {
      const res = await t.app.request(path, { method: "POST", headers: cookie ? { cookie } : {}, body: form });
      return { status: res.status, json: (await res.json().catch(() => null)) as { attachment: { id: string } } };
    },
  };
}

async function signIn(b: ReturnType<typeof browser>, email: string, slug = "acme") {
  expect((await b.call(`/portal/orgs/${slug}/auth/code`, { email })).status).toBe(200);
  const code = mail.sent.at(-1)!.subject.slice(0, 6);
  expect((await b.call(`/portal/orgs/${slug}/auth/verify`, { email, code })).status).toBe(200);
}

let serviceId = "";
let requestId = "";
const priya = browser();

beforeAll(async () => {
  t = await createTestApi(viewers, { mailer: mail.mailer });
  for (const v of Object.keys(viewers)) await t.call(v, "/me");
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe("services and the directory", () => {
  it("lets admins list services; the directory shows only listed orgs", async () => {
    expect((await t.call("max", "/services", { name: "GST returns" })).status).toBe(403);
    const r = await t.call<{ service: { id: string } }>("fia", "/services", {
      name: "GST returns",
      summary: "Monthly GSTR-1 and GSTR-3B",
      priceType: "from",
      price: 250_000,
      billing: "monthly",
      requiredDocs: [{ name: "Sales register" }, { name: "Purchase invoices", hint: "PDF or Excel" }],
    });
    expect(r.status).toBe(201);
    serviceId = r.json.service.id;
    expect((await t.call("fia", "/services", { name: "Audit", priceType: "fixed" })).status).toBe(422);
    await t.call("fia", "/services", { name: "Statutory audit", priceType: "quote" });

    expect((await t.call<{ orgs: unknown[] }>(null, "/portal/orgs")).json.orgs).toHaveLength(0);
    await t.call("fia", "/portal-settings", { listed: true, tagline: "Chartered accountants" }, "PATCH");
    const dir = await t.call<{ orgs: { slug: string; services: number; tagline: string }[] }>(null, "/portal/orgs");
    expect(dir.json.orgs).toEqual([expect.objectContaining({ slug: "acme", services: 2, tagline: "Chartered accountants" })]);

    const page = await t.call<{ services: { name: string; priceLabel: string }[] }>(null, "/portal/orgs/acme");
    expect(page.json.services.map((s) => s.priceLabel)).toEqual(["From ₹2,500.00 a month", "Price on request"]);
    expect((await t.call(null, "/portal/orgs/nope")).status).toBe(404);
  });
});

describe("signing in with an email code", () => {
  it("rejects wrong codes and signs in with the right one", async () => {
    const b = browser();
    await b.call("/portal/orgs/acme/auth/code", { email: "Priya@Client.test" });
    const code = mail.sent.at(-1)!.subject.slice(0, 6);
    expect(mail.sent.at(-1)!.to).toBe("priya@client.test");
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await b.call("/portal/orgs/acme/auth/verify", { email: "priya@client.test", code: wrong })).status).toBe(400);
    expect((await b.call("/portal/orgs/acme/me")).status).toBe(401);
    await signIn(priya, "priya@client.test");
    expect((await priya.call<{ user: { email: string } }>("/portal/orgs/acme/me")).json.user.email).toBe("priya@client.test");
  });

  it("keeps sessions to one organization", async () => {
    // Signed in at Acme; Globex's portal doesn't know this browser.
    expect((await priya.call("/portal/orgs/globex/me")).status).toBe(401);
  });

  it("limits how many codes can be asked for", async () => {
    const b = browser();
    for (let i = 0; i < 5; i++) expect((await b.call("/portal/orgs/acme/auth/code", { email: "spam@client.test" })).status).toBe(200);
    expect((await b.call("/portal/orgs/acme/auth/code", { email: "spam@client.test" })).status).toBe(429);
  });
});

describe("requests", () => {
  it("creates a request with its document checklist, and tells the team", async () => {
    const before = mail.sent.length;
    const r = await priya.call<{ request: { id: string; label: string } }>("/portal/orgs/acme/requests", { serviceId, details: "Need monthly filing from October", name: "Priya Shah", companyName: "Shah Textiles" });
    expect(r.status).toBe(201);
    expect(r.json.request.label).toBe("REQ-1");
    requestId = r.json.request.id;
    // Owners hear about it by email.
    expect(mail.sent.slice(before).some((m) => m.to === "fia@acme.test" && m.subject.includes("New request"))).toBe(true);

    const d = await priya.call<{ request: { status: string }; documents: { name: string; status: string }[] }>(`/portal/orgs/acme/requests/${requestId}`);
    expect(d.json.request.status).toBe("new");
    expect(d.json.documents.map((x) => x.name)).toEqual(["Sales register", "Purchase invoices"]);

    const list = await t.call<{ requests: { label: string; clientName: string; contactName: string }[] }>("max", "/service-requests?status=open");
    expect(list.json.requests[0]).toMatchObject({ label: "REQ-1", clientName: "Shah Textiles", contactName: "Priya Shah" });
    expect((await t.call("mo", "/service-requests")).status).toBe(403);
  });

  it("carries a conversation both ways, with files", async () => {
    expect((await priya.call(`/portal/orgs/acme/requests/${requestId}/messages`, { body: "Hi! Also need help with last quarter." })).status).toBe(201);
    const before = mail.sent.length;
    expect((await t.call("max", `/service-requests/${requestId}/messages`, { body: "Sure, send the sales register first." })).status).toBe(201);
    expect(mail.sent.slice(before).some((m) => m.to === "priya@client.test" && m.subject.includes("New message"))).toBe(true);

    const docs = (await priya.call<{ documents: { id: string }[] }>(`/portal/orgs/acme/requests/${requestId}`)).json.documents;
    const form = new FormData();
    form.set("file", new File(["sales"], "sales.xlsx", { type: "application/vnd.ms-excel" }));
    form.set("ownerType", "client_document");
    form.set("ownerId", docs[0]!.id);
    expect((await priya.upload("/portal/orgs/acme/files", form)).status).toBe(201);

    const staff = await t.call<{ request: { status: string; assigneeUserId: string }; messages: { authorKind: string; author: { name: string } }[]; documents: { status: string; files: unknown[] }[] }>("max", `/service-requests/${requestId}`);
    expect(staff.json.request).toMatchObject({ status: "in_discussion", assigneeUserId: "max" });
    expect(staff.json.messages.map((m) => m.authorKind)).toEqual(["client", "staff"]);
    expect(staff.json.documents[0]).toMatchObject({ status: "uploaded", files: [expect.anything()] });
  });

  it("never shows one client another client's requests", async () => {
    const other = browser();
    await signIn(other, "someone@else.test");
    expect((await other.call(`/portal/orgs/acme/requests/${requestId}`)).status).toBe(404);
    expect((await other.call<{ requests: unknown[] }>("/portal/orgs/acme/home")).json.requests).toHaveLength(0);
  });

  it("quotes, asks for billing details on acceptance, and starts a project", async () => {
    const q = await t.call<{ quote: { id: string } }>("fia", `/service-requests/${requestId}/quote`, {});
    expect(q.status).toBe(201);
    await t.call("fia", `/finance/documents/${q.json.quote.id}/issue`, { email: false });
    const d = await priya.call<{ request: { status: string; quote: { number: string; total: number } } }>(`/portal/orgs/acme/requests/${requestId}`);
    expect(d.json.request.status).toBe("quoted");
    expect(d.json.request.quote.total).toBe(250_000); // Acme isn't GST-registered here, so no GST

    const blocked = await priya.call<{ code: string }>(`/portal/orgs/acme/requests/${requestId}/quote/accept`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe("billing_required");
    expect((await priya.call("/portal/orgs/acme/billing", { legalName: "Shah Textiles Pvt Ltd", billingAddress: "Surat", gstin: "24AAPFU0939F1ZZ" }, "PUT")).status).toBe(400);
    expect((await priya.call("/portal/orgs/acme/billing", { legalName: "Shah Textiles Pvt Ltd", billingAddress: "Ring Road, Surat", stateCode: "24" }, "PUT")).status).toBe(200);
    expect((await priya.call(`/portal/orgs/acme/requests/${requestId}/quote/accept`, {})).status).toBe(200);

    const clientId = (await t.call<{ client: { id: string } }>("fia", `/service-requests/${requestId}`)).json.client.id;
    const p = await t.call<{ project: { id: string } }>("fia", "/projects", { name: "Shah Textiles GST", clientId });
    expect((await t.call("fia", `/service-requests/${requestId}/project`, { projectId: p.json.project.id })).status).toBe(200);

    await t.call("fia", "/tasks", { title: "File GSTR-1", projectId: p.json.project.id });
    await t.call("fia", "/tasks", { title: "File GSTR-3B", projectId: p.json.project.id, status: "done" });
    const home = await priya.call<{ projects: { id: string; done: number; total: number; docsNeeded: number }[]; requests: { status: string }[] }>("/portal/orgs/acme/home");
    expect(home.json.requests[0]!.status).toBe("started");
    expect(home.json.projects).toEqual([expect.objectContaining({ id: p.json.project.id, done: 1, total: 2, docsNeeded: 1 })]);
    const svc = await t.call<{ services: { name: string; requests: number }[] }>("fia", "/services");
    expect(svc.json.services.find((x) => x.name === "GST returns")!.requests).toBe(1);
    const proj = await priya.call<{ messages: { body: string }[]; documents: unknown[] }>(`/portal/orgs/acme/projects/${p.json.project.id}`);
    expect(proj.json.messages.at(-1)!.body).toContain("Work has started");
    expect(proj.json.documents).toHaveLength(2);
    // The client sees their issued documents, not drafts.
    const docs = await priya.call<{ documents: { kind: string; status: string; url: string }[] }>("/portal/orgs/acme/invoices");
    expect(docs.json.documents).toEqual([expect.objectContaining({ kind: "quote", status: "accepted", url: expect.stringMatching(/\/i\//) })]);
  });
});

describe("answering quotes from the portal", () => {
  let clientId = "";
  const quote = async (rupees: number) => {
    const q = await t.call<{ document: { id: string } }>("fia", "/finance/documents", { kind: "quote", clientId, issueDate: "2026-10-20", lines: [{ description: "Annual audit", quantity: 1, unitPrice: rupees * 100, taxRate: 18 }] });
    await t.call("fia", `/finance/documents/${q.json.document.id}/issue`, { email: false });
    return q.json.document.id;
  };
  type Offer = { id: string; amount: number; status: string };
  const staffView = async (id: string) =>
    (await t.call<{ document: { status: string; number: string; total: number }; counterOffers: Offer[] }>("fia", `/finance/documents/${id}`)).json;
  const billing = async () => (await priya.call<{ documents: { id: string; number: string; status: string; total: number; counterOffer: Offer | null }[] }>("/portal/orgs/acme/invoices")).json.documents;

  beforeAll(async () => {
    clientId = (await t.call<{ client: { id: string } }>("fia", `/service-requests/${requestId}`)).json.client.id;
  });

  it("proposes a new price, which the team can reject", async () => {
    const q = await quote(5000);
    const sent = await priya.call(`/portal/orgs/acme/quotes/${q}/counter`, { amount: 400_000, note: "Our budget is ₹4,000" });
    expect(sent.status).toBe(201);
    expect((await priya.call(`/portal/orgs/acme/quotes/${q}/counter`, { amount: 450_000 })).status).toBe(409);
    expect((await staffView(q)).counterOffers).toEqual([expect.objectContaining({ amount: 400_000, status: "pending" })]);
    const list = await t.call<{ documents: { id: string; counterPending: boolean }[] }>("fia", "/finance/documents?kind=quote");
    expect(list.json.documents.find((d) => d.id === q)!.counterPending).toBe(true);

    expect((await t.call("mo", `/finance/documents/${q}/counter-offers/${(await staffView(q)).counterOffers[0]!.id}/reject`, {})).status).toBe(403);
    expect((await t.call("fia", `/finance/documents/${q}/counter-offers/${(await staffView(q)).counterOffers[0]!.id}/reject`, { reason: "That's below cost." })).status).toBe(200);
    expect((await billing()).find((d) => d.id === q)).toMatchObject({ status: "sent", counterOffer: { status: "rejected", amount: 400_000 } });
  });

  it("issues a revised, accepted quote at the client's price when the team approves", async () => {
    const q = (await billing()).find((d) => d.status === "sent")!.id;
    await priya.call(`/portal/orgs/acme/quotes/${q}/counter`, { amount: 450_000 });
    const offer = (await staffView(q)).counterOffers[0]!;
    const approved = await t.call<{ document: { id: string }; number: string }>("fia", `/finance/documents/${q}/counter-offers/${offer.id}/approve`, {});
    expect(approved.status).toBe(200);
    const revised = await staffView(approved.json.document.id);
    expect(revised.document).toMatchObject({ status: "accepted", total: 450_000, number: approved.json.number });
    expect((await staffView(q)).document.status).toBe("void");
    expect((await t.call("fia", `/finance/documents/${q}/counter-offers/${offer.id}/approve`, {})).status).toBe(409);
    expect((await billing()).find((d) => d.id === approved.json.document.id)).toMatchObject({ status: "accepted" });
  });

  it("accepts or declines any quote, once", async () => {
    const a = await quote(1000);
    const b = await quote(2000);
    expect((await priya.call(`/portal/orgs/acme/quotes/${a}/accept`, {})).status).toBe(200);
    expect((await priya.call(`/portal/orgs/acme/quotes/${b}/decline`, {})).status).toBe(200);
    expect((await priya.call(`/portal/orgs/acme/quotes/${b}/accept`, {})).status).toBe(409);
    expect((await priya.call(`/portal/orgs/acme/quotes/${a}/counter`, { amount: 500 })).status).toBe(409);
    const docs = await billing();
    expect(docs.find((d) => d.id === a)!.status).toBe("accepted");
    expect(docs.find((d) => d.id === b)!.status).toBe("declined");
    expect((await browser().call(`/portal/orgs/acme/quotes/${a}/accept`, {})).status).toBe(401);
  });
});

describe("clients the team already bills", () => {
  it("see their quotes as soon as they sign in with the client's email", async () => {
    const cl = await t.call<{ client: { id: string } }>("fia", "/clients", { name: "Mehta Exports", email: "accounts@mehta.test" });
    const q = await t.call<{ document: { id: string } }>("fia", "/finance/documents", { kind: "quote", clientId: cl.json.client.id, issueDate: "2026-10-20", lines: [{ description: "Bookkeeping", quantity: 1, unitPrice: 300_000, taxRate: 18 }] });
    await t.call("fia", `/finance/documents/${q.json.document.id}/issue`, { email: false });
    const mehta = browser();
    await signIn(mehta, "accounts@mehta.test");
    const docs = await mehta.call<{ documents: { id: string; status: string }[] }>("/portal/orgs/acme/invoices");
    expect(docs.json.documents).toEqual([expect.objectContaining({ id: q.json.document.id, status: "sent" })]);
  });
});
