import { computeTotals, emiSchedule, formatMoney, INDIAN_STATES, supplyTypeFor } from "@operant/core";
import { useId, useMemo, useState } from "react";

/*
 * Try-it-yourself: the same GST and EMI maths Operant uses on real invoices
 * (imported from the product's own core package), so what you see here is exactly
 * what the app would produce.
 */

const STATES = Object.entries(INDIAN_STATES).sort((a, b) => a[1].localeCompare(b[1]));
const inr = (paise: number) => formatMoney(paise, "INR");

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-ink-2">
      {children}
    </label>
  );
}
const field = "w-full border border-line-2 bg-card px-3 py-2.5 text-[15px] text-ink outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/15";

function Gst() {
  const id = useId();
  const [amount, setAmount] = useState("100000");
  const [rate, setRate] = useState(18);
  const [seller, setSeller] = useState("27");
  const [buyer, setBuyer] = useState("29");
  const paise = Math.max(0, Math.round(Number(amount || 0) * 100));
  const supply = supplyTypeFor(seller, buyer, "IN");
  const t = useMemo(() => computeTotals([{ quantity: 1, unitPrice: paise, discountPct: 0, taxRate: rate }], supply, { roundOff: true }), [paise, rate, supply]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor={`${id}-a`}>Amount before tax (₹)</Label>
          <input id={`${id}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={`${field} font-mono`} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`${id}-r`}>GST rate</Label>
          <div id={`${id}-r`} role="radiogroup" className="flex gap-1.5">
            {[5, 12, 18, 28].map((r) => (
              <button
                key={r}
                role="radio"
                aria-checked={rate === r}
                onClick={() => setRate(r)}
                className={`flex-1 py-2 text-sm font-semibold transition ${rate === r ? "bg-brand text-[#09090b]" : "border border-line-2 text-ink-2"}`}
              >
                {r}%
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor={`${id}-s`}>You're in</Label>
          <select id={`${id}-s`} value={seller} onChange={(e) => setSeller(e.target.value)} className={field}>
            {STATES.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${id}-b`}>Your client is in</Label>
          <select id={`${id}-b`} value={buyer} onChange={(e) => setBuyer(e.target.value)} className={field}>
            {STATES.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className=" border border-line bg-paper-2 p-5" aria-live="polite">
        <div className="eyebrow">{supply === "intra" ? "Same state: CGST + SGST" : "Different states: IGST"}</div>
        <dl className="mt-4 space-y-2 font-mono text-sm">
          <div className="flex justify-between">
            <dt className="font-sans text-ink-3">Taxable value</dt>
            <dd>{inr(t.taxableTotal)}</dd>
          </div>
          {supply === "intra" ? (
            <>
              <div className="flex justify-between">
                <dt className="font-sans text-ink-3">CGST {rate / 2}%</dt>
                <dd>{inr(t.cgst)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-sans text-ink-3">SGST {rate / 2}%</dt>
                <dd>{inr(t.sgst)}</dd>
              </div>
            </>
          ) : (
            <div className="flex justify-between">
              <dt className="font-sans text-ink-3">IGST {rate}%</dt>
              <dd>{inr(t.igst)}</dd>
            </div>
          )}
          {t.roundOff ? (
            <div className="flex justify-between">
              <dt className="font-sans text-ink-3">Round off</dt>
              <dd>{inr(t.roundOff)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-line-2 pt-3 text-lg font-semibold">
            <dt className="font-sans">Invoice total</dt>
            <dd>{inr(t.total)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-ink-3">Operant picks CGST and SGST or IGST from your state and your client's, numbers the invoice for the financial year, and writes the amount in words.</p>
      </div>
    </div>
  );
}

function Emi() {
  const id = useId();
  const [amount, setAmount] = useState("300000");
  const [count, setCount] = useState(6);
  const [rate, setRate] = useState(12);
  const principal = Math.max(0, Math.round(Number(amount || 0) * 100));
  const first = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const s = useMemo(() => (principal >= count * 100 ? emiSchedule({ principal, annualRatePct: rate, count, frequency: "monthly", firstDueDate: first }) : null), [principal, count, rate, first]);
  const max = s ? Math.max(...s.rows.map((r) => r.principal + r.interest)) : 1;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <div>
          <Label htmlFor={`${id}-a`}>Invoice balance (₹)</Label>
          <input id={`${id}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={`${field} font-mono`} />
        </div>
        <div>
          <div className="flex justify-between">
            <Label htmlFor={`${id}-n`}>Instalments</Label>
            <span className="font-mono text-sm">{count} months</span>
          </div>
          <input id={`${id}-n`} type="range" min={2} max={24} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-[var(--brand)]" />
        </div>
        <div>
          <div className="flex justify-between">
            <Label htmlFor={`${id}-r`}>Interest, a year</Label>
            <span className="font-mono text-sm">{rate}%</span>
          </div>
          <input id={`${id}-r`} type="range" min={0} max={24} step={0.5} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="w-full accent-[var(--brand)]" />
        </div>
      </div>

      <div className=" border border-line bg-paper-2 p-5" aria-live="polite">
        {s ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="eyebrow">Each instalment</div>
                <div className="mt-1 font-mono text-2xl font-semibold">{inr(s.emi)}</div>
              </div>
              <div className="text-right text-xs text-ink-3">
                Interest in all <span className="font-mono text-ink">{inr(s.totalInterest)}</span>
              </div>
            </div>
            {/* Each bar: principal (ink) and interest (orange), falling as the balance is repaid. */}
            <div className="mt-5 flex h-28 items-end gap-1" role="img" aria-label={`Schedule of ${count} instalments; interest falls from ${inr(s.rows[0]!.interest)} to ${inr(s.rows.at(-1)!.interest)}`}>
              {s.rows.map((r) => (
                <div key={r.seq} className="flex flex-1 flex-col justify-end overflow-hidden" title={`Instalment ${r.seq}: principal ${inr(r.principal)}, interest ${inr(r.interest)}`}>
                  <span style={{ height: `${(r.interest / max) * 100}%`, background: "var(--brand)" }} className="transition-[height] duration-500" />
                  <span style={{ height: `${(r.principal / max) * 100}%`, background: "var(--ink)" }} className="border-t-2 border-paper-2 opacity-85 transition-[height] duration-500" />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-4 text-xs text-ink-3">
              <span className="flex items-center gap-1.5">
                <i className="size-2 bg-ink opacity-85" /> Principal
              </span>
              <span className="flex items-center gap-1.5">
                <i className="size-2 bg-brand" /> Interest (reducing balance)
              </span>
            </div>
            <p className="mt-4 text-xs text-ink-3">In Operant, each instalment's interest gets its own GST invoice when it falls due, the client gets a link to pay, and reminders go out on their own.</p>
          </>
        ) : (
          <p className="text-sm text-ink-3">Enter an amount to see the schedule.</p>
        )}
      </div>
    </div>
  );
}

export default function Calculators() {
  const [tab, setTab] = useState<"gst" | "emi">("gst");
  return (
    <div className=" border border-line bg-card p-5 sm:p-8">
      <div role="tablist" aria-label="Calculators" className="mb-6 inline-flex bg-paper-2 p-1">
        {[
          ["gst", "GST invoice"],
          ["emi", "Instalments (EMI)"],
        ].map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k as "gst" | "emi")}
            className={` px-4 py-1.5 text-sm font-semibold transition ${tab === k ? "bg-card text-ink" : "text-ink-3 hover:text-ink"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "gst" ? <Gst /> : <Emi />}
    </div>
  );
}
