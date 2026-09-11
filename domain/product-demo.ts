import { advisorDailySeries, advisorKpis, type AdvisorDay } from "./advisor-kpis";

export type DemoLocation = "all" | "central" | "riverside";
export type DemoQuality = "complete" | "missing-cost" | "missing-days";
export const DEMO_DATE = "2026-06-25";
export const DEMO_LOCATIONS = { central: "Central shop", riverside: "Riverside shop" } as const;
const day = (offset: number) => new Date(Date.UTC(2026, 4, 1 + offset)).toISOString().slice(0, 10);

/** Deliberately fictional daily records. Never seeded into a customer database. */
export function demoRecords(location: DemoLocation = "all", quality: DemoQuality = "complete"): AdvisorDay[] {
  return Object.keys(DEMO_LOCATIONS).flatMap((locationRef, shop) => Array.from({ length: 56 }, (_, index) => {
    const transactions = 29 + shop * 7 + index % 7 * 3 + [-3, 2, -1, 2][Math.floor(index % 28 / 7)] + (index >= 28 ? 5 : 0);
    const netSalesCents = transactions * (shop ? 3850 : 4250);
    const costCents = Math.round(netSalesCents * (index >= 28 ? .61 : .58));
    return { date: day(index), locationRef, netSalesCents, grossProfitCents: quality === "missing-cost" && index === 55 && shop === (location === "riverside" ? 1 : 0) ? null : netSalesCents - costCents,
      transactions, discountsCents: transactions * 125, refundsCents: index % 6 === 0 ? 4250 : 0, unitsSold: transactions * 2,
      labourCostCents: 22000 + shop * 4000, inventoryValueCents: 1850000 + shop * 500000, accountsPayableCents: 420000 + shop * 180000 };
  })).filter(row => (location === "all" || row.locationRef === location) && !(quality === "missing-days" && row.date >= day(7) && row.date < day(14)));
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

