import type { CanonicalCommerceCoverage } from "./provider-feature-coverage.ts";

type CoverageKey = keyof CanonicalCommerceCoverage;

export const reportCapableCommerceProviders = [
  "lightspeed",
  "lightspeed-r",
  "shopify",
  "shopify-pos",
  "square",
  "clover",
  "moneris",
  "doordash",
  "uber-eats",
] as const;

export type ProviderVocabulary = {
  sale: string;
  sales: string;
  location: string;
  product: string;
  customer: string;
  payment: string;
};

export type ProviderReportDefinition = {
  id: string;
  label: string;
  description: string;
  status: "ready" | "needs_data";
  dataUsed: CoverageKey[];
  dataNeeded: CoverageKey[];
  sourceMode: "canonical" | "provider_specific";
  implementationStatus: "available" | "planned";
  queryReportId: "sales_totals" | null;
  presentation: "sales" | "payment_mix" | null;
};

const vocabularies: Record<string, ProviderVocabulary> = {
  "lightspeed-r": { sale: "Sale", sales: "Sales", location: "Shop", product: "Item", customer: "Customer", payment: "Payment" },
  lightspeed: { sale: "Sale", sales: "Sales", location: "Outlet", product: "Product", customer: "Customer", payment: "Payment" },
  "shopify-pos": { sale: "Order", sales: "Orders", location: "Location", product: "Product", customer: "Customer", payment: "Payment" },
  shopify: { sale: "Order", sales: "Orders", location: "Channel", product: "Product", customer: "Customer", payment: "Payment" },
  square: { sale: "Order", sales: "Orders", location: "Location", product: "Catalog item", customer: "Customer", payment: "Tender" },
  clover: { sale: "Order", sales: "Orders", location: "Merchant location", product: "Item", customer: "Customer", payment: "Tender" },
  moneris: { sale: "Transaction", sales: "Transactions", location: "Merchant location", product: "Product", customer: "Customer", payment: "Settlement" },
  doordash: { sale: "Delivery order", sales: "Delivery orders", location: "Store", product: "Menu item", customer: "Customer", payment: "Payout" },
  "uber-eats": { sale: "Delivery order", sales: "Delivery orders", location: "Store", product: "Menu item", customer: "Customer", payment: "Payout" },
};

const canonicalContracts: Array<Omit<ProviderReportDefinition, "status" | "dataNeeded">> = [
  { id: "sales_performance", label: "Sales performance", description: "Revenue, order volume, average transaction value, and trend.", dataUsed: ["sales", "locations"], sourceMode: "canonical", implementationStatus: "available", queryReportId: "sales_totals", presentation: "sales" },
  { id: "payment_mix", label: "Payment mix", description: "Tender share and collected amounts from verified payment facts.", dataUsed: ["sales", "payments"], sourceMode: "canonical", implementationStatus: "available", queryReportId: "sales_totals", presentation: "payment_mix" },
  { id: "inventory_health", label: "Inventory health", description: "Stock cover, movement, and stockout risk.", dataUsed: ["products", "inventory", "sales"], sourceMode: "canonical", implementationStatus: "planned", queryReportId: null, presentation: null },
  { id: "customer_intelligence", label: "Customer intelligence", description: "Repeat activity and retention signals from linked customer facts.", dataUsed: ["customers", "sales"], sourceMode: "canonical", implementationStatus: "planned", queryReportId: null, presentation: null },
  { id: "supplier_performance", label: "Supplier performance", description: "Supplier exposure, product coverage, and purchasing follow-up.", dataUsed: ["products", "suppliers", "inventory"], sourceMode: "canonical", implementationStatus: "planned", queryReportId: null, presentation: null },
  { id: "location_comparison", label: "Location comparison", description: "Mapped store performance and inventory comparison.", dataUsed: ["locations", "sales", "inventory"], sourceMode: "canonical", implementationStatus: "planned", queryReportId: null, presentation: null },
];

function report(
  id: string,
  label: string,
  description: string,
  dataUsed: CoverageKey[],
  implementation: Pick<ProviderReportDefinition, "implementationStatus" | "queryReportId" | "presentation"> = { implementationStatus: "planned", queryReportId: null, presentation: null },
): Omit<ProviderReportDefinition, "status" | "dataNeeded"> {
  return { id, label, description, dataUsed, sourceMode: "provider_specific", ...implementation };
}

function providerContracts(provider: string, vocabulary: ProviderVocabulary) {
  const generic = [
    report(`${provider}_sales_performance`, `${vocabulary.sales} performance`, `Uses the provider's ${vocabulary.sales.toLowerCase()} terminology while retaining Vanteloq's canonical sales math.`, ["sales", "locations"], { implementationStatus: "available", queryReportId: "sales_totals", presentation: "sales" }),
    report(`${provider}_product_performance`, `${vocabulary.product} performance`, `Sales and movement grouped by the provider's ${vocabulary.product.toLowerCase()} records.`, ["sales", "products"]),
    report(`${provider}_payment_performance`, `${vocabulary.payment} performance`, `Collected value and count grouped by the provider's ${vocabulary.payment.toLowerCase()} fields.`, ["sales", "payments"], { implementationStatus: "available", queryReportId: "sales_totals", presentation: "payment_mix" }),
  ];
  if (provider === "moneris") {
    generic.push(report("moneris_settlement_reconciliation", "Settlement reconciliation", "Compares imported Moneris settlement facts with canonical sales and bank evidence.", ["payments"]));
  }
  if (provider === "doordash" || provider === "uber-eats") {
    generic.push(
      report(`${provider}_delivery_fees`, "Delivery fees and net proceeds", `Separates ${provider === "doordash" ? "DoorDash" : "Uber Eats"} order value, fees, refunds, and payout evidence.`, ["sales", "payments"]),
      report(`${provider}_store_performance`, "Delivery store performance", "Compares mapped delivery-store demand without mixing it into in-store sales unless source authority is explicit.", ["sales", "locations", "products"]),
    );
  }
  return generic;
}

function resolveDefinitions(
  definitions: Array<Omit<ProviderReportDefinition, "status" | "dataNeeded">>,
  coverage: CanonicalCommerceCoverage,
): ProviderReportDefinition[] {
  return definitions.map((definition) => {
    const dataNeeded = definition.dataUsed.filter((key) => !coverage[key]);
    return { ...definition, dataNeeded, status: dataNeeded.length || definition.implementationStatus !== "available" ? "needs_data" : "ready" };
  });
}

export function buildCanonicalReportCatalog(coverage: CanonicalCommerceCoverage) {
  return resolveDefinitions(canonicalContracts, coverage);
}

export function providerVocabulary(provider: string): ProviderVocabulary {
  return vocabularies[provider] ?? { sale: "Transaction", sales: "Transactions", location: "Location", product: "Product", customer: "Customer", payment: "Payment" };
}

export function buildProviderReportCatalog(input: {
  provider: string;
  connectionId: string;
  coverage: CanonicalCommerceCoverage;
}) {
  const vocabulary = providerVocabulary(input.provider);
  return {
    provider: input.provider,
    connectionId: input.connectionId,
    vocabulary,
    canonicalReports: buildCanonicalReportCatalog(input.coverage),
    providerReports: resolveDefinitions(providerContracts(input.provider, vocabulary), input.coverage),
    boundary: "Canonical reports use Vanteloq definitions. Provider reports retain source terminology and never silently change consolidated totals.",
  };
}

export type ReportSourceCandidate = {
  provider: string;
  connectionId: string;
  locationId: string;
  lastSuccessfulSyncAt: string | null;
  metricLocationRef?: string;
  externalOutletRef?: string;
  accountName?: string | null;
  hasFacts?: boolean;
  availability?: "ready" | "syncing" | "staging" | "unavailable" | "needs_data";
};

export function resolveReportSourceAuthority(input: {
  candidates: readonly ReportSourceCandidate[];
  preferredConnectionId: string | null;
}) {
  const unique = [...new Map(input.candidates.map((candidate) => [candidate.connectionId, candidate])).values()];
  if (!unique.length) return {
    status: "missing" as const,
    selected: null,
    excludedConnectionIds: [] as string[],
    reason: "No approved reporting source is mapped to this location.",
  };
  if (unique.length === 1) return {
    status: "automatic" as const,
    selected: unique[0],
    excludedConnectionIds: [] as string[],
    reason: "The only approved mapped source is authoritative.",
  };
  const selected = input.preferredConnectionId
    ? unique.find((candidate) => candidate.connectionId === input.preferredConnectionId) ?? null
    : null;
  if (!selected) return {
    status: "conflict" as const,
    selected: null,
    excludedConnectionIds: [] as string[],
    reason: "Choose one reporting source for this location before combining overlapping sales.",
  };
  return {
    status: "selected" as const,
    selected,
    excludedConnectionIds: unique.filter((candidate) => candidate.connectionId !== selected.connectionId).map((candidate) => candidate.connectionId).sort(),
    reason: "Consolidated reporting uses the owner-selected connection and excludes overlapping sources.",
  };
}

export function selectAuthoritativeReportScopes(input: {
  candidates: readonly ReportSourceCandidate[];
  preferredConnectionId: string | null;
}) {
  const eligibleScopes = input.candidates.filter((candidate) => candidate.hasFacts !== false && (candidate.availability ?? "ready") === "ready");
  const connectionCandidates = [...new Map(eligibleScopes.map((candidate) => [candidate.connectionId, candidate])).values()];
  const resolution = resolveReportSourceAuthority({
    candidates: connectionCandidates,
    preferredConnectionId: input.preferredConnectionId,
  });
  return {
    resolution,
    selectedScopes: resolution.selected
      ? eligibleScopes.filter((candidate) => candidate.connectionId === resolution.selected!.connectionId)
      : [],
  };
}
