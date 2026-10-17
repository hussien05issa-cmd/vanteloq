import { isCalendarDate } from "./calendar-date";

type NumericInput = string | number | null | undefined;
export type PlanningToolError = { field: string; message: string };
type Calculation<T> = { value: T | null; errors: PlanningToolError[] };

export const PLANNING_TOOL_LIMITS = {
  money: 100_000_000,
  dailyCost: 100_000,
  weeks: 13,
  entries: 52,
  annualRate: 100,
  days: 3650,
} as const;

export type CashPlanEntry = {
  id: string; label: string; date: string; kind: "receipt" | "obligation"; amount: NumericInput;
};
export type CashOrderPlanInput = {
  asOfDate: string; openingCash: NumericInput; reconciled: boolean; horizonWeeks: NumericInput;
  minimumBuffer: NumericInput; orderAmount: NumericInput; paymentWeek: NumericInput;
  entries: readonly CashPlanEntry[];
};
export type CashPlanWeek = {
  week: number; startDate: string; endDate: string; receiptsCents: number; obligationsCents: number;
  orderPaymentCents: number; baselineOpeningCents: number; baselineClosingCents: number;
  scenarioOpeningCents: number; scenarioClosingCents: number;
};
export type CashOrderPlan = {
  asOfDate: string; openingCashCents: number; minimumBufferCents: number; orderAmountCents: number;
  paymentWeek: number; weeks: CashPlanWeek[]; entries: (Omit<CashPlanEntry, "amount"> & { amountCents: number })[];
  baselineLowestCents: number; scenarioLowestCents: number; baselineLowestWeek: number; scenarioLowestWeek: number;
  baselineBufferGapCents: number; scenarioBufferGapCents: number;
  baselineShortfallCents: number; scenarioShortfallCents: number;
};
export type VehicleHoldingCostInput = {
  asOfDate: string; financedBalance: NumericInput; annualRate: NumericInput; days: NumericInput;
  dailyStorage: NumericInput; dailyOther: NumericInput; recordedCosts: NumericInput;
};
export type VehicleHoldingCost = {
  asOfDate: string; endDate: string; financedBalanceCents: number; annualRate: number; days: number;
  dailyStorageCents: number; dailyOtherCents: number; recordedCostsCents: number;
  financingCents: number; dailyCostCents: number; estimatedAdditionalCents: number;
};

// Parse decimal text into integer units. Blank, nonfinite, signed, exponential and
// excessive-precision inputs cannot become zero or enter the arithmetic.
function units(input: NumericInput, precision: number, maximum: number, field: string, label: string, errors: PlanningToolError[]) {
  const raw = typeof input === "number" && Number.isFinite(input) ? String(input) : typeof input === "string" ? input.trim() : "";
  const pattern = precision ? new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`) : /^\d+$/;
  if (!pattern.test(raw) || raw.length > 24) {
    errors.push({ field, message: `Enter ${label} as a nonnegative ${precision ? `number with at most ${precision} decimal places` : "whole number"}. Zero is allowed.` });
    return null;
  }
  const [whole, fraction = ""] = raw.split(".");
  const parsed = BigInt(whole) * BigInt(10 ** precision) + BigInt(fraction.padEnd(precision, "0") || "0");
  if (parsed > BigInt(maximum) * BigInt(10 ** precision)) {
    errors.push({ field, message: `${label[0].toUpperCase()}${label.slice(1)} must be no more than ${maximum.toLocaleString("en-CA")}.` });
    return null;
  }
  return Number(parsed);
}

function calendarDate(input: string, field: string, errors: PlanningToolError[]) {
  if (!isCalendarDate(input) || input < "1900-01-01" || input > "2100-12-31") {
    errors.push({ field, message: "Enter a valid date from 1900 through 2100." });
    return null;
  }
  return input;
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function calculateCashOrderPlan(input: CashOrderPlanInput): Calculation<CashOrderPlan> {
  const errors: PlanningToolError[] = [];
  const asOfDate = calendarDate(input.asOfDate, "asOfDate", errors);
  const openingCashCents = units(input.openingCash, 2, PLANNING_TOOL_LIMITS.money, "openingCash", "opening cash (CAD)", errors);
  const minimumBufferCents = units(input.minimumBuffer, 2, PLANNING_TOOL_LIMITS.money, "minimumBuffer", "minimum cash buffer (CAD)", errors);
  const orderAmountCents = units(input.orderAmount, 2, PLANNING_TOOL_LIMITS.money, "orderAmount", "proposed order payment (CAD)", errors);
  const horizonWeeks = units(input.horizonWeeks, 0, PLANNING_TOOL_LIMITS.weeks, "horizonWeeks", "planning weeks", errors);
  const paymentWeek = units(input.paymentWeek, 0, PLANNING_TOOL_LIMITS.weeks, "paymentWeek", "payment week", errors);
  if (input.reconciled !== true) errors.push({ field: "reconciled", message: "Confirm that the opening cash agrees with your reconciled records as of the selected date." });
  if (horizonWeeks === 0) errors.push({ field: "horizonWeeks", message: "Choose a horizon from 1 to 13 weeks." });
  if (paymentWeek === 0 || (paymentWeek !== null && horizonWeeks !== null && paymentWeek > horizonWeeks)) errors.push({ field: "paymentWeek", message: "Choose a payment week within the planning horizon." });
  const lastDate = asOfDate && horizonWeeks ? addDays(asOfDate, horizonWeeks * 7) : null;
  if (lastDate && lastDate > "2100-12-31") errors.push({ field: "asOfDate", message: "Choose a date whose entire planning horizon ends by December 31, 2100." });
  if (!Array.isArray(input.entries) || input.entries.length > PLANNING_TOOL_LIMITS.entries) {
    errors.push({ field: "entries", message: "Use no more than 52 dated receipt and obligation rows." });
  }
  const seen = new Set<string>();
  const entries: CashOrderPlan["entries"] = [];
  for (const [index, entry] of (Array.isArray(input.entries) ? input.entries : []).entries()) {
    const prefix = `entries.${index}`;
    if (typeof entry.id !== "string" || !entry.id.trim() || seen.has(entry.id)) errors.push({ field: `${prefix}.id`, message: "Each cash row requires a unique identifier." });
    seen.add(entry.id);
    const date = calendarDate(entry.date, `${prefix}.date`, errors);
    if (date && asOfDate && lastDate && (date <= asOfDate || date > lastDate)) errors.push({ field: `${prefix}.date`, message: `Date must be after ${asOfDate} and on or before ${lastDate}. Opening cash already includes earlier movements.` });
    const amountCents = units(entry.amount, 2, PLANNING_TOOL_LIMITS.money, `${prefix}.amount`, "row amount (CAD)", errors);
    if (entry.kind !== "receipt" && entry.kind !== "obligation") errors.push({ field: `${prefix}.kind`, message: "Choose receipt or obligation." });
    if (typeof entry.label !== "string" || entry.label.length > 100) errors.push({ field: `${prefix}.label`, message: "Keep the optional description to 100 characters." });
    if (date && amountCents !== null) entries.push({ id: entry.id, label: entry.label, date, kind: entry.kind, amountCents });
  }
  if (errors.length || asOfDate === null || openingCashCents === null || minimumBufferCents === null || orderAmountCents === null || horizonWeeks === null || paymentWeek === null) return { value: null, errors };

  let baseline = openingCashCents, scenario = openingCashCents;
  let baselineLowestCents = openingCashCents, scenarioLowestCents = openingCashCents;
  let baselineLowestWeek = 0, scenarioLowestWeek = 0;
  const weeks = Array.from({ length: horizonWeeks }, (_, index) => {
    const week = index + 1, startDate = addDays(asOfDate, index * 7 + 1), endDate = addDays(asOfDate, week * 7);
    const scheduled = entries.filter(entry => entry.date >= startDate && entry.date <= endDate);
    const receiptsCents = scheduled.filter(entry => entry.kind === "receipt").reduce((sum, entry) => sum + entry.amountCents, 0);
    const obligationsCents = scheduled.filter(entry => entry.kind === "obligation").reduce((sum, entry) => sum + entry.amountCents, 0);
    const orderPaymentCents = week === paymentWeek ? orderAmountCents : 0;
    const baselineOpeningCents = baseline, scenarioOpeningCents = scenario;
    baseline += receiptsCents - obligationsCents;
    scenario += receiptsCents - obligationsCents - orderPaymentCents;
    if (baseline < baselineLowestCents) { baselineLowestCents = baseline; baselineLowestWeek = week; }
    if (scenario < scenarioLowestCents) { scenarioLowestCents = scenario; scenarioLowestWeek = week; }
    return { week, startDate, endDate, receiptsCents, obligationsCents, orderPaymentCents, baselineOpeningCents, baselineClosingCents: baseline, scenarioOpeningCents, scenarioClosingCents: scenario };
  });
  const baselineBufferGapCents = baselineLowestCents - minimumBufferCents, scenarioBufferGapCents = scenarioLowestCents - minimumBufferCents;
  return { value: { asOfDate, openingCashCents, minimumBufferCents, orderAmountCents, paymentWeek, weeks, entries,
    baselineLowestCents, scenarioLowestCents, baselineLowestWeek, scenarioLowestWeek,
    baselineBufferGapCents, scenarioBufferGapCents,
    baselineShortfallCents: Math.max(0, -baselineBufferGapCents), scenarioShortfallCents: Math.max(0, -scenarioBufferGapCents) }, errors };
}

export function calculateVehicleHoldingCost(input: VehicleHoldingCostInput): Calculation<VehicleHoldingCost> {
  const errors: PlanningToolError[] = [];
  const asOfDate = calendarDate(input.asOfDate, "asOfDate", errors);
  const financedBalanceCents = units(input.financedBalance, 2, PLANNING_TOOL_LIMITS.money, "financedBalance", "financed balance (CAD)", errors);
  const rateUnits = units(input.annualRate, 4, PLANNING_TOOL_LIMITS.annualRate, "annualRate", "annual interest rate (%)", errors);
  const days = units(input.days, 0, PLANNING_TOOL_LIMITS.days, "days", "holding days", errors);
  const dailyStorageCents = units(input.dailyStorage, 2, PLANNING_TOOL_LIMITS.dailyCost, "dailyStorage", "daily storage cost (CAD)", errors);
  const dailyOtherCents = units(input.dailyOther, 2, PLANNING_TOOL_LIMITS.dailyCost, "dailyOther", "other daily costs (CAD)", errors);
  const recordedCostsCents = units(input.recordedCosts, 2, PLANNING_TOOL_LIMITS.money, "recordedCosts", "recorded holding costs (CAD)", errors);
  const endDate = asOfDate && days !== null ? addDays(asOfDate, days) : null;
  if (endDate && endDate > "2100-12-31") errors.push({ field: "asOfDate", message: "Choose a date whose holding period ends by December 31, 2100." });
  if (errors.length || asOfDate === null || endDate === null || financedBalanceCents === null || rateUnits === null || days === null || dailyStorageCents === null || dailyOtherCents === null || recordedCostsCents === null) return { value: null, errors };
  // Integer rational calculation preserves half-cent boundaries, even at limits.
  const numerator = BigInt(financedBalanceCents) * BigInt(rateUnits) * BigInt(days);
  const denominator = BigInt(100 * 10000 * 365);
  const financingCents = Number((numerator + denominator / BigInt(2)) / denominator);
  const dailyCostCents = (dailyStorageCents + dailyOtherCents) * days;
  return { value: { asOfDate, endDate, financedBalanceCents, annualRate: rateUnits / 10000, days, dailyStorageCents, dailyOtherCents, recordedCostsCents,
    financingCents, dailyCostCents, estimatedAdditionalCents: financingCents + dailyCostCents }, errors };
}

function dollars(cents: number) { return (cents / 100).toFixed(2); }
function csv(rows: (string | number)[][]) {
  return rows.map(row => row.map(value => {
    let cell = String(value);
    // User descriptions are text, never executable spreadsheet formulas.
    if (typeof value === "string" && /^\s*[=+@-]/.test(cell) && !/^-\d+(\.\d+)?$/.test(cell)) cell = `'${cell}`;
    return `"${cell.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}

export function cashOrderPlanCsv(input: CashOrderPlanInput): string | null {
  const value = calculateCashOrderPlan(input).value;
  if (!value) return null;
  return csv([
    ["section", "as_of_date", "description", "date_or_week", "amount_CAD", "method"],
    ["model", value.asOfDate, "Manual scenario; opening cash confirmed reconciled by user", "", "", "opening cash + receipts - obligations - proposed order payment"],
    ["assumption", value.asOfDate, "Opening cash", value.asOfDate, dollars(value.openingCashCents), "Opening balance is included in the lowest-balance comparison"],
    ["assumption", value.asOfDate, "Minimum buffer", "", dollars(value.minimumBufferCents), "Buffer gap = lowest cash - minimum buffer"],
    ["assumption", value.asOfDate, "Proposed order payment", value.paymentWeek, dollars(value.orderAmountCents), "Single cash payment in selected week"],
    ...value.entries.map(entry => [entry.kind, value.asOfDate, entry.label, entry.date, dollars(entry.amountCents), "User-entered cash timing assumption"]),
    ...value.weeks.flatMap(week => [
      ["baseline", value.asOfDate, `Week ${week.week} closing cash`, week.endDate, dollars(week.baselineClosingCents), `${dollars(week.baselineOpeningCents)} + ${dollars(week.receiptsCents)} - ${dollars(week.obligationsCents)}`],
      ["with_order", value.asOfDate, `Week ${week.week} closing cash`, week.endDate, dollars(week.scenarioClosingCents), `${dollars(week.scenarioOpeningCents)} + ${dollars(week.receiptsCents)} - ${dollars(week.obligationsCents)} - ${dollars(week.orderPaymentCents)}`],
    ]),
    ["result", value.asOfDate, "Lowest balance before order", value.baselineLowestWeek ? `Week ${value.baselineLowestWeek}` : "Opening", dollars(value.baselineLowestCents), "Minimum of opening cash and every weekly closing balance"],
    ["result", value.asOfDate, "Lowest balance with order", value.scenarioLowestWeek ? `Week ${value.scenarioLowestWeek}` : "Opening", dollars(value.scenarioLowestCents), "Minimum of opening cash and every weekly closing balance"],
  ]);
}

export function vehicleHoldingCostCsv(input: VehicleHoldingCostInput): string | null {
  const value = calculateVehicleHoldingCost(input).value;
  if (!value) return null;
  return csv([
    ["section", "as_of_date", "description", "value", "unit", "method"],
    ["assumption", value.asOfDate, "Financed balance", dollars(value.financedBalanceCents), "CAD", "Outstanding financed principal, not the vehicle purchase price"],
    ["assumption", value.asOfDate, "Annual interest rate", value.annualRate, "percent", "Constant simple annual rate"],
    ["assumption", value.asOfDate, "Additional holding days", value.days, "days", `Period ends ${value.endDate}`],
    ["assumption", value.asOfDate, "Daily storage", dollars(value.dailyStorageCents), "CAD/day", "Constant daily cost"],
    ["assumption", value.asOfDate, "Other daily costs", dollars(value.dailyOtherCents), "CAD/day", "Constant daily cost"],
    ["recorded", value.asOfDate, "Recorded holding costs to date", dollars(value.recordedCostsCents), "CAD", "Historical user-entered costs; separate from the future estimate"],
    ["estimate", value.asOfDate, "Financing", dollars(value.financingCents), "CAD", "financed balance * annual rate / 100 * days / 365; nearest cent"],
    ["estimate", value.asOfDate, "Daily costs", dollars(value.dailyCostCents), "CAD", "(daily storage + other daily costs) * days"],
    ["estimate", value.asOfDate, "Additional holding cost", dollars(value.estimatedAdditionalCents), "CAD", "financing estimate + daily costs; excludes recorded costs"],
  ]);
}
