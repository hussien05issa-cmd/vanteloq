import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CashOrderPlanner, VehicleHoldingCalculator } from "../app/tools/public-calculators";
import {
  calculateCashOrderPlan,
  calculateVehicleHoldingCost,
  cashOrderPlanCsv,
  vehicleHoldingCostCsv,
  type CashOrderPlanInput,
  type VehicleHoldingCostInput,
} from "../domain/public-planning-tools.ts";

const cash: CashOrderPlanInput = {
  asOfDate: "2026-10-11", openingCash: "1000.00", reconciled: true,
  horizonWeeks: "2", minimumBuffer: "200", orderAmount: "300", paymentWeek: "2",
  entries: [
    { id: "receipt", label: "Receipt", date: "2026-10-12", kind: "receipt", amount: "100" },
    { id: "bill", label: "Bill", date: "2026-10-25", kind: "obligation", amount: "500" },
  ],
};
const vehicle: VehicleHoldingCostInput = {
  asOfDate: "2026-10-11", financedBalance: "10000", annualRate: "10",
  days: "30", dailyStorage: "5", dailyOther: "2.25", recordedCosts: "420.15",
};

test("cash plan uses dated buckets, exact cents, and the proposed payment only once", () => {
  const { value, errors } = calculateCashOrderPlan(cash);
  assert.deepEqual(errors, []);
  assert.ok(value);
  assert.equal(value.weeks[0].startDate, "2026-10-12");
  assert.equal(value.weeks[0].endDate, "2026-10-18");
  assert.equal(value.weeks[0].baselineClosingCents, 110000);
  assert.equal(value.weeks[1].baselineClosingCents, 60000);
  assert.equal(value.weeks[1].scenarioClosingCents, 30000);
  assert.equal(value.weeks[1].orderPaymentCents, 30000);
  assert.equal(value.baselineLowestCents, 60000);
  assert.equal(value.scenarioLowestCents, 30000);
  assert.equal(value.scenarioBufferGapCents, 10000);
  assert.equal(value.scenarioShortfallCents, 0);
});

test("opening cash participates in both lowest-balance and buffer checks", () => {
  const result = calculateCashOrderPlan({ ...cash, openingCash: "100", orderAmount: "0", minimumBuffer: "200", entries: [{ id: "later", date: "2026-10-12", kind: "receipt", amount: "1000", label: "Later cash" }] }).value;
  assert.ok(result);
  assert.equal(result.baselineLowestCents, 10000);
  assert.equal(result.scenarioLowestCents, 10000);
  assert.equal(result.scenarioLowestWeek, 0);
  assert.equal(result.scenarioShortfallCents, 10000);
});

test("cash outflows retain negative balances and report buffer shortfalls", () => {
  const result = calculateCashOrderPlan({ ...cash, orderAmount: "1000" }).value;
  assert.ok(result);
  assert.equal(result.scenarioLowestCents, -40000);
  assert.equal(result.scenarioShortfallCents, 60000);
});

test("cash plan permits explicit zero amounts and an explicitly empty list", () => {
  const result = calculateCashOrderPlan({ ...cash, openingCash: "0", minimumBuffer: "0", orderAmount: "0", entries: [] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.value?.scenarioLowestCents, 0);
});

test("cash plan withholds output on missing, nonfinite, negative, excessive, or fractional inputs", () => {
  for (const invalid of ["", " ", null, undefined, "NaN", NaN, Infinity, "Infinity", "-1", "1e10", "100000000.01", "0.001"]) {
    for (const field of ["openingCash", "minimumBuffer", "orderAmount"] as const) {
      const result = calculateCashOrderPlan({ ...cash, [field]: invalid });
      assert.equal(result.value, null, `${field}: ${invalid}`);
      assert.ok(result.errors.some(error => error.field === field));
    }
  }
  for (const invalid of ["0", "14", "1.5", "", null, Infinity]) {
    assert.equal(calculateCashOrderPlan({ ...cash, horizonWeeks: invalid }).value, null);
  }
  for (const invalid of ["0", "3", "1.5", "", null]) {
    assert.equal(calculateCashOrderPlan({ ...cash, paymentWeek: invalid }).value, null);
  }
  assert.equal(calculateCashOrderPlan({ ...cash, reconciled: false }).value, null);
});

test("cash plan rejects duplicate IDs, invalid dates, and rows outside its dated horizon", () => {
  for (const date of ["2026-10-11", "2026-10-26", "2026-02-30", "", "2101-01-01"]) {
    assert.equal(calculateCashOrderPlan({ ...cash, entries: [{ ...cash.entries[0], date }] }).value, null);
  }
  assert.equal(calculateCashOrderPlan({ ...cash, entries: [cash.entries[0], cash.entries[0]] }).value, null);
  assert.equal(calculateCashOrderPlan({ ...cash, asOfDate: "2026-02-29" }).value, null);
  assert.equal(calculateCashOrderPlan({ ...cash, asOfDate: "2100-12-31" }).value, null);
});

test("cash cents do not accumulate floating point drift", () => {
  const result = calculateCashOrderPlan({ ...cash, openingCash: "0.10", orderAmount: "0.03", minimumBuffer: "0", paymentWeek: "1", entries: [{ id: "one", label: "Small receipt", date: "2026-10-12", kind: "receipt", amount: "0.20" }] }).value;
  assert.ok(result);
  assert.equal(result.weeks[0].baselineClosingCents, 30);
  assert.equal(result.weeks[1].scenarioClosingCents, 27);
});

test("vehicle cost uses financed principal and keeps recorded cost separate", () => {
  const { value, errors } = calculateVehicleHoldingCost(vehicle);
  assert.deepEqual(errors, []);
  assert.ok(value);
  assert.equal(value.financingCents, 8219);
  assert.equal(value.dailyCostCents, 21750);
  assert.equal(value.estimatedAdditionalCents, 29969);
  assert.equal(value.recordedCostsCents, 42015);
  assert.equal(value.endDate, "2026-11-10");
});

test("vehicle calculator supports zero principal, zero rate, and zero days", () => {
  assert.equal(calculateVehicleHoldingCost({ ...vehicle, financedBalance: "0" }).value?.financingCents, 0);
  assert.equal(calculateVehicleHoldingCost({ ...vehicle, annualRate: "0" }).value?.financingCents, 0);
  assert.equal(calculateVehicleHoldingCost({ ...vehicle, days: "0" }).value?.estimatedAdditionalCents, 0);
  assert.equal(calculateVehicleHoldingCost({ ...vehicle, days: "0" }).value?.recordedCostsCents, 42015);
});

test("vehicle calculation rounds only the final financing estimate to the nearest cent", () => {
  const half = calculateVehicleHoldingCost({ ...vehicle, financedBalance: "3.65", annualRate: "50", days: "1", dailyStorage: "0", dailyOther: "0" }).value;
  assert.equal(half?.financingCents, 1);
  const belowHalf = calculateVehicleHoldingCost({ ...vehicle, financedBalance: "3.64", annualRate: "50", days: "1", dailyStorage: "0", dailyOther: "0" }).value;
  assert.equal(belowHalf?.financingCents, 0);
});

test("vehicle calculator rejects missing, negative, nonfinite, excessive, and imprecise inputs", () => {
  for (const invalid of ["", null, undefined, "-1", NaN, Infinity, "100000000.01", "0.001"]) {
    assert.equal(calculateVehicleHoldingCost({ ...vehicle, financedBalance: invalid }).value, null);
  }
  for (const field of ["dailyStorage", "dailyOther", "recordedCosts"] as const) {
    assert.equal(calculateVehicleHoldingCost({ ...vehicle, [field]: "" }).value, null);
    assert.equal(calculateVehicleHoldingCost({ ...vehicle, [field]: "-1" }).value, null);
  }
  for (const annualRate of ["", "100.0001", "-1", "0.00001", NaN, Infinity]) {
    assert.equal(calculateVehicleHoldingCost({ ...vehicle, annualRate }).value, null);
  }
  for (const days of ["", "-1", "3651", "1.5", NaN, Infinity]) {
    assert.equal(calculateVehicleHoldingCost({ ...vehicle, days }).value, null);
  }
  assert.equal(calculateVehicleHoldingCost({ ...vehicle, dailyStorage: "100000.01" }).value, null);
  assert.equal(calculateVehicleHoldingCost({ ...vehicle, asOfDate: "2100-12-31", days: "1" }).value, null);
});

test("bounded extreme inputs remain exact and finite", () => {
  const result = calculateVehicleHoldingCost({ ...vehicle, financedBalance: "100000000", annualRate: "100", days: "3650", dailyStorage: "100000", dailyOther: "100000" }).value;
  assert.ok(result);
  assert.equal(result.financingCents, 100000000000);
  assert.equal(result.estimatedAdditionalCents, 173000000000);
  assert.ok(Number.isSafeInteger(result.estimatedAdditionalCents));
  const plan = calculateCashOrderPlan({ ...cash, openingCash: "100000000", orderAmount: "100000000", entries: [] }).value;
  assert.equal(plan?.scenarioLowestCents, 0);
});

test("CSV exports carry date, model formulas, exact decimal amounts, and safe user text", () => {
  const csv = cashOrderPlanCsv({ ...cash, entries: [{ ...cash.entries[0], label: '=HYPERLINK("https://example.com")' }] });
  assert.ok(csv);
  assert.match(csv, /2026-10-11/);
  assert.match(csv, /opening cash \+ receipts - obligations - proposed order payment/);
  assert.match(csv, /'="?HYPERLINK/);
  assert.match(csv, /1000\.00/);
  assert.equal(cashOrderPlanCsv({ ...cash, openingCash: "" }), null);
  const holdingCsv = vehicleHoldingCostCsv(vehicle);
  assert.ok(holdingCsv);
  assert.match(holdingCsv, /financed balance \* annual rate \/ 100 \* days \/ 365/);
  assert.match(holdingCsv, /299\.69/);
  assert.equal(vehicleHoldingCostCsv({ ...vehicle, days: "" }), null);
});

test("public calculators server-render fictional example results with labelled controls", () => {
  for (const component of [CashOrderPlanner, VehicleHoldingCalculator]) {
    const html = renderToStaticMarkup(createElement(component));
    assert.match(html, /Fictional example loaded/);
    assert.match(html, /Download fictional sample CSV/);
    assert.doesNotMatch(html, /NaN|Infinity|Calculation unavailable/);
    const controls = [...html.matchAll(/<(?:input|select)\b[^>]*\bid="([^"]+)"/g)];
    assert.ok(controls.length > 0);
    for (const [, id] of controls) assert.ok(html.includes(`for="${id}"`), `Missing associated label: ${id}`);
    for (const [, ids] of html.matchAll(/aria-describedby="([^"]+)"/g)) {
      for (const id of ids.split(" ")) assert.ok(html.includes(`id="${id}"`), `Missing description: ${id}`);
    }
  }
  const cashHtml = renderToStaticMarkup(createElement(CashOrderPlanner));
  assert.match(cashHtml, /Lowest balance includes opening cash/);
  assert.match(cashHtml, /\$8,000\.00/);
  assert.match(cashHtml, /-\$1,000\.00/);
  const holdingHtml = renderToStaticMarkup(createElement(VehicleHoldingCalculator));
  assert.match(holdingHtml, /\$414\.66/);
  assert.match(holdingHtml, /Historical input, excluded from the additional estimate above/);
});
