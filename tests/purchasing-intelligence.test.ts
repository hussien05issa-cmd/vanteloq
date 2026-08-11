import assert from "node:assert/strict";
import test from "node:test";
import {
  allocatePurchasingCapacity,
  assessPurchasingProduct,
  calculateVerifiedPurchasingCapacity,
} from "../domain/purchasing-intelligence.ts";

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

test("verified purchasing capacity is allocated once across the highest-risk products", () => {
  const urgent = assessPurchasingProduct({ ...base, sku: "URGENT", onHandUnits: 0, unitsSold30: 60, unitCostCents: 1_000 });
  const lowerRisk = assessPurchasingProduct({ ...base, sku: "LOWER", onHandUnits: 7, unitsSold30: 30, unitCostCents: 500 });
  const result = allocatePurchasingCapacity([lowerRisk, urgent], 2_500);

  assert.equal(result.reduce((sum, item) => sum + (item.cashAllocatedCents ?? 0), 0), 2_500);
  assert.equal(result.find((item) => item.sku === "URGENT")?.cashConstrainedUnits, 2);
  assert.equal(result.find((item) => item.sku === "LOWER")?.cashConstrainedUnits, 1);
  assert.ok(result.every((item) => item.cashConstrainedUnits !== null && item.cashConstrainedUnits <= item.recommendedUnits));
});

test("missing verified cash leaves a review requirement instead of inventing capacity", () => {
  const assessment = assessPurchasingProduct({ ...base, onHandUnits: 0, unitCostCents: 500 });
  const [result] = allocatePurchasingCapacity([assessment], null);
  assert.equal(result.cashConstrainedUnits, null);
  assert.equal(result.cashDecision, "needs_verified_cash");
});

test("purchasing capacity preserves the cash reserve and deducts verified obligations", () => {
  const result = calculateVerifiedPurchasingCapacity({
    connectionVerified: true,
    nowMs: Date.parse("2026-08-11T12:00:00Z"),
    maximumAgeMs: 48 * 60 * 60 * 1000,
    baseCurrency: "CAD",
    cashSafetyReserveCents: 25_000,
    outstandingBillsCents: 40_000,
    uninvoicedPurchaseCommitmentsCents: 15_000,
    accounts: [
      {
        accountType: "chequing",
        currency: "CAD",
        connectionStatus: "healthy",
        availableBalanceCents: 120_000,
        liveBalanceCents: 125_000,
        lastSyncAtMs: Date.parse("2026-08-11T10:00:00Z"),
      },
      {
        accountType: "credit_card",
        currency: "CAD",
        connectionStatus: "healthy",
        availableBalanceCents: 500_000,
        liveBalanceCents: -20_000,
        lastSyncAtMs: Date.parse("2026-08-11T10:00:00Z"),
      },
      {
        accountType: "savings",
        currency: "USD",
        connectionStatus: "healthy",
        availableBalanceCents: 300_000,
        liveBalanceCents: 300_000,
        lastSyncAtMs: Date.parse("2026-08-11T10:00:00Z"),
      },
    ],
  });

  assert.equal(result.status, "available");
  assert.equal(result.verifiedCashCents, 120_000);
  assert.equal(result.verifiedPurchasingCapacityCents, 40_000);
  assert.equal(result.accountsUsed, 1);
});

test("stale bank balances never become purchasing capacity", () => {
  const result = calculateVerifiedPurchasingCapacity({
    connectionVerified: true,
    nowMs: Date.parse("2026-08-11T12:00:00Z"),
    maximumAgeMs: 48 * 60 * 60 * 1000,
    baseCurrency: "CAD",
    cashSafetyReserveCents: 0,
    outstandingBillsCents: 0,
    uninvoicedPurchaseCommitmentsCents: 0,
    accounts: [{
      accountType: "chequing",
      currency: "CAD",
      connectionStatus: "healthy",
      availableBalanceCents: 120_000,
      liveBalanceCents: 120_000,
      lastSyncAtMs: Date.parse("2026-08-01T10:00:00Z"),
    }],
  });

  assert.equal(result.status, "stale_bank_data");
  assert.equal(result.verifiedPurchasingCapacityCents, null);
});
