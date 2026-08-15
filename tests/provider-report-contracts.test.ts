import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProviderReportCatalog,
  reportCapableCommerceProviders,
  resolveReportSourceAuthority,
  selectAuthoritativeReportScopes,
} from "../domain/provider-report-contracts.ts";

const completeCoverage = {
  sales: true,
  payments: true,
  products: true,
  inventory: true,
  customers: true,
  suppliers: true,
  locations: true,
};

test("normalized coverage unlocks the same canonical reports for every POS while retaining provider terminology", () => {
  const lightspeed = buildProviderReportCatalog({
    provider: "lightspeed-r",
    connectionId: "r-main",
    coverage: completeCoverage,
  });
  const shopify = buildProviderReportCatalog({
    provider: "shopify-pos",
    connectionId: "shopify-main",
    coverage: completeCoverage,
  });

  assert.deepEqual(
    lightspeed.canonicalReports.map(({ id, status }) => ({ id, status })),
    shopify.canonicalReports.map(({ id, status }) => ({ id, status })),
  );
  assert.ok(lightspeed.canonicalReports.filter((report) => report.implementationStatus === "available").every((report) => report.status === "ready"));
  assert.ok(lightspeed.canonicalReports.filter((report) => report.implementationStatus === "planned").every((report) => report.status === "needs_data"));
  assert.ok(lightspeed.providerReports.some((report) => report.label === "Sales performance"));
  assert.ok(shopify.providerReports.some((report) => report.label === "Orders performance"));
  assert.equal(lightspeed.vocabulary.location, "Shop");
  assert.equal(shopify.vocabulary.sale, "Order");
});

test("marketplace and delivery connectors have explicit report vocabulary and native planned contracts", () => {
  const expected = [
    ["doordash", "Delivery orders"],
    ["uber-eats", "Delivery orders"],
  ] as const;
  for (const [provider, salesLabel] of expected) {
    assert.ok(reportCapableCommerceProviders.includes(provider));
    const catalog = buildProviderReportCatalog({ provider, connectionId: `${provider}-main`, coverage: completeCoverage });
    assert.equal(catalog.vocabulary.sales, salesLabel);
    assert.ok(catalog.providerReports.some((report) => report.id.startsWith(`${provider}_`) && report.implementationStatus === "planned"));
  }
});

test("provider reports stay gated by the exact normalized facts they require", () => {
  const catalog = buildProviderReportCatalog({
    provider: "moneris",
    connectionId: "moneris-main",
    coverage: { ...completeCoverage, payments: false, inventory: false },
  });

  const settlement = catalog.providerReports.find((report) => report.id === "moneris_settlement_reconciliation");
  const inventory = catalog.canonicalReports.find((report) => report.id === "inventory_health");
  assert.deepEqual(settlement?.dataNeeded, ["payments"]);
  assert.equal(settlement?.status, "needs_data");
  assert.ok(inventory?.dataNeeded.includes("inventory"));
});

test("overlapping POS sources fail closed until one connection is selected as the reporting authority", () => {
  const candidates = [
    { provider: "lightspeed-r", connectionId: "r-main", locationId: "north", lastSuccessfulSyncAt: "2026-08-11T10:00:00Z" },
    { provider: "shopify-pos", connectionId: "shopify-main", locationId: "north", lastSuccessfulSyncAt: "2026-08-11T11:00:00Z" },
  ];

  assert.deepEqual(resolveReportSourceAuthority({ candidates, preferredConnectionId: null }), {
    status: "conflict",
    selected: null,
    excludedConnectionIds: [],
    reason: "Choose one reporting source for this location before combining overlapping sales.",
  });

  const resolved = resolveReportSourceAuthority({ candidates, preferredConnectionId: "shopify-main" });
  assert.equal(resolved.status, "selected");
  assert.equal(resolved.selected?.connectionId, "shopify-main");
  assert.deepEqual(resolved.excludedConnectionIds, ["r-main"]);
});

test("authority resolves per connection and retains every fact-backed outlet for the selected account", () => {
  const scopes = selectAuthoritativeReportScopes({
    preferredConnectionId: null,
    candidates: [
      { provider: "lightspeed-r", connectionId: "r-main", locationId: "north", lastSuccessfulSyncAt: null, metricLocationRef: "lightspeed-r:r-main:first", hasFacts: false, availability: "needs_data" },
      { provider: "lightspeed-r", connectionId: "r-main", locationId: "north", lastSuccessfulSyncAt: null, metricLocationRef: "lightspeed-r:r-main:second", hasFacts: true, availability: "ready" },
      { provider: "lightspeed-r", connectionId: "r-main", locationId: "north", lastSuccessfulSyncAt: null, metricLocationRef: "lightspeed-r:r-main:third", hasFacts: true, availability: "ready" },
    ],
  });

  assert.equal(scopes.resolution.status, "automatic");
  assert.deepEqual(scopes.selectedScopes.map((scope) => scope.metricLocationRef), [
    "lightspeed-r:r-main:second",
    "lightspeed-r:r-main:third",
  ]);
});
