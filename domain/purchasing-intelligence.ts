export type PurchasingProductInput = {
  sku: string;
  name: string;
  supplierName: string | null;
  onHandUnits: number;
  reorderPointUnits: number;
  incomingUnits: number;
  unitsSold30: number;
  unitsSoldPrevious30: number;
  unitsSold90: number;
  unitCostCents: number | null;
  lastOrderedAt: string | null;
  lastOrderStatus: string | null;
  lastSaleAt: string | null;
};

export type PurchasingProductAssessment = PurchasingProductInput & {
  health: "issue" | "healthy" | "dead_stock" | "watch";
  recommendedUnits: number;
  recommendedCostCents: number | null;
  daysCover: number | null;
  demandTrendRate: number | null;
  summary: string;
  factors: string[];
};

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function assessPurchasingProduct(input: PurchasingProductInput): PurchasingProductAssessment {
  const onHand = nonNegative(input.onHandUnits);
  const incoming = nonNegative(input.incomingUnits);
  const currentDemand = nonNegative(input.unitsSold30);
  const previousDemand = nonNegative(input.unitsSoldPrevious30);
  const demand90 = nonNegative(input.unitsSold90);
  const dailyDemand = currentDemand / 30;
  const demandTrendRate = previousDemand > 0 ? (currentDemand - previousDemand) / previousDemand : null;
  const growthFactor = demandTrendRate === null ? 1 : Math.min(1.5, Math.max(0.75, 1 + demandTrendRate * 0.5));
  const targetUnits = Math.max(nonNegative(input.reorderPointUnits) * 2, Math.ceil(currentDemand * growthFactor));
  const availableUnits = onHand + incoming;
  const daysCover = dailyDemand > 0 ? Math.round((availableUnits / dailyDemand) * 10) / 10 : null;
  const deadStock = demand90 === 0 && onHand > 0;
  const openOrderBuffer = incoming > 0 ? Math.ceil(dailyDemand * 7) : 0;
  const rawNeed = Math.max(0, targetUnits - availableUnits);
  const recommendedUnits = deadStock || rawNeed <= openOrderBuffer ? 0 : Math.ceil(rawNeed);
  const factors: string[] = [];

  if (demandTrendRate !== null) {
    factors.push(`${Math.abs(demandTrendRate * 100).toFixed(0)}% demand ${demandTrendRate >= 0 ? "growth" : "decline"} versus the prior 30 days`);
  } else {
    factors.push("Prior-period demand is not available");
  }
  factors.push(`${onHand} on hand plus ${incoming} already incoming`);
  factors.push(`${targetUnits} unit performance target using 30-day demand and reorder point`);
  if (input.lastOrderedAt) factors.push(`Last ordered ${input.lastOrderedAt} with status ${input.lastOrderStatus?.replaceAll("_", " ") || "recorded"}`);

  let health: PurchasingProductAssessment["health"] = "watch";
  let summary = "Review product history before committing cash.";
  if (deadStock) {
    health = "dead_stock";
    summary = "No units sold in 90 days. Pause reordering and review markdown, transfer, or removal options.";
  } else if (availableUnits <= nonNegative(input.reorderPointUnits) || (recommendedUnits > 0 && (daysCover ?? 0) < 14)) {
    health = "issue";
    summary = `${recommendedUnits} units recommended to restore performance-based cover.`;
  } else if (recommendedUnits === 0) {
    health = "healthy";
    summary = incoming > 0
      ? "Current and incoming stock cover the next order cycle. Do not duplicate the open order."
      : "Inventory cover is healthy for the current demand rate.";
  } else {
    summary = `${recommendedUnits} units suggested for the next reviewed order.`;
  }

  return {
    ...input,
    onHandUnits: onHand,
    incomingUnits: incoming,
    unitsSold30: currentDemand,
    unitsSoldPrevious30: previousDemand,
    unitsSold90: demand90,
    health,
    recommendedUnits,
    recommendedCostCents: input.unitCostCents === null ? null : recommendedUnits * Math.max(0, input.unitCostCents),
    daysCover,
    demandTrendRate,
    summary,
    factors,
  };
}
