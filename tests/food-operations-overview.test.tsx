import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import FoodOperationsOverview, { FoodOperationsReviewView } from "../app/food-operations-overview";
import type { SectorRecord } from "../domain/sector-operations";
const location = { id: "one", name: "North café", currency: "CAD", timezone: "America/Denver" };
const base = { records: [], kinds: ["prep_batch", "service_period", "delivery_order"] as const, partial: false, location, recipes: [], onOpen: () => {} };

test("an empty food review states the missing evidence without inventing operational rates", () => {
  const html = renderToStaticMarkup(<FoodOperationsOverview {...base}/>);
  assert.match(html, /No reviewed production batches/);
  assert.match(html, /No reviewed service periods/);
  assert.match(html, /No reviewed delivery orders/);
  assert.match(html, /America\/Denver/);
  assert.doesNotMatch(html, /CAD 0|0\.0%|0 min/);
  assert.match(html, /Kitchen queue length, station preparation time and restaurant occupancy need/);
});
test("only permitted workflow sections render and partial record scope remains visible", () => {
  const html = renderToStaticMarkup(<FoodOperationsOverview {...base} kinds={["service_period"]} partial/>);
  assert.match(html, /Partial view/);
  assert.match(html, /Service-period comparison/);
  assert.doesNotMatch(html, /Batch yield and waste|Delivery contribution review/);
  assert.equal(renderToStaticMarkup(<FoodOperationsOverview {...base} kinds={["room", "reservation"]}/>), "");
});
test("unconfirmed service coverage does not render unsupported rates", () => {
  const row: SectorRecord = { id: "service", locationId: "one", version: 1, state: "reviewed", updatedAt: 1, kind: "service_period", title: "Lunch", source: "Test source", sourceDate: "2026-10-04", dueDate: "", currency: "CAD", notes: "", batch: null, values: { serviceDate: "2026-10-04", daypart: "Lunch", projectedSales: 0, netSales: 10000, plannedMinutes: 0, paidMinutes: 60, labourCost: 2000, orders: 10, lateOrders: 1, coverageComplete: false } };
  const html = renderToStaticMarkup(<FoodOperationsOverview {...base} records={[row]} kinds={["service_period"]}/>);
  assert.match(html, /Coverage not confirmed/);
  assert.equal((html.match(/Not available/g) ?? []).length, 4);
  assert.doesNotMatch(html, /20\.0%|10\.0%/);
});
test("malformed dates render an accessible error instead of throwing during review rendering", () => {
  const callbacks = { onFromChange: () => {}, onToChange: () => {}, onToday: () => {}, onClear: () => {} };
  for (const range of [{ from: "10000-01-01", to: "" }, { from: "", to: "10000-01-01" }, { from: "2026-02-30", to: "2026-10-04" }, { from: "2026-10-05", to: "2026-10-04" }]) {
    const html = renderToStaticMarkup(<FoodOperationsReviewView {...base} {...callbacks} {...range}/>);
    const errorId = html.match(/<p id="([^"]+)" role="alert">/)?.[1];
    assert.ok(errorId);
    assert.equal((html.match(/aria-invalid="true"/g) ?? []).length, 2);
    assert.equal(html.split(`aria-describedby="${errorId}"`).length - 1, 2);
    assert.equal((html.match(/max="9999-12-31"/g) ?? []).length, 2);
    assert.doesNotMatch(html, /reviewed records in this date range|No reviewed production batches/);
  }
});

test("service plan variances render signed actual-minus-plan amounts without combining windows", () => {
  const row: SectorRecord = { id: "service", locationId: "one", version: 1, state: "reviewed", updatedAt: 1, kind: "service_period", title: "Lunch", source: "Test source", sourceDate: "2026-10-04", dueDate: "", currency: "CAD", notes: "", batch: null, values: { serviceDate: "2026-10-04", daypart: "Lunch", projectedSales: 200000, netSales: 180000, plannedMinutes: 600, paidMinutes: 720, labourCost: 40000, orders: 60, lateOrders: 6, coverageComplete: true } };
  const html = renderToStaticMarkup(<FoodOperationsOverview {...base} records={[row]} kinds={["service_period"]}/>);
  assert.match(html, /Sales versus plan/);
  assert.match(html, /Paid minutes versus plan/);
  assert.match(html, /<td>-CAD(?:&nbsp;|\s)200\.00<\/td><td>120<\/td>/);
  const missing = renderToStaticMarkup(<FoodOperationsOverview {...base} records={[{ ...row, values: { ...row.values, projectedSales: null, plannedMinutes: null } }]} kinds={["service_period"]}/>);
  assert.match(missing, /<td>Not available<\/td><td>Not available<\/td>/);
});
