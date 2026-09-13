import type { RetailReport } from "./retail-intelligence";

/** Provider-bound allowlist: no customer references, employee records, connection IDs or raw receipts. */
export function projectAdvisorRetail(report: RetailReport) {
  const product = (row: RetailReport["products"][number]) => ({
    name: row.name, category: row.category, itemType: row.itemType, units: row.unitsMilli / 1000,
    netSalesCents: row.netCents, priorNetSalesCents: row.priorNetCents, growthRate: row.growthRate,
    grossProfitCents: row.grossProfitCents, marginRate: row.marginRate, discountRate: row.discountRate,
    baskets: row.basketCount, identifiedBuyers: row.identifiedBuyers, observedRepeatRate: row.repeatPurchaseRate, salesPerformanceScore: row.score,
  });
  const pair = (row: RetailReport["baskets"]["products"]["pairs"][number]) => ({
    first: row.aName, second: row.bName, coPurchaseBaskets: row.count, sourceBaskets: row.baskets,
    support: row.support, confidence: row.confidence, lift: row.lift,
  });
  return {
    status: report.current.lineCount ? "available" : "no_records",
    period: report.period, timeZone: report.timeZone, current: report.current, prior: report.prior,
    comparison: report.comparison, revenueBridge: report.bridge,
    products: report.products.slice(0, 20).map(product), totalProducts: report.products.length,
    categories: report.categories.slice(0, 25), totalCategories: report.categories.length,
    basketPairs: report.baskets.products.pairs.slice(0, 8).map(pair), categoryPairs: report.baskets.categories.pairs.slice(0, 8).map(pair),
    basketAnalysisStatus: report.baskets.products.status, customers: report.customers,
    inventory: report.inventory.slice().sort((a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity)).slice(0, 20).map(row => ({
      name: row.name, recordedOnHand: row.onHand, stockUpdatedAt: new Date(row.updatedAt).toISOString(), fresh: row.fresh,
      unitsSold: row.units, dailyVelocity: row.dailyVelocity, daysOfCover: row.daysOfCover, turnover: row.turnover,
      daysOnHand: row.daysOnHand, sellThrough: row.sellThrough, reorderReviewUnits: row.reorderUnits, overstockReview: row.overstock,
      evidenceIssue: row.stockInputIssue, hasReviewedStockEvidence: Boolean(row.measurementSource),
    })),
    totalInventoryItems: report.inventory.length,
    expiry: report.expiry.slice(0, 15).map(row => ({ name: row.name, quantity: row.quantity, expirationDate: row.expirationDate, daysToExpiry: row.daysToExpiry, recordedCostAtRiskCents: row.valueAtRiskCents })),
    hours: report.hours, anomalies: report.anomalies.slice(-12), operations: report.operations,
    methodology: report.methodology, dataQualityWarnings: report.dataQualityWarnings,
    limitation: "Top-ranked product, category, basket and inventory summaries are bounded excerpts of complete calculations. They are not a complete list. Recorded trends do not establish causes or complete trading-day coverage.",
  };
}
