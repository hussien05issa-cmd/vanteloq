import { connectorHealth, type Connector } from "./connector-guidance";
import { customerIntegrationAvailability } from "./integration-availability";
import type { CanonicalCommerceCoverage } from "./provider-feature-coverage";
import { buildProviderReportCatalog } from "./provider-report-contracts";
import { aggregateConnectionReadiness, type ConnectionDataReadiness } from "./integration-data-readiness";

export type IntegrationCapabilityInput = Omit<Connector, "connections"> & {
  canonicalCoverage?: CanonicalCommerceCoverage;
  dataReadiness?: ConnectionDataReadiness;
  connections?: readonly (NonNullable<Connector["connections"]>[number] & { id?: string; dataReadiness?: ConnectionDataReadiness })[];
  providerReadiness: null | (NonNullable<Connector["providerReadiness"]> & { supportedDatasets?: readonly string[] });
};
type RecordClass = keyof CanonicalCommerceCoverage | "sale_lines" | "balances" | "bank_transactions" | "balance_transactions" | "fees" | "payouts" | "analytics" | "search_visibility" | "business_profile" | "ad_metrics" | "company_identity" | "payroll_cycles" | "payroll_totals" | "channel";
type Action = { id: string; label: string; direction: "inbound" | "outbound" | "local"; confirmationRequired: boolean; requiredRecords: readonly RecordClass[] };
type Definition = {
  direction: "inbound" | "outbound" | "both" | "none";
  scope: "commerce" | "review_only" | "marketing" | "banking" | "identity_only" | "channel" | "unimplemented";
  summary: string;
  records: readonly RecordClass[];
  actions: readonly Action[];
  limits: readonly string[];
};
const labels: Record<RecordClass, string> = {
  sales: "Sales and orders", sale_lines: "Sale line items", payments: "Payments", products: "Products", inventory: "Stock by location", customers: "Customer records", suppliers: "Suppliers", locations: "Mapped locations",
  balances: "Bank balances", bank_transactions: "Bank transactions", balance_transactions: "Balance transactions", fees: "Fees", payouts: "Payouts", analytics: "Analytics measurements", search_visibility: "Search visibility", business_profile: "Business Profile measurements and requested reviews", ad_metrics: "Advertising measurements", company_identity: "Company identity", payroll_cycles: "Finalized payroll cycles", payroll_totals: "Aggregate payroll totals", channel: "Authorized Slack channel",
};
const importAction: Action = { id: "import_records", label: "Import and review records", direction: "inbound", confirmationRequired: false, requiredRecords: [] };
const reviewAction: Action = { id: "review_records", label: "Review imported records", direction: "local", confirmationRequired: false, requiredRecords: [] };
const commonCommerce: Definition = {
  direction: "inbound", scope: "commerce", summary: "Review sales, products and stock from the authorized business account.",
  records: ["sales", "sale_lines", "payments", "products", "inventory", "customers", "locations"], actions: [importAction, reviewAction],
  limits: ["Map locations and review complete imports before using eligible records in reports.", "Missing costs, incomplete periods and source conflicts remain visible. The connection does not write to the POS."],
};
// Scope follows actual importers in server/integrations/sync. These definitions are
// implementation descriptions, never a substitute for rollout, consent or record-level coverage.
const definitions: Record<string, Definition> = {
  "lightspeed-r": { ...commonCommerce, records: [...commonCommerce.records, "suppliers"] },
  lightspeed: { ...commonCommerce, records: [...commonCommerce.records, "suppliers"] },
  square: commonCommerce,
  clover: commonCommerce,
  shopify: { ...commonCommerce, summary: "Review online orders, products, payments and stock from the authorized Shopify store." },
  "shopify-pos": { ...commonCommerce, summary: "Review in-store Shopify orders, products, payments and stock for mapped retail locations." },
  stripe: { direction: "inbound", scope: "review_only", summary: "Inspect Stripe balance transactions, fees and payouts in a review sample.", records: ["balance_transactions", "fees", "payouts"], actions: [importAction, reviewAction], limits: ["These imports remain separate from revenue and posted accounting totals.", "Connecting a merchant's Stripe records is separate from paying for a Vanteloq subscription."] },
  moneris: { direction: "inbound", scope: "review_only", summary: "Inspect imported Moneris payment records without treating deposits as sales.", records: ["payments"], actions: [importAction, reviewAction], limits: ["Refund and settlement reconciliation is incomplete. Imported payment totals do not establish net sales or settlement balances.", "Raw card data is not stored."] },
  deel: { direction: "inbound", scope: "review_only", summary: "Review finalized payroll-cycle evidence and aggregate gross-to-net totals.", records: ["company_identity", "payroll_cycles", "payroll_totals"], actions: [importAction, reviewAction], limits: ["Payroll evidence remains in review and is not automatically posted to BookLoQ or operating results.", "Employee records, banking details and payslip files are not imported. Vanteloq does not run payroll."] },
  quickbooks: { direction: "inbound", scope: "identity_only", summary: "Authorize and verify the QuickBooks company identity.", records: ["company_identity"], actions: [{ id: "verify_company", label: "Verify company", direction: "inbound", confirmationRequired: false, requiredRecords: ["company_identity"] }], limits: ["Ledger, invoice, bill and tax imports are not enabled. Company authorization alone does not populate BookLoQ."] },
  plaid: { direction: "inbound", scope: "banking", summary: "Review bank balances and imported transactions in BookLoQ.", records: ["balances", "bank_transactions"], actions: [importAction, reviewAction], limits: ["Production access and institution coverage must be available. Finance review is required before imported records enter business accounts.", "Bank inflows do not automatically become sales revenue."] },
  google: { direction: "both", scope: "marketing", summary: "Review measurements from selected Analytics, Search Console and Business Profile resources.", records: ["analytics", "search_visibility", "business_profile"], actions: [importAction, reviewAction, { id: "reply_to_review", label: "Confirm a Business Profile review reply", direction: "outbound", confirmationRequired: true, requiredRecords: ["business_profile"] }], limits: ["Only selected resources belonging to this business should enter reports.", "Business Profile and Google Ads require their own provider access. A review reply is sent only after explicit confirmation.", "Advertising attribution is provider-reported and is not accounting revenue."] },
  meta: { direction: "both", scope: "marketing", summary: "Review measurements from selected Meta advertising accounts.", records: ["ad_metrics"], actions: [importAction, reviewAction, { id: "update_campaign", label: "Confirm a campaign status or daily-budget change", direction: "outbound", confirmationRequired: true, requiredRecords: ["ad_metrics"] }], limits: ["Required Meta permissions and app review must be approved for the account.", "Facebook and Instagram organic insights are not imported. Attributed outcomes are not accounting revenue.", "Supported campaign changes require explicit confirmation."] },
  slack: { direction: "outbound", scope: "channel", summary: "Share a secure Vanteloq sign-in link with one approved Slack channel.", records: ["channel"], actions: [{ id: "send_test", label: "Send a data-free connection test", direction: "outbound", confirmationRequired: true, requiredRecords: ["channel"] }, { id: "share_workspace", label: "Share a secure Vanteloq link", direction: "outbound", confirmationRequired: true, requiredRecords: ["channel"] }], limits: ["Messages, files and conversations are not read.", "Automatic alerts and incoming Slack activity are not enabled. Each outgoing message requires confirmation."] },
};
const unavailable: Definition = { direction: "none", scope: "unimplemented", summary: "This connection is not available yet.", records: [], actions: [], limits: ["Use an available connection or a supported file import while this integration is being prepared."] };
const emptyCoverage: CanonicalCommerceCoverage = { sales: false, payments: false, products: false, inventory: false, customers: false, suppliers: false, locations: false };

export function hasCanonicalCommerceMapping(provider: string) { return definitions[provider]?.scope === "commerce"; }

/** Customer-facing scope only. Server permissions, source authority and financial review remain authoritative. */
export function buildIntegrationCapabilities(provider: IntegrationCapabilityInput) {
  const id = provider.id ?? "";
  const definition = definitions[id] ?? unavailable;
  const health = connectorHealth(provider);
  const availability = customerIntegrationAvailability(provider);
  const records = [...definition.records];
  const dataReadiness = definition.scope === "commerce" ? aggregateConnectionReadiness(provider.connections?.flatMap(connection => connection.dataReadiness ? [connection.dataReadiness] : []) ?? (provider.dataReadiness ? [provider.dataReadiness] : [])) : [];
  if (id === "google" && provider.providerReadiness?.supportedDatasets?.includes("google_ads")) records.push("ad_metrics");
  const reporting = definition.scope === "unimplemented" ? "unavailable" as const
    : definition.scope === "channel" || definition.scope === "identity_only" ? "not_applicable" as const
      : definition.scope === "review_only" ? "review_only" as const
        : health.state === "synced" && provider.dataPromotionStatus === "approved" ? "approved_records" as const : "review_required" as const;
  // Existing contracts own required records and implementation status. Never turn
  // planned provider reports into promises simply because coverage booleans exist.
  const reports = definition.scope === "commerce" ? buildProviderReportCatalog({ provider: id, connectionId: "", coverage: provider.canonicalCoverage ?? emptyCoverage }).providerReports
    .filter(report => report.implementationStatus === "available")
    .map(report => {
      const key = report.presentation === "payment_mix" ? "payment_mix" : "sales_performance";
      const readiness = dataReadiness.find(metric => metric.id === key)!;
      return { id: report.id, label: report.label, requiredRecords: report.dataUsed, missingRecords: report.dataNeeded,
        ready: reporting === "approved_records" && readiness.ready, state: readiness.state, readyConnectionIds: readiness.readyConnectionIds, reason: readiness.reason };
    }) : [];
  const scheduled = provider.automaticSync ?? provider.connections?.find(connection => connection.automaticSync)?.automaticSync;
  const freshness = definition.scope === "channel" || definition.scope === "identity_only" || definition.scope === "unimplemented"
    ? { model: "not_applicable" as const, detail: "This connection does not run a financial data sync." }
    : scheduled ? { model: "scheduled_or_manual" as const, detail: scheduled.enabled
      ? "Automatic updates are enabled for a connected account. Review each account's schedule and latest completed import."
      : "Import on request or enable the available automatic-sync control. Review each account's setting." }
      : { model: "on_demand" as const, detail: "Records update when a supported import is requested. Check the last completed import before using time-sensitive results." };
  return {
    provider: id, direction: definition.direction, scope: definition.scope, summary: definition.summary,
    publiclyAvailable: definition.scope !== "unimplemented" && !availability.comingSoon, reportingEligibility: reporting,
    records: records.map(record => ({ id: record, label: labels[record] })),
    actions: definition.actions.map(action => ({ ...action, requiredRecords: [...action.requiredRecords] })),
    reports, dataReadiness, freshness, limitations: [...definition.limits],
  };
}
export type IntegrationCapabilities = ReturnType<typeof buildIntegrationCapabilities>;
