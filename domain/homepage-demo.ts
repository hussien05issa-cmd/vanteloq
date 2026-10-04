import { demoAnalysis } from "./product-demo";
import { retailDemo } from "./retail-demo";
import { bookloqDemo } from "./bookloq-demo";

/** One fictional source for the homepage, retail landing and full product demo. */
export function homepageDemo() {
  const daily = demoAnalysis("all", "complete");
  const retail = retailDemo("all", false);
  const cash = bookloqDemo(0, false, false);
  const stock = retail.inventory.find(row => row.sku === "CRE-01" && row.outletRef === "central")!;
  return {
    period: { from: "2026-05-29", to: "2026-06-25", label: "May 29 to June 25, 2026", prior: "May 1 to 28, 2026", days: 28 },
    currency: "CAD", location: "All sample locations", sample: "Fictional records",
    current: retail.current, prior: retail.prior, bridge: retail.bridge ?? [],
    salesChange: retail.comparison.growthRate, weeks: daily.weeks, stock,
    coverage: { days: retail.comparison.currentObservedDays, rows: daily.currentRows.length, snapshot: "June 25, 2026" },
    cash: { asOf: cash.asOf, opening: cash.openingCashCents, committed: cash.confirmedPurchasingObligationsCents, capacity: cash.purchasingCapacityCents, threshold: cash.safetyThresholdCents },
  };
}
export const HOME_DEMO = homepageDemo();
export const sampleMoney = (cents: number | null, decimals = 2) => cents === null ? "Unavailable" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(cents / 100);
