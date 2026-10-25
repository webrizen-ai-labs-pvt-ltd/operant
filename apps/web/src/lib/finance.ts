import { formatMoney } from "@operant/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

export type DocKind = "quote" | "invoice" | "credit_note";
export type DocStatus = "draft" | "sent" | "partially_paid" | "paid" | "accepted" | "declined" | "void";
export type SupplyType = "intra" | "inter" | "export";

export interface Line {
  id?: string;
  itemId?: string | null;
  description: string;
  hsnSac?: string | null;
  quantity: number;
  unit?: string | null;
  /** Paise. */
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  amount?: number;
  taxAmount?: number;
}

export interface DocRow {
  id: string;
  kind: DocKind;
  number: string | null;
  status: DocStatus;
  clientId: string;
  clientName: string;
  projectId: string | null;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  total: number;
  amountPaid: number;
  recurringId: string | null;
  sentAt: string | null;
  /** A quote with a client's proposed price waiting for an answer. */
  counterPending?: boolean;
}

export interface Doc extends Omit<DocRow, "clientName"> {
  milestoneId: string | null;
  relatedId: string | null;
  placeOfSupply: string | null;
  supplyType: SupplyType;
  subtotal: number;
  discountTotal: number;
  taxableTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  notes: string | null;
  terms: string | null;
  paymentLinkUrl: string | null;
  /** What the current payment link asks for (an advance on a quote can be less than the balance). */
  paymentLinkAmount: number | null;
  paidAt: string | null;
  voidedAt: string | null;
  lastReminderAt: string | null;
}

export interface BankDetails {
  accountName?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  bankName?: string | null;
  upiId?: string | null;
}

export interface Seller {
  name: string;
  legalName: string | null;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  bank: BankDetails;
}

export interface ClientInfo {
  id?: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress: string | null;
  stateCode: string | null;
  country: string;
  currency?: string;
  paymentTermsDays?: number | null;
  notes?: string | null;
}

export interface Payment {
  id: string;
  amount: number;
  method: string;
  paidOn: string;
  reference: string | null;
  notes: string | null;
  voidedAt: string | null;
  /** Set on payments against a quote. */
  receiptNumber: string | null;
}

/** A receipt for a payment against a quote, with the GST the amount contains. */
export interface Receipt {
  id: string;
  number: string;
  paidOn: string;
  amount: number;
  method: string;
  reference: string | null;
  cgst: number;
  sgst: number;
  igst: number;
  voidedAt?: string | null;
}

export interface CounterOfferRow {
  id: string;
  amount: number;
  note: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  response: string | null;
  revisedQuoteId: string | null;
  decidedAt: string | null;
  createdAt: string;
  byName: string | null;
  byEmail: string | null;
}

export interface DocDetail {
  document: Doc;
  lines: Line[];
  payments: Payment[];
  related: { id: string; kind: DocKind; number: string | null; status: DocStatus; total: number }[];
  /** A quote's receipts, or the receipts that settled a final invoice. */
  receipts: Receipt[];
  /** On a quote: the final invoice generated from it. */
  finalInvoice: { id: string; number: string | null } | null;
  /** On a quote: prices the client proposed from the portal, newest first. */
  counterOffers: CounterOfferRow[];
  client: ClientInfo & { id: string };
  project: { id: string; name: string } | null;
  seller: Seller & { razorpayConnected: boolean };
  publicUrl: string | null;
  installments: InstallmentSchedule | null;
  /** Set when this invoice bills the interest for an instalment of another invoice. */
  interestFor: { invoiceId: string; seq: number } | null;
}

export type InstallmentStatus = "scheduled" | "billed" | "paid" | "cancelled";

export interface InstallmentRow {
  id: string;
  seq: number;
  dueDate: string;
  principal: number;
  interest: number;
  interestTax: number;
  total: number;
  amountPaid: number;
  status: InstallmentStatus;
  paymentLinkUrl: string | null;
  interestInvoice: { id: string; number: string | null } | null;
}

export interface InstallmentSchedule {
  plan: { id: string; principal: number; annualRate: number; count: number; frequency: "monthly" | "quarterly"; interestTaxRate: number; status: "active" | "completed"; emi: number };
  installments: InstallmentRow[];
}

export interface FinanceSettings extends Omit<Seller, "name"> {
  invoicePrefix: string;
  quotePrefix: string;
  creditNotePrefix: string;
  receiptPrefix: string;
  defaultDueDays: number;
  terms: string | null;
  notes: string | null;
  roundOff: boolean;
  razorpayKeyId: string | null;
  razorpayConnected: boolean;
  webhookConfigured: boolean;
}

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  isDefault: boolean;
}

export interface Item {
  id: string;
  name: string;
  description: string | null;
  hsnSac: string | null;
  unit: string;
  unitPrice: number;
  taxRate: number;
}

export interface ClientRow extends ClientInfo {
  id: string;
  email: string | null;
  billed: number;
  outstanding: number;
  overdue: number;
}

export const KIND_LABEL: Record<DocKind, { one: string; many: string }> = {
  invoice: { one: "Invoice", many: "Invoices" },
  quote: { one: "Quote", many: "Quotes" },
  credit_note: { one: "Credit note", many: "Credit notes" },
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer",
  upi: "UPI",
  cash: "Cash",
  cheque: "Cheque",
  card: "Card",
  razorpay: "Razorpay",
  credit_note: "Credit note",
  other: "Other",
};

export const FINANCE_KEYS = ["finance-docs", "finance-doc", "finance-receipt", "finance-summary", "clients", "client", "finance-payments", "finance-recurring", "finance-settings", "finance-items", "finance-tax-rates", "project"];

export const money = (paise: number, currency = "INR") => formatMoney(paise, currency);

/** ₹4.5L / ₹1.2Cr style for axes and tiles. */
export function compactMoney(paise: number, currency = "INR") {
  const r = paise / 100;
  if (currency !== "INR") return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(r);
  const abs = Math.abs(r);
  if (abs >= 1e7) return `₹${(r / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `₹${(r / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
  if (abs >= 1e3) return `₹${(r / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `₹${Math.round(r)}`;
}

export const toPaise = (rupees: string | number) => Math.round(Number(rupees || 0) * 100);
export const toRupees = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, "");

/** Status as people read it: an unpaid invoice past its due date is overdue. */
export function displayStatus(d: { kind: DocKind; status: DocStatus; dueDate: string | null }, today: string) {
  if (d.kind === "invoice" && (d.status === "sent" || d.status === "partially_paid") && d.dueDate && d.dueDate < today) return "overdue" as const;
  return d.status;
}

export const STATUS_META: Record<DocStatus | "overdue", { label: string; tone: "neutral" | "collab" | "finance" | "people" | "danger" | "ember" }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "collab" },
  partially_paid: { label: "Part paid", tone: "finance" },
  paid: { label: "Paid", tone: "people" },
  accepted: { label: "Accepted", tone: "people" },
  declined: { label: "Declined", tone: "danger" },
  void: { label: "Void", tone: "neutral" },
  overdue: { label: "Overdue", tone: "danger" },
};

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const useDocs = (params: { kind?: DocKind; status?: string; clientId?: string; projectId?: string; q?: string }) =>
  useQuery({ queryKey: ["finance-docs", params], queryFn: () => api<{ today: string; documents: DocRow[] }>(`finance/documents${qs(params)}`) });
export const useDoc = (id: string | undefined) =>
  useQuery({ queryKey: ["finance-doc", id], queryFn: () => api<DocDetail>(`finance/documents/${id}`), enabled: Boolean(id) });
export interface ReceiptDetail {
  receipt: Receipt;
  quote: Doc;
  receipts: Receipt[];
  lines: Line[];
  client: ClientInfo;
  seller: Seller;
}
export const useReceipt = (id: string) => useQuery({ queryKey: ["finance-receipt", id], queryFn: () => api<ReceiptDetail>(`finance/receipts/${id}`) });
export const useClients = (q?: string) => useQuery({ queryKey: ["clients", q ?? ""], queryFn: () => api<{ clients: ClientRow[] }>(`clients${qs({ q })}`) });
export const useClient = (id: string) =>
  useQuery({ queryKey: ["client", id], queryFn: () => api<{ client: ClientInfo & { id: string; email: string | null; phone: string | null }; contacts: { id: string; name: string; email: string | null; phone: string | null; designation: string | null; isPrimary: boolean }[] }>(`clients/${id}`) });
export const useFinanceSettings = () =>
  useQuery({ queryKey: ["finance-settings"], queryFn: () => api<{ settings: FinanceSettings; webhookUrl: string; email: { enabled: boolean; from: string | null } }>("finance/settings") });
export const useTaxRates = () => useQuery({ queryKey: ["finance-tax-rates"], queryFn: () => api<{ taxRates: TaxRate[] }>("finance/tax-rates") });
export const useItems = () => useQuery({ queryKey: ["finance-items"], queryFn: () => api<{ items: Item[] }>("finance/items") });
export const usePayments = () =>
  useQuery({
    queryKey: ["finance-payments"],
    queryFn: () =>
      api<{ payments: (Payment & { invoiceId: string; invoiceNumber: string | null; invoiceKind: DocKind; clientName: string; currency: string })[] }>("finance/payments"),
  });
export const useRecurring = () =>
  useQuery({
    queryKey: ["finance-recurring"],
    queryFn: () =>
      api<{
        recurring: { id: string; name: string; clientId: string; clientName: string; frequency: string; nextIssueDate: string; endDate: string | null; active: boolean; autoSend: boolean; lines: Line[]; lastIssuedAt: string | null }[];
      }>("finance/recurring"),
  });
export const useFinanceSummary = () =>
  useQuery({
    queryKey: ["finance-summary"],
    queryFn: () =>
      api<{
        today: string;
        currency: string;
        foreignOutstanding: { currency: string; amount: number }[];
        financialYearStart: string;
        billedThisYear: number;
        collectedThisYear: number;
        outstanding: number;
        overdue: number;
        drafts: number;
        aging: Record<"current" | "1-30" | "31-60" | "61-90" | "90+", number>;
        months: { month: string; billed: number; collected: number; due: number }[];
        topClients: { clientId: string; name: string; outstanding: number; overdue: number }[];
        recentPayments: { id: string; amount: number; currency: string; paidOn: string; method: string; clientName: string; invoiceId: string; invoiceNumber: string | null }[];
      }>("finance/summary"),
  });
