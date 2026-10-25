import { INDIAN_STATES, isValidGstin, stateOfGstin } from "@operant/core";
import { Badge, Button, Dialog, DialogContent, Field, Input, Select, Skeleton, Textarea } from "@operant/ui";
import { ExternalLink, ReceiptText } from "lucide-react";
import { useState } from "react";
import { QuoteAnswer } from "../components/quote-answer.tsx";
import { PageTitle, Section, SignedIn, useSlug } from "../components/shell.tsx";
import { api, longDate, type Me, money, useAction, useBilling, useMe } from "../lib/api.ts";

/** Who to invoice. Asked for only when it's needed: accepting a quote or paying. */
export function BillingForm({ me, onDone, submitLabel = "Save billing details" }: { me: Me; onDone?: () => void; submitLabel?: string }) {
  const slug = useSlug();
  const c = me.company;
  const [legalName, setLegalName] = useState(c?.legalName ?? c?.name ?? "");
  const [gstin, setGstin] = useState(c?.gstin ?? "");
  const [address, setAddress] = useState(c?.billingAddress ?? "");
  const [country, setCountry] = useState(c?.country ?? "IN");
  const [state, setState] = useState(c?.stateCode ?? "");
  const gstOk = !gstin || isValidGstin(gstin);
  const save = useAction(
    () =>
      api(`portal/orgs/${slug}/billing`, {
        method: "PUT",
        body: JSON.stringify({ legalName, gstin: gstin || null, billingAddress: address, country, stateCode: country === "IN" ? state || null : null }),
      }),
    { success: "Billing details saved", onSuccess: () => onDone?.() },
  );
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <Field label="Name to invoice" hint="Your company's registered name, or your own." className="sm:col-span-2">
        <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} required maxLength={200} />
      </Field>
      <Field label="GSTIN (optional)" error={gstOk ? undefined : "That GSTIN isn't valid"} hint={gstin && gstOk ? INDIAN_STATES[stateOfGstin(gstin)] : "Add it to claim input tax credit."}>
        <Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} className="font-mono" />
      </Field>
      <Field label="Country">
        <Select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="IN">India</option>
          <option value="AE">United Arab Emirates</option>
          <option value="GB">United Kingdom</option>
          <option value="SG">Singapore</option>
          <option value="US">United States</option>
        </Select>
      </Field>
      {country === "IN" && !(gstin && gstOk) ? (
        <Field label="State" className="sm:col-span-2">
          <Select value={state} onChange={(e) => setState(e.target.value)} title="State">
            <option value="">Choose a state</option>
            {Object.entries(INDIAN_STATES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Billing address" className="sm:col-span-2">
        <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} required maxLength={500} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={save.isPending || !gstOk || !legalName.trim() || !address.trim() || (country === "IN" && !gstin && !state)}>
          {save.isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function BillingDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const slug = useSlug();
  const { data: me } = useMe(slug);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Billing details" icon={ReceiptText} description="Needed once, so invoices carry the right name and tax details.">
        {me ? <BillingForm me={me} submitLabel="Save and continue" onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const KIND = { invoice: "Invoice", quote: "Quote", credit_note: "Credit note" } as const;

export function BillingPage() {
  const slug = useSlug();
  const { data } = useBilling(slug);
  const { data: me } = useMe(slug);
  const today = new Date().toISOString().slice(0, 10);
  const open = data?.documents.filter((d) => d.kind === "invoice" && (d.status === "sent" || d.status === "partially_paid")) ?? [];
  return (
    <SignedIn>
      <PageTitle title="Billing" description="Quotes, invoices and payments. Open any of them to download or pay online." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Documents" className="lg:col-span-2">
          {!data ? (
            <Skeleton className="h-40" />
          ) : data.documents.length === 0 ? (
            <p className="text-sm text-tertiary">Nothing here yet.</p>
          ) : (
            <ul className="divide-y divide-border-secondary">
              {data.documents.map((d) => {
                const balance = d.total - d.amountPaid;
                const unpaid = d.kind === "invoice" && (d.status === "sent" || d.status === "partially_paid");
                const late = unpaid && d.dueDate && d.dueDate < today;
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-primary">
                          {KIND[d.kind]} {d.number}
                        </span>
                        {unpaid ? (
                          <Badge tone={late ? "danger" : "warning"} pill dot>
                            {late ? "Overdue" : "To pay"}
                          </Badge>
                        ) : d.status === "paid" ? (
                          <Badge tone="people" pill>
                            Paid
                          </Badge>
                        ) : d.kind === "quote" ? (
                          <Badge tone={d.status === "accepted" || d.status === "partially_paid" ? "people" : d.status === "declined" ? "danger" : "brand"} pill>
                            {d.status === "void" && d.counterOffer?.status === "approved"
                              ? "Replaced at your price"
                              : ({ sent: "Waiting for you", accepted: "Accepted", partially_paid: "Part paid", declined: "Declined", void: "Cancelled" }[d.status] ?? d.status)}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-tertiary">
                        {longDate(d.issueDate)}
                        {unpaid && d.dueDate ? ` · due ${longDate(d.dueDate)}` : ""}
                      </div>
                    </div>
                    <span className="font-mono text-sm">{money(unpaid || d.status === "partially_paid" ? balance : d.total, d.currency)}</span>
                    <Button size="sm" variant={unpaid ? "primary" : "secondary"} asChild>
                      <a href={d.url} target="_blank" rel="noreferrer">
                        {unpaid ? "View and pay" : "View"} <ExternalLink />
                      </a>
                    </Button>
                    {d.kind === "quote" && (d.status === "sent" || d.counterOffer?.status === "pending" || d.counterOffer?.status === "rejected") ? (
                      <div className="basis-full">
                        <QuoteAnswer slug={slug} quote={d} compact />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <div className="space-y-6">
          <Section title="To pay">
            <div className="font-mono text-display-xs font-semibold">{money(open.reduce((a, d) => a + d.total - d.amountPaid, 0), open[0]?.currency)}</div>
            <p className="mt-1 text-sm text-tertiary">{open.length ? `${open.length} open invoice${open.length === 1 ? "" : "s"}` : "You're all paid up."}</p>
          </Section>
          <Section title="Billing details">
            {me?.company?.billingComplete ? (
              <div className="text-sm">
                <div className="font-medium text-primary">{me.company.legalName ?? me.company.name}</div>
                {me.company.gstin ? <div className="font-mono text-xs text-tertiary">GSTIN {me.company.gstin}</div> : null}
                <p className="mt-1 whitespace-pre-wrap text-tertiary">{me.company.billingAddress}</p>
              </div>
            ) : (
              <p className="text-sm text-tertiary">Not added yet. We'll ask when you accept a quote.</p>
            )}
          </Section>
        </div>
      </div>
    </SignedIn>
  );
}

export function AccountPage() {
  const slug = useSlug();
  const { data: me } = useMe(slug);
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const save = useAction(() => api(`portal/orgs/${slug}/me`, { method: "PATCH", body: JSON.stringify({ name: name ?? me?.user.name ?? undefined, phone: phone ?? me?.user.phone ?? null }) }), { success: "Saved" });
  return (
    <SignedIn>
      <PageTitle title="Account" description={me?.user.email} />
      {me ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="You">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(undefined);
              }}
            >
              <Field label="Name">
                <Input value={name ?? me.user.name ?? ""} onChange={(e) => setName(e.target.value)} required maxLength={120} />
              </Field>
              <Field label="Phone">
                <Input value={phone ?? me.user.phone ?? ""} onChange={(e) => setPhone(e.target.value)} maxLength={32} />
              </Field>
              <Button type="submit" variant="primary" disabled={save.isPending}>
                Save
              </Button>
            </form>
          </Section>
          <Section title="Billing details">
            <BillingForm me={me} />
          </Section>
        </div>
      ) : null}
    </SignedIn>
  );
}
