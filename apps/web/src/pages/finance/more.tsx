import { can, INDIAN_STATES, isValidGstin, stateOfGstin, supplyTypeFor } from "@operant/core";
import { Avatar, Badge, Button, Card, cn, DateInput, Dialog, DialogContent, Em, EmptyState, FeaturedIcon, Field, Input, KpiTile, Select, Textarea, Toggle } from "@operant/ui";
import { Link } from "@tanstack/react-router";
import { Check, Copy, CreditCard, Mail, Plus, Repeat, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "../../components/app-shell.tsx";
import { api, type Me } from "../../lib/api.ts";
import {
  compactMoney,
  FINANCE_KEYS,
  type Line,
  money,
  PAYMENT_METHOD_LABEL,
  toPaise,
  useClients,
  useFinanceSettings,
  useItems,
  usePayments,
  useRecurring,
  useTaxRates,
} from "../../lib/finance.ts";
import { formatDate, useApiMutation } from "../../lib/people.ts";
import { FinanceBody } from "./layout.tsx";
import { emptyLine, LineEditor } from "./line-editor.tsx";

/* ---------------- Payments ---------------- */

export function PaymentsPage() {
  const { data } = usePayments();
  const list = data?.payments ?? [];
  const real = list.filter((p) => !p.voidedAt && p.method !== "credit_note" && p.currency === "INR");
  const total = real.reduce((s, p) => s + p.amount, 0);
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = real.filter((p) => p.paidOn.startsWith(month)).reduce((s, p) => s + p.amount, 0);
  const byMethod = [...real.reduce((m, p) => m.set(p.method, (m.get(p.method) ?? 0) + p.amount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const METHOD_COLORS = ["var(--chart-collected)", "var(--finance)", "var(--people)", "var(--collab)", "var(--work)"];
  return (
    <FinanceBody>
      <PageHeader
        title="Payments"
        description={list.length ? <><Em tone="var(--chart-collected)">{money(total)}</Em> received across {list.length} payments shown.</> : "Money received against invoices."}
        children={
          real.length ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_2fr]">
              <KpiTile label="Received this month" icon={<CreditCard />} tone="var(--chart-collected)" value={compactMoney(thisMonth)} hint={new Date().toLocaleDateString("en-IN", { month: "long" })} />
              <KpiTile label="Average payment" icon={<CreditCard />} tone="var(--finance)" value={compactMoney(Math.round(total / real.length))} hint={`Across ${real.length} payments`} />
              <Card className="p-5">
                <div className="text-[13px] text-tertiary">How clients pay</div>
                <div className="mt-3 flex h-3 gap-[2px] overflow-hidden rounded-full">
                  {byMethod.map(([m, v], i) => (
                    <span key={m} style={{ flex: v, background: METHOD_COLORS[i % METHOD_COLORS.length] }} title={`${PAYMENT_METHOD_LABEL[m] ?? m}: ${money(v)}`} />
                  ))}
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                  {byMethod.map(([m, v], i) => (
                    <li key={m} className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm" style={{ background: METHOD_COLORS[i % METHOD_COLORS.length] }} />
                      <span className="text-tertiary">{PAYMENT_METHOD_LABEL[m] ?? m}</span>
                      <span className="font-mono">{Math.round((v / total) * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ) : null
        }
      />
      <Card>
        {data && list.length === 0 ? (
          <EmptyState icon={<CreditCard />} title="No payments yet" description="Record a payment from an invoice, or connect Razorpay so clients can pay online." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-secondary bg-secondary text-left text-xs font-semibold text-quaternary">
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 font-semibold">Client</th>
                  <th className="px-5 py-3 font-semibold">Against</th>
                  <th className="px-5 py-3 font-semibold">Receipt</th>
                  <th className="px-5 py-3 font-semibold">Method</th>
                  <th className="px-5 py-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-secondary">
                {list.map((p) => (
                  <tr key={p.id} className={cn(p.voidedAt && "text-tertiary line-through")}>
                    <td className="px-5 py-3.5">{formatDate(p.paidOn)}</td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={p.clientName} className="size-7 rounded-lg text-[10px]" />
                        {p.clientName}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <Link to="/finance/invoices/$id" params={{ id: p.invoiceId }} className="font-mono text-xs text-brand-secondary hover:underline">
                        {p.invoiceNumber}
                      </Link>
                      {p.invoiceKind === "quote" ? <span className="ml-1.5 text-xs text-tertiary">quote</span> : null}
                    </td>
                    <td className="px-5 py-3.5">
                      {p.receiptNumber ? (
                        <Link to="/finance/receipts/$id" params={{ id: p.id }} className="font-mono text-xs text-brand-secondary hover:underline">
                          {p.receiptNumber}
                        </Link>
                      ) : (
                        <span className="text-quaternary">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-tertiary">
                      {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                      {p.reference ? <span className="ml-1 font-mono text-xs">· {p.reference}</span> : null}
                    </td>
                    <td className={cn("px-4 py-3 text-right font-mono", !p.voidedAt && "text-success-primary")}>{p.voidedAt ? "" : "+"}{money(p.amount, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </FinanceBody>
  );
}

/* ---------------- Retainers ---------------- */

function RetainerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: clients } = useClients();
  const { data: settings } = useFinanceSettings();
  const { data: rates } = useTaxRates();
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [nextIssueDate, setNext] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10);
  });
  const [dueDays, setDueDays] = useState("15");
  const [autoSend, setAutoSend] = useState(false);
  const [lines, setLines] = useState<Line[]>([emptyLine(rates?.taxRates.find((r) => r.isDefault)?.rate ?? 18)]);
  const [error, setError] = useState<string | null>(null);
  const client = clients?.clients.find((c) => c.id === clientId);
  const create = useApiMutation(
    () =>
      api("finance/recurring", {
        method: "POST",
        body: JSON.stringify({ clientId, name, frequency, nextIssueDate, dueDays: Number(dueDays) || 0, autoSend, lines: lines.filter((l) => l.description.trim()).map((l) => ({ ...l, hsnSac: l.hsnSac || null })) }),
      }),
    { invalidate: FINANCE_KEYS, success: "Retainer set up", onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New retainer"
        icon={Repeat}
        description="An invoice created automatically every month, quarter or year."
        className="w-[min(960px,calc(100vw-32px))]"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={create.isPending}
              onClick={() => {
                if (!clientId || !name.trim()) return setError("Choose a client and give it a name");
                if (!lines.some((l) => l.description.trim() && l.unitPrice > 0)) return setError("Add a line with a rate");
                create.mutate(undefined);
              }}
            >
              Create retainer
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Choose a client</option>
              {clients?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly SEO retainer" maxLength={120} />
          </Field>
          <Field label="Repeats">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value="monthly">Every month</option>
              <option value="quarterly">Every quarter</option>
              <option value="yearly">Every year</option>
            </Select>
          </Field>
          <Field label="First invoice on">
            <DateInput value={nextIssueDate} onChange={(v) => setNext(v)} />
          </Field>
          <Field label="Due after (days)">
            <Input type="number" min={0} max={365} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
          </Field>
          <Field label="When it's created">
            <Select value={autoSend ? "send" : "draft"} onChange={(e) => setAutoSend(e.target.value === "send")}>
              <option value="draft">Save as a draft for review</option>
              <option value="send">Issue and email the client</option>
            </Select>
          </Field>
        </div>
        <div className="mt-5">
          <LineEditor
            lines={lines}
            onChange={setLines}
            supplyType={client ? supplyTypeFor(settings?.settings.stateCode, client.stateCode, client.country) : "intra"}
            currency={client?.currency ?? "INR"}
            gstRegistered={!settings || Boolean(settings.settings.gstin)}
          />
        </div>
        {error ? <p className="mt-3 text-sm text-error-primary">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

export function RetainersPage({ me }: { me: Me }) {
  const { data } = useRecurring();
  const [creating, setCreating] = useState(false);
  const toggle = useApiMutation((v: { id: string; active: boolean }) => api(`finance/recurring/${v.id}`, { method: "PATCH", body: JSON.stringify({ active: v.active }) }), {
    invalidate: FINANCE_KEYS,
  });
  const list = data?.recurring ?? [];
  const amountOf = (r: (typeof list)[number]) => r.lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice * (1 - (l.discountPct ?? 0) / 100)), 0);
  const PER_MONTH: Record<string, number> = { monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
  const active = list.filter((r) => r.active);
  const monthly = active.reduce((s, r) => s + amountOf(r) * (PER_MONTH[r.frequency] ?? 1), 0);
  return (
    <FinanceBody>
      <PageHeader
        title="Retainers"
        description={
          active.length ? (
            <>
              <Em tone="var(--finance)">{active.length} active</Em>, worth about <Em tone="var(--chart-collected)">{money(Math.round(monthly))}</Em> a month before GST.
            </>
          ) : (
            "Recurring invoices for ongoing work."
          )
        }
        actions={
          can(me.org.permissions, "invoice", "create") ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> New retainer
            </Button>
          ) : null
        }
      />
      {data && list.length === 0 ? (
        <Card>
          <EmptyState icon={<Repeat />} title="No retainers yet" description="Set one up for monthly support, maintenance or subscriptions, and the invoices make themselves." />
        </Card>
      ) : (
        <div className="rise rise-1 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => {
            const amount = amountOf(r);
            const days = Math.round((Date.parse(`${r.nextIssueDate}T00:00:00`) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000);
            return (
              <Card key={r.id} className={cn("relative flex flex-col overflow-hidden p-5", !r.active && "opacity-60")}>
                <div className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-finance/15 blur-2xl" />
                <div className="relative flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-finance/15 text-finance [&_svg]:size-5">
                    <Repeat />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display text-[16px] font-bold">{r.name}</h3>
                    <p className="truncate text-sm text-tertiary">{r.clientName}</p>
                  </div>
                  <Badge tone={r.active ? "finance" : "neutral"}>{r.active ? (r.autoSend ? "Auto-send" : "Drafts") : "Paused"}</Badge>
                </div>
                <div className="relative mt-4 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold tabular">{money(amount)}</span>
                  <span className="text-sm text-tertiary">+ GST, {r.frequency}</span>
                </div>
                <div className="relative mt-auto flex items-center justify-between gap-3 pt-4">
                  <div className="text-xs text-tertiary">
                    {r.active ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5">
                        <span className="size-1.5 rounded-full bg-finance" />
                        Next {formatDate(r.nextIssueDate, { day: "numeric", month: "short" })}
                        {days >= 0 ? ` · in ${days} day${days === 1 ? "" : "s"}` : ""}
                      </span>
                    ) : (
                      "Paused"
                    )}
                    {r.lastIssuedAt ? <div className="mt-1">Last issued {formatDate(r.lastIssuedAt.slice(0, 10), { day: "numeric", month: "short" })}</div> : null}
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => toggle.mutate({ id: r.id, active: !r.active })}>
                    {r.active ? "Pause" : "Resume"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {creating ? <RetainerDialog open onOpenChange={setCreating} /> : null}
    </FinanceBody>
  );
}

/* ---------------- Settings ---------------- */

/** Whether invoice email works, where it comes from, where replies go, and a test send. */
function EmailCard({ enabled, from, replyTo, canManage }: { enabled: boolean; from: string | null; replyTo: string | null; canManage: boolean }) {
  const test = useApiMutation(() => api<{ to: string; sent: boolean; message: string | null }>("finance/settings/test-email", { method: "POST" }), {
    invalidate: [],
    onSuccess: (r) => (r.sent ? toast.success(`Test email sent to ${r.to}`, { description: "Check your inbox (and spam, the first time)." }) : toast.error("Test email not sent", { description: r.message ?? undefined })),
  });
  return (
    <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
      <FeaturedIcon color={enabled ? "success" : "warning"} theme="light" size="lg" icon={Mail} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">Invoice email</h2>
          <Badge tone={enabled ? "success" : "warning"} dot pill>
            {enabled ? "Connected" : "Not set up"}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-tertiary">
          {enabled ? (
            <>
              Invoices, quotes and reminders are sent from <span className="font-medium text-secondary">{from}</span>. Client replies go to{" "}
              <span className="font-medium text-secondary">{replyTo ?? "nowhere yet: add a billing email below"}</span>.
            </>
          ) : (
            "Operant can't email clients yet. Issued invoices still get a shareable link. Your administrator connects an email service (Resend) to turn this on."
          )}
        </p>
      </div>
      {canManage ? (
        <Button onClick={() => test.mutate(undefined)} disabled={test.isPending}>
          <Send /> {test.isPending ? "Sending…" : "Send test email"}
        </Button>
      ) : null}
    </Card>
  );
}

export function FinanceSettingsPage({ me }: { me: Me }) {
  const canManage = can(me.org.permissions, "settings", "manage");
  const { data } = useFinanceSettings();
  const { data: rates } = useTaxRates();
  const { data: items } = useItems();
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [bank, setBank] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [rate, setRate] = useState({ name: "", rate: "" });
  const [item, setItem] = useState({ name: "", hsnSac: "", unitPrice: "", taxRate: "18", unit: "unit" });

  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    setF({
      legalName: s.legalName ?? "",
      gstin: s.gstin ?? "",
      pan: s.pan ?? "",
      stateCode: s.stateCode ?? "",
      address: s.address ?? "",
      email: s.email ?? "",
      phone: s.phone ?? "",
      invoicePrefix: s.invoicePrefix,
      quotePrefix: s.quotePrefix,
      creditNotePrefix: s.creditNotePrefix,
      receiptPrefix: s.receiptPrefix,
      defaultDueDays: String(s.defaultDueDays),
      terms: s.terms ?? "",
      notes: s.notes ?? "",
      roundOff: s.roundOff,
      razorpayKeyId: s.razorpayKeyId ?? "",
    });
    setBank({ accountName: s.bank.accountName ?? "", accountNumber: s.bank.accountNumber ?? "", ifsc: s.bank.ifsc ?? "", bankName: s.bank.bankName ?? "", upiId: s.bank.upiId ?? "" });
  }, [data]);

  const str = (k: string) => String(f[k] ?? "");
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const gstinValid = !str("gstin") || isValidGstin(str("gstin"));

  const save = useApiMutation(
    () =>
      api("finance/settings", {
        method: "PATCH",
        body: JSON.stringify({
          legalName: str("legalName") || null,
          gstin: str("gstin") || null,
          pan: str("pan") || null,
          stateCode: str("stateCode") || null,
          address: str("address") || null,
          email: str("email") || null,
          phone: str("phone") || null,
          invoicePrefix: str("invoicePrefix"),
          quotePrefix: str("quotePrefix"),
          creditNotePrefix: str("creditNotePrefix"),
          receiptPrefix: str("receiptPrefix"),
          defaultDueDays: Number(str("defaultDueDays")) || 0,
          terms: str("terms") || null,
          notes: str("notes") || null,
          roundOff: Boolean(f.roundOff),
          bank: Object.fromEntries(Object.entries(bank).map(([k, v]) => [k, v || null])),
          razorpayKeyId: str("razorpayKeyId") || null,
          ...(secret ? { razorpayKeySecret: secret } : {}),
          ...(webhookSecret ? { razorpayWebhookSecret: webhookSecret } : {}),
        }),
      }),
    { invalidate: FINANCE_KEYS, success: "Finance settings saved", onSuccess: () => (setSecret(""), setWebhookSecret("")) },
  );
  const disconnect = useApiMutation(() => api("finance/settings", { method: "PATCH", body: JSON.stringify({ razorpayKeyId: null, razorpayKeySecret: null, razorpayWebhookSecret: null }) }), {
    invalidate: FINANCE_KEYS,
    success: "Razorpay disconnected",
  });
  const addRate = useApiMutation(() => api("finance/tax-rates", { method: "POST", body: JSON.stringify({ name: rate.name, rate: Number(rate.rate) }) }), {
    invalidate: FINANCE_KEYS,
    onSuccess: () => setRate({ name: "", rate: "" }),
  });
  const removeRate = useApiMutation((id: string) => api(`finance/tax-rates/${id}`, { method: "DELETE" }), { invalidate: FINANCE_KEYS });
  const addItem = useApiMutation(
    () => api("finance/items", { method: "POST", body: JSON.stringify({ name: item.name, hsnSac: item.hsnSac || null, unitPrice: toPaise(item.unitPrice), taxRate: Number(item.taxRate), unit: item.unit || "unit" }) }),
    { invalidate: FINANCE_KEYS, success: "Item saved", onSuccess: () => setItem({ name: "", hsnSac: "", unitPrice: "", taxRate: "18", unit: "unit" }) },
  );
  const removeItem = useApiMutation((id: string) => api(`finance/items/${id}`, { method: "DELETE" }), { invalidate: FINANCE_KEYS });

  if (!data) return <FinanceBody>{null}</FinanceBody>;
  const s = data.settings;

  return (
    <FinanceBody className="max-w-4xl">
      <PageHeader title="Finance settings" description="Appears on every invoice. Only admins can change these." />

      <EmailCard enabled={data.email.enabled} from={data.email.from} replyTo={s.email} canManage={canManage} />

      <Card className="p-6">
        <h2 className="text-lg font-bold">Your business</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Legal name">
            <Input value={str("legalName")} onChange={(e) => set("legalName", e.target.value)} disabled={!canManage} placeholder="Webrizen AI Labs Pvt Ltd" />
          </Field>
          <Field label="GSTIN (optional)" error={gstinValid ? null : "That GSTIN isn't valid"} hint={str("gstin") && gstinValid ? INDIAN_STATES[stateOfGstin(str("gstin"))] : "Leave blank if you aren't GST-registered. Invoices then go out without GST."}>
            <Input value={str("gstin")} onChange={(e) => set("gstin", e.target.value.toUpperCase().replace(/\s/g, "").slice(0, 15))} disabled={!canManage} className="font-mono" placeholder="27AAPFU0939F1ZV" />
          </Field>
          <Field label="PAN">
            <Input value={str("pan")} onChange={(e) => set("pan", e.target.value.toUpperCase().slice(0, 10))} disabled={!canManage} className="font-mono" />
          </Field>
          <Field label="State" hint="Taken from your GSTIN when set">
            <Select value={str("stateCode")} onChange={(e) => set("stateCode", e.target.value)} disabled={!canManage || Boolean(str("gstin") && gstinValid)}>
              <option value="">Choose your state</option>
              {Object.entries(INDIAN_STATES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea value={str("address")} onChange={(e) => set("address", e.target.value)} disabled={!canManage} className="min-h-16" />
          </Field>
          <Field label="Billing email">
            <Input type="email" value={str("email")} onChange={(e) => set("email", e.target.value)} disabled={!canManage} />
          </Field>
          <Field label="Phone">
            <Input value={str("phone")} onChange={(e) => set("phone", e.target.value)} disabled={!canManage} />
          </Field>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold">Numbering and defaults</h2>
        <p className="mt-1 text-sm text-tertiary">Numbers restart every financial year, e.g. {str("invoicePrefix") || "INV"}/26-27/0001.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Field label="Invoice prefix">
            <Input value={str("invoicePrefix")} onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase().slice(0, 6))} disabled={!canManage} className="font-mono" />
          </Field>
          <Field label="Quote prefix">
            <Input value={str("quotePrefix")} onChange={(e) => set("quotePrefix", e.target.value.toUpperCase().slice(0, 6))} disabled={!canManage} className="font-mono" />
          </Field>
          <Field label="Receipt prefix" hint="For payments against quotes">
            <Input value={str("receiptPrefix")} onChange={(e) => set("receiptPrefix", e.target.value.toUpperCase().slice(0, 6))} disabled={!canManage} className="font-mono" />
          </Field>
          <Field label="Credit note prefix">
            <Input value={str("creditNotePrefix")} onChange={(e) => set("creditNotePrefix", e.target.value.toUpperCase().slice(0, 6))} disabled={!canManage} className="font-mono" />
          </Field>
          <Field label="Default notes" className="sm:col-span-2">
            <Textarea value={str("notes")} onChange={(e) => set("notes", e.target.value)} disabled={!canManage} placeholder="Thank you for your business!" />
          </Field>
          <Field label="Default terms" className="sm:col-span-2">
            <Textarea value={str("terms")} onChange={(e) => set("terms", e.target.value)} disabled={!canManage} placeholder="Payment due within 15 days. Interest at 18% p.a. on late payments." />
          </Field>
          <Field label="Pay within (days)">
            <Input type="number" min={0} max={365} value={str("defaultDueDays")} onChange={(e) => set("defaultDueDays", e.target.value)} disabled={!canManage} />
          </Field>
          <Toggle
            className="sm:col-span-4"
            isSelected={Boolean(f.roundOff)}
            onChange={(v) => set("roundOff", v)}
            isDisabled={!canManage}
            label="Round totals to the nearest rupee"
            hint="Adds a round-off line so the total is a whole rupee."
          />
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold">Bank details</h2>
        <p className="mt-1 text-sm text-tertiary">Printed on invoices so clients can pay by transfer or UPI.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(
            [
              ["accountName", "Account name"],
              ["accountNumber", "Account number"],
              ["ifsc", "IFSC"],
              ["bankName", "Bank and branch"],
              ["upiId", "UPI ID"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <Input value={bank[k] ?? ""} onChange={(e) => setBank((b) => ({ ...b, [k]: k === "ifsc" ? e.target.value.toUpperCase() : e.target.value }))} disabled={!canManage} className={k === "accountNumber" || k === "ifsc" ? "font-mono" : ""} />
            </Field>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">Razorpay</h2>
          {s.razorpayConnected ? (
            <Badge tone="people">
              <Check className="size-3" /> Connected
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-tertiary">Let clients pay invoices online by UPI, card or netbanking. Find your keys in the Razorpay Dashboard under Account and settings, then API keys.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Key ID">
            <Input value={str("razorpayKeyId")} onChange={(e) => set("razorpayKeyId", e.target.value.trim())} disabled={!canManage} className="font-mono" placeholder="rzp_live_…" />
          </Field>
          <Field label="Key secret" hint={s.razorpayConnected ? "Saved and encrypted. Enter a new one to replace it." : "Stored encrypted; never shown again"}>
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} disabled={!canManage} autoComplete="off" placeholder={s.razorpayConnected ? "••••••••" : ""} />
          </Field>
          <Field label="Webhook URL" hint="In Razorpay: Webhooks → Add, event payment_link.paid" className="sm:col-span-2">
            <div className="flex gap-2">
              <Input value={data.webhookUrl} readOnly className="font-mono text-xs" />
              <Button type="button" onClick={() => (void navigator.clipboard?.writeText(data.webhookUrl), toast.success("Copied"))} aria-label="Copy webhook URL">
                <Copy />
              </Button>
            </div>
          </Field>
          <Field label="Webhook secret" hint={s.webhookConfigured ? "Saved. Enter a new one to replace it." : "The secret you set when adding the webhook"}>
            <Input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} disabled={!canManage} autoComplete="off" placeholder={s.webhookConfigured ? "••••••••" : ""} />
          </Field>
          {s.razorpayConnected && canManage ? (
            <div className="flex items-end">
              <Button variant="ghost" onClick={() => confirm("Disconnect Razorpay? Existing payment links stop updating invoices.") && disconnect.mutate(undefined)}>
                Disconnect
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {canManage ? (
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => save.mutate(undefined)} disabled={save.isPending || !gstinValid}>
            Save settings
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-bold">GST rates</h2>
          <ul className="mt-3 divide-y divide-border-secondary">
            {rates?.taxRates.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1">{r.name}</span>
                <span className="font-mono">{Number(r.rate)}%</span>
                {r.isDefault ? <Badge>Default</Badge> : null}
                {canManage ? (
                  <button type="button" aria-label={`Remove ${r.name}`} onClick={() => removeRate.mutate(r.id)} className="rounded p-1 text-tertiary hover:text-error-primary">
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <form className="mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), rate.name && rate.rate !== "" && addRate.mutate(undefined))}>
              <Input value={rate.name} onChange={(e) => setRate({ ...rate, name: e.target.value })} placeholder="GST 3% (gold)" />
              <Input type="number" min={0} max={100} step="0.25" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} className="w-24" placeholder="%" aria-label="Rate" />
              <Button type="submit" aria-label="Add rate">
                <Plus />
              </Button>
            </form>
          ) : null}
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-bold">Saved items</h2>
          <p className="mt-1 text-sm text-tertiary">Services and products you bill often. Pick them when adding a line.</p>
          <ul className="mt-3 divide-y divide-border-secondary">
            {items?.items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {it.name}
                  {it.hsnSac ? <span className="ml-2 font-mono text-xs text-tertiary">{it.hsnSac}</span> : null}
                </span>
                <span className="font-mono">{money(it.unitPrice)}</span>
                <span className="font-mono text-xs text-tertiary">{Number(it.taxRate)}%</span>
                <button type="button" aria-label={`Remove ${it.name}`} onClick={() => removeItem.mutate(it.id)} className="rounded p-1 text-tertiary hover:text-error-primary">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <form className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_90px_100px_70px_auto]" onSubmit={(e) => (e.preventDefault(), item.name && addItem.mutate(undefined))}>
            <Input value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} placeholder="Website maintenance" className="col-span-2 sm:col-span-1" />
            <Input value={item.hsnSac} onChange={(e) => setItem({ ...item, hsnSac: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="SAC" className="font-mono" aria-label="HSN or SAC" />
            <Input type="number" min={0} step="0.01" value={item.unitPrice} onChange={(e) => setItem({ ...item, unitPrice: e.target.value })} placeholder="₹ rate" className="font-mono" aria-label="Rate in rupees" />
            <Select value={item.taxRate} onChange={(e) => setItem({ ...item, taxRate: e.target.value })} aria-label="GST rate">
              {(rates?.taxRates ?? []).map((r) => (
                <option key={r.id} value={Number(r.rate)}>
                  {Number(r.rate)}%
                </option>
              ))}
            </Select>
            <Button type="submit" aria-label="Add item">
              <Plus />
            </Button>
          </form>
          <p className="mt-2 text-xs text-tertiary">Rates are in rupees; e.g. 15000 for ₹15,000.</p>
        </Card>
      </div>
    </FinanceBody>
  );
}
