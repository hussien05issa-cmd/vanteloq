const numericFields = ["currentCashCents", "availableCashCents", "bookBalanceCents", "revenueCents", "grossProfitCents", "operatingProfitCents", "totalExpensesCents", "accountsReceivableCents", "accountsPayableCents", "payrollObligationsCents", "debtObligationsCents", "upcomingBillsCount", "overdueInvoicesCount", "unreconciledCount", "uncategorizedCount"] as const;

import { buildFinancialReview, type FinancialReviewStatements } from "./financial-review.ts";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function numericProjection<K extends string>(value: unknown, keys: readonly K[]): Record<K, number | null> {
  const source = record(value);
  return Object.fromEntries(keys.map(key => [key, Number.isSafeInteger(source[key]) ? source[key] as number : null])) as Record<K, number | null>;
}
function safeDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function projectCashOutlook(value: unknown) {
  const source = record(value), asOf = safeDate(source.asOf);
  if (!asOf || (source.status !== "available" && source.status !== "needs_review")) return { status: "unavailable" as const };
  const weeks = Array.isArray(source.weeks) && source.weeks.length === 13 ? source.weeks.map(raw => {
    const week = record(raw);
    return { weekStart: safeDate(week.weekStart), weekEnd: safeDate(week.weekEnd), ...numericProjection(week, ["confirmedNetCents", "expectedNetCents", "conservativeClosingCashCents", "planningClosingCashCents"]) };
  }) : [];
  if (weeks.length !== 13 || weeks.some((week, index) => !week.weekStart || !week.weekEnd || week.conservativeClosingCashCents === null || Date.parse(week.weekEnd) - Date.parse(week.weekStart) !== 6 * 86_400_000 || (index > 0 && Date.parse(week.weekStart) - Date.parse(weeks[index - 1].weekEnd!) !== 86_400_000))) return { status: "unavailable" as const };
  const minimum = weeks.reduce((lowest, week) => week.conservativeClosingCashCents! < lowest.conservativeClosingCashCents! ? week : lowest);
  const threshold = numericProjection(source, ["safetyThresholdCents"]).safetyThresholdCents;
  const firstBreach = threshold === null ? null : weeks.find(week => week.conservativeClosingCashCents! < threshold);
  const blocks = ["foreign_currency_obligations", "undated_purchase_commitments"];
  return { status: source.status, asOf, ...numericProjection(source, ["openingCashCents", "safetyThresholdCents", "confirmedPurchasingObligationsCents"]),
    purchasingCapacityCents: source.capacityStatus === "available" ? numericProjection(source, ["purchasingCapacityCents"]).purchasingCapacityCents : null,
    decisionBlocks: Array.isArray(source.decisionBlocks) ? source.decisionBlocks.filter(item => typeof item === "string" && blocks.includes(item)) : [], weeks,
    minimumConservativeCashCents: minimum.conservativeClosingCashCents, minimumCashWeekEnd: minimum.weekEnd, firstSafetyBreachWeekEnd: firstBreach?.weekEnd ?? null,
    boundary: "Weekly scenarios from recorded obligations. Conservative includes confirmed cash movements; planning also includes expected movements. Expected receipts never increase purchasing capacity. No supplier, invoice, bank or employee identifiers are included." };
}

function safeTimestamp(value: unknown) {
  const milliseconds = typeof value === "number" && Number.isFinite(value) ? (value < 1e11 ? value * 1000 : value) : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds < 8.64e15 ? new Date(milliseconds).toISOString() : null;
}

/** Allowlist only. Never forward the underlying BookLoQ response to an AI. */
export function projectAdvisorBookloq(payload: unknown) {
  const data = (payload as { bookloq?: { settings?: { status?: string; dataMode?: string; baseCurrency?: string }; ledgerAccess?: { available?: boolean }; summary?: Record<string, unknown> } } | null)?.bookloq;
  const source = record(data), statements = record(source.statements);
  const activity = record(source.cashActivity);
  const activityAllowed = record(source.transactionAccess).available === true;
  const cashActivity = activityAllowed ? ["days30", "days90", "months12"].map(key => {
    const period = record(activity[key]);
    return { period: key, startDate: safeDate(period.startDate), endDate: safeDate(period.endDate), ...numericProjection(period, ["transactionCount", "inflowCents", "outflowCents", "netCashFlowCents", "categorizedBasisPoints", "matchedBasisPoints"]) };
  }).filter(period => period.startDate && period.endDate && (period.transactionCount ?? 0) > 0) : [];
  const liveCashOnly = source.configured === true && cashActivity.length > 0 && !data?.settings;
  if (!data || (!liveCashOnly && (data.settings?.status !== "active" || data.settings?.dataMode !== "live"))) return { status: "unavailable", reason: "Configured live BookLoQ evidence is required. Demonstration data is excluded." };
  const values = Object.fromEntries(numericFields.map(key => [key, typeof data.summary?.[key] === "number" && Number.isSafeInteger(data.summary[key]) ? data.summary[key] : null]));
  const aggregates = data.ledgerAccess?.available === true ? {
    trialBalance: numericProjection(statements.trialBalance, ["totalDebitCents", "totalCreditCents"]),
    balanceSheet: numericProjection(statements.balanceSheet, ["assetCents", "liabilityCents", "equityCents"]),
    profitAndLoss: numericProjection(statements.profitAndLoss, ["revenueCents", "expenseCents", "cogsCents", "grossProfitCents", "operatingProfitCents", "operatingRevenueCents", "operatingExpensesCents", "otherIncomeCents", "financeAndTaxCents", "netProfitCents"]),
  } : null;
  const currency = data.settings?.baseCurrency ?? record(source.organization).currency;
  return { status: "available", source: "BookLoQ permission-filtered summaries", scope: "organization", currency: typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : null, ledgerAvailable: data.ledgerAccess?.available === true, period: "Cumulative posted ledger balances as recorded; not the retail KPI date range", cashLastSyncAt: safeTimestamp(data.summary?.cashLastSyncAt), values,
    statements: aggregates, financialReview: buildFinancialReview(aggregates as FinancialReviewStatements | null, data.ledgerAccess?.available === true),
    cashOutlook: projectCashOutlook(source.thirteenWeekCashFlow),
    cashActivity,
    cashActivityBoundary: "Historical approved bank movements in each explicit reporting window. Reviewed statement imports may supply these totals when Plaid is not active. They are not income, expenses, a current balance or a formal cash-flow statement. Raw document contents and transaction descriptions are excluded.",
    limitations: "Null means unavailable or withheld. No raw transactions, identities or account identifiers are included. Ledger results do not prove that every real-world expense or obligation has been recorded. Do not add these balances to POS totals." };
}
