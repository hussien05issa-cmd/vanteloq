import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderFeatureCoverage, buildProviderFeatureCoverageByConnection } from "../domain/provider-feature-coverage.ts";

const completeCoverage = {
  sales: true,
  payments: true,
  products: true,
  inventory: true,
  customers: true,
  suppliers: true,
  locations: true,
};

test("feature access is determined by normalized data coverage, not the POS brand", () => {
  const lightspeed = buildProviderFeatureCoverage("lightspeed-r", completeCoverage);
  const shopify = buildProviderFeatureCoverage("shopify-pos", completeCoverage);

  assert.deepEqual(
    lightspeed.map(({ id, status, dataNeeded }) => ({ id, status, dataNeeded })),
    shopify.map(({ id, status, dataNeeded }) => ({ id, status, dataNeeded })),
  );
  assert.ok(lightspeed.every((feature) => feature.status === "ready"));
});

test("a feature is blocked with a specific data requirement when coverage is incomplete", () => {
  const coverage = buildProviderFeatureCoverage("shopify-pos", {
    ...completeCoverage,
    inventory: false,
    suppliers: false,
  });

  const reorder = coverage.find((feature) => feature.id === "reorder_intelligence");
  assert.equal(reorder?.status, "needs_data");
  assert.deepEqual(reorder?.dataNeeded.sort(), ["inventory", "suppliers"]);
});

test("complementary sibling accounts cannot satisfy one account's dependency", () => {
  const records = buildProviderFeatureCoverageByConnection("square", [
    { connectionId: "sales-account", coverage: { ...completeCoverage, payments: false } },
    { connectionId: "payment-account", coverage: { ...completeCoverage, sales: false } },
  ]);
  assert.equal(records.find(feature => feature.id === "payment_mix")?.status, "needs_data");
  assert.equal(records.find(feature => feature.id === "sales_performance")?.status, "ready", "the sales account has those record classes by itself");
});
