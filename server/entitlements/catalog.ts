export const PLAN_KEYS = ["starter", "growth", "pro"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const ADDON_KEYS = ["bookloq"] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const FEATURE_KEYS = [
  "dashboard.core",
  "business.profile",
  "business.settings",
  "business.brief.basic",
  "operations.basic",
  "communications.basic",
  "pos.reporting.core",
  "analytics.sales.basic",
  "analytics.sales.advanced",
  "products.basic",
  "products.margin",
  "products.location_performance",
  "inventory.basic",
  "inventory.lots",
  "inventory.expiry",
  "inventory.shelf_life",
  "inventory.fefo",
  "inventory.turnover",
  "inventory.sell_through",
  "inventory.velocity",
  "inventory.days_on_hand",
  "inventory.dead_stock",
  "inventory.stockout_risk",
  "inventory.reorder_ai",
  "inventory.bring_back",
  "inventory.assortment",
  "inventory.opportunity",
  "inventory.transfers",
  "supplier.analytics",
  "supplier.cost_trends",
  "supplier.lead_time",
  "supplier.fill_rate",
  "supplier.reliability",
  "invoice.basic",
  "invoice.extraction",
  "invoice.matching",
  "invoice.discrepancy",
  "invoice.credit_opportunities",
  "calendar.basic",
  "calendar.automation",
  "marketing.overview",
  "marketing.google_business",
  "marketing.google_ads",
  "marketing.google_analytics",
  "marketing.meta_ads",
  "marketing.search_intelligence",
  "marketing.profit_attribution",
  "marketing.inventory_aware",
  "marketing.optimization",
  "marketing.advanced_attribution",
  "marketing.channel_allocation",
  "growth.strategy",
  "growth.strategy_graph",
  "growth.goals",
  "growth.opportunities",
  "pulse",
  "exceptions",
  "forecasting.revenue",
  "forecasting.demand",
  "forecasting.inventory",
  "forecasting.cash_basic",
  "forecasting.advanced",
  "forecasting.scenarios",
  "forecasting.future_obligations",
  "ai.basic",
  "ai.advanced",
  "ai.pro",
  "ai.tools.sales",
  "ai.tools.inventory",
  "ai.tools.products",
  "ai.tools.marketing",
  "ai.tools.suppliers",
  "ai.tools.invoices",
  "ai.tools.customers",
  "ai.tools.strategy",
  "multi_location.basic",
  "multi_location.advanced",
  "multi_location.benchmarking",
  "multi_location.forecasting",
  "multi_location.marketing",
  "reporting.basic",
  "reporting.advanced",
  "reporting.exports",
  "reporting.custom_dashboards",
  "workflow.advanced",
  "workflow.rules",
  "permissions.standard",
  "permissions.advanced",
  "support.priority",
  "bookloq",
  "bookloq.dashboard",
  "bookloq.chart_of_accounts",
  "bookloq.transactions",
  "bookloq.expenses",
  "bookloq.documents",
  "bookloq.ap",
  "bookloq.ar",
  "bookloq.reconciliation",
  "bookloq.financial_statements",
  "bookloq.cash_intelligence",
  "bookloq.anomaly_detection",
  "bookloq.accountant_access",
  "bookloq.ai",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type MoneyPrice = {
  readonly currency: "CAD";
  readonly amountCents: number;
  readonly interval: BillingInterval;
  /** Stable lookup key. A verified Stripe price ID will map to this in Step 5. */
  readonly lookupKey: string;
};

export type PlanLimits = {
  readonly activeLocations: number;
  readonly users: number;
  readonly ai: {
    readonly capability: "basic" | "advanced" | "pro";
    /** No numerical quota is advertised or enforced until usage metering exists. */
    readonly requestsPerMonth: null;
    readonly meteringStatus: "not_launched";
  };
};

export type PlanDefinition = {
  readonly key: PlanKey;
  readonly displayName: string;
  readonly description: string;
  readonly mostPopular: boolean;
  readonly prices: Readonly<Record<BillingInterval, MoneyPrice>>;
  readonly limits: PlanLimits;
  readonly features: readonly FeatureKey[];
};

export type AddonDefinition = {
  readonly key: AddonKey;
  readonly displayName: string;
  readonly prices: Readonly<Record<BillingInterval, MoneyPrice>>;
  readonly features: readonly FeatureKey[];
};

const starterFeatures = [
  "dashboard.core",
  "business.profile",
  "business.settings",
  "business.brief.basic",
  "operations.basic",
  "communications.basic",
  "pos.reporting.core",
  "analytics.sales.basic",
  "products.basic",
  "products.margin",
  "inventory.basic",
  "invoice.basic",
  "calendar.basic",
  "marketing.overview",
  "marketing.google_business",
  "ai.basic",
  "reporting.basic",
  "permissions.standard",
  "multi_location.basic",
] as const satisfies readonly FeatureKey[];

const growthOnlyFeatures = [
  "analytics.sales.advanced",
  "inventory.lots",
  "inventory.expiry",
  "inventory.shelf_life",
  "inventory.fefo",
  "inventory.turnover",
  "inventory.sell_through",
  "inventory.velocity",
  "inventory.days_on_hand",
  "inventory.dead_stock",
  "inventory.stockout_risk",
  "inventory.reorder_ai",
  "inventory.bring_back",
  "inventory.assortment",
  "inventory.opportunity",
  "supplier.analytics",
  "supplier.cost_trends",
  "supplier.lead_time",
  "supplier.fill_rate",
  "supplier.reliability",
  "invoice.extraction",
  "invoice.matching",
  "invoice.discrepancy",
  "invoice.credit_opportunities",
  "calendar.automation",
  "marketing.google_ads",
  "marketing.google_analytics",
  "marketing.meta_ads",
  "marketing.search_intelligence",
  "marketing.profit_attribution",
  "marketing.inventory_aware",
  "growth.strategy",
  "growth.strategy_graph",
  "growth.goals",
  "growth.opportunities",
  "pulse",
  "exceptions",
  "forecasting.revenue",
  "forecasting.demand",
  "forecasting.inventory",
  "forecasting.cash_basic",
  "ai.advanced",
  "ai.tools.sales",
  "ai.tools.inventory",
  "ai.tools.products",
  "ai.tools.marketing",
  "ai.tools.suppliers",
  "ai.tools.invoices",
  "ai.tools.customers",
  "ai.tools.strategy",
] as const satisfies readonly FeatureKey[];

const proOnlyFeatures = [
  "products.location_performance",
  "inventory.transfers",
  "marketing.optimization",
  "marketing.advanced_attribution",
  "marketing.channel_allocation",
  "forecasting.advanced",
  "forecasting.scenarios",
  "forecasting.future_obligations",
  "ai.pro",
  "multi_location.advanced",
  "multi_location.benchmarking",
  "multi_location.forecasting",
  "multi_location.marketing",
  "reporting.advanced",
  "reporting.exports",
  "reporting.custom_dashboards",
  "workflow.advanced",
  "workflow.rules",
  "permissions.advanced",
  "support.priority",
] as const satisfies readonly FeatureKey[];

const bookloqFeatures = [
  "bookloq",
  "bookloq.dashboard",
  "bookloq.chart_of_accounts",
  "bookloq.transactions",
  "bookloq.expenses",
  "bookloq.documents",
  "bookloq.ap",
  "bookloq.ar",
  "bookloq.reconciliation",
  "bookloq.financial_statements",
  "bookloq.cash_intelligence",
  "bookloq.anomaly_detection",
  "bookloq.accountant_access",
  "bookloq.ai",
] as const satisfies readonly FeatureKey[];

function uniqueFeatures(...groups: readonly (readonly FeatureKey[])[]): readonly FeatureKey[] {
  return Object.freeze([...new Set(groups.flat())]);
}

function price(amountCents: number, interval: BillingInterval, lookupKey: string): MoneyPrice {
  return Object.freeze({ currency: "CAD", amountCents, interval, lookupKey });
}

export const PLANS: Readonly<Record<PlanKey, PlanDefinition>> = Object.freeze({
  starter: Object.freeze({
    key: "starter",
    displayName: "Starter",
    description: "Core operating visibility for a smaller business.",
    mostPopular: false,
    prices: Object.freeze({
      month: price(4_900, "month", "vanteloq_starter_monthly_cad"),
      year: price(49_000, "year", "vanteloq_starter_yearly_cad"),
    }),
    limits: Object.freeze({
      activeLocations: 1,
      users: 3,
      ai: Object.freeze({ capability: "basic", requestsPerMonth: null, meteringStatus: "not_launched" }),
    }),
    features: uniqueFeatures(starterFeatures),
  }),
  growth: Object.freeze({
    key: "growth",
    displayName: "Growth",
    description: "Operational intelligence and optimization for a growing retailer.",
    mostPopular: true,
    prices: Object.freeze({
      month: price(9_900, "month", "vanteloq_growth_monthly_cad"),
      year: price(99_000, "year", "vanteloq_growth_yearly_cad"),
    }),
    limits: Object.freeze({
      activeLocations: 3,
      users: 10,
      ai: Object.freeze({ capability: "advanced", requestsPerMonth: null, meteringStatus: "not_launched" }),
    }),
    features: uniqueFeatures(starterFeatures, growthOnlyFeatures),
  }),
  pro: Object.freeze({
    key: "pro",
    displayName: "Pro",
    description: "Advanced multi-location intelligence, automation and controls.",
    mostPopular: false,
    prices: Object.freeze({
      month: price(17_900, "month", "vanteloq_pro_monthly_cad"),
      year: price(179_000, "year", "vanteloq_pro_yearly_cad"),
    }),
    limits: Object.freeze({
      activeLocations: 10,
      users: 25,
      ai: Object.freeze({ capability: "pro", requestsPerMonth: null, meteringStatus: "not_launched" }),
    }),
    features: uniqueFeatures(starterFeatures, growthOnlyFeatures, proOnlyFeatures),
  }),
});

export const ADDONS: Readonly<Record<AddonKey, AddonDefinition>> = Object.freeze({
  bookloq: Object.freeze({
    key: "bookloq",
    displayName: "BookLoq",
    prices: Object.freeze({
      month: price(3_900, "month", "bookloq_monthly_cad"),
      year: price(39_000, "year", "bookloq_yearly_cad"),
    }),
    features: uniqueFeatures(bookloqFeatures),
  }),
});

export const ALL_NORMAL_PAID_FEATURES = uniqueFeatures(
  PLANS.pro.features,
  ...Object.values(ADDONS).map((addon) => addon.features),
);

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && PLAN_KEYS.includes(value as PlanKey);
}

export function isAddonKey(value: unknown): value is AddonKey {
  return typeof value === "string" && ADDON_KEYS.includes(value as AddonKey);
}

export function planIncludesFeature(plan: PlanKey, feature: FeatureKey): boolean {
  return PLANS[plan].features.includes(feature);
}

