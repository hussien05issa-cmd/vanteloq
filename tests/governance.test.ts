import assert from "node:assert/strict";
import test from "node:test";
import { allPermissions, roleTemplates } from "../server/permissions.ts";
import { hashPin, validateTemporaryPin } from "../server/pin.ts";
import { metricRegistry } from "../server/metric-registry.ts";

test("owner template contains every registered permission", () => {
  assert.deepEqual([...roleTemplates.account_owner].sort(), [...allPermissions].sort());
});

test("employee defaults allow work without exposing banking, profit, payroll or administration", () => {
  const permissions = new Set(roleTemplates.employee);
  assert.equal(permissions.has("dashboard.view"), true);
  assert.equal(permissions.has("operations.tasks"), true);
  assert.equal(permissions.has("finance.bank_balances"), false);
  assert.equal(permissions.has("metrics.profit"), false);
  assert.equal(permissions.has("metrics.cash"), false);
  assert.equal(permissions.has("payroll.individual"), false);
  assert.equal(permissions.has("team.roles"), false);
});

test("temporary workplace PINs reject common and sequential values", () => {
  for (const pin of ["123456", "654321", "111111", "01234567", "12345", "123456789", "12ab5678"]) {
    assert.throws(() => validateTemporaryPin(pin));
  }
  assert.equal(validateTemporaryPin("407286"), "407286");
});

test("PIN hashing is salted and deterministic only for the same salt", async () => {
  const salt = new Uint8Array(16).fill(7);
  const first = await hashPin("407286", salt, 1_000);
  const replay = await hashPin("407286", salt, 1_000);
  const other = await hashPin("407286", new Uint8Array(16).fill(8), 1_000);
  assert.equal(first.hashHex, replay.hashHex);
  assert.notEqual(first.hashHex, other.hashHex);
  assert.equal(first.hashHex.length, 64);
  assert.equal(first.saltHex.length, 32);
});

test("metric registry has unique keys, source lineage and permissions", () => {
  assert.equal(new Set(metricRegistry.map((metric) => metric.key)).size, metricRegistry.length);
  for (const metric of metricRegistry) {
    assert.ok(metric.formula.length > 0, metric.key);
    assert.ok(metric.sourceFields.length > 0, metric.key);
    assert.ok(metric.permission.includes("."), metric.key);
  }
});
