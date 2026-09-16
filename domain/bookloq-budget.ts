export function budgetControl(budget: {
  actualCents?: number | null; budgetCents: number; committedCents: number;
  forecastCents: number; accountType: string;
}) {
  const value = Number.isSafeInteger(budget.actualCents) ? budget.actualCents! : null;
  if (value === null) return { value, projected: null, variance: null, utilization: null };
  const projected = Math.max(value + budget.committedCents, budget.forecastCents);
  const compared = budget.accountType === "revenue" ? value : projected;
  return {
    value, projected,
    variance: budget.accountType === "revenue" ? compared - budget.budgetCents : budget.budgetCents - compared,
    utilization: budget.budgetCents > 0 ? Math.round(compared * 10_000 / budget.budgetCents) : null,
  };
}

export function bookloqReportHeadings(report: string) {
  return report === "trial" ? ["Code", "Account", "Debits", "Credits"] : ["Code", "Account", "Type", "Balance"];
}
