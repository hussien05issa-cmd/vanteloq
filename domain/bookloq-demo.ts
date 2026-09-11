import { buildThirteenWeekCashFlow } from "./thirteen-week-cash-flow.ts";

/** Fictional obligations, evaluated by the same cash engine as BookLoQ. */
export function bookloqDemo(purchaseCents: number, receiptDelayed: boolean, bankMissing: boolean) {
  const purchase = Math.max(0, Math.min(2_000_000, Math.round(purchaseCents)));
  return buildThirteenWeekCashFlow({
    asOf: "2026-06-25", openingCashCents: bankMissing ? null : 3_000_000, safetyThresholdCents: 1_000_000,
    actualTransactions: [], confirmedPurchasingObligationsCents: 1_200_000 + purchase,
    decisionBlocks: bankMissing ? ["bank_data_unavailable"] : [],
    forecastItems: [
      { id: "rent", label: "Rent", dueDate: "2026-07-01", amountCents: 400_000, direction: "out", certainty: "confirmed" },
      { id: "payroll", label: "Payroll", dueDate: "2026-07-03", amountCents: 500_000, direction: "out", certainty: "confirmed" },
      { id: "supplier", label: "Supplier bill", dueDate: "2026-07-06", amountCents: 300_000, direction: "out", certainty: "confirmed" },
      { id: "receipt", label: "Expected customer receipt", dueDate: receiptDelayed ? "2026-08-03" : "2026-06-29", amountCents: 700_000, direction: "in", certainty: "expected" },
      { id: "purchase", label: "Proposed stock purchase", dueDate: "2026-06-26", amountCents: purchase, direction: "out", certainty: "confirmed" },
    ],
  });
}
