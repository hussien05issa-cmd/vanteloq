import assert from "node:assert/strict";
import test from "node:test";
import { bankCashSnapshot } from "../domain/bank-cash-snapshot.ts";
import type { PurchasingCapacityAccount } from "../domain/purchasing-intelligence.ts";

const nowMs = Date.parse("2026-10-04T12:00:00Z");
const hour = 60 * 60 * 1000;
const account = (overrides: Partial<PurchasingCapacityAccount> = {}): PurchasingCapacityAccount => ({
  accountType: "chequing", currency: "CAD", connectionStatus: "healthy",
  availableBalanceCents: 120_000, liveBalanceCents: 130_000,
  lastSyncAtMs: nowMs - hour, demoRecord: false, ...overrides,
});
const snapshot = (accounts: PurchasingCapacityAccount[], overrides: Partial<Parameters<typeof bankCashSnapshot>[0]> = {}) =>
  bankCashSnapshot({ allowed: true, connected: true, currency: "CAD", nowMs, accounts, ...overrides });

test("live bank cash ignores demonstration balances and timestamps", () => {
  const result = snapshot([
    account(),
    account({ availableBalanceCents: 999_999, demoRecord: true, lastSyncAtMs: nowMs - 100 * hour }),
  ]);
  assert.equal(result.status, "available");
  assert.equal(result.balanceCents, 120_000);
  assert.equal(result.verifiedCashCents, 120_000);
  assert.equal(result.accountsUsed, 1);
  assert.equal(result.oldestSyncAt, new Date(nowMs - hour).toISOString());
  assert.equal(result.newestSyncAt, result.oldestSyncAt);
  assert.equal(snapshot([account({ demoRecord: true })]).balanceCents, null);
  assert.equal(snapshot([]).balanceCents, null);
});

test("available balance falls back to current balance without inventing missing cash", () => {
  assert.equal(snapshot([account({ availableBalanceCents: null })]).balanceCents, 130_000);
  const missing = snapshot([account({ availableBalanceCents: null, liveBalanceCents: null })]);
  assert.equal(missing.status, "needs_healthy_cash_account");
  assert.equal(missing.balanceCents, null);
  assert.equal(missing.oldestSyncAt, null);
  assert.equal(missing.accountsUsed, 0);
});

test("recorded zero and overdrafts retain their signed bank amounts", () => {
  const zero = snapshot([account({ availableBalanceCents: 0 })]);
  assert.equal(zero.status, "available");
  assert.equal(zero.balanceCents, 0);
  assert.equal(snapshot([account(), account({ availableBalanceCents: -150_000 })]).balanceCents, -30_000);
  assert.equal(snapshot([account({ availableBalanceCents: null, liveBalanceCents: -5_000 })]).balanceCents, -5_000);
});

test("one stale, future, missing or unhealthy live account withholds a partial balance", () => {
  const invalidAccounts: Partial<PurchasingCapacityAccount>[] = [
    { lastSyncAtMs: nowMs - 49 * hour }, { lastSyncAtMs: nowMs + 1 },
    { lastSyncAtMs: null }, { lastSyncAtMs: NaN }, { connectionStatus: "error" },
  ];
  for (const invalid of invalidAccounts) {
    const result = snapshot([account(), account(invalid)]);
    assert.notEqual(result.status, "available");
    assert.equal(result.balanceCents, null);
    assert.equal(result.oldestSyncAt, null);
    assert.equal(result.newestSyncAt, null);
    assert.equal(result.accountsUsed, 0);
  }
  assert.equal(snapshot([account({ lastSyncAtMs: nowMs - 49 * hour })]).status, "stale_bank_data");
  assert.equal(snapshot([account({ lastSyncAtMs: nowMs - 48 * hour })]).balanceCents, 120_000);
});

test("timestamps cover only eligible base-currency cash accounts", () => {
  const result = snapshot([
    account({ lastSyncAtMs: nowMs - 30 * hour }),
    account({ accountType: "savings", availableBalanceCents: 40_000, lastSyncAtMs: nowMs - 2 * hour }),
    account({ currency: "USD", lastSyncAtMs: nowMs }),
    account({ currency: "UNK", lastSyncAtMs: nowMs }),
    account({ accountType: "credit_card", availableBalanceCents: 900_000, lastSyncAtMs: nowMs }),
    account({ accountType: "line_of_credit", lastSyncAtMs: nowMs - 200 * hour }),
  ], { currency: " cad " });
  assert.equal(result.balanceCents, 160_000);
  assert.equal(result.baseCurrency, "CAD");
  assert.equal(result.accountsUsed, 2);
  assert.equal(result.oldestSyncAt, new Date(nowMs - 30 * hour).toISOString());
  assert.equal(result.newestSyncAt, new Date(nowMs - 2 * hour).toISOString());
  assert.equal(snapshot([account({ currency: "USD" })]).balanceCents, null);
});

test("permission or source denial reveals no balance, account count or timestamps", () => {
  for (const overrides of [{ allowed: false }, { connected: false }]) {
    const result = snapshot([account()], overrides);
    assert.equal(result.status, "needs_bank_connection");
    assert.equal(result.balanceCents, null);
    assert.equal(result.verifiedCashCents, null);
    assert.equal(result.accountsUsed, 0);
    assert.equal(result.oldestSyncAt, null);
    assert.equal(result.newestSyncAt, null);
    assert.ok(result.reason);
  }
});

test("a bank snapshot does not claim that reserves or purchasing obligations were checked", () => {
  const result = snapshot([account()]);
  for (const field of ["verifiedPurchasingCapacityCents", "cashSafetyReserveCents", "outstandingBillsCents", "openPurchaseCommitmentsCents"]) {
    assert.equal(Object.hasOwn(result, field), false, `${field} is not a bank balance fact`);
  }
  assert.match(result.boundary, /not period-end ledger cash or profit/);
});
