import assert from "node:assert/strict";
import test from "node:test";
import { assessPurchasingProduct } from "../domain/purchasing-intelligence.ts";

const base = {
  sku: "SKU-1",
  name: "Core product",
  supplierName: "North Supplier",
  onHandUnits: 10,
  reorderPointUnits: 8,
  incomingUnits: 0,
  unitsSold30: 30,
  unitsSoldPrevious30: 24,
  unitsSold90: 80,
  unitCostCents: 500,
  lastOrderedAt: null,
  lastOrderStatus: null,
  lastSaleAt: "2026-08-10T12:00:00Z",
};

test("open order quantities prevent duplicate reordering", () => {
  const assessment = assessPurchasingProduct({ ...base, onHandUnits: 2, incomingUnits: 35, lastOrderedAt: "2026-08-09", lastOrderStatus: "sent" });
  assert.equal(assessment.recommendedUnits, 0);
  assert.equal(assessment.health, "healthy");
  assert.match(assessment.summary, /incoming/i);
});

test("dead stock is explicitly identified and never reordered", () => {
  const assessment = assessPurchasingProduct({ ...base, onHandUnits: 20, unitsSold30: 0, unitsSoldPrevious30: 0, unitsSold90: 0, lastSaleAt: null });
  assert.equal(assessment.health, "dead_stock");
  assert.equal(assessment.recommendedUnits, 0);
});

test("stockout risk receives a red issue alert and performance-based quantity", () => {
  const assessment = assessPurchasingProduct({ ...base, onHandUnits: 1, incomingUnits: 0, unitsSold30: 60, unitsSoldPrevious30: 30 });
  assert.equal(assessment.health, "issue");
  assert.ok(assessment.recommendedUnits > 30);
  assert.ok(assessment.factors.some((factor) => factor.includes("growth")));
});
