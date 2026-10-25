import { Button, Card, Skeleton } from "@operant/ui";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { money, useReceipt } from "../../lib/finance.ts";
import { useCrumb } from "../../lib/breadcrumbs.ts";
import { formatDate } from "../../lib/people.ts";
import { ReceiptDocument } from "./invoice-document.tsx";
import { FinanceBody } from "./layout.tsx";

/** A receipt for a payment against a quote, ready to print or save as PDF. */
export function ReceiptPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, isLoading, error } = useReceipt(id);
  useCrumb(data ? data.receipt.number : null);
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
  const { receipt, quote } = data;
  return (
    <FinanceBody className="max-w-7xl">
      <Link to="/finance/invoices/$id" params={{ id: quote.id }} className="inline-flex items-center gap-1 text-sm text-tertiary hover:text-primary print:hidden">
        <ArrowLeft className="size-4" /> Quote {quote.number}
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 overflow-x-auto rounded-xl border border-secondary shadow-[0_24px_64px_-32px_rgb(0_0_0/0.5)]">
          <ReceiptDocument receipt={receipt} receipts={data.receipts} quote={quote} lines={data.lines} seller={data.seller} client={data.client} className="min-w-[640px]" />
        </div>
        <aside className="space-y-4 print:hidden">
          <Card className="p-5">
            <span className="font-mono text-sm">{receipt.number}</span>
            <div className="mt-3 font-display text-3xl font-bold">{money(receipt.amount, quote.currency)}</div>
            <div className="text-sm text-tertiary">{receipt.voidedAt ? "Cancelled" : `Received on ${formatDate(receipt.paidOn)}`}</div>
            <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-xs text-secondary">
              {quote.status === "paid"
                ? "The quote is paid in full. Generate the final invoice from the quote."
                : `${money(quote.total - quote.amountPaid, quote.currency)} is still to be paid on the quote.`}
            </p>
            <div className="mt-4 grid gap-2">
              <Button onClick={() => window.print()}>
                <Printer /> Print or save PDF
              </Button>
            </div>
          </Card>
        </aside>
      </div>
    </FinanceBody>
  );
}
