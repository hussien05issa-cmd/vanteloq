import assert from "node:assert/strict";
import test from "node:test";
import {
  allocatePurchasingCapacity,
  assessPurchasingProduct,
  calculateOpenPurchasingObligations,
  calculateVerifiedPurchasingCapacity,
  verifiedCashSourceEligible,
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
    openPurchaseCommitmentsCents: 15_000,
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
  const response = result as unknown as Record<string, unknown>;
  assert.equal(response.openPurchaseCommitmentsCents, 15_000);
  assert.equal("uninvoicedPurchaseCommitmentsCents" in response, false);
});

test("verified cash nets fresh overdrawn depository accounts instead of ignoring their deficit", () => {
  const result = calculateVerifiedPurchasingCapacity({
    connectionVerified: true,
    nowMs: Date.parse("2026-08-11T12:00:00Z"),
    maximumAgeMs: 48 * 60 * 60 * 1000,
    baseCurrency: "CAD",
    cashSafetyReserveCents: 10_000,
    outstandingBillsCents: 0,
    openPurchaseCommitmentsCents: 0,
    accounts: [
      {
        accountType: "chequing",
        currency: "CAD",
        connectionStatus: "healthy",
        availableBalanceCents: 120_000,
        liveBalanceCents: 120_000,
        lastSyncAtMs: Date.parse("2026-08-11T10:00:00Z"),
      },
      {
        accountType: "merchant",
        currency: "CAD",
        connectionStatus: "healthy",
        availableBalanceCents: -30_000,
        liveBalanceCents: -30_000,
        lastSyncAtMs: Date.parse("2026-08-11T10:00:00Z"),
      },
    ],
  });

  assert.equal(result.status, "available");
  assert.equal(result.verifiedCashCents, 90_000);
  assert.equal(result.verifiedPurchasingCapacityCents, 80_000);
  assert.equal(result.accountsUsed, 2);
});

test("one stale or unhealthy relevant cash account blocks a favorable partial balance", () => {
  const common = {
    connectionVerified: true,
    nowMs: Date.parse("2026-08-11T12:00:00Z"),
    maximumAgeMs: 48 * 60 * 60 * 1000,
    baseCurrency: "CAD",
    cashSafetyReserveCents: 0,
    outstandingBillsCents: 0,
    openPurchaseCommitmentsCents: 0,
  } as const;
  const healthy = {
    accountType: "chequing" as const,
    currency: "CAD",
    connectionStatus: "healthy" as const,
    availableBalanceCents: 120_000,
    liveBalanceCents: 120_000,
    lastSyncAtMs: Date.parse("2026-08-11T10:00:00Z"),
  };
  const stale = calculateVerifiedPurchasingCapacity({
    ...common,
    accounts: [healthy, {
      ...healthy,
      accountType: "savings",
      availableBalanceCents: 50_000,
      lastSyncAtMs: Date.parse("2026-08-01T10:00:00Z"),
    }],
  });
  const unhealthy = calculateVerifiedPurchasingCapacity({
    ...common,
    accounts: [healthy, {
      ...healthy,
      accountType: "merchant",
      connectionStatus: "error",
      availableBalanceCents: -20_000,
    }],
  });

  assert.equal(stale.status, "stale_bank_data");
  assert.equal(stale.verifiedPurchasingCapacityCents, null);
  assert.equal(stale.accountsUsed, 0);
  assert.equal(unhealthy.status, "needs_healthy_cash_account");
  assert.equal(unhealthy.verifiedPurchasingCapacityCents, null);
  assert.equal(unhealthy.accountsUsed, 0);
});

test("stale bank balances never become purchasing capacity", () => {
  const result = calculateVerifiedPurchasingCapacity({
    connectionVerified: true,
    nowMs: Date.parse("2026-08-11T12:00:00Z"),
    maximumAgeMs: 48 * 60 * 60 * 1000,
    baseCurrency: "CAD",
    cashSafetyReserveCents: 0,
    outstandingBillsCents: 0,
    openPurchaseCommitmentsCents: 0,
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

test("future-dated bank balances never become purchasing capacity", () => {
  const nowMs = Date.parse("2026-08-11T12:00:00Z");
  const result = calculateVerifiedPurchasingCapacity({
    connectionVerified: true,
    nowMs,
    maximumAgeMs: 48 * 60 * 60 * 1000,
    baseCurrency: "CAD",
    cashSafetyReserveCents: 0,
    outstandingBillsCents: 0,
    openPurchaseCommitmentsCents: 0,
    accounts: [{
      accountType: "chequing",
      currency: "CAD",
      connectionStatus: "healthy",
      availableBalanceCents: 120_000,
      liveBalanceCents: 120_000,
      lastSyncAtMs: nowMs + 1_000,
    }],
  });
  assert.equal(result.verifiedPurchasingCapacityCents, null);
});

test("open purchase obligations retain invoiced orders and deduplicate linked bills", () => {
  const baseOrder = { id: "po-1", orderNumber: "PO-1", status: "invoiced", currency: "CAD", totalCents: 105_000 };
  assert.deepEqual(calculateOpenPurchasingObligations({ baseCurrency: "CAD", orders: [baseOrder], bills: [] }), {
    outstandingBillsCents: 0,
    openPurchaseCommitmentsCents: 105_000,
    excludedCurrencyObligations: 0,
  });
  assert.deepEqual(calculateOpenPurchasingObligations({
    baseCurrency: "CAD",
    orders: [baseOrder],
    bills: [{ status: "partially_paid", totalCents: 105_000, paidCents: 25_000, currency: "CAD", purchaseOrderRef: "PO-1", demoRecord: false }],
  }), {
    outstandingBillsCents: 0,
    openPurchaseCommitmentsCents: 80_000,
    excludedCurrencyObligations: 0,
  });
});

test("open purchase obligations preserve the larger mismatch and ignore demo bills", () => {
  const result = calculateOpenPurchasingObligations({
    baseCurrency: "CAD",
    orders: [{ id: "po-1", orderNumber: "PO-1", status: "invoiced", currency: "CAD", totalCents: 105_000 }],
    bills: [
      { status: "approved", totalCents: 110_000, paidCents: 0, currency: "CAD", purchaseOrderRef: "po-1", demoRecord: false },
      { status: "approved", totalCents: 900_000, paidCents: 0, currency: "CAD", purchaseOrderRef: null, demoRecord: true },
    ],
  });
  assert.equal(result.openPurchaseCommitmentsCents, 110_000);
  assert.equal(result.outstandingBillsCents, 0);
});

test("sandbox, demonstration, and inactive BookLoQ sources never verify purchasing cash", () => {
  const otherwiseConnected = {
    connectionStatus: "connected",
    promotionStatus: "approved",
    bookloqStatus: "active",
    bookloqDataMode: "live",
    bookloqAddonActive: true,
    hasDemoAccounts: false,
  };
  assert.equal(verifiedCashSourceEligible({ ...otherwiseConnected, liveDataEligible: false }), false);
  assert.equal(verifiedCashSourceEligible({ ...otherwiseConnected, liveDataEligible: true, bookloqDataMode: "demonstration" }), false);
  assert.equal(verifiedCashSourceEligible({ ...otherwiseConnected, liveDataEligible: true, bookloqAddonActive: false }), false);
  assert.equal(verifiedCashSourceEligible({ ...otherwiseConnected, liveDataEligible: true, hasDemoAccounts: true }), false);
  assert.equal(verifiedCashSourceEligible({ ...otherwiseConnected, liveDataEligible: true }), true);
});
