import assert from "node:assert/strict";
import test from "node:test";

type PaidFeatureRoutingModule = {
  commerceViewFeature?: (mode: string | null) => string | null;
  reportRequestFeature?: (format: string | null) => string;
  marketingProviderFeature?: (provider: string) => string | null;
  marketingDatasetFeature?: (dataset: string) => string | null;
  integrationProviderFeature?: (provider: string) => string | null;
  bookloqActionFeature?: (action: string) => string | null;
  commerceResponseForMode?: <T extends Record<string, unknown>>(
    mode: "Sales" | "Inventory" | "Customers" | "Suppliers",
    response: T,
  ) => T;
};

async function routingModule(): Promise<PaidFeatureRoutingModule> {
  return import("../domain/paid-feature-routing.ts").catch(() => ({}));
}

test("paid API modes map to the matching subscription feature", async () => {
  const routing = await routingModule();
  assert.equal(typeof routing.commerceViewFeature, "function");
  assert.equal(typeof routing.reportRequestFeature, "function");
  assert.equal(typeof routing.marketingProviderFeature, "function");

  assert.equal(routing.commerceViewFeature?.("Sales"), "analytics.sales.basic");
  assert.equal(routing.commerceViewFeature?.("Inventory"), "inventory.lots");
  assert.equal(routing.commerceViewFeature?.("Customers"), "ai.tools.customers");
  assert.equal(routing.commerceViewFeature?.("Suppliers"), "supplier.analytics");
  assert.equal(routing.commerceViewFeature?.("Unknown"), null);
  assert.equal(routing.commerceViewFeature?.(null), null);

  assert.equal(routing.reportRequestFeature?.("csv"), "reporting.exports");
  assert.equal(routing.reportRequestFeature?.("json"), "reporting.basic");
  assert.equal(routing.reportRequestFeature?.(null), "reporting.basic");

  assert.equal(routing.marketingProviderFeature?.("google"), "marketing.google_analytics");
  assert.equal(routing.marketingProviderFeature?.("meta"), "marketing.meta_ads");
  assert.equal(routing.marketingProviderFeature?.("unknown"), null);

  assert.equal(routing.marketingDatasetFeature?.("google_business_profile"), "marketing.google_business");
  assert.equal(routing.marketingDatasetFeature?.("google_search_console"), "marketing.search_intelligence");
  assert.equal(routing.marketingDatasetFeature?.("google_ads"), "marketing.google_ads");
  assert.equal(routing.marketingDatasetFeature?.("meta_ads"), "marketing.meta_ads");
  assert.equal(routing.marketingDatasetFeature?.("unknown"), null);

  assert.equal(routing.integrationProviderFeature?.("square"), "pos.reporting.core");
  assert.equal(routing.integrationProviderFeature?.("plaid"), "bookloq.reconciliation");
  assert.equal(routing.integrationProviderFeature?.("google"), "marketing.google_analytics");
  assert.equal(routing.integrationProviderFeature?.("meta"), "marketing.meta_ads");
  assert.equal(routing.integrationProviderFeature?.("unknown"), null);

  assert.equal(routing.bookloqActionFeature?.("categorize_transaction"), "bookloq.transactions");
  assert.equal(routing.bookloqActionFeature?.("create_category"), "bookloq.chart_of_accounts");
  assert.equal(routing.bookloqActionFeature?.("match_transaction"), "bookloq.reconciliation");
  assert.equal(routing.bookloqActionFeature?.("upsert_budget"), "bookloq.cash_intelligence");
  assert.equal(routing.bookloqActionFeature?.("lock_period"), "bookloq.financial_statements");
  assert.equal(routing.bookloqActionFeature?.("alert_status"), "bookloq.anomaly_detection");
  assert.equal(routing.bookloqActionFeature?.("unknown"), null);
});

test("commerce mode responses exclude data belonging to other paid modules", async () => {
  const routing = await routingModule();
  assert.equal(typeof routing.commerceResponseForMode, "function");
  const response = {
    source: "fixture",
    saleLines: [{ id: "sale" }],
    inventory: [{ id: "inventory" }],
    customers: [{ id: "customer" }],
    suppliers: [{ id: "supplier" }],
    products: [{ id: "product" }],
    alerts: [
      { type: "stockout" },
      { type: "low_stock" },
      { type: "low_margin" },
      { type: "discount" },
      { type: "basket" },
    ],
  };

  assert.deepEqual(routing.commerceResponseForMode?.("Sales", response), {
    ...response,
    inventory: [],
    customers: [],
    suppliers: [],
    alerts: [{ type: "low_margin" }, { type: "discount" }, { type: "basket" }],
  });
  assert.deepEqual(routing.commerceResponseForMode?.("Inventory", response), {
    ...response,
    saleLines: [],
    customers: [],
    suppliers: [],
    products: [],
    alerts: [{ type: "stockout" }, { type: "low_stock" }],
  });
  assert.deepEqual(routing.commerceResponseForMode?.("Customers", response), {
    ...response,
    saleLines: [],
    inventory: [],
    suppliers: [],
    products: [],
    alerts: [],
  });
  assert.deepEqual(routing.commerceResponseForMode?.("Suppliers", response), {
    ...response,
    saleLines: [],
    inventory: [],
    customers: [],
    products: [],
    alerts: [],
  });
});
