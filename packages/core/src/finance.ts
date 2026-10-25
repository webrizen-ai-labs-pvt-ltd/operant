/*
 * Money is stored as integer minor units (paise). All tax maths happens here,
 * shared by the API (source of truth) and the invoice editor (live preview).
 */

/** GST state codes (first two digits of a GSTIN), used for place of supply. */
export const INDIAN_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

const GSTIN_RE = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Structural GSTIN check plus the official mod-36 check digit. */
export function isValidGstin(value: string): boolean {
  const v = value.trim().toUpperCase();
  const m = GSTIN_RE.exec(v);
  if (!m || !INDIAN_STATES[m[1]!]) return false;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = chars.indexOf(v[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return chars[(36 - (sum % 36)) % 36] === v[14];
}

export const stateOfGstin = (gstin: string) => gstin.trim().slice(0, 2);

export type SupplyType = "intra" | "inter" | "export";

/** Same state → CGST + SGST; different state → IGST; outside India → export (zero-rated). */
export function supplyTypeFor(sellerState: string | null | undefined, placeOfSupply: string | null | undefined, clientCountry = "IN"): SupplyType {
  if (clientCountry.toUpperCase() !== "IN") return "export";
  if (!sellerState || !placeOfSupply) return "intra";
  return sellerState === placeOfSupply ? "intra" : "inter";
}

export interface LineInput {
  quantity: number;
  /** Paise per unit. */
  unitPrice: number;
  discountPct?: number;
  taxRate: number;
}

export interface LineResult {
  gross: number;
  discount: number;
  taxable: number;
  tax: number;
}

export interface Totals {
  subtotal: number;
  discountTotal: number;
  taxableTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  lines: LineResult[];
  /** Tax summary by rate, for the invoice's tax table. */
  byRate: { rate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
}

const r = (n: number) => Math.round(n);

export function computeLine(l: LineInput, supply: SupplyType): LineResult {
  const gross = r(l.quantity * l.unitPrice);
  const discount = r((gross * (l.discountPct ?? 0)) / 100);
  const taxable = gross - discount;
  const tax = supply === "export" ? 0 : r((taxable * l.taxRate) / 100);
  return { gross, discount, taxable, tax };
}

export function computeTotals(lines: LineInput[], supply: SupplyType, opts: { roundOff?: boolean } = {}): Totals {
  const results = lines.map((l) => computeLine(l, supply));
  const byRate = new Map<number, { rate: number; taxable: number; cgst: number; sgst: number; igst: number }>();
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  results.forEach((res, i) => {
    const rate = supply === "export" ? 0 : lines[i]!.taxRate;
    const row = byRate.get(rate) ?? { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += res.taxable;
    if (supply === "intra") {
      // Split evenly; any odd paisa goes to SGST.
      const c = Math.floor(res.tax / 2);
      row.cgst += c;
      row.sgst += res.tax - c;
      cgst += c;
      sgst += res.tax - c;
    } else {
      row.igst += res.tax;
      igst += res.tax;
    }
    byRate.set(rate, row);
  });
  const subtotal = results.reduce((s, x) => s + x.gross, 0);
  const discountTotal = results.reduce((s, x) => s + x.discount, 0);
  const taxableTotal = subtotal - discountTotal;
  const exact = taxableTotal + cgst + sgst + igst;
  const total = opts.roundOff === false ? exact : Math.round(exact / 100) * 100;
  return {
    subtotal,
    discountTotal,
    taxableTotal,
    cgst,
    sgst,
    igst,
    roundOff: total - exact,
    total,
    lines: results,
    byRate: [...byRate.values()].sort((a, b) => a.rate - b.rate),
  };
}

/** Indian financial year (April–March) of a date, e.g. "2026-10-01" → "26-27". */
export function financialYear(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** GST invoice numbers: unique per financial year, at most 16 characters. */
export function documentNumber(prefix: string, date: string, seq: number): string {
  const n = `${prefix}/${financialYear(date)}/${String(seq).padStart(4, "0")}`;
  return n.length <= 16 ? n : `${prefix.slice(0, Math.max(1, 16 - n.length + prefix.length))}/${financialYear(date)}/${String(seq).padStart(4, "0")}`;
}

/**
 * The GST contained in a payment received against a quote, for its receipt voucher
 * (CGST Rules, rule 50): the quote's tax in proportion to the amount. It's worked out on the
 * running total received, so once the quote is fully paid its receipts add up exactly to the
 * quote's tax, which the final invoice then carries.
 */
export function receiptTax(quote: { total: number; cgst: number; sgst: number; igst: number }, paidBefore: number, amount: number) {
  const upTo = (paid: number) => {
    if (quote.total <= 0 || paid >= quote.total) return { cgst: quote.cgst, sgst: quote.sgst, igst: quote.igst };
    const share = (tax: number) => Math.round((tax * paid) / quote.total);
    return { cgst: share(quote.cgst), sgst: share(quote.sgst), igst: share(quote.igst) };
  };
  const before = upTo(paidBefore);
  const after = upTo(paidBefore + amount);
  const cgst = after.cgst - before.cgst;
  const sgst = after.sgst - before.sgst;
  const igst = after.igst - before.igst;
  return { taxable: amount - cgst - sgst - igst, cgst, sgst, igst };
}

/** ₹1,23,456.78 style (Indian digit grouping). */
export function formatMoney(paise: number, currency = "INR"): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(paise / 100);
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(rest < 20 ? ONES[rest]! : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? ` ${ONES[rest % 10]}` : ""}`);
  return parts.join(" ");
}

function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** "Rupees Forty Eight Thousand Five Hundred and Fifty Paise Only". */
export function amountInWords(paise: number, currency = "INR"): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  if (currency !== "INR") return `${currency} ${indianWords(rupees)}${p ? ` and ${indianWords(p)} Cents` : ""} Only`;
  return `Rupees ${indianWords(rupees)}${p ? ` and ${indianWords(p)} Paise` : ""} Only`;
}

/** Days overdue → aging bucket for receivables reports. */
export function agingBucket(daysOverdue: number): "current" | "1-30" | "31-60" | "61-90" | "90+" {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

/* ---------------- Instalments (EMI) ---------------- */

export const INSTALLMENT_FREQUENCIES = ["monthly", "quarterly"] as const;
export type InstallmentFrequency = (typeof INSTALLMENT_FREQUENCIES)[number];
const PERIOD_MONTHS: Record<InstallmentFrequency, number> = { monthly: 1, quarterly: 3 };

/** Same day n months later, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export interface InstallmentRow {
  seq: number;
  dueDate: string;
  /** Part of the invoice balance repaid by this instalment (paise). */
  principal: number;
  /** Interest for the period on the balance still owed (paise), before GST. */
  interest: number;
  /** Principal still owed after this instalment. */
  balanceAfter: number;
}

/**
 * Reducing-balance EMI: every instalment is the same amount; interest is charged on the
 * balance still owed, so early instalments carry more interest and less principal.
 * Amounts are whole paise; the last instalment absorbs rounding so principals add up exactly.
 */
export function emiSchedule(opts: { principal: number; annualRatePct: number; count: number; frequency: InstallmentFrequency; firstDueDate: string }) {
  const { principal, annualRatePct, count, frequency, firstDueDate } = opts;
  const months = PERIOD_MONTHS[frequency];
  const i = annualRatePct / 100 / (12 / months);
  const emi = i === 0 ? principal / count : (principal * i * (1 + i) ** count) / ((1 + i) ** count - 1);
  const rows: InstallmentRow[] = [];
  let balance = principal;
  for (let k = 0; k < count; k++) {
    const interest = Math.round(balance * i);
    const last = k === count - 1;
    const part = last ? balance : Math.min(balance, Math.round(emi) - interest);
    balance -= part;
    rows.push({ seq: k + 1, dueDate: addMonths(firstDueDate, k * months), principal: part, interest, balanceAfter: balance });
  }
  return { emi: Math.round(emi), rows, totalInterest: rows.reduce((a, r) => a + r.interest, 0) };
}

/**
 * Reprice lines so the document totals exactly `target` (a price agreed with the client,
 * including GST): every unit price is scaled by the same factor, and the few paise that
 * rounding leaves over are settled on the last line sold as a single unit.
 */
export function scaleLinesToTotal<L extends LineInput>(lines: L[], supply: SupplyType, opts: { roundOff?: boolean }, target: number): L[] {
  const current = computeTotals(lines, supply, opts).total;
  if (current <= 0 || target <= 0) return lines;
  const out = lines.map((l) => ({ ...l, unitPrice: Math.max(0, Math.round((l.unitPrice * target) / current)) }));
  let i = out.length - 1;
  while (i >= 0 && Number(out[i]!.quantity) !== 1) i--;
  if (i < 0) return out;
  for (let pass = 0; pass < 6; pass++) {
    const diff = target - computeTotals(out, supply, opts).total;
    if (diff === 0) break;
    const l = out[i]!;
    const perPaisa = (1 - (l.discountPct ?? 0) / 100) * (1 + (supply === "export" ? 0 : l.taxRate / 100));
    const step = Math.round(diff / perPaisa) || Math.sign(diff);
    out[i] = { ...l, unitPrice: Math.max(0, l.unitPrice + step) };
  }
  return out;
}
