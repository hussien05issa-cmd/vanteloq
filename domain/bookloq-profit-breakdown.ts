export type PostedProfit = {
  revenueCents: number; expenseCents: number; cogsCents: number;
  grossProfitCents: number; operatingProfitCents: number;
};

/** Display posted amounts only. Expenses already include COGS, so subtract it once. */
export function buildProfitBreakdown(profit: PostedProfit, available: boolean) {
  if (!available || !Object.values(profit).every(Number.isSafeInteger)) return null;
  if (profit.revenueCents - profit.cogsCents !== profit.grossProfitCents ||
      profit.revenueCents - profit.expenseCents !== profit.operatingProfitCents) return null;
  const operatingExpenses = profit.expenseCents - profit.cogsCents;
  if (!Number.isSafeInteger(operatingExpenses)) return null;
  return [
    { label: "Revenue", cents: profit.revenueCents, kind: "income", explanation: "Revenue in the posted ledger." },
    { label: "Cost of Goods Sold", cents: profit.cogsCents, kind: "cost", explanation: "Posted costs of the goods sold." },
    { label: "Gross Profit", cents: profit.grossProfitCents, kind: "total", explanation: "Revenue minus cost of goods sold." },
    { label: "Other Posted Expenses", cents: operatingExpenses, kind: "cost", explanation: "Total posted expenses minus cost of goods sold." },
    { label: "Operating Profit", cents: profit.operatingProfitCents, kind: "total", explanation: "Revenue minus all posted expenses, as classified in BookLoQ." },
  ] as const;
}
