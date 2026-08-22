import type { FeatureKey } from "../server/entitlements/catalog.ts";

export const commerceViewModes = ["Sales", "Inventory", "Customers", "Suppliers"] as const;
export type CommerceViewMode = (typeof commerceViewModes)[number];

const commerceFeatureByMode: Readonly<Record<CommerceViewMode, FeatureKey>> = Object.freeze({
  Sales: "analytics.sales.basic",
  Inventory: "inventory.lots",
  Customers: "ai.tools.customers",
  Suppliers: "supplier.analytics",
});

export function commerceViewFeature(mode: string | null): FeatureKey | null {
  return commerceViewModes.includes(mode as CommerceViewMode)
    ? commerceFeatureByMode[mode as CommerceViewMode]
    : null;
}

export function reportRequestFeature(format: string | null): FeatureKey {
  return format === "csv" ? "reporting.exports" : "reporting.basic";
}

export function marketingProviderFeature(provider: string): FeatureKey | null {
  if (provider === "google") return "marketing.google_analytics";
  if (provider === "meta") return "marketing.meta_ads";
  return null;
}

export function marketingDatasetFeature(dataset: string): FeatureKey | null {
  if (dataset === "google_business_profile") return "marketing.google_business";
  if (dataset === "google_analytics") return "marketing.google_analytics";
  if (dataset === "google_search_console") return "marketing.search_intelligence";
  if (dataset === "google_ads") return "marketing.google_ads";
  if (dataset === "meta_ads") return "marketing.meta_ads";
  return null;
}

const posIntegrationProviders = new Set([
  "lightspeed",
  "lightspeed-r",
  "shopify",
  "shopify-pos",
  "square",
  "clover",
  "stripe",
  "moneris",
  "doordash",
  "uber-eats",
]);

export function integrationProviderFeature(provider: string): FeatureKey | null {
  if (posIntegrationProviders.has(provider)) return "pos.reporting.core";
  if (provider === "plaid" || provider === "quickbooks" || provider === "xero") return "bookloq.reconciliation";
  return marketingProviderFeature(provider);
}

const bookloqFeatureByAction: Readonly<Record<string, FeatureKey>> = Object.freeze({
  categorize_transaction: "bookloq.transactions",
  create_category: "bookloq.chart_of_accounts",
  match_transaction: "bookloq.reconciliation",
  upsert_budget: "bookloq.cash_intelligence",
  month_end_status: "bookloq.financial_statements",
  alert_status: "bookloq.anomaly_detection",
  lock_period: "bookloq.financial_statements",
  unlock_period: "bookloq.financial_statements",
});

export function bookloqActionFeature(action: string): FeatureKey | null {
  return bookloqFeatureByAction[action] ?? null;
}

const alertTypesByMode: Readonly<Record<CommerceViewMode, ReadonlySet<string>>> = Object.freeze({
  Sales: new Set(["low_margin", "discount", "basket"]),
  Inventory: new Set(["stockout", "low_stock"]),
  Customers: new Set<string>(),
  Suppliers: new Set<string>(),
});

export function commerceResponseForMode<T extends Record<string, unknown>>(
  mode: CommerceViewMode,
  response: T,
): T {
  const alerts = Array.isArray(response.alerts)
    ? response.alerts.filter((alert) => {
      if (!alert || typeof alert !== "object" || Array.isArray(alert)) return false;
      return alertTypesByMode[mode].has(String((alert as Record<string, unknown>).type ?? ""));
    })
    : [];
  return {
    ...response,
    saleLines: mode === "Sales" && Array.isArray(response.saleLines) ? response.saleLines : [],
    inventory: mode === "Inventory" && Array.isArray(response.inventory) ? response.inventory : [],
    customers: mode === "Customers" && Array.isArray(response.customers) ? response.customers : [],
    suppliers: mode === "Suppliers" && Array.isArray(response.suppliers) ? response.suppliers : [],
    products: mode === "Sales" && Array.isArray(response.products) ? response.products : [],
    alerts,
  } as T;
}
