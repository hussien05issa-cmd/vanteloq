import { isCalendarDate } from "./calendar-date";
import { exactSum } from "./executive-metrics";

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
  | "dated_statement_cash"
  | "foreign_currency_obligations"
  | "undated_purchase_commitments"
  | "obligation_review_required";

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
  obligationReviewBlocks?: readonly string[];
}) {
  if (!isCalendarDate(input.asOf) || input.actualTransactions.some(item => !isCalendarDate(item.postingDate))
    || input.forecastItems.some(item => !isCalendarDate(item.dueDate))) throw new Error("Cash forecasts require valid calendar dates.");
  if (new Set(input.forecastItems.map(item => item.id)).size !== input.forecastItems.length) throw new Error("Duplicate cash forecast obligations require review.");
  for (const amount of [input.safetyThresholdCents, ...(input.openingCashCents === null ? [] : [input.openingCashCents]),
    ...(input.confirmedPurchasingObligationsCents == null ? [] : [input.confirmedPurchasingObligationsCents]),
    ...input.actualTransactions.map(item => item.amountCents), ...input.forecastItems.map(item => item.amountCents)]) {
    if (!Number.isSafeInteger(amount)) throw new Error("Cash forecasts require exact integer amounts within safe precision.");
  }
  if (input.forecastItems.some(item => item.amountCents < 0)) throw new Error("Cash forecast item amounts must be nonnegative; use the direction for outflows.");
  const obligationReviewBlocks = [...new Set(input.obligationReviewBlocks ?? [])];
  const decisionBlocks = [...new Set<CashFlowDecisionBlock>([
    ...(input.decisionBlocks ?? []),
    ...(obligationReviewBlocks.length ? ["obligation_review_required" as const] : []),
  ])];
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
    const actualInflowCents = exactSum(weekActuals.map(item => Math.max(0, item.amountCents)));
    const actualOutflowCents = exactSum(weekActuals.map(item => Math.max(0, -item.amountCents)));
    const actualNetCents = exactSum([actualInflowCents, -actualOutflowCents]);
    const items = input.forecastItems.filter((item) => {
      const effectiveDueDate = item.dueDate < input.asOf ? input.asOf : item.dueDate;
      return effectiveDueDate >= weekStart && effectiveDueDate <= weekEnd;
    });
    const confirmedNetCents = exactSum(items.filter(item => item.certainty === "confirmed").map(item => signed(item.direction, item.amountCents)));
    const expectedNetCents = exactSum(items.filter(item => item.certainty === "expected").map(item => signed(item.direction, item.amountCents)));
    if (conservative !== null) conservative = exactSum([conservative, confirmedNetCents]);
    if (planning !== null) planning = exactSum([planning, confirmedNetCents, expectedNetCents]);
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
  const confirmedOutflows = exactSum(input.forecastItems
    .filter(item => item.certainty === "confirmed" && item.direction === "out" && item.dueDate <= weeks.at(-1)!.weekEnd)
    .map(item => item.amountCents));
  const actualInflowCents = exactSum(weeks.map(week => week.actualInflowCents));
  const actualOutflowCents = exactSum(weeks.map(week => week.actualOutflowCents));
  const actualNetChangeCents = exactSum([actualInflowCents, -actualOutflowCents]);
  const excludedCurrencyItemCount = Math.max(0, input.excludedCurrencyItemCount ?? 0);
  const undatedCommittedItemCount = Math.max(0, input.undatedCommittedItemCount ?? 0);
  const currencyReviewRequired = decisionBlocks.includes("foreign_currency_obligations") || excludedCurrencyItemCount > 0;
  const commitmentDateRequired = decisionBlocks.includes("undated_purchase_commitments") || undatedCommittedItemCount > 0;
  const cashSourceRefreshRequired = decisionBlocks.includes("dated_statement_cash");
  const obligationReviewRequired = decisionBlocks.includes("obligation_review_required");
  const capacityStatus = decisionOpeningCashCents === null
    ? "unavailable" as const
    : cashSourceRefreshRequired
      ? "source_refresh_required" as const
    : currencyReviewRequired
      ? "currency_review_required" as const
      : commitmentDateRequired
        ? "commitment_date_required" as const
        : obligationReviewRequired
          ? "obligation_review_required" as const
          : "available" as const;
  const confirmedPurchasingObligationsCents = input.confirmedPurchasingObligationsCents === undefined
    ? confirmedOutflows
    : input.confirmedPurchasingObligationsCents;
  const unreservedCashCents = capacityStatus !== "available" || confirmedPurchasingObligationsCents === null
    ? null
    : exactSum([decisionOpeningCashCents!, -Math.max(0, input.safetyThresholdCents), -Math.max(0, confirmedPurchasingObligationsCents)]);
  const purchasingCapacityCents = unreservedCashCents === null ? null : Math.max(0, unreservedCashCents);
  const fundingShortfallCents = unreservedCashCents === null ? null : Math.max(0, -unreservedCashCents);
  return {
    status: decisionOpeningCashCents === null
      ? "unavailable" as const
      : currencyReviewRequired || commitmentDateRequired || obligationReviewRequired
        ? "needs_review" as const
        : "available" as const,
    asOf: input.asOf,
    openingCashCents: decisionOpeningCashCents,
    observedOpeningCashCents: input.openingCashCents,
    actualPeriodOpeningCashCents: input.openingCashCents === null ? null : exactSum([input.openingCashCents, -actualNetChangeCents]),
    actualPeriodClosingCashCents: input.openingCashCents,
    actualInflowCents,
    actualOutflowCents,
    actualNetChangeCents,
    safetyThresholdCents: Math.max(0, input.safetyThresholdCents),
    purchasingCapacityCents,
    unreservedCashCents,
    fundingShortfallCents,
    capacityStatus,
    confirmedPurchasingObligationsCents,
    reservedPurchasingObligationsCents: confirmedPurchasingObligationsCents,
    decisionBlocks,
    obligationReviewBlocks,
    excludedCurrencyItemCount,
    undatedCommittedItemCount,
    cashSourceRefreshRequired,
    weeks,
    boundary: cashSourceRefreshRequired
      ? "This scenario starts from the separately labelled reconciled statement cutoff, not current available bank cash. Unobserved subsequent cash movements are not estimated. Current purchasing capacity is withheld until bank coverage is refreshed. Expected receipts never increase purchasing authority."
      : "Opening cash is the separately labelled source balance. Actual movements are shown for context and are not added to that balance again. Recorded bills, purchase orders and the safety reserve reduce purchasing capacity; expected receipts never increase it. Conflicting, foreign-currency or undated obligations block purchasing capacity until reviewed. A zero purchasing capacity can represent a funding shortfall or cash fully reserved, not proof that obligations are covered.",
  };
}

export type ThirteenWeekCashFlow = ReturnType<typeof buildThirteenWeekCashFlow>;
