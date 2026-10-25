import { amountInWords, INDIAN_STATES } from "@operant/core";
import { cn } from "@operant/ui";
import { type ClientInfo, type Doc, type DocKind, type Line, money, PAYMENT_METHOD_LABEL, type Receipt, type Seller } from "../../lib/finance.ts";

/*
 * The printable documents (tax invoice, quote, credit note and receipt). Used in the app
 * and on the client's public page. Prints on A4 via the browser's print to PDF.
 */

const TITLE: Record<DocKind, string> = { invoice: "Tax invoice", quote: "Quotation", credit_note: "Credit note" };

/** A seller without a GSTIN can't issue a tax invoice; theirs is a bill of supply. */
export const docTitle = (kind: DocKind, sellerGstin: string | null) => (kind === "invoice" && !sellerGstin ? "Bill of supply" : TITLE[kind]);

const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const state = (code: string | null) => (code ? `${INDIAN_STATES[code] ?? code} (${code})` : null);

/** Top left of every document: the logo, with name, address, contact details and tax registration beside it. */
function SellerBlock({ seller, logoSlot }: { seller: Seller; logoSlot?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-5">
      {seller.logo ? (
        <img src={seller.logo} alt="" className="h-32 w-auto max-w-[260px] shrink-0 object-contain object-left" />
      ) : logoSlot ? (
        // Staff see where the logo goes; it never prints.
        <div className="flex size-32 shrink-0 items-center justify-center rounded-md border border-dashed border-[#d6cdbf] p-2 text-center text-[11px] text-[#8a8178] print:hidden">Logo (add in Settings)</div>
      ) : null}
      <div className="min-w-0">
        <div className="font-display text-xl font-bold">{seller.legalName ?? seller.name}</div>
        {seller.address ? <div className="whitespace-pre-line text-[#5f574e]">{seller.address}</div> : null}
        {seller.phone ? <div className="text-[#5f574e]">{seller.phone}</div> : null}
        {seller.email ? <div className="text-[#5f574e]">{seller.email}</div> : null}
        {seller.gstin || seller.pan ? (
          <div className="space-x-3 text-[#5f574e]">
            {seller.gstin ? <span>GSTIN <b className="font-mono text-[#1a1715]">{seller.gstin}</b></span> : null}
            {seller.pan ? <span>PAN <b className="font-mono text-[#1a1715]">{seller.pan}</b></span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* Line tables: a row rule plus a faint rule between columns. */
const ROW = "[&>*]:px-2 [&>*:first-child]:pl-0 [&>*:last-child]:pr-0 [&>*+*]:border-l [&>*+*]:border-[#1a1715]/10";

type DocLike = Pick<
  Doc,
  "kind" | "number" | "status" | "issueDate" | "dueDate" | "currency" | "placeOfSupply" | "supplyType" | "subtotal" | "discountTotal" | "taxableTotal" | "cgst" | "sgst" | "igst" | "roundOff" | "total" | "amountPaid" | "notes" | "terms"
>;

export function InvoiceDocument({
  doc,
  lines,
  seller,
  client,
  receipts = [],
  logoSlot,
  className,
}: {
  doc: DocLike;
  lines: Line[];
  seller: Seller;
  client: ClientInfo;
  /** A quote's receipts, or the receipts that settled a final invoice. */
  receipts?: Receipt[];
  /** Show an empty logo placeholder when the org has none (staff app only). */
  logoSlot?: boolean;
  className?: string;
}) {
  const m = (p: number) => money(p, doc.currency);
  const hasDiscount = lines.some((l) => l.discountPct > 0);
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const l of lines) {
    const row = byRate.get(l.taxRate) ?? { taxable: 0, tax: 0 };
    row.taxable += l.amount ?? 0;
    row.tax += l.taxAmount ?? 0;
    byRate.set(l.taxRate, row);
  }
  const balance = doc.total - doc.amountPaid;
  const bank = seller.bank ?? {};
  const live = receipts.filter((r) => !r.voidedAt);

  return (
    <article className={cn("invoice-doc relative bg-white p-8 text-[13px] leading-relaxed text-[#1a1715] sm:p-10", className)}>
      {doc.status === "void" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-12 rounded-lg border-4 border-[#b81f33]/40 px-8 py-2 font-display text-6xl font-bold text-[#b81f33]/30">VOID</span>
        </div>
      ) : null}
      <header className="pb-5">
        <SellerBlock seller={seller} logoSlot={logoSlot} />
      </header>

      {/* The document's name, between two rules. */}
      <div className="relative border-y-2 border-[#1a1715] py-2.5 text-center font-display text-xl font-bold uppercase tracking-wide">
        {docTitle(doc.kind, seller.gstin)}
        {doc.status === "paid" ? (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 -rotate-12 rounded-lg border-4 border-[#2e8b6e]/50 px-4 font-display text-2xl font-bold text-[#2e8b6e]/60">PAID</span>
        ) : null}
      </div>

      <section className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8178]">Bill to</div>
          <div className="mt-1 font-semibold">{client.legalName ?? client.name}</div>
          {client.billingAddress ? <div className="whitespace-pre-line text-[#5f574e]">{client.billingAddress}</div> : null}
          {client.country !== "IN" ? <div className="text-[#5f574e]">{client.country}</div> : null}
          {client.gstin ? (
            <div className="text-[#5f574e]">
              GSTIN <b className="font-mono text-[#1a1715]">{client.gstin}</b>
            </div>
          ) : client.stateCode ? (
            <div className="text-[#5f574e]">{state(client.stateCode)}</div>
          ) : null}
        </div>
        <div className="text-right">
          <dl className="grid grid-cols-[auto_auto] justify-end gap-x-4 text-[#5f574e]">
            <dt>{doc.kind === "quote" ? "Quotation no." : doc.kind === "credit_note" ? "Credit note no." : "Invoice no."}</dt>
            <dd className="font-mono font-semibold text-[#1a1715]">{doc.number ?? "Draft"}</dd>
            <dt>Date</dt>
            <dd className="text-[#1a1715]">{fmtDate(doc.issueDate)}</dd>
            {doc.dueDate && doc.kind !== "credit_note" ? (
              <>
                <dt>{doc.kind === "quote" ? "Valid until" : "Due"}</dt>
                <dd className="text-[#1a1715]">{fmtDate(doc.dueDate)}</dd>
              </>
            ) : null}
            {doc.supplyType !== "export" && doc.placeOfSupply ? (
              <>
                <dt>Place of supply</dt>
                <dd className="text-[#1a1715]">{state(doc.placeOfSupply)}</dd>
              </>
            ) : null}
          </dl>
          {doc.supplyType === "export" ? <div className="mt-1 text-[#5f574e]">Export of services, zero-rated (under LUT)</div> : null}
        </div>
      </section>

      <table className="mt-6 w-full border-collapse text-left">
        <thead>
          <tr className={cn(ROW, "border-y border-[#1a1715]/80 text-[11px] uppercase tracking-wider text-[#5f574e]")}>
            <th className="py-2 font-semibold">#</th>
            <th className="py-2 font-semibold">Description</th>
            <th className="py-2 font-semibold">HSN/SAC</th>
            <th className="py-2 text-right font-semibold">Qty</th>
            <th className="py-2 text-right font-semibold">Rate</th>
            {hasDiscount ? <th className="py-2 text-right font-semibold">Disc.</th> : null}
            {doc.supplyType !== "export" ? <th className="py-2 text-right font-semibold">GST</th> : null}
            <th className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id ?? i} className={cn(ROW, "border-b border-[#e2dace] align-top")}>
              <td className="py-2 text-[#8a8178]">{i + 1}</td>
              <td className="py-2 whitespace-pre-line">{l.description}</td>
              <td className="py-2 font-mono text-xs">{l.hsnSac ?? ""}</td>
              <td className="py-2 text-right font-mono">
                {Number(l.quantity)}
                {l.unit && l.unit !== "unit" ? <span className="text-[#8a8178]"> {l.unit}</span> : null}
              </td>
              <td className="py-2 text-right font-mono">{m(l.unitPrice)}</td>
              {hasDiscount ? <td className="py-2 text-right font-mono">{l.discountPct ? `${Number(l.discountPct)}%` : ""}</td> : null}
              {doc.supplyType !== "export" ? <td className="py-2 text-right font-mono">{Number(l.taxRate)}%</td> : null}
              <td className="py-2 text-right font-mono">{m(l.amount ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-5 flex flex-wrap justify-between gap-6">
        <div className="max-w-sm flex-1 space-y-4">
          {doc.supplyType !== "export" && byRate.size ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[#8a8178]">
                  <th className="pb-1 font-semibold">Tax rate</th>
                  <th className="pb-1 text-right font-semibold">Taxable</th>
                  {doc.supplyType === "intra" ? (
                    <>
                      <th className="pb-1 text-right font-semibold">CGST</th>
                      <th className="pb-1 text-right font-semibold">SGST</th>
                    </>
                  ) : (
                    <th className="pb-1 text-right font-semibold">IGST</th>
                  )}
                </tr>
              </thead>
              <tbody className="font-mono">
                {[...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, row]) => (
                  <tr key={rate}>
                    <td className="font-sans">{rate}%</td>
                    <td className="text-right">{m(row.taxable)}</td>
                    {doc.supplyType === "intra" ? (
                      <>
                        <td className="text-right">{m(Math.floor(row.tax / 2))}</td>
                        <td className="text-right">{m(row.tax - Math.floor(row.tax / 2))}</td>
                      </>
                    ) : (
                      <td className="text-right">{m(row.tax)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8178]">Amount in words</div>
            <div className="font-medium">{amountInWords(doc.total, doc.currency)}</div>
          </div>
        </div>

        <dl className="grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          <dt className="text-[#5f574e]">Subtotal</dt>
          <dd className="text-right font-mono">{m(doc.subtotal)}</dd>
          {doc.discountTotal ? (
            <>
              <dt className="text-[#5f574e]">Discount</dt>
              <dd className="text-right font-mono">−{m(doc.discountTotal)}</dd>
              <dt className="text-[#5f574e]">Taxable value</dt>
              <dd className="text-right font-mono">{m(doc.taxableTotal)}</dd>
            </>
          ) : null}
          {doc.cgst ? (
            <>
              <dt className="text-[#5f574e]">CGST</dt>
              <dd className="text-right font-mono">{m(doc.cgst)}</dd>
              <dt className="text-[#5f574e]">SGST</dt>
              <dd className="text-right font-mono">{m(doc.sgst)}</dd>
            </>
          ) : null}
          {doc.igst ? (
            <>
              <dt className="text-[#5f574e]">IGST</dt>
              <dd className="text-right font-mono">{m(doc.igst)}</dd>
            </>
          ) : null}
          {doc.roundOff ? (
            <>
              <dt className="text-[#5f574e]">Round off</dt>
              <dd className="text-right font-mono">{doc.roundOff > 0 ? "" : "−"}{m(Math.abs(doc.roundOff))}</dd>
            </>
          ) : null}
          <dt className="mt-1 border-t-2 border-[#1a1715] pt-2 font-display text-base font-bold">Total</dt>
          <dd className="mt-1 border-t-2 border-[#1a1715] pt-2 text-right font-mono text-base font-bold">{m(doc.total)}</dd>
          {(doc.kind === "invoice" || doc.kind === "quote") && doc.amountPaid ? (
            <>
              <dt className="text-[#5f574e]">Paid</dt>
              <dd className="text-right font-mono">−{m(doc.amountPaid)}</dd>
              <dt className="font-semibold">Balance due</dt>
              <dd className="text-right font-mono font-semibold">{m(balance)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {live.length ? (
        <section className="mt-6">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8178]">{doc.kind === "invoice" ? "Settled by payments received against the quotation" : "Payments received"}</div>
          <table className="mt-1 w-full text-xs">
            <thead>
              <tr className="border-b border-[#e2dace] text-left text-[#8a8178]">
                <th className="py-1 font-semibold">Receipt</th>
                <th className="py-1 font-semibold">Date</th>
                <th className="py-1 font-semibold">Mode</th>
                <th className="py-1 text-right font-semibold">GST included</th>
                <th className="py-1 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {live.map((r) => (
                <tr key={r.id} className="border-b border-[#e2dace]/60">
                  <td className="py-1">{r.number}</td>
                  <td className="py-1 font-sans">{fmtDate(r.paidOn)}</td>
                  <td className="py-1 font-sans">{PAYMENT_METHOD_LABEL[r.method] ?? r.method}</td>
                  <td className="py-1 text-right">{m(r.cgst + r.sgst + r.igst)}</td>
                  <td className="py-1 text-right">{m(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {(doc.kind === "invoice" || doc.kind === "quote") && doc.status !== "paid" && (bank.accountNumber || bank.upiId) ? (
        <section className="mt-6 rounded-lg bg-[#f5f1ea] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8178]">Pay by bank transfer</div>
          <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
            {bank.accountName ? <div>Account name: <b>{bank.accountName}</b></div> : null}
            {bank.accountNumber ? <div>Account no.: <b className="font-mono">{bank.accountNumber}</b></div> : null}
            {bank.ifsc ? <div>IFSC: <b className="font-mono">{bank.ifsc}</b></div> : null}
            {bank.bankName ? <div>Bank: <b>{bank.bankName}</b></div> : null}
            {bank.upiId ? <div>UPI: <b className="font-mono">{bank.upiId}</b></div> : null}
          </div>
        </section>
      ) : null}

      {doc.notes ? (
        <section className="mt-6 text-[#5f574e]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8178]">Notes</div>
          <div className="whitespace-pre-line">{doc.notes}</div>
        </section>
      ) : null}

      <footer className="mt-10 flex items-end justify-between gap-6 text-xs text-[#8a8178]">
        <span>{doc.kind === "invoice" ? `This is a computer-generated ${docTitle(doc.kind, seller.gstin).toLowerCase()}.` : "This is a computer-generated document."}</span>
        <span className="text-right">
          For {seller.legalName ?? seller.name}
          <br />
          <span className="mt-8 inline-block border-t border-[#8a8178] pt-1">Authorised signatory</span>
        </span>
      </footer>

      {/* Terms belong to the offer: printed on quotations, never on invoices or bills of supply. */}
      {doc.kind === "quote" && doc.terms ? (
        <section className="mt-8 border-t border-[#1a1715]/15 pt-4 text-xs text-[#5f574e]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8178]">Terms and conditions</div>
          <div className="mt-1 whitespace-pre-line">{doc.terms}</div>
        </section>
      ) : null}
    </article>
  );
}

/**
 * A receipt for money received against a quote. For a GST-registered seller it's a receipt
 * voucher (CGST Rules, rule 50): it names the supply, and shows the tax the amount contains.
 */
export function ReceiptDocument({
  receipt,
  receipts,
  quote,
  lines,
  seller,
  client,
  className,
}: {
  receipt: Receipt;
  /** Every receipt on the quote, for "received earlier" and the balance. */
  receipts: Receipt[];
  quote: Pick<Doc, "number" | "issueDate" | "currency" | "placeOfSupply" | "supplyType" | "total">;
  lines: Line[];
  seller: Seller;
  client: ClientInfo;
  className?: string;
}) {
  const m = (p: number) => money(p, quote.currency);
  const tax = receipt.cgst + receipt.sgst + receipt.igst;
  const order = receipts.findIndex((r) => r.id === receipt.id);
  const earlier = receipts.filter((r, i) => !r.voidedAt && i < order).reduce((a, r) => a + r.amount, 0);
  const balance = quote.total - earlier - receipt.amount;
  const rates = [...new Set(lines.map((l) => Number(l.taxRate)))].sort((a, b) => a - b);
  const half = rates.length === 1 ? ` @ ${rates[0]! / 2}%` : "";
  return (
    <article className={cn("invoice-doc relative bg-white p-8 text-[13px] leading-relaxed text-[#1a1715] sm:p-10", className)}>
      {receipt.voidedAt ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-12 rounded-lg border-4 border-[#b81f33]/40 px-8 py-2 font-display text-6xl font-bold text-[#b81f33]/30">CANCELLED</span>
        </div>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[#1a1715] pb-5">
        <SellerBlock seller={seller} />
        <div className="text-right">
          <div className="font-display text-2xl font-bold uppercase tracking-wide">{seller.gstin ? "Receipt voucher" : "Receipt"}</div>
          <div className="mt-1 font-mono text-base">{receipt.number}</div>
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 text-[#5f574e]">
            <dt>Date</dt>
            <dd className="text-[#1a1715]">{fmtDate(receipt.paidOn)}</dd>
            <dt>Against quotation</dt>
            <dd className="font-mono text-[#1a1715]">{quote.number}</dd>
            {quote.supplyType !== "export" && quote.placeOfSupply ? (
              <>
                <dt>Place of supply</dt>
                <dd className="text-[#1a1715]">{state(quote.placeOfSupply)}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </header>

      <section className="mt-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8178]">Received from</div>
        <div className="mt-1 font-semibold">{client.legalName ?? client.name}</div>
        {client.billingAddress ? <div className="whitespace-pre-line text-[#5f574e]">{client.billingAddress}</div> : null}
        {client.gstin ? (
          <div className="text-[#5f574e]">
            GSTIN <b className="font-mono text-[#1a1715]">{client.gstin}</b>
          </div>
        ) : client.stateCode ? (
          <div className="text-[#5f574e]">{state(client.stateCode)}</div>
        ) : null}
      </section>

      <p className="mt-6 rounded-lg bg-[#f5f1ea] p-4 text-[14px]">
        Received with thanks <b className="font-mono">{m(receipt.amount)}</b> ({amountInWords(receipt.amount, quote.currency)}) by {PAYMENT_METHOD_LABEL[receipt.method] ?? receipt.method}
        {receipt.reference ? <> (ref. <span className="font-mono">{receipt.reference}</span>)</> : null}, as {balance > 0 ? "an advance" : "the final payment"} against quotation{" "}
        <span className="font-mono">{quote.number}</span> dated {fmtDate(quote.issueDate)}.
      </p>

      <table className="mt-6 w-full border-collapse text-left">
        <thead>
          <tr className={cn(ROW, "border-y border-[#1a1715]/80 text-[11px] uppercase tracking-wider text-[#5f574e]")}>
            <th className="py-2 font-semibold">#</th>
            <th className="py-2 font-semibold">For</th>
            <th className="py-2 font-semibold">HSN/SAC</th>
            {quote.supplyType !== "export" ? <th className="py-2 text-right font-semibold">GST</th> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id ?? i} className={cn(ROW, "border-b border-[#e2dace] align-top")}>
              <td className="py-2 text-[#8a8178]">{i + 1}</td>
              <td className="py-2 whitespace-pre-line">{l.description}</td>
              <td className="py-2 font-mono text-xs">{l.hsnSac ?? ""}</td>
              {quote.supplyType !== "export" ? <td className="py-2 text-right font-mono">{Number(l.taxRate)}%</td> : null}
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-5 flex flex-wrap justify-between gap-6">
        <dl className="grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[#5f574e]">
          <dt>Quotation total</dt>
          <dd className="text-right font-mono text-[#1a1715]">{m(quote.total)}</dd>
          <dt>Received earlier</dt>
          <dd className="text-right font-mono text-[#1a1715]">{m(earlier)}</dd>
          <dt>This receipt</dt>
          <dd className="text-right font-mono text-[#1a1715]">{m(receipt.amount)}</dd>
          <dt className="font-semibold text-[#1a1715]">Balance</dt>
          <dd className="text-right font-mono font-semibold text-[#1a1715]">{m(Math.max(0, balance))}</dd>
        </dl>

        <dl className="grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          {tax ? (
            <>
              <dt className="text-[#5f574e]">Taxable value</dt>
              <dd className="text-right font-mono">{m(receipt.amount - tax)}</dd>
              {receipt.igst ? (
                <>
                  <dt className="text-[#5f574e]">IGST{rates.length === 1 ? ` @ ${rates[0]}%` : ""}</dt>
                  <dd className="text-right font-mono">{m(receipt.igst)}</dd>
                </>
              ) : (
                <>
                  <dt className="text-[#5f574e]">CGST{half}</dt>
                  <dd className="text-right font-mono">{m(receipt.cgst)}</dd>
                  <dt className="text-[#5f574e]">SGST{half}</dt>
                  <dd className="text-right font-mono">{m(receipt.sgst)}</dd>
                </>
              )}
            </>
          ) : null}
          <dt className="mt-1 border-t-2 border-[#1a1715] pt-2 font-display text-base font-bold">Amount received</dt>
          <dd className="mt-1 border-t-2 border-[#1a1715] pt-2 text-right font-mono text-base font-bold">{m(receipt.amount)}</dd>
        </dl>
      </section>

      <footer className="mt-10 flex items-end justify-between gap-6 text-xs text-[#8a8178]">
        <span>
          This is a receipt, not a tax invoice. {balance > 0 ? "The tax invoice is issued once the quotation is paid in full." : "The tax invoice for this quotation follows."}
        </span>
        <span className="text-right">
          For {seller.legalName ?? seller.name}
          <br />
          <span className="mt-8 inline-block border-t border-[#8a8178] pt-1">Authorised signatory</span>
        </span>
      </footer>
    </article>
  );
}
