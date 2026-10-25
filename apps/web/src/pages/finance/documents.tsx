import { can, supplyTypeFor } from "@operant/core";
import { Avatar, Button, Card, cn, DateInput, Dialog, DialogContent, EmptyState, Field, Input, Segmented, Select, Skeleton, Textarea, Toggle } from "@operant/ui";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Ban, Banknote, BellRing, Copy, ExternalLink, FileCheck2, FilePlus2, FileText, HandCoins, Link2, Printer, ReceiptIndianRupee, Search, Send, Split, Trash2 } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "../../components/app-shell.tsx";
import { Thread } from "../../components/collab/thread.tsx";
import { api, type Me } from "../../lib/api.ts";
import {
  type DocDetail,
  type DocKind,
  displayStatus,
  FINANCE_KEYS,
  compactMoney,
  KIND_LABEL,
  type Line,
  money,
  PAYMENT_METHOD_LABEL,
  toPaise,
  toRupees,
  useClients,
  useDoc,
  useDocs,
  useFinanceSettings,
  useTaxRates,
} from "../../lib/finance.ts";
import { formatDate, useApiMutation } from "../../lib/people.ts";
import { useProjects } from "../../lib/work.ts";
import { useCrumb } from "../../lib/breadcrumbs.ts";
import { ClientDialog } from "./clients.tsx";
import { InstallmentsCard, SplitDialog } from "./installments.tsx";
import { InvoiceDocument } from "./invoice-document.tsx";
import { FinanceBody, StatusPill } from "./layout.tsx";
import { emptyLine, LineEditor } from "./line-editor.tsx";

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ---------------- Lists ---------------- */

const FILTERS = {
  invoice: [
    ["", "All"],
    ["draft", "Drafts"],
    ["open", "Unpaid"],
    ["overdue", "Overdue"],
    ["paid", "Paid"],
    ["void", "Void"],
  ],
  quote: [
    ["", "All"],
    ["draft", "Drafts"],
    ["sent", "Sent"],
    ["accepted", "Accepted"],
    ["partially_paid", "Part paid"],
    ["paid", "Paid"],
    ["declined", "Declined"],
  ],
  credit_note: [["", "All"]],
} as const;

const INVOICE_BUCKETS = [
  { key: "draft", label: "Drafts", color: "var(--color-text-quaternary)", match: (s: string) => s === "draft" },
  { key: "open", label: "Unpaid", color: "var(--collab)", match: (s: string) => s === "sent" || s === "partially_paid" || s === "overdue" },
  { key: "overdue", label: "Overdue", color: "var(--color-fg-error-primary)", match: (s: string) => s === "overdue" },
  { key: "paid", label: "Paid", color: "var(--color-fg-success-primary)", match: (s: string) => s === "paid" },
];
const QUOTE_BUCKETS = [
  { key: "draft", label: "Drafts", color: "var(--color-text-quaternary)", match: (s: string) => s === "draft" },
  { key: "sent", label: "Sent", color: "var(--collab)", match: (s: string) => s === "sent" },
  { key: "accepted", label: "Accepted", color: "var(--people)", match: (s: string) => s === "accepted" },
  { key: "partially_paid", label: "Part paid", color: "var(--finance)", match: (s: string) => s === "partially_paid" },
  { key: "paid", label: "Paid in full", color: "var(--color-fg-success-primary)", match: (s: string) => s === "paid" },
];

export function DocumentsPage({ me, kind }: { me: Me; kind: "invoice" | "quote" }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const [showCredit, setShowCredit] = useState(false);
  const effectiveKind = kind === "invoice" && showCredit ? "credit_note" : kind;
  const { data, isLoading } = useDocs({ kind: effectiveKind, status: status || undefined, q: deferred || undefined });
  const docs = data?.documents ?? [];
  const today = data?.today ?? todayLocal();
  const label = KIND_LABEL[effectiveKind];
  const canCreate = can(me.org.permissions, "invoice", "create");

  // Totals per status, from the unfiltered list, for the summary strip.
  const { data: everything } = useDocs({ kind });
  const buckets = (kind === "invoice" ? INVOICE_BUCKETS : QUOTE_BUCKETS).map((b) => {
    const list = (everything?.documents ?? []).filter((d) => b.match(displayStatus(d, everything?.today ?? today)));
    const amount = list.filter((d) => d.currency === "INR").reduce((a, d) => a + (b.key === "open" || b.key === "overdue" ? d.total - d.amountPaid : b.key === "partially_paid" ? d.amountPaid : d.total), 0);
    return { ...b, count: list.length, amount };
  });

  return (
    <FinanceBody>
      <PageHeader
        title={KIND_LABEL[kind].many}
        description={kind === "invoice" ? "GST invoices, payments and credit notes." : "Quotes collect advances and part payments, each with a receipt. The final invoice is generated once a quote is paid in full."}
        children={
          everything?.documents.length ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {buckets.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => (setShowCredit(false), setStatus(status === b.key ? "" : b.key))}
                  className={cn(
                    "relative overflow-hidden rounded-xl border bg-primary p-4 text-left shadow-xs transition-colors",
                    status === b.key && !showCredit ? "border-primary" : "border-secondary hover:border-primary",
                  )}
                >
                  <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: b.color }} />
                  <div className="flex items-center justify-between text-[13px] text-tertiary">
                    {b.label}
                    <span className="rounded-full px-1.5 font-mono text-[10.5px]" style={{ color: b.color, background: `color-mix(in srgb, ${b.color} 14%, transparent)` }}>
                      {b.count}
                    </span>
                  </div>
                  <div className="mt-1.5 font-display text-2xl font-bold tabular">{compactMoney(b.amount)}</div>
                </button>
              ))}
            </div>
          ) : null
        }
        actions={
          canCreate ? (
            <Button variant="primary" asChild>
              <Link to="/finance/new" search={{ kind }}>
                <FilePlus2 /> New {KIND_LABEL[kind].one.toLowerCase()}
              </Link>
            </Button>
          ) : null
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-secondary p-3">
          <Segmented
            aria-label="Filter"
            value={showCredit ? "credit" : status || "all"}
            onChange={(key) => {
              if (key === "credit") {
                setShowCredit(true);
                setStatus("");
              } else {
                setShowCredit(false);
                setStatus(key === "all" ? "" : key);
              }
            }}
            items={[
              ...FILTERS[kind].map(([k, l]) => ({ key: k || "all", label: l })),
              ...(kind === "invoice" ? [{ key: "credit", label: "Credit notes" }] : []),
            ]}
          />
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tertiary" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number or client" className="h-8 pl-9" />
          </div>
        </div>
        {isLoading ? <Skeleton className="m-4 h-24" /> : null}
        {!isLoading && docs.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title={status || deferred ? "Nothing matches" : `No ${label.one.toLowerCase()}s yet`}
            description={kind === "invoice" ? "Create an invoice, or complete a billable milestone and a draft appears here." : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-secondary bg-secondary text-left text-xs font-semibold text-quaternary">
                  <th className="px-5 py-3 font-semibold">Number</th>
                  <th className="px-5 py-3 font-semibold">Client</th>
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 font-semibold">{effectiveKind === "quote" ? "Valid until" : "Due"}</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Amount</th>
                  {effectiveKind === "invoice" ? <th className="px-5 py-3 text-right font-semibold">Balance</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-secondary">
                {docs.map((d) => {
                  const st = displayStatus(d, today);
                  return (
                    <tr key={d.id} className="cursor-pointer hover:bg-secondary/60" onClick={() => navigate({ to: "/finance/invoices/$id", params: { id: d.id } })}>
                      <td className="px-5 py-3.5 font-mono text-xs">
                        {d.number ?? <span className="text-tertiary">Draft</span>}
                        {d.recurringId ? <span className="ml-2 font-sans text-[11px] text-finance">Retainer</span> : null}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={d.clientName} className="size-7 rounded-lg text-[10px]" />
                          <span className="truncate">{d.clientName}</span>
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-tertiary">{formatDate(d.issueDate, { day: "numeric", month: "short" })}</td>
                      <td className={cn("px-4 py-3", st === "overdue" ? "text-error-primary" : "text-tertiary")}>{formatDate(d.dueDate, { day: "numeric", month: "short" })}</td>
                      <td className="px-5 py-3.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusPill status={st} />
                          {d.counterPending ? (
                            <span className="rounded-full bg-warning-primary px-2 py-0.5 text-[11px] font-medium text-warning-primary">Price proposed</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono">{money(d.total, d.currency)}</td>
                      {effectiveKind === "invoice" ? (
                        <td className="px-5 py-3.5 text-right font-mono">{["sent", "partially_paid"].includes(d.status) ? money(d.total - d.amountPaid, d.currency) : "—"}</td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </FinanceBody>
  );
}

/* ---------------- Editor (new and drafts) ---------------- */

function Editor({ me, kind, initial }: { me: Me; kind: DocKind; initial?: DocDetail }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { clientId?: string; projectId?: string };
  const { data: clients } = useClients();
  const { data: projects } = useProjects("current");
  const { data: settings } = useFinanceSettings();
  const { data: rates } = useTaxRates();
  const defaultRate = rates?.taxRates.find((r) => r.isDefault)?.rate ?? 18;
  const [clientId, setClientId] = useState(initial?.document.clientId ?? search.clientId ?? "");
  const [projectId, setProjectId] = useState(initial?.document.projectId ?? search.projectId ?? "");
  const [issueDate, setIssueDate] = useState(initial?.document.issueDate ?? todayLocal());
  const [dueDate, setDueDate] = useState(initial?.document.dueDate ?? "");
  const [lines, setLines] = useState<Line[]>(initial?.lines.map((l) => ({ ...l, quantity: Number(l.quantity), discountPct: Number(l.discountPct), taxRate: Number(l.taxRate) })) ?? [emptyLine(defaultRate)]);
  const [notes, setNotes] = useState(initial?.document.notes ?? "");
  const [terms, setTerms] = useState(initial?.document.terms ?? "");
  const [addingClient, setAddingClient] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New documents start with the organisation's default notes; quotes also with its default terms.
  useEffect(() => {
    if (!initial && settings) {
      setNotes((n) => n || settings.settings.notes || "");
      if (kind === "quote") setTerms((t) => t || settings.settings.terms || "");
    }
  }, [initial, settings, kind]);
  useEffect(() => {
    if (!initial) setLines((l) => (l.length === 1 && !l[0]!.description ? [emptyLine(defaultRate)] : l));
  }, [defaultRate, initial]);

  const client = clients?.clients.find((c) => c.id === clientId);
  const supplyType = client ? supplyTypeFor(settings?.settings.stateCode, client.stateCode, client.country) : "intra";
  const currency = client?.currency ?? "INR";

  const save = useApiMutation(
    async (andIssue: boolean) => {
      const body = {
        clientId,
        projectId: projectId || null,
        issueDate,
        dueDate: dueDate || null,
        notes: notes || null,
        terms: terms || null,
        lines: lines.filter((l) => l.description.trim()).map((l) => ({ ...l, id: undefined, amount: undefined, taxAmount: undefined, hsnSac: l.hsnSac || null })),
      };
      let id = initial?.document.id;
      if (id) await api(`finance/documents/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      else id = (await api<{ document: { id: string } }>("finance/documents", { method: "POST", body: JSON.stringify({ ...body, kind }) })).document.id;
      if (andIssue) {
        const r = await api<{ number: string; emailed: boolean; emailError: string | null }>(`finance/documents/${id}/issue`, { method: "POST", body: JSON.stringify({ email: true }) });
        if (r.emailed || !r.emailError) toast.success(`${KIND_LABEL[kind].one} ${r.number} issued${r.emailed ? " and emailed to the client" : ""}`);
        else toast.warning(`${KIND_LABEL[kind].one} ${r.number} issued, but not emailed`, { description: `${r.emailError}. You can copy the client link from the document instead.` });
      } else toast.success("Draft saved");
      return id;
    },
    { invalidate: FINANCE_KEYS, onSuccess: (id) => navigate({ to: "/finance/invoices/$id", params: { id }, replace: true }) },
  );

  const submit = (andIssue: boolean) => {
    if (!clientId) return setError("Choose a client");
    if (!lines.some((l) => l.description.trim() && l.unitPrice > 0)) return setError("Add at least one line with a rate");
    setError(null);
    save.mutate(andIssue);
  };

  const remove = useApiMutation(() => api(`finance/documents/${initial!.document.id}`, { method: "DELETE" }), {
    invalidate: FINANCE_KEYS,
    success: "Draft deleted",
    onSuccess: () => navigate({ to: kind === "quote" ? "/finance/quotes" : "/finance/invoices" }),
  });

  return (
    <FinanceBody className="max-w-6xl">
      <Link to={kind === "quote" ? "/finance/quotes" : "/finance/invoices"} className="inline-flex items-center gap-1 text-sm text-tertiary hover:text-primary">
        <ArrowLeft className="size-4" /> {KIND_LABEL[kind === "credit_note" ? "invoice" : kind].many}
      </Link>
      <PageHeader title={initial ? `Draft ${KIND_LABEL[kind].one.toLowerCase()}` : `New ${KIND_LABEL[kind].one.toLowerCase()}`} description={
          settings && !settings.settings.gstin
            ? `You're not GST-registered, so this goes out without GST${kind === "invoice" ? " as a bill of supply" : ""}. Add a GST number in Settings → Organization if you register.`
            : undefined
        }
      />

      <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Client" className="lg:col-span-2" hint={client ? (supplyType === "intra" ? "Same state: CGST + SGST" : supplyType === "inter" ? "Different state: IGST" : `Export in ${client.currency}, zero-rated`) : undefined}>
          <div className="flex gap-2">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={kind === "credit_note"}>
              <option value="">Choose a client</option>
              {clients?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {kind !== "credit_note" && can(me.org.permissions, "client", "create") ? (
              <Button type="button" onClick={() => setAddingClient(true)}>
                New
              </Button>
            ) : null}
          </div>
        </Field>
        <Field label="Date">
          <DateInput value={issueDate} onChange={(v) => setIssueDate(v)} />
        </Field>
        {kind !== "credit_note" ? (
          <Field label={kind === "quote" ? "Valid until" : "Due date"} hint={dueDate ? undefined : "Blank uses the client's terms"}>
            <DateInput value={dueDate} min={issueDate} onChange={(v) => setDueDate(v)} />
          </Field>
        ) : null}
        <Field label="Project" className="lg:col-span-2" hint="Optional: links revenue to the work">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">None</option>
            {projects?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card className="p-5">
        <LineEditor lines={lines} onChange={setLines} supplyType={supplyType} currency={currency} roundOff={settings?.settings.roundOff ?? true} gstRegistered={!settings || Boolean(settings.settings.gstin)} />
      </Card>

      <Card className={cn("grid gap-4 p-5", kind === "quote" && "sm:grid-cols-2")}>
        <Field label="Notes" hint="Shown on the document, e.g. a thank-you or PO number">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
        </Field>
        {kind === "quote" ? (
          <Field label="Terms and conditions" hint="Printed at the bottom of the quotation, not on the invoice">
            <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={4000} />
          </Field>
        ) : null}
      </Card>

      {error ? <p className="text-sm text-error-primary">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {initial ? (
          <Button variant="ghost" className="mr-auto" onClick={() => confirm("Delete this draft?") && remove.mutate(undefined)}>
            <Trash2 /> Delete draft
          </Button>
        ) : null}
        <Button onClick={() => submit(false)} disabled={save.isPending}>
          Save draft
        </Button>
        {can(me.org.permissions, "invoice", "send") ? (
          <Button variant="primary" onClick={() => submit(true)} disabled={save.isPending}>
            <Send /> Save and issue
          </Button>
        ) : null}
      </div>
      {addingClient ? <ClientDialog open onOpenChange={setAddingClient} onSaved={(id) => setClientId(id)} /> : null}
    </FinanceBody>
  );
}

export function NewDocumentPage({ me }: { me: Me }) {
  const search = useSearch({ strict: false }) as { kind?: DocKind };
  const kind: DocKind = search.kind === "quote" ? "quote" : "invoice";
  useCrumb(`New ${KIND_LABEL[kind].one.toLowerCase()}`);
  return <Editor me={me} kind={kind} />;
}

/* ---------------- Issued documents ---------------- */

function RecordPaymentDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (o: boolean) => void; detail: DocDetail }) {
  const isQuote = detail.document.kind === "quote";
  const balance = detail.document.total - detail.document.amountPaid;
  const [amount, setAmount] = useState(toRupees(balance));
  const [method, setMethod] = useState("bank_transfer");
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState(Boolean(detail.client.email));
  const record = useApiMutation(
    () =>
      api<{ payment: { receiptNumber: string | null }; emailError: string | null }>(`finance/documents/${detail.document.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: toPaise(amount), method, paidOn, reference: reference || null, email: isQuote && email }),
      }),
    {
      invalidate: FINANCE_KEYS,
      onSuccess: (r) => {
        if (r.payment.receiptNumber) toast.success(`Receipt ${r.payment.receiptNumber} issued`, r.emailError ? { description: `Not emailed: ${r.emailError}` } : undefined);
        else toast.success("Payment recorded");
        onOpenChange(false);
      },
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isQuote ? "Record a payment against the quote" : "Record a payment"}
        icon={Banknote}
        iconColor="success"
        description={
          isQuote
            ? `Balance on the quote ${money(balance, detail.document.currency)}. The client gets a receipt for this payment; the final invoice comes once the quote is paid in full.`
            : `Balance due ${money(balance, detail.document.currency)}`
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={record.isPending || toPaise(amount) <= 0} onClick={() => record.mutate(undefined)}>
              Record payment
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (₹)">
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" autoFocus />
          </Field>
          <Field label="Received on">
            <DateInput value={paidOn} onChange={(v) => setPaidOn(v)} />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {["bank_transfer", "upi", "cash", "cheque", "card", "other"].map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" hint="UTR, cheque number, …">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
          </Field>
          {isQuote ? (
            <Toggle
              className="sm:col-span-2"
              isSelected={email}
              onChange={setEmail}
              isDisabled={!detail.client.email}
              label="Email the receipt to the client"
              hint={detail.client.email ? detail.client.email : "The client has no email address."}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Ask the client to pay online against a quote: an advance, or the whole balance. */
function RequestPaymentDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (o: boolean) => void; detail: DocDetail }) {
  const d = detail.document;
  const balance = d.total - d.amountPaid;
  const [amount, setAmount] = useState(toRupees(d.amountPaid ? balance : Math.min(balance, Math.round(d.total * 0.3))));
  const [email, setEmail] = useState(Boolean(detail.client.email));
  const request = useApiMutation(
    () => api<{ url: string; emailError: string | null }>(`finance/documents/${d.id}/payment-link`, { method: "POST", body: JSON.stringify({ amount: toPaise(amount), email }) }),
    {
      invalidate: FINANCE_KEYS,
      onSuccess: (r) => {
        void navigator.clipboard?.writeText(r.url);
        toast.success(email && !r.emailError ? "Payment requested, and the link is copied" : "Payment link copied", r.emailError ? { description: `Not emailed: ${r.emailError}` } : undefined);
        onOpenChange(false);
      },
    },
  );
  const paise = toPaise(amount);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Request a payment"
        icon={HandCoins}
        description={`The client pays this online from the quote, and gets a receipt for it. Balance on the quote ${money(balance, d.currency)}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={request.isPending || paise <= 0 || paise > balance} onClick={() => request.mutate(undefined)}>
              <Link2 /> Create payment link
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Amount (₹)" hint={paise > balance ? "That's more than the balance" : `${Math.round((paise / d.total) * 100)}% of the quote`}>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" autoFocus />
          </Field>
          <div className="flex flex-wrap gap-2">
            {[25, 30, 50].map((pct) => (
              <Button key={pct} size="sm" variant="secondary" onClick={() => setAmount(toRupees(Math.min(balance, Math.round((d.total * pct) / 100))))}>
                {pct}%
              </Button>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setAmount(toRupees(balance))}>
              Full balance
            </Button>
          </div>
          <Toggle
            isSelected={email}
            onChange={setEmail}
            isDisabled={!detail.client.email}
            label="Email the client a payment request"
            hint={detail.client.email ? detail.client.email : "The client has no email address."}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DocumentView({ me, detail }: { me: Me; detail: DocDetail }) {
  const navigate = useNavigate();
  const [paying, setPaying] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const d = detail.document;
  const today = todayLocal();
  // With an instalment plan, what matters is when the next instalment is due.
  const nextDue = detail.installments?.plan.status === "active" ? detail.installments.installments.find((r) => r.status === "scheduled" || r.status === "billed")?.dueDate : undefined;
  const status = displayStatus({ ...d, dueDate: nextDue ?? d.dueDate }, today);
  const balance = d.total - d.amountPaid;
  const p = me.org.permissions;
  const onPlan = detail.installments?.plan.status === "active";
  // Plans and their interest invoices are paid instalment by instalment, from the schedule.
  const unpaid = d.kind === "invoice" && (d.status === "sent" || d.status === "partially_paid") && !onPlan && !detail.interestFor;
  // A plan and its interest invoices can't be credited or voided until the plan is cancelled.
  const locked = onPlan || Boolean(detail.interestFor);
  // Quotes take advances and part payments (each with a receipt) until they're paid in full.
  const quoteOpen = d.kind === "quote" && ["sent", "accepted", "partially_paid"].includes(d.status);
  // A final invoice is settled by the receipts on its quote rather than payments of its own.
  const settledByReceipts = d.kind === "invoice" && detail.payments.length === 0 && detail.receipts.length > 0;
  const paymentRows = settledByReceipts ? detail.receipts.map((r) => ({ ...r, receiptNumber: r.number, notes: null, voidedAt: r.voidedAt ?? null })) : detail.payments;
  const canSplit = d.kind === "invoice" && (d.status === "sent" || d.status === "partially_paid") && !detail.installments && !detail.interestFor && can(p, "invoice", "update");
  const go = (id: string) => navigate({ to: "/finance/invoices/$id", params: { id } });

  const remind = useApiMutation(() => api(`finance/documents/${d.id}/remind`, { method: "POST" }), { invalidate: FINANCE_KEYS, success: "Reminder sent" });
  const voidDoc = useApiMutation(() => api(`finance/documents/${d.id}/void`, { method: "POST" }), { invalidate: FINANCE_KEYS, success: "Marked as void" });
  const copy = useApiMutation((as: "duplicate" | "credit_note") => api<{ document: { id: string } }>(`finance/documents/${d.id}/copy`, { method: "POST", body: JSON.stringify({ as }) }), {
    invalidate: FINANCE_KEYS,
    onSuccess: (r) => go(r.document.id),
  });
  const quoteStatus = useApiMutation((status: string) => api(`finance/documents/${d.id}/quote-status`, { method: "POST", body: JSON.stringify({ status }) }), { invalidate: FINANCE_KEYS });
  const link = useApiMutation(() => api<{ url: string }>(`finance/documents/${d.id}/payment-link`, { method: "POST" }), {
    invalidate: FINANCE_KEYS,
    onSuccess: (r) => {
      void navigator.clipboard?.writeText(r.url);
      toast.success("Payment link copied");
    },
  });
  const voidPayment = useApiMutation((id: string) => api(`finance/payments/${id}/void`, { method: "POST" }), { invalidate: FINANCE_KEYS, success: d.kind === "quote" ? "Receipt cancelled" : "Payment voided" });
  const finalInvoice = useApiMutation(
    () => api<{ document: { id: string }; number: string; emailError: string | null }>(`finance/documents/${d.id}/final-invoice`, { method: "POST", body: JSON.stringify({ email: true }) }),
    {
      invalidate: FINANCE_KEYS,
      onSuccess: (r) => {
        toast.success(`Invoice ${r.number} generated`, r.emailError ? { description: `Not emailed: ${r.emailError}` } : undefined);
        go(r.document.id);
      },
    },
  );

  return (
    <FinanceBody className="max-w-7xl">
      <Link to={d.kind === "quote" ? "/finance/quotes" : "/finance/invoices"} className="inline-flex items-center gap-1 text-sm text-tertiary hover:text-primary print:hidden">
        <ArrowLeft className="size-4" /> {KIND_LABEL[d.kind === "credit_note" ? "invoice" : d.kind].many}
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <div className="overflow-x-auto rounded-xl border border-secondary shadow-[0_24px_64px_-32px_rgb(0_0_0/0.5)]">
            <InvoiceDocument doc={d} lines={detail.lines} seller={detail.seller} client={detail.client} receipts={detail.receipts} logoSlot className="min-w-[640px]" />
          </div>
          {detail.installments ? <InstallmentsCard me={me} detail={detail} /> : null}
          <Card className="p-4 sm:p-6 print:hidden">
            <h2 className="mb-3 font-bold">Internal notes</h2>
            <Thread type="invoice" id={d.id} placeholder="Notes for your team (the client never sees these)" />
          </Card>
        </div>

        <aside className="space-y-4 print:hidden">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm">{d.number}</span>
              <StatusPill status={status} />
            </div>
            <div className="mt-3 font-display text-3xl font-bold">{money((d.kind === "invoice" || (d.kind === "quote" && d.amountPaid > 0)) && d.status !== "void" ? balance : d.total, d.currency)}</div>
            <div className="text-sm text-tertiary">
              {d.kind === "invoice"
                ? d.status === "paid"
                  ? `Paid in full${d.paidAt ? ` on ${formatDate(d.paidAt.slice(0, 10))}` : ""}`
                  : d.status === "void"
                    ? "Void"
                    : nextDue
                      ? `next instalment due ${formatDate(nextDue)}`
                      : `due ${formatDate(d.dueDate)}`
                : d.kind === "quote" && d.amountPaid > 0
                  ? d.status === "paid"
                    ? `Paid in full · ${money(d.total, d.currency)}`
                    : `left to pay of ${money(d.total, d.currency)}`
                  : `${KIND_LABEL[d.kind].one} total`}
            </div>
            <p className="mt-1 text-xs text-tertiary">
              {detail.client.name}
              {detail.project ? (
                <>
                  {" · "}
                  <Link to="/work/projects/$id" params={{ id: detail.project.id }} className="hover:underline">
                    {detail.project.name}
                  </Link>
                </>
              ) : null}
            </p>

            {onPlan ? (
              <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-xs text-secondary">Being paid in instalments. Record payments, links and reminders from the schedule.</p>
            ) : null}
            {quoteOpen ? (
              <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-xs text-secondary">
                Record each advance or part payment here. The client gets a receipt for each one, and you generate the final invoice once the quote is paid in full.
              </p>
            ) : null}
            {d.kind === "quote" && d.status === "paid" && !detail.finalInvoice ? (
              <p className="mt-3 rounded-lg bg-success-solid/15 px-3 py-2 text-xs text-success-primary">Paid in full. Generate the final tax invoice for it.</p>
            ) : null}
            {detail.finalInvoice ? (
              <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-xs text-secondary">
                Final invoice{" "}
                <Link to="/finance/invoices/$id" params={{ id: detail.finalInvoice.id }} className="font-mono font-medium text-brand-secondary hover:underline">
                  {detail.finalInvoice.number}
                </Link>{" "}
                has been generated.
              </p>
            ) : null}
            {detail.interestFor ? (
              <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-xs text-secondary">
                Interest for instalment {detail.interestFor.seq} of{" "}
                <Link to="/finance/invoices/$id" params={{ id: detail.interestFor.invoiceId }} className="font-medium text-brand-secondary hover:underline">
                  the original invoice
                </Link>
                . It's paid with that instalment.
              </p>
            ) : null}

            <div className="mt-4 grid gap-2">
              {d.kind === "quote" && d.status === "paid" && !detail.finalInvoice && can(p, "invoice", "create") && can(p, "invoice", "send") ? (
                <Button variant="primary" onClick={() => finalInvoice.mutate(undefined)} disabled={finalInvoice.isPending}>
                  <FileCheck2 /> Generate final invoice
                </Button>
              ) : null}
              {(unpaid || quoteOpen) && can(p, "payment", "record") ? (
                <Button variant="primary" onClick={() => setPaying(true)}>
                  <ReceiptIndianRupee /> {quoteOpen ? "Record payment and receipt" : "Record payment"}
                </Button>
              ) : null}
              {quoteOpen && detail.seller.razorpayConnected && can(p, "invoice", "send") ? (
                <>
                  {d.paymentLinkUrl ? (
                    <Button onClick={() => (void navigator.clipboard?.writeText(d.paymentLinkUrl!), toast.success("Payment link copied"))}>
                      <Link2 /> Copy link for {money(d.paymentLinkAmount ?? balance, d.currency)}
                    </Button>
                  ) : null}
                  <Button onClick={() => setRequesting(true)}>
                    <HandCoins /> {d.paymentLinkUrl ? "Request a different amount" : "Request a payment"}
                  </Button>
                </>
              ) : null}
              {unpaid && detail.seller.razorpayConnected && can(p, "invoice", "send") ? (
                d.paymentLinkUrl ? (
                  <Button onClick={() => (void navigator.clipboard?.writeText(d.paymentLinkUrl!), toast.success("Payment link copied"))}>
                    <Link2 /> Copy payment link
                  </Button>
                ) : (
                  <Button onClick={() => link.mutate(undefined)} disabled={link.isPending}>
                    <Link2 /> Create Razorpay link
                  </Button>
                )
              ) : null}
              {unpaid && can(p, "invoice", "send") ? (
                <Button onClick={() => remind.mutate(undefined)} disabled={remind.isPending}>
                  <BellRing /> Send reminder
                </Button>
              ) : null}
              {canSplit ? (
                <Button onClick={() => setSplitting(true)}>
                  <Split /> Split into instalments
                </Button>
              ) : null}
              {d.kind === "quote" && d.status === "sent" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => quoteStatus.mutate("accepted")}>Accepted</Button>
                  <Button onClick={() => quoteStatus.mutate("declined")}>Declined</Button>
                </div>
              ) : null}
              {detail.publicUrl ? (
                <Button asChild>
                  <a href={detail.publicUrl} target="_blank" rel="noreferrer">
                    <ExternalLink /> Client view
                  </a>
                </Button>
              ) : null}
              <Button onClick={() => window.print()}>
                <Printer /> Print or save PDF
              </Button>
              {can(p, "invoice", "create") ? (
                <Button variant="ghost" onClick={() => copy.mutate("duplicate")}>
                  <Copy /> Duplicate
                </Button>
              ) : null}
              {d.kind === "invoice" && d.status !== "void" && !locked && can(p, "invoice", "create") ? (
                <Button variant="ghost" onClick={() => copy.mutate("credit_note")}>
                  <FilePlus2 /> Issue a credit note
                </Button>
              ) : null}
              {d.status !== "void" && !locked && !(d.kind === "quote" && d.amountPaid > 0) && can(p, "invoice", "void") ? (
                <Button variant="ghost" className="text-error-primary" onClick={() => confirm(`Void ${d.number}? The number stays used, and it no longer counts as owed.`) && voidDoc.mutate(undefined)}>
                  <Ban /> Void
                </Button>
              ) : null}
            </div>
          </Card>

          {d.kind === "invoice" || (d.kind === "quote" && d.status !== "draft") ? (
            <Card className="p-5">
              <h2 className="font-bold">{d.kind === "quote" ? "Receipts" : settledByReceipts ? "Paid against the quote" : "Payments"}</h2>
              {paymentRows.length === 0 ? <p className="mt-2 text-sm text-tertiary">{d.kind === "quote" ? "No payments against this quote yet." : "Nothing received yet."}</p> : null}
              <ul className="mt-2 divide-y divide-border-secondary">
                {paymentRows.map((pay) => (
                  <li key={pay.id} className={cn("flex items-center gap-2 py-2 text-sm", pay.voidedAt && "text-tertiary line-through")}>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono">{money(pay.amount, d.currency)}</div>
                      <div className="truncate text-xs text-tertiary">
                        {pay.receiptNumber ? (
                          <>
                            <Link to="/finance/receipts/$id" params={{ id: pay.id }} className="font-mono text-brand-secondary hover:underline">
                              {pay.receiptNumber}
                            </Link>
                            {" · "}
                          </>
                        ) : null}
                        {formatDate(pay.paidOn, { day: "numeric", month: "short" })} · {PAYMENT_METHOD_LABEL[pay.method] ?? pay.method}
                        {pay.reference ? ` · ${pay.reference}` : ""}
                      </div>
                    </div>
                    {!pay.voidedAt && pay.method !== "credit_note" && !detail.finalInvoice && !settledByReceipts && can(p, "payment", "refund") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => confirm(pay.receiptNumber ? `Cancel receipt ${pay.receiptNumber}? Its number stays used, and the amount goes back on the quote's balance.` : "Void this payment?") && voidPayment.mutate(pay.id)}
                      >
                        {pay.receiptNumber ? "Cancel" : "Void"}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {detail.counterOffers.length ? <CounterOffersCard me={me} detail={detail} /> : null}

          {detail.related.length ? (
            <Card className="p-5">
              <h2 className="font-bold">Related</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {detail.related.map((r) => (
                  <li key={r.id}>
                    <Link to="/finance/invoices/$id" params={{ id: r.id }} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-secondary">
                      <span>
                        {KIND_LABEL[r.kind].one} <span className="font-mono text-xs">{r.number ?? "Draft"}</span>
                      </span>
                      <StatusPill status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </aside>
      </div>
      {paying ? <RecordPaymentDialog open onOpenChange={setPaying} detail={detail} /> : null}
      {requesting ? <RequestPaymentDialog open onOpenChange={setRequesting} detail={detail} /> : null}
      {splitting ? <SplitDialog open onOpenChange={setSplitting} detail={detail} /> : null}
    </FinanceBody>
  );
}

/** Prices the client proposed for a quote from the portal: approve (a revised quote at that price) or reject. */
function CounterOffersCard({ me, detail }: { me: Me; detail: DocDetail }) {
  const navigate = useNavigate();
  const d = detail.document;
  const p = me.org.permissions;
  const canApprove = can(p, "invoice", "create") && can(p, "invoice", "send");
  const approve = useApiMutation((id: string) => api<{ document: { id: string }; number: string }>(`finance/documents/${d.id}/counter-offers/${id}/approve`, { method: "POST" }), {
    invalidate: FINANCE_KEYS,
    onSuccess: (r) => {
      toast.success(`Revised quote ${r.number} issued and accepted`);
      navigate({ to: "/finance/invoices/$id", params: { id: r.document.id } });
    },
  });
  const reject = useApiMutation(
    ({ id, reason }: { id: string; reason: string }) => api(`finance/documents/${d.id}/counter-offers/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: reason || null }) }),
    { invalidate: FINANCE_KEYS, success: "Proposal rejected. The client has been told." },
  );
  const LABEL = { pending: "Waiting for you", approved: "Approved", rejected: "Rejected", withdrawn: "Superseded" } as const;
  return (
    <Card className="p-5">
      <h2 className="font-bold">Client's proposed price</h2>
      <ul className="mt-2 divide-y divide-border-secondary">
        {detail.counterOffers.map((o) => {
          const off = d.total ? Math.round(((d.total - o.amount) / d.total) * 100) : 0;
          return (
            <li key={o.id} className="py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-base font-semibold">{money(o.amount, d.currency)}</span>
                <span className={cn("text-xs", o.status === "pending" ? "font-medium text-warning-primary" : "text-tertiary")}>{LABEL[o.status]}</span>
              </div>
              <div className="text-xs text-tertiary">
                {off > 0 ? `${off}% below the quote` : off < 0 ? `${-off}% above the quote` : "Same as the quote"} · {o.byName ?? o.byEmail ?? "Client"} · {formatDate(o.createdAt.slice(0, 10), { day: "numeric", month: "short" })}
              </div>
              {o.note ? <p className="mt-1.5 rounded-md bg-secondary px-2.5 py-1.5 text-xs text-secondary">{o.note}</p> : null}
              {o.status === "rejected" && o.response ? <p className="mt-1 text-xs text-tertiary">Your reply: {o.response}</p> : null}
              {o.status === "approved" && o.revisedQuoteId ? (
                <Link to="/finance/invoices/$id" params={{ id: o.revisedQuoteId }} className="mt-1 inline-block text-xs font-medium text-brand-secondary hover:underline">
                  Open the revised quote
                </Link>
              ) : null}
              {o.status === "pending" && d.status === "sent" ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {canApprove ? (
                    <Button
                      variant="primary"
                      disabled={approve.isPending}
                      onClick={() =>
                        confirm(`Approve ${money(o.amount, d.currency)}? A revised quote at that price replaces ${d.number}, already accepted, and the client is told.`) &&
                        approve.mutate(o.id)
                      }
                    >
                      Approve
                    </Button>
                  ) : null}
                  {can(p, "invoice", "update") ? (
                    <Button
                      disabled={reject.isPending}
                      onClick={() => {
                        const reason = prompt("Reject this price? Tell the client why (optional). The quote stays as it is.");
                        if (reason !== null) reject.mutate({ id: o.id, reason: reason.trim() });
                      }}
                    >
                      Reject
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function DocumentPage({ me }: { me: Me }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, isLoading, error } = useDoc(id);
  useCrumb(data ? (data.document.number ?? `Draft ${KIND_LABEL[data.document.kind].one.toLowerCase()}`) : null);
  if (isLoading) {
    return (
      <FinanceBody>
        <Skeleton className="h-[600px] w-full" />
      </FinanceBody>
    );
  }
  if (error || !data) {
    return (
      <FinanceBody>
        <p className="text-sm text-tertiary">{error?.message ?? "Not found"}</p>
      </FinanceBody>
    );
  }
  if (data.document.status === "draft" && can(me.org.permissions, "invoice", "update")) return <Editor key={id} me={me} kind={data.document.kind} initial={data} />;
  return <DocumentView me={me} detail={data} />;
}
