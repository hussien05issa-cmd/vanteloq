import { retailDemoInput } from "./retail-demo";
import { advisorDailySeries, advisorKpis, type AdvisorDay } from "./advisor-kpis";

export type DemoLocation = "all" | "central" | "riverside";
export type DemoQuality = "complete" | "missing-cost" | "missing-days";
export const DEMO_DATE = "2026-06-25";
export const DEMO_LOCATIONS = { central: "Central shop", riverside: "Riverside shop" } as const;
const day = (offset: number) => new Date(Date.UTC(2026, 4, 1 + offset)).toISOString().slice(0, 10);

/** Deliberately fictional daily records. Never seeded into a customer database. */
export function demoRecords(location: DemoLocation = "all", quality: DemoQuality = "complete"): AdvisorDay[] {
  const input = retailDemoInput(location, quality === "missing-cost");
  const summaries = new Map<string, AdvisorDay>();
  const receipts = new Map<string, Set<string>>();
  for (const line of input.lines) {
    const date = line.soldAt.slice(0, 10), locationRef = line.outletRef;
    if (!locationRef) throw new Error("A sample receipt must identify its shop.");
    if (quality === "missing-days" && date >= day(7) && date < day(14)) continue;
    const key = date + ":" + locationRef;
    const row = summaries.get(key) ?? { date, locationRef, netSalesCents: 0, grossProfitCents: 0, transactions: 0, discountsCents: 0, refundsCents: 0, unitsSold: 0, labourCostCents: null, inventoryValueCents: null, accountsPayableCents: null };
    row.netSalesCents = (row.netSalesCents ?? 0) + line.netCents;
    row.grossProfitCents = row.grossProfitCents === null || line.costCents === null ? null : row.grossProfitCents + line.netCents - line.costCents;
    row.discountsCents = (row.discountsCents ?? 0) + line.discountCents;
    row.unitsSold = (row.unitsSold ?? 0) + line.quantityMilli / 1000;
    const sales = receipts.get(key) ?? new Set<string>();
    sales.add(line.saleId); receipts.set(key, sales); row.transactions = sales.size;
    summaries.set(key, row);
  }
  return [...summaries.values()];
}

export function demoAnalysis(location: DemoLocation, quality: DemoQuality) {
  const rows = demoRecords(location, quality).sort((a, b) => b.date.localeCompare(a.date) || a.locationRef.localeCompare(b.locationRef));
  const kpis = advisorKpis(rows, new Date(`${DEMO_DATE}T12:00:00Z`));
  const currentRows = rows.filter(row => row.date >= kpis.current!.start);
  const series = advisorDailySeries(currentRows);
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const week = series.slice(i * 7, i * 7 + 7);
    return { label: `Week ${i + 1}`, from: week[0].date, to: week.at(-1)!.date, salesCents: week.reduce((sum, row) => sum + (row.netSalesCents ?? 0), 0) };
  });
  return { rows, currentRows, kpis, weeks };
}

/** A sensitivity calculation at unchanged volume, not a forecast or actual KPI. */
export function demoScenario(salesCents: number, profitCents: number | null, pricePercent: number, costPercent: number) {
  if (profitCents === null || ![salesCents, profitCents, pricePercent, costPercent].every(Number.isFinite) || salesCents <= 0 || pricePercent < -20 || pricePercent > 20 || costPercent < -10 || costPercent > 30) return null;
  const costCents = salesCents - profitCents;
  const scenarioSalesCents = Math.round(salesCents * (1 + pricePercent / 100));
  const scenarioCostCents = Math.round(costCents * (1 + costPercent / 100));
  return { salesCents: scenarioSalesCents, costCents: scenarioCostCents, profitCents: scenarioSalesCents - scenarioCostCents, marginPercent: (scenarioSalesCents - scenarioCostCents) / scenarioSalesCents * 100, profitChangeCents: scenarioSalesCents - scenarioCostCents - profitCents };
}

