import { describe, expect, it } from "vitest";
import {
  agingBucket,
  amountInWords,
  computeTotals,
  emiSchedule,
  documentNumber,
  financialYear,
  formatMoney,
  isValidGstin,
  receiptTax,
  scaleLinesToTotal,
  supplyTypeFor,
} from "./finance.ts";

describe("GSTIN", () => {
  it("accepts valid numbers and checks the check digit", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("27aapfu0939f1zv")).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZX")).toBe(false); // wrong check digit
    expect(isValidGstin("99AAPFU0939F1ZV")).toBe(false); // unknown state
    expect(isValidGstin("27AAPFU0939F1")).toBe(false);
  });
});

describe("supply type", () => {
  it("decides CGST/SGST vs IGST vs export", () => {
    expect(supplyTypeFor("27", "27")).toBe("intra");
    expect(supplyTypeFor("27", "29")).toBe("inter");
    expect(supplyTypeFor("27", null, "US")).toBe("export");
  });
});

describe("totals", () => {
  const lines = [
    { quantity: 10, unitPrice: 150_000, taxRate: 18 }, // ₹15,000
    { quantity: 1, unitPrice: 999_99, discountPct: 10, taxRate: 5 }, // ₹999.99 − 10%
  ];

  it("splits tax into CGST and SGST within a state", () => {
    const t = computeTotals(lines, "intra");
    expect(t.subtotal).toBe(1_599_999);
    expect(t.discountTotal).toBe(10_000);
    expect(t.taxableTotal).toBe(1_589_999);
    // 18% of 15,00,000 = 2,70,000 → 1,35,000 each; 5% of 89,999 = 4,500 → 2,250 each
    expect(t.cgst).toBe(137_250);
    expect(t.sgst).toBe(137_250);
    expect(t.igst).toBe(0);
    expect(t.total % 100).toBe(0);
    expect(t.total).toBe(t.taxableTotal + t.cgst + t.sgst + t.roundOff);
    expect(t.byRate.map((b) => b.rate)).toEqual([5, 18]);
  });

  it("uses IGST between states and no tax for exports", () => {
    expect(computeTotals(lines, "inter").igst).toBe(274_500);
    const exp = computeTotals(lines, "export");
    expect(exp.cgst + exp.sgst + exp.igst).toBe(0);
  });

  it("gives odd paise to SGST", () => {
    const t = computeTotals([{ quantity: 1, unitPrice: 101, taxRate: 18 }], "intra", { roundOff: false });
    expect(t.cgst + t.sgst).toBe(18);
    expect(t.total).toBe(119);
  });
});

describe("numbering", () => {
  it("follows the Indian financial year", () => {
    expect(financialYear("2026-10-01")).toBe("26-27");
    expect(financialYear("2027-03-31")).toBe("26-27");
    expect(financialYear("2027-04-01")).toBe("27-28");
    expect(documentNumber("INV", "2026-10-01", 42)).toBe("INV/26-27/0042");
    expect(documentNumber("WEBRIZEN", "2026-10-01", 1).length).toBeLessThanOrEqual(16);
  });
});

describe("formatting", () => {
  it("formats rupees with Indian grouping", () => {
    expect(formatMoney(12_345_678)).toBe("₹1,23,456.78");
  });

  it("writes amounts in words", () => {
    expect(amountInWords(4_850_050)).toBe("Rupees Forty Eight Thousand Five Hundred and Fifty Paise Only");
    expect(amountInWords(12_500_000_00)).toBe("Rupees One Crore Twenty Five Lakh Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });

  it("buckets receivables", () => {
    expect([0, 5, 45, 75, 200].map(agingBucket)).toEqual(["current", "1-30", "31-60", "61-90", "90+"]);
  });
});

describe("EMI schedule", () => {
  it("matches the standard reducing-balance formula", () => {
    // ₹1,00,000 over 12 months at 12% p.a. → EMI ₹8,884.88
    const s = emiSchedule({ principal: 10_000_000, annualRatePct: 12, count: 12, frequency: "monthly", firstDueDate: "2026-01-31" });
    expect(s.emi).toBe(888_488);
    expect(s.rows[0]).toMatchObject({ interest: 100_000, principal: 788_488, dueDate: "2026-01-31" });
    expect(s.rows[1]!.dueDate).toBe("2026-02-28");
    expect(s.rows[2]!.dueDate).toBe("2026-03-31");
    expect(s.rows.reduce((a, r) => a + r.principal, 0)).toBe(10_000_000);
    expect(s.rows.at(-1)!.balanceAfter).toBe(0);
    // Interest falls as the balance is repaid.
    expect(s.rows[11]!.interest).toBeLessThan(s.rows[0]!.interest);
    expect(s.totalInterest).toBeGreaterThan(600_000);
    expect(s.totalInterest).toBeLessThan(700_000);
  });

  it("splits evenly with no interest, rounding into the last instalment", () => {
    const s = emiSchedule({ principal: 1_000_001, annualRatePct: 0, count: 3, frequency: "quarterly", firstDueDate: "2026-05-15" });
    expect(s.rows.map((r) => r.principal)).toEqual([333_334, 333_334, 333_333]);
    expect(s.rows.map((r) => r.interest)).toEqual([0, 0, 0]);
    expect(s.rows.map((r) => r.dueDate)).toEqual(["2026-05-15", "2026-08-15", "2026-11-15"]);
  });
});

describe("receipt tax", () => {
  // ₹1,00,000 + 18% GST in-state = ₹1,18,000
  const quote = { total: 11_800_000, cgst: 900_000, sgst: 900_000, igst: 0 };

  it("carries the quote's GST in proportion to the amount received", () => {
    expect(receiptTax(quote, 0, 3_540_000)).toEqual({ taxable: 3_000_000, cgst: 270_000, sgst: 270_000, igst: 0 });
  });

  it("adds up exactly to the quote's tax once fully paid", () => {
    const parts = [333_333, 1_000_001, 4_466_666, 6_000_000];
    let paid = 0;
    const sum = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    for (const amount of parts) {
      const r = receiptTax(quote, paid, amount);
      paid += amount;
      for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += r[k];
    }
    expect(paid).toBe(quote.total);
    expect(sum).toEqual({ taxable: 10_000_000, cgst: 900_000, sgst: 900_000, igst: 0 });
  });

  it("has no tax when the quote has none", () => {
    expect(receiptTax({ total: 500_000, cgst: 0, sgst: 0, igst: 0 }, 0, 100_000)).toEqual({ taxable: 100_000, cgst: 0, sgst: 0, igst: 0 });
  });
});

describe("repricing to an agreed total", () => {
  it("hits the agreed total exactly, keeping the lines' proportions", () => {
    const lines = [
      { quantity: 3, unitPrice: 250_000, taxRate: 18 },
      { quantity: 1, unitPrice: 1_000_000, taxRate: 5, discountPct: 10 },
    ];
    for (const roundOff of [true, false]) {
      const out = scaleLinesToTotal(lines, "intra", { roundOff }, 1_500_000);
      expect(computeTotals(out, "intra", { roundOff }).total).toBe(1_500_000);
      expect(out[0]!.unitPrice).toBeLessThan(250_000);
    }
    const inter = scaleLinesToTotal(lines, "inter", {}, 1_234_500);
    expect(computeTotals(inter, "inter", {}).total).toBe(1_234_500);
  });
});
