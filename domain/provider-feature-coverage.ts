export type CanonicalCommerceCoverage = {
  sales: boolean;
  payments: boolean;
  products: boolean;
  inventory: boolean;
  customers: boolean;
  suppliers: boolean;
  locations: boolean;
};

type CoverageKey = keyof CanonicalCommerceCoverage;

export type ProviderFeatureCoverage = {
  id: string;
  label: string;
  status: "ready" | "needs_data";
  dataNeeded: CoverageKey[];
  dataUsed: CoverageKey[];
  insight: string;
  provider: string;
};

const featureContracts: Array<{
  id: string;
  label: string;
  required: CoverageKey[];
  insight: string;
}> = [
  {
    id: "sales_performance",
    label: "Sales performance",
    required: ["sales", "locations"],
    insight: "Revenue, order volume, average order value, trend and store comparison.",
  },
  {
    id: "payment_mix",
    label: "Payment mix",
    required: ["sales", "payments"],
    insight: "Tender share, collected amount and payment reconciliation coverage.",
  },
  {
    id: "inventory_health",
    label: "Inventory health",
    required: ["products", "inventory", "sales"],
    insight: "Days of cover, stockout risk, slow movement and incoming-order context.",
  },
  {
    id: "reorder_intelligence",
    label: "Reorder intelligence",
    required: ["products", "inventory", "sales", "suppliers"],
    insight: "Demand-based order quantities with supplier and verified cash constraints.",
  },
  {
    id: "customer_intelligence",
    label: "Customer intelligence",
    required: ["customers", "sales"],
    insight: "Repeat activity, customer value and retention signals without invented identity matches.",
  },
  {
    id: "supplier_performance",
    label: "Supplier performance",
    required: ["products", "suppliers", "inventory"],
    insight: "Supplier coverage, product exposure and purchasing follow-up requirements.",
  },
  {
    id: "location_comparison",
    label: "Location comparison",
    required: ["locations", "sales", "inventory"],
    insight: "Store-level demand, inventory and operating comparisons using mapped source locations.",
  },
];

export function buildProviderFeatureCoverage(
  provider: string,
  coverage: CanonicalCommerceCoverage,
): ProviderFeatureCoverage[] {
  return featureContracts.map((feature) => {
    const dataNeeded = feature.required.filter((key) => !coverage[key]);
    return {
      id: feature.id,
      label: feature.label,
      status: dataNeeded.length === 0 ? "ready" : "needs_data",
      dataNeeded,
      dataUsed: [...feature.required],
      insight: feature.insight,
      provider,
    };
  });
}
