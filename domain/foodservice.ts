/** Reviewed operational calculations, not ledger postings or tax calculations.
 * Money is integer minor units. Decimal quantities never pass through Number. */
export type FoodMoney = { minor: number; currency: string };
export type FoodUnit = "g" | "kg" | "oz_mass" | "lb" | "ml" | "l" | "each";
export type FoodQuantity = { amount: string | null; unit: FoodUnit };
export type ExactFoodValue = { numerator: string; denominator: string };
export type FoodResult<T> = { status: "available"; value: T } | { status: "unavailable"; reason: "missing_input" | "zero_denominator" | "nonpositive_sales" | "negative_consumption" | "inconsistent_waste"; fields: string[] };
export class FoodserviceInputError extends Error {
  constructor(public field: string, message: string) { super(`${field}: ${message}`); this.name = "FoodserviceInputError"; }
}
type Fraction = { n: bigint; d: bigint };
const ZERO = BigInt(0), ONE = BigInt(1), MAX = BigInt(Number.MAX_SAFE_INTEGER);
const fail = (field: string, message: string): never => { throw new FoodserviceInputError(field, message); };
const available = <T>(value: T): FoodResult<T> => ({ status: "available", value });
const unavailable = (reason: "missing_input" | "zero_denominator" | "nonpositive_sales" | "negative_consumption" | "inconsistent_waste", ...fields: string[]): FoodResult<never> => ({ status: "unavailable", reason, fields });
function fraction(n: bigint, d = ONE): Fraction {
  if (d <= ZERO) throw Error("Positive rational denominator required.");
  let a = n < ZERO ? -n : n, b = d;
  while (b !== ZERO) { const r = a % b; a = b; b = r; }
  return { n: n / (a || ONE), d: d / (a || ONE) };
}
const add = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const multiply = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d);
const divide = (a: Fraction, b: Fraction) => fraction(a.n * b.d, a.d * b.n);
const exact = (v: Fraction): ExactFoodValue => ({ numerator: String(v.n), denominator: String(v.d) });
function safe(value: bigint, field: string) {
  if (value > MAX || value < -MAX) fail(field, "exceeds exact minor-unit precision");
  return Number(value);
}
/** Round once at the reporting boundary, ties away from zero. */
function rounded(value: Fraction, field: string) {
  const absolute = value.n < ZERO ? -value.n : value.n;
  return safe((value.n < ZERO ? -ONE : ONE) * ((absolute * BigInt(2) + value.d) / (value.d * BigInt(2))), field);
}
function decimal(value: unknown, field: string, positive = false): Fraction | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value)) fail(field, "use a nonnegative decimal string with at most six decimal places");
  const [whole, places = ""] = (value as string).split(".");
  const result = fraction(BigInt(whole + places), BigInt(10) ** BigInt(places.length));
  if (positive && result.n === ZERO) fail(field, "must be greater than zero");
  return result;
}
export function foodCurrency(value: string): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) fail("currency", "use an explicit three-letter uppercase currency code");
  return value;
}
export function foodCurrencyDigits(currency: string) { return new Intl.NumberFormat("en-CA", { style: "currency", currency: foodCurrency(currency) }).resolvedOptions().maximumFractionDigits ?? 2; }
export function foodAmountToMinor(value: string, currency: string): number | null {
  if (value === "") return null;
  const digits = foodCurrencyDigits(currency), pattern = new RegExp(`^-?(?:0|[1-9]\\d{0,11})${digits ? `(?:\\.\\d{1,${digits}})?` : ""}$`);
  if (!pattern.test(value)) fail("amount", `use a plain amount with at most ${digits} decimal places`);
  const negative = value.startsWith("-"), [whole, parts = ""] = (negative ? value.slice(1) : value).split(".");
  return safe((negative ? -ONE : ONE) * BigInt(whole + parts.padEnd(digits, "0")), "amount");
}
export function foodAmountText(minor: number | null, currency: string): string {
  if (minor === null) return "";
  if (!Number.isSafeInteger(minor)) fail("amount", "use safe integer minor units");
  const digits = foodCurrencyDigits(currency), absolute = String(Math.abs(minor)).padStart(digits + 1, "0");
  return (minor < 0 ? "-" : "") + (digits ? absolute.slice(0, -digits) + "." + absolute.slice(-digits) : absolute);
}
function money(value: FoodMoney | null | undefined, currency: string, field: string, nonnegative = true): bigint | null {
  if (value == null) return null;
  if (foodCurrency(value.currency) !== currency) fail(field, "currency differs from the reporting currency; convert under an explicit policy before calculation");
  if (!Number.isSafeInteger(value.minor) || nonnegative && value.minor < 0) fail(field, `must use ${nonnegative ? "nonnegative " : ""}safe integer minor units`);
  return BigInt(value.minor);
}
function count(value: number | null | undefined, field: string) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) fail(field, "must be a nonnegative safe integer");
  return BigInt(value);
}
function identifier(value: string, field: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 120) fail(field, "provide a nonempty identifier of at most 120 characters");
}
const units: Record<FoodUnit, { dimension: string; factor: Fraction }> = {
  g: { dimension: "mass", factor: fraction(ONE) }, kg: { dimension: "mass", factor: fraction(BigInt(1000)) },
  lb: { dimension: "mass", factor: fraction(BigInt(45359237), BigInt(100000)) },
  oz_mass: { dimension: "mass", factor: fraction(BigInt(45359237), BigInt(1600000)) },
  ml: { dimension: "volume", factor: fraction(ONE) }, l: { dimension: "volume", factor: fraction(BigInt(1000)) },
  each: { dimension: "count", factor: fraction(ONE) },
};
function unit(value: FoodUnit, field: string) {
  if (!Object.hasOwn(units, value)) fail(field, "unsupported or ambiguous unit");
  return units[value];
}
function quantity(value: FoodQuantity | null | undefined, field: string, positive = false) {
  if (value == null) return null;
  const definition = unit(value.unit, field + ".unit"), amount = decimal(value.amount, field + ".amount", positive);
  return amount === null ? null : { ...definition, base: multiply(amount, definition.factor) };
}
export function convertFoodQuantity(value: FoodQuantity | null, target: FoodUnit): FoodResult<ExactFoodValue & { unit: FoodUnit }> {
  const to = unit(target, "target"), from = quantity(value, "quantity");
  if (!from) return unavailable("missing_input", "quantity");
  if (from.dimension !== to.dimension) fail("quantity", "mass, volume and count require an explicit ingredient-specific conversion; none is inferred");
  return available({ ...exact(divide(from.base, to.factor)), unit: target });
}
export type FoodIngredient = {
  id: string; purchaseQuantity: FoodQuantity | null; purchaseCost: FoodMoney | null;
  recipeQuantity: FoodQuantity | null;
  /** Edible/prepared quantity divided by purchased quantity in compatible units.
   * May exceed 1 for a documented gain such as hydration. Never inferred. */
  preparationYield: string | null;
};
export type FoodRecipe = { currency: string; portions: string | null; ingredients: readonly FoodIngredient[] | null };
export type FoodRecipeCost = { currency: string; totalMinorExact: ExactFoodValue; perPortionMinorExact: ExactFoodValue; totalMinor: number; perPortionMinor: number };
function recipeFraction(recipe: FoodRecipe): FoodResult<{ currency: string; total: Fraction; perPortion: Fraction }> {
  const currency = foodCurrency(recipe.currency), portions = decimal(recipe.portions, "portions", true);
  const missing: string[] = portions === null ? ["portions"] : [];
  if (recipe.ingredients == null) return unavailable("missing_input", ...missing, "ingredients");
  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0 || recipe.ingredients.length > 100) fail("ingredients", "provide between 1 and 100 ingredient rows");
  const ids = new Set<string>(); let total = fraction(ZERO);
  for (const [index, row] of recipe.ingredients.entries()) {
    const field = `ingredients[${index}]`; identifier(row.id, field + ".id");
    if (ids.has(row.id)) fail(field + ".id", "duplicate ingredient row"); ids.add(row.id);
    const purchase = quantity(row.purchaseQuantity, field + ".purchaseQuantity", true);
    const use = quantity(row.recipeQuantity, field + ".recipeQuantity");
    const cost = money(row.purchaseCost, currency, field + ".purchaseCost");
    const yieldFactor = decimal(row.preparationYield, field + ".preparationYield", true);
    if (purchase && use && purchase.dimension !== use.dimension) fail(field + ".recipeQuantity", "purchase and recipe units must measure the same dimension");
    if (purchase === null) missing.push(field + ".purchaseQuantity");
    if (use === null) missing.push(field + ".recipeQuantity");
    if (cost === null) missing.push(field + ".purchaseCost");
    if (yieldFactor === null) missing.push(field + ".preparationYield");
    if (purchase && use && cost !== null && yieldFactor) total = add(total, divide(multiply(fraction(cost), use.base), multiply(purchase.base, yieldFactor)));
  }
  return missing.length ? unavailable("missing_input", ...missing) : available({ currency, total, perPortion: divide(total, portions!) });
}
export function costRecipe(recipe: FoodRecipe): FoodResult<FoodRecipeCost> {
  const result = recipeFraction(recipe);
  if (result.status !== "available") return result;
  const { currency, total, perPortion } = result.value;
  return available({ currency, totalMinorExact: exact(total), perPortionMinorExact: exact(perPortion), totalMinor: rounded(total, "recipe total"), perPortionMinor: rounded(perPortion, "portion cost") });
}
export type FoodProductionLine = { id: string; recipe: FoodRecipe; portions: string | null };
/** Supply a complete eligible menu/production cohort; zero activity is [], missing coverage is null.
 * Refunds do not restore consumed food. Use documented prepared portions, not signed refund quantities. */
export function theoreticalFoodCost(currencyInput: string, lines: readonly FoodProductionLine[] | null): FoodResult<FoodMoney & { exactMinor: ExactFoodValue }> {
  const currency = foodCurrency(currencyInput);
  if (lines === null) return unavailable("missing_input", "productionLines");
  if (!Array.isArray(lines) || lines.length > 1000) fail("productionLines", "at most 1000 lines per bounded calculation");
  let total = fraction(ZERO); const ids = new Set<string>(), missing: string[] = [];
  for (const [index, row] of lines.entries()) {
    identifier(row.id, `productionLines[${index}].id`);
    if (ids.has(row.id)) fail("productionLines", "duplicate production line"); ids.add(row.id);
    if (foodCurrency(row.recipe.currency) !== currency) fail("productionLines", "mixed recipe currencies");
    const portions = decimal(row.portions, `productionLines[${index}].portions`), recipe = recipeFraction(row.recipe);
    if (portions === null) missing.push(`productionLines[${index}].portions`);
    if (recipe.status === "unavailable") missing.push(...recipe.fields.map(field => `productionLines[${index}].${field}`));
    else if (portions !== null) total = add(total, multiply(recipe.value.perPortion, portions));
  }
  return missing.length ? unavailable("missing_input", ...missing) : available({ currency, minor: rounded(total, "theoretical food cost"), exactMinor: exact(total) });
}
export type FoodInventoryPeriod = {
  currency: string; opening: FoodMoney | null; purchases: FoodMoney | null; supplierCredits: FoodMoney | null;
  transfersIn: FoodMoney | null; transfersOut: FoodMoney | null; closing: FoodMoney | null;
};
/** Complete physical-count interval, identical location and valuation basis. Waste is already
 * inside depletion; adding a waste expense here would count it twice. */
export function actualFoodCost(input: FoodInventoryPeriod): FoodResult<{ currency: string; availableMinor: number; actualMinor: number }> {
  const currency = foodCurrency(input.currency), keys = ["opening", "purchases", "supplierCredits", "transfersIn", "transfersOut", "closing"] as const;
  const values = keys.map(key => money(input[key], currency, key));
  const missing = keys.filter((_, index) => values[index] === null);
  if (missing.length) return unavailable("missing_input", ...missing);
  const [opening, purchases, credits, incoming, outgoing, closing] = values as bigint[];
  const stock = opening + purchases - credits + incoming - outgoing, consumed = stock - closing;
  if (stock < ZERO || consumed < ZERO) return unavailable("negative_consumption", "inventory movements");
  return available({ currency, availableMinor: safe(stock, "available inventory"), actualMinor: safe(consumed, "actual food cost") });
}
function monetaryRatio(numerator: FoodMoney | null, denominator: FoodMoney | null, currency: string, fields: [string, string]): FoodResult<number> {
  const n = money(numerator, currency, fields[0]), d = money(denominator, currency, fields[1], false);
  if (n === null || d === null) return unavailable("missing_input", ...fields.filter((_, i) => [n, d][i] === null));
  if (d <= ZERO) return unavailable("nonpositive_sales", fields[1]);
  return available(rounded(fraction(n * BigInt(10000), d), fields[0] + " basis points"));
}
function difference(currency: string, fields: [string, FoodMoney | null][]): FoodResult<FoodMoney> {
  const amounts = fields.map(([field, value], index) => money(value, currency, field, index !== 0));
  if (amounts.some(value => value === null)) return unavailable("missing_input", ...fields.filter((_, i) => amounts[i] === null).map(([field]) => field));
  return available({ currency, minor: safe((amounts as bigint[]).slice(1).reduce((n, v) => n - v, amounts[0]!), "difference") });
}
export type FoodservicePeriodInput = {
  currency: string; foodNetSales: FoodMoney | null; totalNetSales: FoodMoney | null;
  actualCost: FoodMoney | null; theoreticalCost: FoodMoney | null; recordedWasteCost: FoodMoney | null;
  availableInventoryCost: FoodMoney | null; labourCost: FoodMoney | null; otherVariableCosts: FoodMoney | null;
  closedChecks: number | null;
};
/** Caller must supply matched reviewed period/location records and tax-exclusive net sales.
 * Ratios are integer basis points: 1250 = 12.50%. No benchmark or target is assumed. */
export function foodservicePeriodMetrics(input: FoodservicePeriodInput) {
  const c = foodCurrency(input.currency);
  // Validate even independent/missing fields, so a partial record cannot hide a currency mismatch.
  for (const key of ["foodNetSales", "totalNetSales", "actualCost", "theoreticalCost", "recordedWasteCost", "availableInventoryCost", "labourCost", "otherVariableCosts"] as const) money(input[key], c, key, !["foodNetSales", "totalNetSales"].includes(key));
  const checks = count(input.closedChecks, "closedChecks"), sales = money(input.totalNetSales, c, "totalNetSales", false);
  const waste = money(input.recordedWasteCost, c, "recordedWasteCost"), stock = money(input.availableInventoryCost, c, "availableInventoryCost");
  const averageCheck: FoodResult<FoodMoney> = checks === null || sales === null ? unavailable("missing_input", ...[checks === null ? "closedChecks" : "", sales === null ? "totalNetSales" : ""].filter(Boolean)) : checks === ZERO ? unavailable("zero_denominator", "closedChecks") : available({ currency: c, minor: rounded(fraction(sales, checks), "average check") });
  const wasteRate: FoodResult<number> = waste === null || stock === null ? unavailable("missing_input", ...[waste === null ? "recordedWasteCost" : "", stock === null ? "availableInventoryCost" : ""].filter(Boolean)) : stock === ZERO ? unavailable("zero_denominator", "availableInventoryCost") : waste > stock ? unavailable("inconsistent_waste", "recordedWasteCost", "availableInventoryCost") : available(rounded(fraction(waste * BigInt(10000), stock), "waste basis points"));
  return {
    currency: c,
    actualFoodCostBasisPoints: monetaryRatio(input.actualCost, input.foodNetSales, c, ["actualCost", "foodNetSales"]),
    theoreticalFoodCostBasisPoints: monetaryRatio(input.theoreticalCost, input.foodNetSales, c, ["theoreticalCost", "foodNetSales"]),
    labourCostBasisPoints: monetaryRatio(input.labourCost, input.totalNetSales, c, ["labourCost", "totalNetSales"]),
    costVariance: difference(c, [["actualCost", input.actualCost], ["theoreticalCost", input.theoreticalCost]]),
    foodContribution: difference(c, [["foodNetSales", input.foodNetSales], ["actualCost", input.actualCost]]),
    contributionAfterVariableCosts: difference(c, [["foodNetSales", input.foodNetSales], ["actualCost", input.actualCost], ["otherVariableCosts", input.otherVariableCosts]]),
    recordedWasteRateBasisPoints: wasteRate, averageCheck,
  };
}
export function foodWasteQuantityRate(wasted: FoodQuantity | null, availableQuantity: FoodQuantity | null): FoodResult<number> {
  const w = quantity(wasted, "wastedQuantity"), a = quantity(availableQuantity, "availableQuantity");
  if (!w || !a) return unavailable("missing_input", ...[!w ? "wastedQuantity" : "", !a ? "availableQuantity" : ""].filter(Boolean));
  if (w.dimension !== a.dimension) fail("wastedQuantity", "waste and available quantity must have compatible units");
  if (a.base.n === ZERO) return unavailable("zero_denominator", "availableQuantity");
  const rate = divide(w.base, a.base);
  if (rate.n > rate.d) return unavailable("inconsistent_waste", "wastedQuantity", "availableQuantity");
  return available(rounded(multiply(rate, fraction(BigInt(10000))), "quantity waste basis points"));
}
/** A single defined service period with fixed available table configuration. Count seated
 * parties, not split checks, guests or payments; do not combine unequal service windows. */
export function tableTurns(input: { servicePeriod: string; servedParties: number | null; availableTables: number | null }): FoodResult<ExactFoodValue> {
  identifier(input.servicePeriod, "servicePeriod");
  const parties = count(input.servedParties, "servedParties"), tables = count(input.availableTables, "availableTables");
  if (parties === null || tables === null) return unavailable("missing_input", ...[parties === null ? "servedParties" : "", tables === null ? "availableTables" : ""].filter(Boolean));
  return tables === ZERO ? unavailable("zero_denominator", "availableTables") : available(exact(fraction(parties, tables)));
}

export const FOOD_PERIOD_AMOUNTS = ["opening", "purchases", "supplierCredits", "transfersIn", "transfersOut", "closing", "foodNetSales", "totalNetSales", "theoreticalCost", "recordedWasteCost", "labourCost", "otherVariableCosts"] as const;
export type FoodPeriodEntry = { currency: string; closedChecks: number | null } & Record<typeof FOOD_PERIOD_AMOUNTS[number], FoodMoney | null>;
type FoodEvidence = { name: string; source: string; asOfDate: string; from: string; to: string };
export type FoodRecordContent = FoodEvidence & ({ kind: "recipe"; payload: FoodRecipe } | { kind: "period"; payload: FoodPeriodEntry });
export type FoodSavedRecord = FoodRecordContent & { id: string; locationId: string; version: number; updatedAt: number };
function object(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(field, "provide an object");
  return input as Record<string, unknown>;
}
function text(input: unknown, field: string) {
  if (typeof input !== "string" || !input.trim() || input.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(input)) fail(field, "use 1 to 120 plain characters");
  return (input as string).trim().normalize("NFC");
}
function date(input: unknown, field: string) {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input) || !Number.isFinite(Date.parse(input + "T00:00:00Z")) || new Date(input + "T00:00:00Z").toISOString().slice(0, 10) !== input) fail(field, "use a valid YYYY-MM-DD date");
  return input as string;
}
/** Boundary parser strips unrecognized fields and retains unknown numbers as null. */
export function validateFoodserviceContent(input: unknown): FoodRecordContent {
  const row = object(input, "record"), p = object(row.payload, "payload");
  const currency = foodCurrency(p.currency as string), name = text(row.name, "name"), source = text(row.source, "source"), asOfDate = date(row.asOfDate, "asOfDate");
  const readMoney = (raw: unknown, field: string, nonnegative = true): FoodMoney | null => {
    if (raw == null) return null;
    const item = object(raw, field), output = { currency: item.currency as string, minor: item.minor as number };
    money(output, currency, field, nonnegative); return output;
  };
  if (row.kind === "recipe") {
    const readQuantity = (raw: unknown, field: string): FoodQuantity | null => {
      if (raw == null) return null;
      const q = object(raw, field), output = { amount: q.amount == null ? null : q.amount as string, unit: q.unit as FoodUnit };
      quantity(output, field); return output;
    };
    if (!Array.isArray(p.ingredients) || p.ingredients.length < 1 || p.ingredients.length > 100) fail("ingredients", "provide 1 to 100 rows");
    const ingredients = (p.ingredients as unknown[]).map((raw, index) => {
      const line = object(raw, `ingredient ${index + 1}`);
      return { id: text(line.id, "ingredient name"), purchaseQuantity: readQuantity(line.purchaseQuantity, "purchaseQuantity"), recipeQuantity: readQuantity(line.recipeQuantity, "recipeQuantity"), purchaseCost: readMoney(line.purchaseCost, "purchaseCost"), preparationYield: line.preparationYield == null ? null : line.preparationYield as string };
    });
    const payload: FoodRecipe = { currency, portions: p.portions == null ? null : p.portions as string, ingredients };
    costRecipe(payload);
    return { kind: "recipe", name, source, asOfDate, from: "", to: "", payload };
  }
  if (row.kind !== "period") fail("kind", "choose recipe or period");
  const from = date(row.from, "from"), to = date(row.to, "to");
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 365) fail("period", "use an ordered period of at most 366 days");
  if (asOfDate < to) fail("asOfDate", "must cover the period end");
  const payload = { currency, closedChecks: p.closedChecks == null ? null : p.closedChecks as number } as FoodPeriodEntry;
  for (const field of FOOD_PERIOD_AMOUNTS) payload[field] = readMoney(p[field], field, field !== "foodNetSales" && field !== "totalNetSales");
  count(payload.closedChecks, "closedChecks");
  foodserviceRecordReport({ kind: "period", name, source, asOfDate, from, to, payload });
  return { kind: "period", name, source, asOfDate, from, to, payload };
}
export function foodserviceRecordReport(record: FoodRecordContent) {
  if (record.kind === "recipe") return { kind: "recipe" as const, recipe: costRecipe(record.payload) };
  const inventory = actualFoodCost(record.payload), actual = inventory.status === "available" ? { currency: record.payload.currency, minor: inventory.value.actualMinor } : null;
  const stock = inventory.status === "available" ? { currency: record.payload.currency, minor: inventory.value.availableMinor } : null;
  return { kind: "period" as const, inventory, metrics: foodservicePeriodMetrics({ ...record.payload, actualCost: actual, availableInventoryCost: stock }) };
}
