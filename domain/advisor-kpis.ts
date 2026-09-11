export type AdvisorDay = { date: string; locationRef: string; netSalesCents: number | null; grossProfitCents: number | null; transactions: number | null; discountsCents: number | null; refundsCents: number | null; unitsSold: number | null; labourCostCents: number | null; inventoryValueCents: number | null; accountsPayableCents: number | null };
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
type NumericField = Exclude<keyof AdvisorDay, "date" | "locationRef">;
const total = (rows: AdvisorDay[], field: NumericField) => {
  if (!rows.length || rows.some(row => row[field] === null || !Number.isSafeInteger(row[field]))) return null;
  const value = rows.reduce((sum, row) => sum + row[field]!, 0);
  return Number.isSafeInteger(value) ? value : null;
};

export function advisorDailySeries(rows: AdvisorDay[]) {
  return [...new Set(rows.map(row => row.date))].sort().map(date => {
    const day = rows.filter(row => row.date === date);
    return { date, netSalesCents: total(day, "netSalesCents"), grossProfitCents: total(day, "grossProfitCents"), transactions: total(day, "transactions"), discountsCents: total(day, "discountsCents"), refundsCents: total(day, "refundsCents"), observedLocations: day.length };
  });
}
const ratio = (numerator: number | null, denominator: number | null, scale = 1) => numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator * scale : null;

/** Calculations use only permission-filtered data. Missing values never become zero. */
export function advisorKpis(rows: AdvisorDay[], now = new Date()) {
  const dates = rows.map(row => row.date).sort();
  const latestDate = dates.at(-1);
  if (!latestDate) return { latestDate: null, current: null, previous: null, comparisonComplete: false, salesChangePercent: null, limitations: ["No approved daily business evidence is available."] };
  const locations = [...new Set(rows.map(row => row.locationRef))];
  function period(end: string) {
    const start = shift(end, -27);
    const selected = rows.filter(row => row.date >= start && row.date <= end);
    const coverage = new Set(selected.map(row => `${row.date}:${row.locationRef}`));
    const complete = locations.every(location => Array.from({length: 28}, (_, i) => shift(end, -i)).every(date => coverage.has(`${date}:${location}`)));
    const netSalesCents = total(selected, "netSalesCents"), grossProfitCents = total(selected, "grossProfitCents"), transactions = total(selected, "transactions"), unitsSold = total(selected, "unitsSold"), labourCostCents = total(selected, "labourCostCents");
    return { start, end, complete, observedDays: new Set(selected.map(row => row.date)).size, netSalesCents, grossProfitCents, transactions, unitsSold, labourCostCents,
      discountsCents: total(selected, "discountsCents"), refundsCents: total(selected, "refundsCents"), grossMarginPercent: ratio(grossProfitCents, netSalesCents, 100), averageTransactionCents: ratio(netSalesCents, transactions), unitsPerTransaction: ratio(unitsSold, transactions), labourToSalesPercent: ratio(labourCostCents, netSalesCents, 100),
      contributionAfterLabourCents: grossProfitCents !== null && labourCostCents !== null ? grossProfitCents - labourCostCents : null,
    };
  }
  const current = period(latestDate), previous = period(shift(latestDate, -28));
  const comparisonComplete = current.complete && previous.complete;
  const latestRows = rows.filter(row => row.date === latestDate);
  const snapshotComplete = locations.every(location => latestRows.some(row => row.locationRef === location));
  return { latestDate, ageDays: Math.max(0, Math.floor((now.getTime() - Date.parse(`${latestDate}T00:00:00Z`)) / 86400000)), current, previous, comparisonComplete,
    salesChangePercent: comparisonComplete && current.netSalesCents !== null && previous.netSalesCents !== null && previous.netSalesCents > 0 ? (current.netSalesCents - previous.netSalesCents) / previous.netSalesCents * 100 : null,
    inventorySnapshotCents: snapshotComplete ? total(latestRows, "inventoryValueCents") : null,
    accountsPayableSnapshotCents: snapshotComplete ? total(latestRows, "accountsPayableCents") : null,
    netProfitCents: null,
    definitions: { grossMarginPercent: "gross profit / net sales * 100", averageTransactionCents: "net sales / transaction count", unitsPerTransaction: "units sold / transaction count", labourToSalesPercent: "labour cost / net sales * 100", contributionAfterLabourCents: "gross profit minus labour; excludes other operating costs and is not net profit" },
    limitations: ["Totals describe the observed approved rows only. Missing days and locations are not zero; comparisons require equal complete 28-day periods across observed locations.", "Observed locations do not prove all intended sources are connected. Imported balances are dated snapshots, not bank-verified cash or purchasing capacity.", "Net profit, tax, working capital, liquidity ratios and a cash forecast require their additional verified inputs; do not invent them.", "Historical trends do not establish causation or guarantee forecasts. Any scenario must show assumptions and remain separate from actual KPIs."] };
}
