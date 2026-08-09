import test from "node:test";
import assert from "node:assert/strict";
import { assessInventoryLot, fefoSort, type InventoryLotEvidence } from "../domain/inventory-lifecycle.ts";

const base: InventoryLotEvidence = {
  id: "lot-1",
  sku: "CRE-LL",
  productName: "Creatine Lemon Lime",
  locationRef: "north",
  lotNumber: "LL-2401",
  batchNumber: "",
  receivedDate: "2026-06-01",
  expirationDate: "2026-10-20",
  bestBeforeDate: null,
  quantityRemaining: 42,
  unitCostCents: 1900,
  unitRetailCents: 4990,
  unitsSold30Days: 8,
  demandHistoryDays: 120,
};

test("shelf-life risk uses dated lot quantity, recorded velocity, and cost evidence", () => {
  const result = assessInventoryLot(base, new Date("2026-08-08T12:00:00Z"));
  assert.equal(result.daysRemaining, 73);
  assert.equal(result.monthlyVelocity, 8);
  assert.equal(result.projectedUnitsAtDate, 23);
  assert.equal(result.inventoryCostAtRiskCents, 43_700);
  assert.equal(result.grossMarginOpportunityAtRiskCents, 71_070);
  assert.equal(result.risk, "at_risk");
  assert.equal(result.confidence, "high");
});

test("missing movement history remains unavailable instead of becoming zero demand", () => {
  const result = assessInventoryLot({ ...base, unitsSold30Days: null, demandHistoryDays: 0 }, new Date("2026-08-08T12:00:00Z"));
  assert.equal(result.monthlyVelocity, null);
  assert.equal(result.projectedUnitsAtDate, null);
  assert.equal(result.inventoryCostAtRiskCents, null);
  assert.equal(result.confidence, "unavailable");
});

test("a depleted lot does not create a false shelf-life intervention", () => {
  const result = assessInventoryLot({ ...base, quantityRemaining: 0, expirationDate: "2026-08-09" }, new Date("2026-08-08T12:00:00Z"));
  assert.equal(result.risk, "healthy");
  assert.match(result.recommendation, /No units remain/);
  assert.equal(result.inventoryCostAtRiskCents, 0);
});

test("FEFO orders dated inventory before undated and uses received date as a stable tie-breaker", () => {
  const lots = fefoSort([
    { ...base, id: "undated", expirationDate: null, receivedDate: "2026-01-01" },
    { ...base, id: "later", expirationDate: "2026-12-01" },
    { ...base, id: "earlier", expirationDate: "2026-09-01" },
  ]);
  assert.deepEqual(lots.map((lot) => lot.id), ["earlier", "later", "undated"]);
});
