/** Reproducible checks, not an opinion on completeness or accounting compliance. */
export type FinancialReviewStatements = {
  trialBalance?: { totalDebitCents?: number | null; totalCreditCents?: number | null };
  balanceSheet?: { assetCents?: number | null; liabilityCents?: number | null; equityCents?: number | null };
  profitAndLoss?: { revenueCents?: number | null; expenseCents?: number | null; cogsCents?: number | null; grossProfitCents?: number | null; operatingProfitCents?: number | null };
};

function exactDifference(values: (number | null | undefined)[]) {
  if (!values.every(Number.isSafeInteger)) return null;
  const result = values.slice(1).reduce<bigint>((sum, value) => sum - BigInt(value!), BigInt(values[0]!));
  return result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(result);
}

export function financialRatioBasisPoints(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator! <= 0) return null;
  const n = BigInt(numerator!) * BigInt(10_000), d = BigInt(denominator!);
  const rounded = (n < BigInt(0) ? -BigInt(1) : BigInt(1)) * (((n < BigInt(0) ? -n : n) + d / BigInt(2)) / d);
  return rounded > BigInt(Number.MAX_SAFE_INTEGER) || rounded < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(rounded);
}

export function buildFinancialReview(statements: FinancialReviewStatements | null | undefined, available: boolean) {
  const s = available ? statements : null, p = s?.profitAndLoss;
  const definitions = [
    { id: "trial_balance", label: "Debits equal credits", formula: "Debits − credits", values: [s?.trialBalance?.totalDebitCents, s?.trialBalance?.totalCreditCents] },
    { id: "balance_sheet", label: "Assets equal liabilities plus equity", formula: "Assets − liabilities − equity", values: [s?.balanceSheet?.assetCents, s?.balanceSheet?.liabilityCents, s?.balanceSheet?.equityCents] },
    { id: "gross_profit", label: "Gross profit reconciles", formula: "Revenue − cost of goods sold − gross profit", values: [p?.revenueCents, p?.cogsCents, p?.grossProfitCents] },
    { id: "recorded_earnings", label: "Recorded earnings reconcile", formula: "Revenue − recorded expenses − recorded earnings", values: [p?.revenueCents, p?.expenseCents, p?.operatingProfitCents] },
  ];
  const checks = definitions.map(({ values, ...definition }) => {
    const differenceCents = exactDifference(values);
    return { ...definition, differenceCents, status: differenceCents === null ? "unavailable" as const : differenceCents === 0 ? "balanced" as const : "needs_review" as const };
  });
  return {
    status: checks.some(check => check.status === "needs_review") ? "needs_review" as const : checks.every(check => check.status === "balanced") ? "balanced" as const : "unavailable" as const,
    checks,
    grossMarginBasisPoints: financialRatioBasisPoints(p?.grossProfitCents, p?.revenueCents),
    recordedEarningsMarginBasisPoints: financialRatioBasisPoints(p?.operatingProfitCents, p?.revenueCents),
    boundary: "Cumulative posted ledger balances. Balanced checks do not establish complete records, bank reconciliation, tax accuracy or an audit opinion. Recorded earnings include only the expenses entered in the ledger.",
  };
}
