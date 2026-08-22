import type { FeatureKey } from "../server/entitlements/catalog.ts";

export const navigationEntitlementViews = [
  "Dashboard",
  "Intelligence",
  "Action Centre",
  "Business Brief",
  "Advisor",
  "BookLoQ",
  "Sales",
  "Profit",
  "Cash",
  "Bookkeeping",
  "Inventory",
  "Customers",
  "Marketing",
  "Communications",
  "Team",
  "Operations",
  "Suppliers",
  "Purchase Orders",
  "Documents",
  "Data Quality",
  "Locations",
  "Decision Journal",
  "Scenario Planner",
  "Reports",
  "Integrations",
  "Settings",
] as const;

export type NavigationEntitlementView = (typeof navigationEntitlementViews)[number];

const requiredFeatureByView: Readonly<Record<NavigationEntitlementView, FeatureKey>> = Object.freeze({
  Dashboard: "dashboard.core",
  Intelligence: "analytics.sales.advanced",
  "Action Centre": "operations.basic",
  "Business Brief": "business.brief.basic",
  Advisor: "ai.basic",
  BookLoQ: "bookloq",
  Sales: "analytics.sales.basic",
  Profit: "bookloq",
  Cash: "bookloq",
  Bookkeeping: "bookloq",
  Inventory: "inventory.lots",
  Customers: "ai.tools.customers",
  Marketing: "growth.strategy",
  Communications: "communications.basic",
  Team: "permissions.standard",
  Operations: "operations.basic",
  Suppliers: "supplier.analytics",
  "Purchase Orders": "inventory.reorder_ai",
  Documents: "invoice.basic",
  "Data Quality": "reporting.basic",
  Locations: "multi_location.basic",
  "Decision Journal": "growth.strategy",
  "Scenario Planner": "forecasting.scenarios",
  Reports: "reporting.basic",
  Integrations: "business.settings",
  Settings: "business.settings",
});

const growthFeatures = new Set<FeatureKey>([
  "analytics.sales.advanced",
  "ai.tools.customers",
  "growth.strategy",
  "inventory.lots",
  "inventory.reorder_ai",
  "supplier.analytics",
]);

const proFeatures = new Set<FeatureKey>([
  "forecasting.scenarios",
]);

function upgradeLabel(feature: FeatureKey): string {
  if (feature === "bookloq") return "BookLoQ add-on";
  if (proFeatures.has(feature)) return "Pro";
  if (growthFeatures.has(feature)) return "Growth";
  return "Starter";
}

export function navigationEntitlement(
  view: string,
  features: readonly string[],
): {
  allowed: boolean;
  requiredFeature: FeatureKey | null;
  upgradeLabel: string | null;
} {
  if (!navigationEntitlementViews.includes(view as NavigationEntitlementView)) {
    return { allowed: false, requiredFeature: null, upgradeLabel: "Unavailable" };
  }
  const requiredFeature = requiredFeatureByView[view as NavigationEntitlementView];
  const allowed = features.includes(requiredFeature);
  return {
    allowed,
    requiredFeature,
    upgradeLabel: allowed ? null : upgradeLabel(requiredFeature),
  };
}
