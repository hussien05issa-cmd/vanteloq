import assert from "node:assert/strict";
import test from "node:test";
import { actualFoodCost, convertFoodQuantity, costRecipe, foodservicePeriodMetrics, foodWasteQuantityRate, tableTurns, theoreticalFoodCost, foodAmountToMinor, foodAmountText, validateFoodserviceContent, foodserviceRecordReport, type FoodRecipe, type FoodservicePeriodInput, type FoodResult } from "../domain/foodservice.ts";

const cad = (minor: number) => ({ currency: "CAD", minor });
const value = <T>(result: FoodResult<T>): T => { assert.equal(result.status, "available"); if (result.status !== "available") throw Error("Unavailable"); return result.value; };
const recipe = (cost = 100, portions = "1"): FoodRecipe => ({ currency: "CAD", portions, ingredients: [{ id: "flour", purchaseQuantity: { amount: "1", unit: "kg" }, purchaseCost: cad(cost), recipeQuantity: { amount: "1", unit: "kg" }, preparationYield: "1" }] });
const inventory = { currency: "CAD", opening: cad(100000), purchases: cad(400000), supplierCredits: cad(10000), transfersIn: cad(20000), transfersOut: cad(30000), closing: cad(180000) };
const period: FoodservicePeriodInput = { currency: "CAD", foodNetSales: cad(1000000), totalNetSales: cad(1200000), actualCost: cad(300000), theoreticalCost: cad(275000), recordedWasteCost: cad(10000), availableInventoryCost: cad(480000), labourCost: cad(400000), otherVariableCosts: cad(50000), closedChecks: 600 };

test("mass and metric volume conversions retain exact values", () => {
  assert.deepEqual(value(convertFoodQuantity({ amount: "1", unit: "lb" }, "g")), { numerator: "45359237", denominator: "100000", unit: "g" });
  assert.deepEqual(value(convertFoodQuantity({ amount: "1", unit: "oz_mass" }, "lb")), { numerator: "1", denominator: "16", unit: "lb" });
  assert.deepEqual(value(convertFoodQuantity({ amount: "250", unit: "g" }, "kg")), { numerator: "1", denominator: "4", unit: "kg" });
  assert.deepEqual(value(convertFoodQuantity({ amount: "0.125", unit: "l" }, "ml")), { numerator: "125", denominator: "1", unit: "ml" });
});
test("incompatible and ambiguous units are rejected without inventing density", () => {
  assert.throws(() => convertFoodQuantity({ amount: "1", unit: "g" }, "ml"), /mass, volume and count/);
  assert.throws(() => convertFoodQuantity({ amount: "1", unit: "each" }, "g"), /mass, volume and count/);
  assert.throws(() => convertFoodQuantity({ amount: "1", unit: "cup" as "g" }, "g"), /ambiguous unit/);
});
test("quantity input does not silently coerce or round decimal values", () => {
  for (const amount of ["", " 1", "1e3", "-1", "01", "0.1234567", "Infinity", 0.1 as unknown as string]) assert.throws(() => convertFoodQuantity({ amount, unit: "g" }, "g"), /decimal string/);
  assert.equal(convertFoodQuantity({ amount: null, unit: "g" }, "g").status, "unavailable");
  assert.equal(value(convertFoodQuantity({ amount: "0", unit: "g" }, "g")).numerator, "0");
});
test("recipe costing combines compatible units and sums before rounding", () => {
  const r: FoodRecipe = { currency: "CAD", portions: "10", ingredients: [
    { id: "flour", purchaseQuantity: { amount: "2", unit: "kg" }, purchaseCost: cad(1000), recipeQuantity: { amount: "500", unit: "g" }, preparationYield: "1" },
    { id: "milk", purchaseQuantity: { amount: "1", unit: "l" }, purchaseCost: cad(400), recipeQuantity: { amount: "250", unit: "ml" }, preparationYield: "1" },
  ] };
  const result = value(costRecipe(r)); assert.equal(result.totalMinor, 350); assert.equal(result.perPortionMinor, 35);
  assert.deepEqual(result.totalMinorExact, { numerator: "350", denominator: "1" });
});
test("edible yield is applied once and a documented hydration gain is supported", () => {
  const r = recipe(1000, "3"); r.ingredients![0].recipeQuantity = { amount: "250", unit: "g" }; r.ingredients![0].preparationYield = "0.8";
  const result = value(costRecipe(r)); assert.deepEqual(result.totalMinorExact, { numerator: "625", denominator: "2" }); assert.equal(result.totalMinor, 313); assert.equal(result.perPortionMinor, 104);
  const rice = recipe(600); rice.ingredients![0].recipeQuantity = { amount: "3", unit: "kg" }; rice.ingredients![0].preparationYield = "3";
  assert.equal(value(costRecipe(rice)).totalMinor, 600);
});
test("unknown cost and yield are unavailable, known zero cost remains zero", () => {
  const r = recipe(0); assert.equal(value(costRecipe(r)).totalMinor, 0);
  r.ingredients![0].purchaseCost = null; assert.equal(costRecipe(r).status, "unavailable");
  r.ingredients![0].purchaseCost = cad(20); r.ingredients![0].preparationYield = null; assert.equal(costRecipe(r).status, "unavailable");
  r.ingredients![0].preparationYield = "0"; assert.throws(() => costRecipe(r), /greater than zero/);
  assert.throws(() => costRecipe({ ...recipe(), portions: "0" }), /greater than zero/);
  assert.equal(costRecipe({ ...recipe(), portions: null }).status, "unavailable");
});
test("rounding is once per aggregate rather than per ingredient or sold portion", () => {
  const r = recipe(1, "3"); assert.equal(value(costRecipe(r)).perPortionMinor, 0);
  assert.equal(value(theoreticalFoodCost("CAD", [{ id: "sale-1", recipe: r, portions: "3" }])).minor, 1);
  const halves = ["a", "b", "c"].map(id => ({ ...recipe(1).ingredients![0], id, recipeQuantity: { amount: "0.5", unit: "kg" as const } }));
  assert.equal(value(costRecipe({ currency: "CAD", portions: "1", ingredients: halves })).totalMinor, 2);
});
test("production data distinguishes confirmed no activity from missing coverage", () => {
  assert.equal(value(theoreticalFoodCost("CAD", [])).minor, 0);
  assert.equal(theoreticalFoodCost("CAD", null).status, "unavailable");
  assert.equal(theoreticalFoodCost("CAD", [{ id: "sale-1", recipe: recipe(), portions: null }]).status, "unavailable");
  assert.throws(() => theoreticalFoodCost("CAD", [{ id: "sale-1", recipe: recipe(), portions: "-1" }]), /decimal string/);
});
test("duplicate ingredients and production records cannot multiply cost", () => {
  const r = recipe(); assert.throws(() => costRecipe({ ...r, ingredients: [r.ingredients![0], r.ingredients![0]] }), /duplicate ingredient/);
  const line = { id: "line-1", recipe: r, portions: "1" }; assert.throws(() => theoreticalFoodCost("CAD", [line, line]), /duplicate production/);
});
test("inventory depletion accounts for credits and transfers exactly once", () => {
  assert.deepEqual(value(actualFoodCost(inventory)), { currency: "CAD", availableMinor: 480000, actualMinor: 300000 });
  // Waste is already inside the inventory count depletion, not an added purchase cost.
  assert.equal(value(foodservicePeriodMetrics(period).costVariance).minor, 25000);
});
test("missing inventory and impossible negative depletion never become zero", () => {
  assert.equal(actualFoodCost({ ...inventory, opening: null }).status, "unavailable");
  assert.deepEqual(actualFoodCost({ ...inventory, closing: cad(500000) }), { status: "unavailable", reason: "negative_consumption", fields: ["inventory movements"] });
  const zero = cad(0); assert.equal(value(actualFoodCost({ currency: "CAD", opening: zero, purchases: zero, supplierCredits: zero, transfersIn: zero, transfersOut: zero, closing: zero })).actualMinor, 0);
});
test("food, labour, contribution and check measures use their explicit denominators", () => {
  const r = foodservicePeriodMetrics(period);
  assert.equal(value(r.actualFoodCostBasisPoints), 3000); assert.equal(value(r.theoreticalFoodCostBasisPoints), 2750);
  assert.equal(value(r.labourCostBasisPoints), 3333); assert.equal(value(r.recordedWasteRateBasisPoints), 208);
  assert.equal(value(r.foodContribution).minor, 700000); assert.equal(value(r.contributionAfterVariableCosts).minor, 650000); assert.equal(value(r.averageCheck).minor, 2000);
});
test("favourable variance and negative contribution retain their signs", () => {
  const r = foodservicePeriodMetrics({ ...period, foodNetSales: cad(100), actualCost: cad(150), theoreticalCost: cad(201) });
  assert.equal(value(r.costVariance).minor, -51); assert.equal(value(r.foodContribution).minor, -50);
  assert.equal(value(foodservicePeriodMetrics({ ...period, totalNetSales: cad(-1), closedChecks: 2 }).averageCheck).minor, -1);
});
test("zero/negative sales, zero checks and missing costs stay unavailable independently", () => {
  const r = foodservicePeriodMetrics({ ...period, foodNetSales: cad(0), totalNetSales: cad(-10), closedChecks: 0, otherVariableCosts: null });
  assert.equal(r.actualFoodCostBasisPoints.status, "unavailable"); assert.equal(r.labourCostBasisPoints.status, "unavailable"); assert.equal(r.averageCheck.status, "unavailable"); assert.equal(r.contributionAfterVariableCosts.status, "unavailable");
  assert.equal(value(r.foodContribution).minor, -300000);
});
test("mixed currencies reject even when another input is missing", () => {
  const usd = { currency: "USD", minor: 10 };
  assert.throws(() => actualFoodCost({ ...inventory, opening: null, closing: usd }), /currency differs/);
  assert.throws(() => foodservicePeriodMetrics({ ...period, labourCost: null, theoreticalCost: usd }), /currency differs/);
  const r = recipe(); r.ingredients![0].purchaseCost = usd; assert.throws(() => costRecipe(r), /currency differs/);
  assert.throws(() => theoreticalFoodCost("USD", [{ id: "a", recipe: recipe(), portions: "1" }]), /mixed recipe currencies/);
});
test("invalid minor units and overflow fail before precision loss", () => {
  for (const amount of [NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1, -1]) assert.throws(() => actualFoodCost({ ...inventory, opening: cad(amount) }), /safe integer/);
  assert.throws(() => actualFoodCost({ ...inventory, opening: cad(Number.MAX_SAFE_INTEGER), purchases: cad(Number.MAX_SAFE_INTEGER) }), /exceeds exact/);
  const r = recipe(Number.MAX_SAFE_INTEGER); r.ingredients![0].recipeQuantity = { amount: "2", unit: "kg" }; assert.throws(() => costRecipe(r), /exceeds exact/);
});
test("recorded waste rates use compatible available quantities and flag inconsistent counts", () => {
  assert.equal(value(foodWasteQuantityRate({ amount: "250", unit: "g" }, { amount: "2", unit: "kg" })), 1250);
  assert.equal(foodWasteQuantityRate({ amount: "3", unit: "kg" }, { amount: "2", unit: "kg" }).status, "unavailable");
  assert.equal(foodWasteQuantityRate(null, { amount: "2", unit: "kg" }).status, "unavailable");
  assert.throws(() => foodWasteQuantityRate({ amount: "1", unit: "l" }, { amount: "2", unit: "kg" }), /compatible units/);
  assert.equal(foodservicePeriodMetrics({ ...period, recordedWasteCost: cad(500000) }).recordedWasteRateBasisPoints.status, "unavailable");
});
test("table turns use a named service period and parties rather than guest/check counts", () => {
  assert.deepEqual(value(tableTurns({ servicePeriod: "2026-10-03 dinner", servedParties: 45, availableTables: 15 })), { numerator: "3", denominator: "1" });
  assert.deepEqual(value(tableTurns({ servicePeriod: "dinner", servedParties: 0, availableTables: 15 })), { numerator: "0", denominator: "1" });
  assert.equal(tableTurns({ servicePeriod: "dinner", servedParties: null, availableTables: 15 }).status, "unavailable");
  assert.equal(tableTurns({ servicePeriod: "dinner", servedParties: 2, availableTables: 0 }).status, "unavailable");
  assert.throws(() => tableTurns({ servicePeriod: "dinner", servedParties: 1.5, availableTables: 5 }), /safe integer/);
});
test("form amounts respect currency minor units without floating-point multiplication", () => {
  assert.equal(foodAmountToMinor("0.29", "CAD"), 29); assert.equal(foodAmountToMinor("-0.01", "CAD"), -1);
  assert.equal(foodAmountToMinor("123", "JPY"), 123); assert.throws(() => foodAmountToMinor("1.2", "JPY"), /decimal places/);
  assert.equal(foodAmountToMinor("1.234", "KWD"), 1234); assert.equal(foodAmountText(1234, "KWD"), "1.234");
  assert.equal(foodAmountText(Number.MAX_SAFE_INTEGER, "CAD"), "90071992547409.91");
  assert.equal(foodAmountToMinor("", "CAD"), null); assert.throws(() => foodAmountToMinor("0.001", "CAD"), /decimal places/);
});
test("saved boundaries strip unrelated fields and validate calendar evidence", () => {
  const input = { kind: "recipe", name: "Cake", source: "Invoice reference", asOfDate: "2026-09-30", payload: recipe(101, "3"), unrelated: "discard" };
  const result = validateFoodserviceContent(input); assert.equal("unrelated" in result, false); assert.equal(result.from, "");
  assert.throws(() => validateFoodserviceContent({ ...input, asOfDate: "2026-02-30" }), /valid YYYY-MM-DD/);
  assert.throws(() => validateFoodserviceContent({ ...input, source: "" }), /source/);
});
test("saved period reports preserve incomplete inputs and require ordered matched dates", () => {
  const record = { kind: "period", name: "September", source: "Physical counts and payroll total", asOfDate: "2026-09-30", from: "2026-09-01", to: "2026-09-30", payload: { ...inventory, ...period } };
  const parsed = validateFoodserviceContent(record), report = foodserviceRecordReport(parsed);
  assert.equal(report.kind, "period"); if (report.kind === "period") assert.equal(value(report.inventory).actualMinor, 300000);
  assert.throws(() => validateFoodserviceContent({ ...record, to: "2026-10-01" }), /cover the period end/);
  assert.throws(() => validateFoodserviceContent({ ...record, from: "2026-10-01" }), /ordered period/);
  const incomplete = validateFoodserviceContent({ ...record, payload: { ...record.payload, opening: null } });
  const missing = foodserviceRecordReport(incomplete); if (missing.kind === "period") assert.equal(missing.metrics.foodContribution.status, "unavailable");
});
