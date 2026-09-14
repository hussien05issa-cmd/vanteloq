import type { RetailReport } from "./retail-intelligence";

/** Provider-bound allowlist: no customer references, employee records, connection IDs or raw receipts. */
export function projectAdvisorRetail(report: RetailReport) {
  const hasCurrentRecords = report.current.lineCount > 0;
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
    status: hasCurrentRecords ? "available" : "no_records",
    period: report.period, timeZone: report.timeZone, current: hasCurrentRecords ? report.current : null, prior: report.prior.lineCount ? report.prior : null,
    comparison: report.comparison, revenueBridge: report.bridge,
    products: hasCurrentRecords ? report.products.slice(0, 20).map(product) : [], totalProducts: hasCurrentRecords ? report.products.length : null,
    categories: hasCurrentRecords ? report.categories.slice(0, 25) : [], totalCategories: hasCurrentRecords ? report.categories.length : null,
    basketPairs: report.baskets.products.pairs.slice(0, 8).map(pair), categoryPairs: report.baskets.categories.pairs.slice(0, 8).map(pair),
    basketAnalysisStatus: report.baskets.products.status, customers: hasCurrentRecords ? report.customers : null,
    inventory: report.inventory.slice().sort((a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity)).slice(0, 20).map(row => ({
      name: row.name, recordedOnHand: row.onHand, stockUpdatedAt: new Date(row.updatedAt).toISOString(), fresh: row.fresh,
      unitsSold: hasCurrentRecords ? row.units : null, dailyVelocity: hasCurrentRecords ? row.dailyVelocity : null, daysOfCover: hasCurrentRecords ? row.daysOfCover : null, turnover: hasCurrentRecords ? row.turnover : null,
      daysOnHand: hasCurrentRecords ? row.daysOnHand : null, sellThrough: hasCurrentRecords ? row.sellThrough : null, reorderReviewUnits: hasCurrentRecords ? row.reorderUnits : null, overstockReview: hasCurrentRecords ? row.overstock : null,
      evidenceIssue: row.stockInputIssue, hasReviewedStockEvidence: Boolean(row.measurementSource),
    })),
    totalInventoryItems: report.inventory.length,
    expiry: report.expiry.slice(0, 15).map(row => ({ name: row.name, quantity: row.quantity, expirationDate: row.expirationDate, daysToExpiry: row.daysToExpiry, recordedCostAtRiskCents: row.valueAtRiskCents })),
    hours: hasCurrentRecords ? report.hours : [], anomalies: hasCurrentRecords ? report.anomalies.slice(-12) : [], operations: hasCurrentRecords ? report.operations : null,
    methodology: report.methodology, dataQualityWarnings: report.dataQualityWarnings,
    limitation: "No records means unavailable evidence, not zero sales or a closed business. Stock snapshots do not prove zero sales velocity. Top-ranked product, category, basket and inventory summaries are bounded excerpts of complete calculations. They are not a complete list. Recorded trends do not establish causes or complete trading-day coverage.",
  };
}
