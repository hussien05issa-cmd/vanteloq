export type PostedProfit = {
  revenueCents: number; expenseCents: number; cogsCents: number;
  grossProfitCents: number; operatingProfitCents: number;
  operatingRevenueCents?:number; operatingExpensesCents?:number; netProfitCents?:number; otherIncomeCents?:number; financeAndTaxCents?:number;
};

/** Display posted amounts only. Expenses already include COGS, so subtract it once. */
export function buildProfitBreakdown(profit: PostedProfit, available: boolean) {
  if (!available || !Object.values(profit).every(Number.isSafeInteger)) return null;
  const revenue=profit.operatingRevenueCents??profit.revenueCents;
  const operatingExpenses = profit.operatingExpensesCents??profit.expenseCents - profit.cogsCents;
  if (revenue - profit.cogsCents !== profit.grossProfitCents ||
      revenue - profit.cogsCents - operatingExpenses !== profit.operatingProfitCents) return null;
  if (!Number.isSafeInteger(operatingExpenses)) return null;
  return [
    { label: "Revenue", cents: revenue, kind: "income", explanation: "Operating revenue in the posted ledger." },
    { label: "Cost of Goods Sold", cents: profit.cogsCents, kind: "cost", explanation: "Posted costs of the goods sold." },
    { label: "Gross Profit", cents: profit.grossProfitCents, kind: "total", explanation: "Revenue minus cost of goods sold." },
    { label: "Other Posted Expenses", cents: operatingExpenses, kind: "cost", explanation: "Posted operating expenses, excluding COGS, finance costs and income tax." },
    { label: "Operating Profit", cents: profit.operatingProfitCents, kind: "total", explanation: "Operating revenue minus cost of goods sold and operating expenses." },
    ...(profit.netProfitCents!==undefined?[{label:"Other Income",cents:profit.otherIncomeCents??0,kind:"income",explanation:"Posted non-operating income."},{label:"Finance Costs and Income Tax",cents:profit.financeAndTaxCents??0,kind:"cost",explanation:"Posted amounts only. Unposted tax adjustments are not estimated."},{label:"Recorded Net Earnings",cents:profit.netProfitCents,kind:"total",explanation:"All posted revenue less all posted expenses."}]:[]),
  ] as const;
}
