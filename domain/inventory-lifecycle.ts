export type ShelfLifeRisk = "healthy" | "monitor" | "at_risk" | "urgent" | "expired" | "untracked";
export type EvidenceConfidence = "high" | "moderate" | "low" | "unavailable";

export type InventoryLotEvidence = {
  id: string;
  sku: string;
  productName: string;
  locationRef: string;
  lotNumber: string;
  batchNumber: string;
  receivedDate: string;
  expirationDate: string | null;
  bestBeforeDate: string | null;
  quantityRemaining: number;
  unitCostCents: number | null;
  unitRetailCents: number | null;
  unitsSold30Days: number | null;
  demandHistoryDays: number;
};

export type InventoryLotAssessment = {
  risk: ShelfLifeRisk;
  trackedDate: string | null;
  trackedDateKind: "expiration" | "best_before" | null;
  daysRemaining: number | null;
  monthlyVelocity: number | null;
  projectedUnitsAtDate: number | null;
  inventoryCostAtRiskCents: number | null;
  grossMarginOpportunityAtRiskCents: number | null;
  confidence: EvidenceConfidence;
  recommendation: string;
  evidence: string[];
};

const DAY_MS = 86_400_000;

function utcDay(date: string | Date): number {
  const value = typeof date === "string" ? new Date(`${date}T00:00:00.000Z`) : date;
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function assessInventoryLot(lot: InventoryLotEvidence, asOf: Date): InventoryLotAssessment {
  const dateCandidates = [
    lot.expirationDate ? { value: lot.expirationDate, kind: "expiration" as const } : null,
    lot.bestBeforeDate ? { value: lot.bestBeforeDate, kind: "best_before" as const } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  dateCandidates.sort((a, b) => a.value.localeCompare(b.value));
  const tracked = dateCandidates[0] ?? null;
  const daysRemaining = tracked ? Math.ceil((utcDay(tracked.value) - utcDay(asOf)) / DAY_MS) : null;
  const hasDemandEvidence = lot.unitsSold30Days !== null && lot.demandHistoryDays >= 7;
  const evidenceDays = Math.max(1, Math.min(30, lot.demandHistoryDays));
  const monthlyVelocity = hasDemandEvidence
    ? Number(((lot.unitsSold30Days! / evidenceDays) * 30).toFixed(2))
    : null;
  const projectedUnitsAtDate = tracked && monthlyVelocity !== null
    ? Math.max(0, Math.ceil(lot.quantityRemaining - monthlyVelocity * Math.max(0, daysRemaining!) / 30))
    : null;
  const inventoryCostAtRiskCents = projectedUnitsAtDate !== null && lot.unitCostCents !== null
    ? projectedUnitsAtDate * lot.unitCostCents
    : null;
  const grossMarginOpportunityAtRiskCents = projectedUnitsAtDate !== null && lot.unitCostCents !== null && lot.unitRetailCents !== null
    ? projectedUnitsAtDate * Math.max(0, lot.unitRetailCents - lot.unitCostCents)
    : null;
  const confidence: EvidenceConfidence = !hasDemandEvidence
    ? "unavailable"
    : lot.demandHistoryDays >= 90
      ? "high"
      : lot.demandHistoryDays >= 30
        ? "moderate"
        : "low";

  let risk: ShelfLifeRisk = "untracked";
  if (lot.quantityRemaining === 0) {
    risk = "healthy";
  } else if (daysRemaining !== null) {
    if (daysRemaining < 0) risk = "expired";
    else if (daysRemaining <= 14 || (projectedUnitsAtDate !== null && projectedUnitsAtDate > 0 && daysRemaining <= 30)) risk = "urgent";
    else if (projectedUnitsAtDate !== null && projectedUnitsAtDate > 0 && daysRemaining <= 90) risk = "at_risk";
    else if ((projectedUnitsAtDate !== null && projectedUnitsAtDate > 0 && daysRemaining <= 180) || daysRemaining <= 60) risk = "monitor";
    else risk = "healthy";
  }

  const recommendation = lot.quantityRemaining === 0
    ? "No units remain in this lot; retain the record for traceability."
    : risk === "expired"
    ? "Quarantine this lot and record an authorized expiry or waste adjustment before it can be sold."
    : risk === "urgent"
      ? "Sell this lot first. Review a transfer or targeted markdown and pause replenishment until the exposure is resolved."
      : risk === "at_risk"
        ? "Prioritize FEFO rotation and evaluate a transfer or targeted promotion using current margin and stock availability."
        : risk === "monitor"
          ? "Keep this lot in FEFO rotation and review its sell-through at the next shelf-life checkpoint."
          : risk === "healthy"
            ? "Continue normal FEFO rotation; no shelf-life intervention is supported by current evidence."
            : "Add an expiration or best-before date if this product has a shelf-life constraint.";

  const evidence = [
    `${lot.quantityRemaining} units remain at ${lot.locationRef}.`,
    daysRemaining === null ? "No expiration or best-before date is recorded." : `${daysRemaining} days remain until ${tracked?.kind === "expiration" ? "expiration" : "best before"}.`,
    monthlyVelocity === null
      ? "Sales history is insufficient for a depletion forecast."
      : `${monthlyVelocity} units/month based on ${Math.min(30, lot.demandHistoryDays)} days of recorded SKU movement.`,
    projectedUnitsAtDate === null
      ? "Projected units at the shelf-life date are unavailable."
      : `${projectedUnitsAtDate} units are projected to remain at the shelf-life date.`,
  ];

  return {
    risk,
    trackedDate: tracked?.value ?? null,
    trackedDateKind: tracked?.kind ?? null,
    daysRemaining,
    monthlyVelocity,
    projectedUnitsAtDate,
    inventoryCostAtRiskCents,
    grossMarginOpportunityAtRiskCents,
    confidence,
    recommendation,
    evidence,
  };
}

export function fefoSort<T extends InventoryLotEvidence>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) => {
    const aDate = [a.expirationDate, a.bestBeforeDate].filter(Boolean).sort()[0] ?? "9999-12-31";
    const bDate = [b.expirationDate, b.bestBeforeDate].filter(Boolean).sort()[0] ?? "9999-12-31";
    return aDate.localeCompare(bDate) || a.receivedDate.localeCompare(b.receivedDate) || a.id.localeCompare(b.id);
  });
}
