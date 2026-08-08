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
  grossMarginBasisPoints?: number | null;
  weatherFactor?: number;
  expiringUnits?: number;
  supplierMinimumSpendCents?: number;
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
  urgency: "hold" | "normal" | "urgent";
  marginBasisPoints: number | null;
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
  const weatherFactor = inputs.weatherFactor ?? 1;
  const expiringUnits = inputs.expiringUnits ?? 0;
  const horizonDays = inputs.leadTimeDays + inputs.reviewPeriodDays;
  const demandUnits = Math.ceil(
    inputs.averageDailyDemand *
      horizonDays *
      inputs.seasonalityFactor *
      inputs.promotionFactor *
      weatherFactor *
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
    targetStockUnits - Math.max(0, inputs.onHandUnits - expiringUnits) - inputs.incomingUnits,
  );
  const minimumSpendUnits = inputs.supplierMinimumSpendCents
    ? Math.ceil(inputs.supplierMinimumSpendCents / inputs.unitCostCents)
    : 0;
  const minimumAdjusted =
    netNeed > 0 ? Math.max(netNeed, inputs.minimumOrderUnits, minimumSpendUnits) : 0;
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
  if ((inputs.weatherFactor ?? 1) < 0.25 || (inputs.weatherFactor ?? 1) > 4) throw new Error("weatherFactor must be between 0.25 and 4.");
  if ((inputs.expiringUnits ?? 0) < 0 || (inputs.supplierMinimumSpendCents ?? 0) < 0) throw new Error("Expiry and supplier minimum spend must be non-negative.");
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
  if (inputs.grossMarginBasisPoints == null) missingInputs.push("Product gross margin");
  if (inputs.weatherFactor == null) missingInputs.push("Weather demand factor");
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
  const expectedStockoutDays = inputs.averageDailyDemand > 0
    ? Math.floor((Math.max(0, inputs.onHandUnits - (inputs.expiringUnits ?? 0)) + inputs.incomingUnits) / inputs.averageDailyDemand)
    : null;
  const urgency: ReorderRecommendation["urgency"] = status === "no_order" ? "hold" : expectedStockoutDays !== null && expectedStockoutDays <= inputs.leadTimeDays ? "urgent" : "normal";

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
    expectedStockoutDays,
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
    urgency,
    marginBasisPoints: inputs.grossMarginBasisPoints ?? null,
  };
}
