import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateConnectionStatus,
  integrationActionKey,
  isTrustedMetricLocationRef,
  scopeExternalRef,
  unscopedExternalRef,
} from "../domain/integration-source.ts";
import * as integrationSource from "../domain/integration-source.ts";

test("connection namespaces keep identical provider identifiers distinct", () => {
  assert.equal(scopeExternalRef("connection-a", "sale-1"), "connection-a:sale-1");
  assert.equal(scopeExternalRef("connection-b", "sale-1"), "connection-b:sale-1");
  assert.notEqual(scopeExternalRef("connection-a", "sale-1"), scopeExternalRef("connection-b", "sale-1"));
  assert.equal(unscopedExternalRef("connection-a", "connection-a:sale-1"), "sale-1");
});

test("legacy connections preserve existing source identifiers", () => {
  assert.equal(scopeExternalRef("legacy", "sale-1"), "sale-1");
  assert.equal(unscopedExternalRef("legacy", "sale-1"), "sale-1");
});

test("provider state aggregates multiple accounts without hiding an error", () => {
  assert.deepEqual(aggregateConnectionStatus([
    { status: "connected", dataPromotionStatus: "approved", lastSuccessfulSyncAt: "2026-08-10T08:00:00.000Z", lastErrorCode: null },
    { status: "error", dataPromotionStatus: "blocked", lastSuccessfulSyncAt: null, lastErrorCode: "AUTH_EXPIRED" },
  ]), {
    status: "connected",
    dataPromotionStatus: "approved",
    lastSuccessfulSyncAt: "2026-08-10T08:00:00.000Z",
    lastErrorCode: "AUTH_EXPIRED",
    connectedCount: 1,
  });
});

test("repeatable connector controls include Stripe and both Lightspeed editions", () => {
  const supportsMultipleProviderAccounts = (
    integrationSource as Record<string, unknown>
  ).supportsMultipleProviderAccounts as ((providerId: string) => boolean) | undefined;

  assert.equal(supportsMultipleProviderAccounts?.("stripe"), true);
  assert.equal(supportsMultipleProviderAccounts?.("lightspeed"), true);
  assert.equal(supportsMultipleProviderAccounts?.("lightspeed-r"), true);
  assert.equal(supportsMultipleProviderAccounts?.("moneris"), true);
  assert.equal(supportsMultipleProviderAccounts?.("plaid"), false);
});

test("connector actions are isolated to a provider account", () => {
  assert.equal(integrationActionKey("stripe", "connection-a"), "stripe:connection-a");
  assert.equal(integrationActionKey("stripe", "connection-b"), "stripe:connection-b");
  assert.equal(integrationActionKey("stripe"), "stripe:new");
  assert.notEqual(
    integrationActionKey("stripe", "connection-a"),
    integrationActionKey("stripe", "connection-b"),
  );
});

test("provider metric references fail closed after disconnect or missing lineage", () => {
  const connections = [
    {
      provider: "lightspeed-r",
      sourceNamespace: "connection-a",
      status: "revoked",
      dataPromotionStatus: "blocked",
    },
  ];
  assert.equal(
    isTrustedMetricLocationRef("lightspeed-r:connection-a:shop-1", connections),
    false,
  );
  assert.equal(isTrustedMetricLocationRef("lightspeed-r:unknown:shop-1", []), false);
  assert.equal(isTrustedMetricLocationRef("Primary location", []), true);
  assert.equal(
    isTrustedMetricLocationRef("lightspeed-r:connection-a:shop-1", [
      { ...connections[0], status: "connected", dataPromotionStatus: "approved" },
    ]),
    true,
  );
});
