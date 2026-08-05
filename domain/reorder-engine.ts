export type ReorderInputs = {
  onHandUnits: number;
  incomingUnits: number;
  averageDailyDemand: number;
  demandStdDevDaily: number | null;
  leadTimeDays: number;
  reviewPeriodDays: number;
  serviceLevelZ: number;
  seasonalityFactor: number;
  promotionFactor: number;
  casePackUnits: number;
  minimumOrderUnits: number;
  unitCostCents: number;
  availableCashCents: number;
  cashSafetyThresholdCents: number;
  accountsPayableCents: number;
  payrollCommitmentsCents: number;
  taxCommitmentsCents: number;
  debtCommitmentsCents: number;
  otherCommitmentsCents: number;
  shelfLifeDays: number | null;
  storageCapacityUnits: number | null;
  demandHistoryDays: number;
  dataAgeHours: number;
};

export type ReorderScenario = {
  label: "Conservative" | "Recommended" | "Growth";
  demandFactor: number;
  demandUnits: number;
  orderUnits: number;
  orderCostCents: number;
  cashAfterOrderCents: number;
};

export type ReorderRecommendation = {
  status: "no_order" | "ready_for_review" | "review_required" | "blocked";
  confidence: "high" | "medium" | "low";
  recommendedUnits: number;
  unconstrainedUnits: number;
  forecastDemandUnits: number;
  safetyStockUnits: number;
  targetStockUnits: number;
  expectedStockoutDays: number | null;
  orderCostCents: number;
  committedCashCents: number;
  cashAvailableForOrderCents: number;
  cashAfterOrderCents: number;
  cashThresholdBreached: boolean;
  constrainedBy: string[];
  missingInputs: string[];
  assumptions: string[];
  scenarios: ReorderScenario[];
  formula: string;
  requiresHumanApproval: true;
};

const numberFields: (keyof ReorderInputs)[] = [
  "onHandUnits",
  "incomingUnits",
  "averageDailyDemand",
  "leadTimeDays",
  "reviewPeriodDays",
  "serviceLevelZ",
  "seasonalityFactor",
  "promotionFactor",
  "casePackUnits",
  "minimumOrderUnits",
  "unitCostCents",
  "availableCashCents",
  "cashSafetyThresholdCents",
  "accountsPayableCents",
  "payrollCommitmentsCents",
  "taxCommitmentsCents",
  "debtCommitmentsCents",
  "otherCommitmentsCents",
  "demandHistoryDays",
  "dataAgeHours",
];

function assertInputs(inputs: ReorderInputs) {
  for (const field of numberFields) {
    const value = inputs[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${field} must be a finite non-negative number.`);
    }
  }
  for (const field of ["demandStdDevDaily", "shelfLifeDays", "storageCapacityUnits"] as const) {
    const value = inputs[field];
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`${field} must be null or a finite non-negative number.`);
    }
  }
  if (inputs.casePackUnits < 1) throw new Error("casePackUnits must be at least one.");
  if (inputs.unitCostCents < 1) throw new Error("unitCostCents must be at least one cent.");
  if (inputs.seasonalityFactor < 0.25 || inputs.seasonalityFactor > 4) {
    throw new Error("seasonalityFactor must be between 0.25 and 4.");
  }
  if (inputs.promotionFactor < 0.25 || inputs.promotionFactor > 4) {
    throw new Error("promotionFactor must be between 0.25 and 4.");
  }
}

function roundUp(value: number, pack: number) {
  return Math.ceil(Math.max(0, value) / pack) * pack;
}

function roundDown(value: number, pack: number) {
  return Math.floor(Math.max(0, value) / pack) * pack;
}

function boundedOrder(inputs: ReorderInputs, demandFactor: number) {
  const horizonDays = inputs.leadTimeDays + inputs.reviewPeriodDays;
  const demandUnits = Math.ceil(
    inputs.averageDailyDemand *
      horizonDays *
      inputs.seasonalityFactor *
      inputs.promotionFactor *
      demandFactor,
  );
  const safetyStockUnits = Math.ceil(
    inputs.demandStdDevDaily === null
      ? inputs.averageDailyDemand * inputs.leadTimeDays * 0.25
      : inputs.serviceLevelZ *
          inputs.demandStdDevDaily *
          Math.sqrt(inputs.leadTimeDays),
  );
  const targetStockUnits = demandUnits + safetyStockUnits;
  const netNeed = Math.max(
    0,
    targetStockUnits - inputs.onHandUnits - inputs.incomingUnits,
  );
  const minimumAdjusted =
    netNeed > 0 ? Math.max(netNeed, inputs.minimumOrderUnits) : 0;
  const unconstrainedUnits = roundUp(minimumAdjusted, inputs.casePackUnits);

  const committedCashCents =
    inputs.accountsPayableCents +
    inputs.payrollCommitmentsCents +
    inputs.taxCommitmentsCents +
    inputs.debtCommitmentsCents +
    inputs.otherCommitmentsCents;
  const cashAvailableForOrderCents = Math.max(
    0,
    inputs.availableCashCents -
      inputs.cashSafetyThresholdCents -
      committedCashCents,
  );
  const cashCap = roundDown(
    Math.floor(cashAvailableForOrderCents / inputs.unitCostCents),
    inputs.casePackUnits,
  );
  const storageCap =
    inputs.storageCapacityUnits === null
      ? Number.POSITIVE_INFINITY
      : roundDown(
          Math.max(
            0,
            inputs.storageCapacityUnits -
              inputs.onHandUnits -
              inputs.incomingUnits,
          ),
          inputs.casePackUnits,
        );
  const shelfLifeCap =
    inputs.shelfLifeDays === null || inputs.averageDailyDemand === 0
      ? Number.POSITIVE_INFINITY
      : roundDown(
          Math.max(
            0,
            Math.floor(
              inputs.averageDailyDemand *
                inputs.shelfLifeDays *
                inputs.seasonalityFactor *
                inputs.promotionFactor -
                inputs.onHandUnits -
                inputs.incomingUnits,
            ),
          ),
          inputs.casePackUnits,
        );
  const orderUnits = Math.max(
    0,
    Math.min(unconstrainedUnits, cashCap, storageCap, shelfLifeCap),
  );
  const orderCostCents = orderUnits * inputs.unitCostCents;
  return {
    demandUnits,
    safetyStockUnits,
    targetStockUnits,
    unconstrainedUnits,
    orderUnits,
    orderCostCents,
    committedCashCents,
    cashAvailableForOrderCents,
    cashAfterOrderCents:
      inputs.availableCashCents - committedCashCents - orderCostCents,
    caps: { cashCap, storageCap, shelfLifeCap },
  };
}

export function calculateReorderRecommendation(
  inputs: ReorderInputs,
): ReorderRecommendation {
  assertInputs(inputs);
  const result = boundedOrder(inputs, 1);
  const constrainedBy: string[] = [];
  if (result.caps.cashCap < result.unconstrainedUnits) constrainedBy.push("Cash safety threshold");
  if (result.caps.storageCap < result.unconstrainedUnits) constrainedBy.push("Storage capacity");
  if (result.caps.shelfLifeCap < result.unconstrainedUnits) constrainedBy.push("Shelf life");
  if (
    result.orderUnits > 0 &&
    result.orderUnits < inputs.minimumOrderUnits
  ) {
    constrainedBy.push("Supplier minimum order");
  }

  const missingInputs: string[] = [];
  const assumptions: string[] = [];
  if (inputs.demandStdDevDaily === null) {
    missingInputs.push("Measured demand variability");
    assumptions.push("Safety stock uses 25% of lead-time demand until variability is measured.");
  }
  if (inputs.shelfLifeDays === null) missingInputs.push("Shelf life");
  if (inputs.storageCapacityUnits === null) missingInputs.push("Storage capacity");
  if (!inputs.minimumOrderUnits) assumptions.push("No supplier minimum order was supplied.");
  if (inputs.demandHistoryDays < 28) missingInputs.push("At least 28 days of demand history");
  if (inputs.dataAgeHours > 72) missingInputs.push("Fresh inventory and sales data");

  const confidence: ReorderRecommendation["confidence"] =
    inputs.demandStdDevDaily !== null &&
    inputs.demandHistoryDays >= 56 &&
    inputs.dataAgeHours <= 24
      ? "high"
      : inputs.demandHistoryDays >= 28 && inputs.dataAgeHours <= 72
        ? "medium"
        : "low";
  const minimumConflict =
    result.unconstrainedUnits > 0 &&
    result.orderUnits > 0 &&
    result.orderUnits < inputs.minimumOrderUnits;
  const status: ReorderRecommendation["status"] =
    result.unconstrainedUnits === 0
      ? "no_order"
      : result.orderUnits === 0 || minimumConflict
        ? "blocked"
        : constrainedBy.length || confidence === "low"
          ? "review_required"
          : "ready_for_review";

  const scenarios = ([
    ["Conservative", 0.85],
    ["Recommended", 1],
    ["Growth", 1.2],
  ] as const).map(([label, demandFactor]) => {
    const scenario = boundedOrder(inputs, demandFactor);
    return {
      label,
      demandFactor,
      demandUnits: scenario.demandUnits,
      orderUnits: scenario.orderUnits,
      orderCostCents: scenario.orderCostCents,
      cashAfterOrderCents: scenario.cashAfterOrderCents,
    };
  });

  return {
    status,
    confidence,
    recommendedUnits: result.orderUnits,
    unconstrainedUnits: result.unconstrainedUnits,
    forecastDemandUnits: result.demandUnits,
    safetyStockUnits: result.safetyStockUnits,
    targetStockUnits: result.targetStockUnits,
    expectedStockoutDays:
      inputs.averageDailyDemand > 0
        ? Math.floor(
            (inputs.onHandUnits + inputs.incomingUnits) /
              inputs.averageDailyDemand,
          )
        : null,
    orderCostCents: result.orderCostCents,
    committedCashCents: result.committedCashCents,
    cashAvailableForOrderCents: result.cashAvailableForOrderCents,
    cashAfterOrderCents: result.cashAfterOrderCents,
    cashThresholdBreached:
      result.cashAfterOrderCents < inputs.cashSafetyThresholdCents,
    constrainedBy,
    missingInputs,
    assumptions,
    scenarios,
    formula:
      "Order = pack-round(max(0, demand through lead + review period + safety stock − on hand − incoming)), capped by cash, shelf life and storage.",
    requiresHumanApproval: true,
  };
}
