export type ThirteenWeekCashFlowItem = {
  id: string;
  dueDate: string;
  amountCents: number;
  direction: "in" | "out";
  certainty: "confirmed" | "expected";
  label: string;
};

export type CashFlowDecisionBlock =
  | "demonstration_data"
  | "bookloq_inactive"
  | "finance_permissions_required"
  | "bank_data_unavailable"
  | "foreign_currency_obligations"
  | "undated_purchase_commitments";

const DAY = 86_400_000;

function isoDate(milliseconds: number) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function mondayOnOrBefore(date: string) {
  const milliseconds = Date.parse(`${date}T00:00:00Z`);
  const day = new Date(milliseconds).getUTCDay();
  return isoDate(milliseconds - ((day + 6) % 7) * DAY);
}

function signed(direction: "in" | "out", amountCents: number) {
  return direction === "in" ? Math.max(0, amountCents) : -Math.max(0, amountCents);
}

export function buildThirteenWeekCashFlow(input: {
  asOf: string;
  openingCashCents: number | null;
  safetyThresholdCents: number;
  actualTransactions: readonly { postingDate: string; amountCents: number }[];
  forecastItems: readonly ThirteenWeekCashFlowItem[];
  excludedCurrencyItemCount?: number;
  undatedCommittedItemCount?: number;
  confirmedPurchasingObligationsCents?: number | null;
  decisionBlocks?: readonly CashFlowDecisionBlock[];
}) {
  const decisionBlocks = [...new Set(input.decisionBlocks ?? [])];
  const forecastUnavailable = decisionBlocks.some((block) =>
    block === "demonstration_data"
    || block === "bookloq_inactive"
    || block === "finance_permissions_required"
    || block === "bank_data_unavailable",
  );
  const decisionOpeningCashCents = forecastUnavailable ? null : input.openingCashCents;
  const firstWeekStart = mondayOnOrBefore(input.asOf);
  let conservative = decisionOpeningCashCents;
  let planning = decisionOpeningCashCents;
  const weeks = Array.from({ length: 13 }, (_, index) => {
    const weekStart = isoDate(Date.parse(`${firstWeekStart}T00:00:00Z`) + index * 7 * DAY);
    const weekEnd = isoDate(Date.parse(`${weekStart}T00:00:00Z`) + 6 * DAY);
    const weekActuals = input.actualTransactions
      .filter((item) => item.postingDate >= weekStart && item.postingDate <= weekEnd && item.postingDate <= input.asOf);
    const actualInflowCents = weekActuals.reduce((sum, item) => sum + Math.max(0, item.amountCents), 0);
    const actualOutflowCents = weekActuals.reduce((sum, item) => sum + Math.max(0, -item.amountCents), 0);
    const actualNetCents = actualInflowCents - actualOutflowCents;
    const items = input.forecastItems.filter((item) => {
      const effectiveDueDate = item.dueDate < input.asOf ? input.asOf : item.dueDate;
      return effectiveDueDate >= weekStart && effectiveDueDate <= weekEnd;
    });
    const confirmedNetCents = items.filter((item) => item.certainty === "confirmed").reduce((sum, item) => sum + signed(item.direction, item.amountCents), 0);
    const expectedNetCents = items.filter((item) => item.certainty === "expected").reduce((sum, item) => sum + signed(item.direction, item.amountCents), 0);
    if (conservative !== null) conservative += confirmedNetCents;
    if (planning !== null) planning += confirmedNetCents + expectedNetCents;
    return {
      index: index + 1,
      weekStart,
      weekEnd,
      actualInflowCents,
      actualOutflowCents,
      actualNetCents,
      confirmedNetCents,
      expectedNetCents,
      conservativeClosingCashCents: conservative,
      planningClosingCashCents: planning,
      itemCount: items.length,
      overdueItemCount: items.filter((item) => item.dueDate < input.asOf).length,
    };
  });
  const confirmedOutflows = input.forecastItems
    .filter((item) => item.certainty === "confirmed" && item.direction === "out" && item.dueDate <= weeks.at(-1)!.weekEnd)
    .reduce((sum, item) => sum + Math.max(0, item.amountCents), 0);
  const actualInflowCents = weeks.reduce((sum, week) => sum + week.actualInflowCents, 0);
  const actualOutflowCents = weeks.reduce((sum, week) => sum + week.actualOutflowCents, 0);
  const actualNetChangeCents = actualInflowCents - actualOutflowCents;
  const excludedCurrencyItemCount = Math.max(0, input.excludedCurrencyItemCount ?? 0);
  const undatedCommittedItemCount = Math.max(0, input.undatedCommittedItemCount ?? 0);
  const currencyReviewRequired = decisionBlocks.includes("foreign_currency_obligations") || excludedCurrencyItemCount > 0;
  const commitmentDateRequired = decisionBlocks.includes("undated_purchase_commitments") || undatedCommittedItemCount > 0;
  const capacityStatus = decisionOpeningCashCents === null
    ? "unavailable" as const
    : currencyReviewRequired
      ? "currency_review_required" as const
      : commitmentDateRequired
        ? "commitment_date_required" as const
        : "available" as const;
  const confirmedPurchasingObligationsCents = input.confirmedPurchasingObligationsCents === undefined
    ? confirmedOutflows
    : input.confirmedPurchasingObligationsCents;
  const purchasingCapacityCents = capacityStatus !== "available" || confirmedPurchasingObligationsCents === null
    ? null
    : Math.max(0, decisionOpeningCashCents! - Math.max(0, input.safetyThresholdCents) - Math.max(0, confirmedPurchasingObligationsCents));
  return {
    status: decisionOpeningCashCents === null
      ? "unavailable" as const
      : currencyReviewRequired || commitmentDateRequired
        ? "needs_review" as const
        : "available" as const,
    asOf: input.asOf,
    openingCashCents: decisionOpeningCashCents,
    observedOpeningCashCents: input.openingCashCents,
    actualPeriodOpeningCashCents: input.openingCashCents === null ? null : input.openingCashCents - actualNetChangeCents,
    actualPeriodClosingCashCents: input.openingCashCents,
    actualInflowCents,
    actualOutflowCents,
    actualNetChangeCents,
    safetyThresholdCents: Math.max(0, input.safetyThresholdCents),
    purchasingCapacityCents,
    capacityStatus,
    confirmedPurchasingObligationsCents,
    decisionBlocks,
    excludedCurrencyItemCount,
    undatedCommittedItemCount,
    weeks,
    boundary: "Opening cash is the verified balance as of the report date. Actual movements are shown for context and are not added to that balance again. Expected receipts never increase purchasing capacity. Foreign-currency or undated vendor commitments block purchasing capacity until reviewed.",
  };
}

export type ThirteenWeekCashFlow = ReturnType<typeof buildThirteenWeekCashFlow>;
