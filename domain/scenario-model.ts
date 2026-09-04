export type ScenarioInputs = {
  sales: number; margin: number; fixed: number; labour: number;
  salesChange: number; marginChange: number; costChange: number; aov: number;
};

/** A period-based sensitivity model. It does not post entries or predict demand. */
export function calculateScenario(input: ScenarioInputs) {
  if (Object.values(input).some(value => !Number.isFinite(value))) {
    throw new Error("Enter a valid number in every field.");
  }
  if (input.sales < 0 || input.fixed < 0 || input.labour < 0 || input.aov < 0) {
    throw new Error("Sales, baseline costs and average transaction cannot be negative.");
  }
  if (input.margin < 0 || input.margin > 100 || input.margin + input.marginChange < 0 || input.margin + input.marginChange > 100) {
    throw new Error("The baseline and adjusted gross margin must be between 0% and 100%.");
  }
  if (input.salesChange < -100) throw new Error("Sales cannot decrease by more than 100%.");
  const projectedSales = input.sales * (1 + input.salesChange / 100);
  const projectedMargin = input.margin + input.marginChange;
  const projectedFixed = input.fixed + input.labour + input.costChange;
  if (projectedFixed < 0) throw new Error("The cost adjustment cannot make total operating costs negative.");
  const grossProfit = projectedSales * projectedMargin / 100;
  const baselineProfit = input.sales * input.margin / 100 - input.fixed - input.labour;
  const profit = grossProfit - projectedFixed;
  // At zero margin, sales cannot cover a positive cost base. Zero is misleading.
  const breakEven = projectedMargin > 0 ? projectedFixed / (projectedMargin / 100) : projectedFixed === 0 ? 0 : null;
  const transactions = breakEven === null || input.aov <= 0 ? null : Math.ceil(breakEven / input.aov);
  const results = [projectedSales, grossProfit, projectedFixed, baselineProfit, profit, breakEven, transactions].filter(value => value !== null);
  if (results.some(value => !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100)) {
    throw new Error("These inputs exceed the supported calculation range. Enter smaller amounts.");
  }
  return { projectedSales, projectedMargin, projectedFixed, grossProfit, baselineProfit, profit, profitChange: profit - baselineProfit, breakEven, transactions };
}
