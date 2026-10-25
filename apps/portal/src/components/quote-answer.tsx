import { Button, Dialog, DialogContent, Field, Input, Textarea } from "@operant/ui";
import { Check, HandCoins } from "lucide-react";
import { useState } from "react";
import { api, ApiError, type CounterOffer, longDate, money, useAction } from "../lib/api.ts";
import { BillingDialog } from "../pages/billing.tsx";

interface QuoteRef {
  id: string;
  number: string;
  status: string;
  total: number;
  currency: string;
  counterOffer: CounterOffer | null;
}

/**
 * The client's answer to a quote: accept it, decline it, or propose a different price
 * (which the team approves or rejects). Shows where a proposal stands.
 */
export function QuoteAnswer({ slug, quote, compact }: { slug: string; quote: QuoteRef; compact?: boolean }) {
  const [billing, setBilling] = useState(false);
  const [proposing, setProposing] = useState(false);
  const offer = quote.counterOffer;
  const pending = offer?.status === "pending";

  const decide = useAction((d: "accept" | "decline") => api(`portal/orgs/${slug}/quotes/${quote.id}/${d}`, { method: "POST" }), {
    success: "Thanks, we've let the team know",
    onError: (e) => {
      if (e instanceof ApiError && e.code === "billing_required") {
        setBilling(true);
        return true;
      }
    },
  });

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {offer && offer.status !== "withdrawn" ? <OfferStatus offer={offer} currency={quote.currency} /> : null}
      {quote.status === "sent" ? (
        <div className="flex flex-wrap gap-2">
          <Button size={compact ? "sm" : undefined} variant="primary" disabled={decide.isPending} onClick={() => decide.mutate("accept")}>
            <Check /> Accept {pending ? `at ${money(quote.total, quote.currency)}` : "quote"}
          </Button>
          {!pending ? (
            <Button size={compact ? "sm" : undefined} variant="secondary" onClick={() => setProposing(true)}>
              <HandCoins /> Propose a price
            </Button>
          ) : null}
          <Button
            size={compact ? "sm" : undefined}
            variant="ghost"
            disabled={decide.isPending}
            onClick={() => confirm("Decline this quote? You can keep talking to the team about it.") && decide.mutate("decline")}
          >
            Decline
          </Button>
        </div>
      ) : null}
      {proposing ? <ProposeDialog slug={slug} quote={quote} onOpenChange={setProposing} /> : null}
      {billing ? <BillingDialog open onOpenChange={setBilling} onDone={() => (setBilling(false), decide.mutate("accept"))} /> : null}
    </div>
  );
}

function OfferStatus({ offer, currency }: { offer: CounterOffer; currency: string }) {
  const price = money(offer.amount, currency);
  if (offer.status === "pending") {
    return <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary">You proposed {price} on {longDate(offer.createdAt.slice(0, 10))}. The team will get back to you.</p>;
  }
  if (offer.status === "approved") {
    return <p className="rounded-lg bg-success-solid/15 px-3 py-2 text-sm text-success-primary">Your price of {price} was approved. The revised quote is in your billing.</p>;
  }
  return (
    <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary">
      The team couldn't agree to {price}.{offer.response ? ` "${offer.response}"` : ""}
    </p>
  );
}

function ProposeDialog({ slug, quote, onOpenChange }: { slug: string; quote: QuoteRef; onOpenChange: (o: boolean) => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const paise = Math.round(Number(amount || 0)) * 100;
  const propose = useAction(() => api(`portal/orgs/${slug}/quotes/${quote.id}/counter`, { method: "POST", body: JSON.stringify({ amount: paise, note: note || null }) }), {
    success: "Sent. The team will get back to you.",
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={`Propose a price for quote ${quote.number}`}
        icon={HandCoins}
        description={`Quoted at ${money(quote.total, quote.currency)}. If the team approves your price, you'll get a revised quote at that price.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={propose.isPending || paise <= 0 || paise === quote.total} onClick={() => propose.mutate(undefined)}>
              Send proposal
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Your price (₹, including GST)">
            <Input type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" autoFocus />
          </Field>
          <Field label="Note for the team (optional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="For example, what fits your budget, or what you'd leave out." />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
