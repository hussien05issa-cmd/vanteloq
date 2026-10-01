import { PREVIEW_INTEGRATION_IDS } from "../domain/integration-availability";

export type IntegrationAvailability =
  | "provider_build_required"
  | "provider_access_required"
  | "credentials_required"
  | "provider_selection_required"
  | "coming_soon";

export const integrationCategoryOrder = [
  "Point of sale",
  "Commerce",
  "Payments",
  "Banking",
  "Accounting",
  "Marketplace",
  "Delivery",
  "Marketing",
  "Labour",
  "Collaboration",
  "Manual imports",
] as const;

export type IntegrationCategory = (typeof integrationCategoryOrder)[number];

export const integrationCategoryGuide: Record<IntegrationCategory, { enables: string; data: string }> = {
  "Point of sale": { enables: "Sales, product, inventory, customer, purchasing, and location views when the provider supplies the required records.", data: "Sales, line items, products, stock by location, payments, customers, suppliers, and stable location identifiers." },
  Commerce: { enables: "Channel sales, product demand, customer activity, refunds, and consolidated commerce reporting.", data: "Orders, line items, refunds, products, customers, fulfilment locations, taxes, and timestamps." },
  Payments: { enables: "Payment mix, fees, payouts, settlement timing, and POS-to-deposit reconciliation.", data: "Payments, fees, balance transactions, payouts, settlement dates, currencies, and source references." },
  Banking: { enables: "Verified cash position, bank review, reconciliation, and cash-aware purchasing for authorized finance roles.", data: "Accounts, balances, transactions, institution status, sync timestamps, and stable transaction identifiers." },
  Accounting: { enables: "Ledger-backed statements, bills, invoices, tax context, close workflows, and reconciliation.", data: "Chart of accounts, journals, bills, invoices, taxes, periods, contacts, and payment status." },
  Marketplace: { enables: "Marketplace revenue, fees, fulfilment, product demand, and settlement reconciliation.", data: "Orders, line items, fees, returns, inventory, marketplace reports, and settlements." },
  Delivery: { enables: "Delivery-channel sales, fees, refunds, store performance, and order reconciliation.", data: "Orders, items, fees, refunds, store identifiers, order state, and settlement records." },
  Marketing: { enables: "Campaign planning, spend review, attributable demand signals, and recorded marketing experiments.", data: "Campaigns, spend, clicks, attributed events, audience and location identifiers, and verified sales outcomes." },
  Labour: { enables: "Labour cost, pay-period review, staffing context, and controlled payroll reconciliation.", data: "Pay periods, hours, gross pay, employer costs, departments, locations, and protected employee identifiers." },
  Collaboration: { enables: "Share a secure Vanteloq link with one approved Slack channel after confirmation. Automatic alerts and incoming Slack activity are not enabled.", data: "The authorized workspace, channel and delivery result. Messages, files and conversations are not read. Business records remain in Vanteloq." },
  "Manual imports": { enables: "Reviewed operating or financial history when a supported direct connection is unavailable.", data: "A validated file format, stable row identifiers, dates, locations, currencies, and reviewable source totals." },
};

export type IntegrationCatalogEntry = {
  id: string;
  name: string;
  providerCompany?: string;
  category: IntegrationCategory;
  availability: IntegrationAvailability;
  activationRequirement: string;
  setupDetails?: string;
  externalApplicationUrl?: string;
  externalApplicationLabel?: string;
};

export type IntegrationPublicStatus = {
  label: string;
  tone: "setup" | "staging" | "development" | "future";
};

/**
 * Converts internal connector readiness into language that a prospective
 * customer can understand without implying production availability.
 */
export function integrationPublicStatus(provider: IntegrationCatalogEntry): IntegrationPublicStatus {
  if (PREVIEW_INTEGRATION_IDS.includes(provider.id) || provider.id === "plaid"
    || provider.availability !== "credentials_required") return { label: "Coming Soon", tone: "future" };
  return { label: "Available", tone: "setup" };
}

export const salesChannelGroups = [
  { label: "Point of Sale", providers: ["Lightspeed", "Square", "Clover", "Shopify POS", "Moneris"] },
  { label: "E-commerce", providers: ["Shopify"] },
  { label: "Delivery", providers: ["DoorDash", "Uber Eats"] },
  { label: "Payments", providers: ["Stripe", "Square", "Moneris"] },
  { label: "Accounting", providers: ["QuickBooks", "Xero"] },
  { label: "Marketing", providers: ["Google", "Meta"] },
  { label: "People & collaboration", providers: ["Deel", "Slack"] },
] as const;

export const integrationCatalog: readonly IntegrationCatalogEntry[] = [
  {
    id: "lightspeed",
    name: "Lightspeed Retail X-Series",
    providerCompany: "Lightspeed Commerce Inc. and its affiliates",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "Connect an X-Series retailer to import sales, products, categories, stock, customers and suppliers. Map outlets and review the completed import before enabling reports.",
  },
  {
    id: "lightspeed-r",
    name: "Lightspeed Retail R-Series",
    providerCompany: "Lightspeed Commerce Inc. and its affiliates",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "The R-Series connection securely imports sales and inventory for each authorized retailer account while keeping every source traceable.",
  },
  {
    id: "shopify",
    name: "Shopify",
    providerCompany: "Shopify Inc.",
    category: "Commerce",
    availability: "credentials_required",
    activationRequirement: "Coming soon. Bring online orders, products and inventory into one reviewed view.",
    setupDetails: "The Shopify connector is built, but public installs are waiting for App Store registration and review. After approval, authorize your store, map its storefront and fulfilment locations, then review imported orders, refunds, products and stock before using the results.",
  },
  {
    id: "shopify-pos",
    name: "Shopify POS",
    providerCompany: "Shopify Inc.",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement: "Coming soon. See in-store sales, products and stock alongside your other locations.",
    setupDetails: "The Shopify POS connector is built, but public installs are waiting for App Store registration and review. After approval, authorize your store, map its retail locations, then review imported POS orders, tenders, products and stock before using the results.",
  },
  {
    id: "square",
    name: "Square",
    providerCompany: "Block, Inc.",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "Authorize each seller with read-only access, map locations, then securely import and reconcile completed orders, tenders, catalog, customers and inventory. Signed Square updates trigger recoverable refreshes without exposing card data.",
  },
  {
    id: "clover",
    name: "Clover",
    providerCompany: "Clover Network, LLC, a Fiserv company",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement: "Coming soon. Explore sales, products and customer trends from your Clover account.",
    setupDetails: "Clover is being prepared for merchant access. Authorized test imports stage orders, items, inventory, customers and payments. App approval and financial reconciliation are still required; these records do not yet contribute to business reports.",
  },
  {
    id: "stripe",
    name: "Stripe",
    providerCompany: "Stripe, Inc.",
    category: "Payments",
    availability: "credentials_required",
    activationRequirement:
      "Connect Stripe to review payments, fees and payouts. Check a sample before adding reviewed records to your reports.",
  },
  {
    id: "moneris",
    name: "Moneris",
    providerCompany: "Moneris Solutions Corporation",
    category: "Payments",
    availability: "credentials_required",
    activationRequirement: "Coming soon. Review payment history and compare it with your sales and deposits.",
    setupDetails: "Connect your own Moneris merchant credentials for read-only payment imports. Imported payments stay separate from business reports while currency, refund and settlement reconciliation are completed. Vanteloq does not store raw card data.",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    providerCompany: "Intuit Inc.",
    category: "Accounting",
    availability: "credentials_required",
    activationRequirement: "Coming soon. Connect QuickBooks accounting records with your business insights.",
    setupDetails: "The read only QuickBooks Online authorization and company verification boundary is built. Sandbox remains staging only while ledger import, account and tax mapping, reconciliation, closed-period handling, recovery tests, and Intuit production review are completed.",
  },
  {
    id: "xero",
    name: "Xero",
    providerCompany: "Xero Limited",
    category: "Accounting",
    availability: "provider_build_required",
    activationRequirement: "Coming soon. Bring your accounting records and business performance into one view.",
    setupDetails: "Not available yet. A production connection still needs authorization, tenant selection, account and tax mapping, incremental import, and conflict recovery tests.",
  },
  {
    id: "doordash",
    name: "DoorDash",
    providerCompany: "DoorDash, Inc.",
    category: "Delivery",
    availability: "coming_soon",
    activationRequirement: "Coming soon. See delivery orders, fees and refunds alongside other sales channels.",
    setupDetails: "Coming soon. DoorDash Marketplace orders, menus, stores, fees, and payout reconciliation will remain unavailable until partner access and Vanteloq reconciliation tests are complete.",
  },
  {
    id: "uber-eats",
    name: "Uber Eats",
    providerCompany: "Uber Technologies, Inc.",
    category: "Delivery",
    availability: "coming_soon",
    activationRequirement: "Coming soon. Review delivery sales, refunds and settlement activity in one place.",
    setupDetails: "Coming soon. Uber Eats orders, stores, fees, refunds, and settlement reconciliation will remain unavailable until partner access and Vanteloq reconciliation tests are complete.",
  },
  {
    id: "google",
    name: "Google",
    providerCompany: "Google LLC",
    category: "Marketing",
    availability: "credentials_required",
    activationRequirement:
      "Connect an owned Business Profile location, Search Console site and Analytics property for verified visibility reporting. Current reviews load only when requested and a reply is sent only after explicit confirmation. Google Ads reporting requires Google Cloud project access and your authorized ad account.",
  },
  {
    id: "meta",
    name: "Meta",
    providerCompany: "Meta Platforms, Inc.",
    category: "Marketing",
    availability: "credentials_required",
    activationRequirement: "Coming soon. Review advertising performance alongside your business results.",
    setupDetails: "Meta advertising requires app credentials, the required permissions and provider review before customer connections can be enabled. Facebook and Instagram organic insights are not currently available. After activation, select the exact ad account and review a sample. Spend, reach, clicks, CTR and CPC remain source-linked; campaign status and supported daily-budget changes require an explicit owner confirmation.",
  },
  {
    id: "plaid",
    name: "Plaid",
    providerCompany: "Plaid Inc.",
    category: "Banking",
    availability: "credentials_required",
    activationRequirement: "Coming soon. Connect bank balances and transactions to BookLoQ. You can review bank statements in Documents today.",
    setupDetails: "The BookLoQ bank-feed adapter uses resumable Plaid Link, encrypted tokens, signed webhooks, repair mode, cursor sync, balances, and reviewed transactions. Production access still requires Plaid approval, Canadian institution testing, and hosted credentials.",
  },
  {
    id: "deel",
    name: "Deel",
    providerCompany: "Deel Inc.",
    category: "Labour",
    availability: "credentials_required",
    activationRequirement: "Coming soon. Reconcile finalized payroll-cycle totals with labour cost, cash planning and BookLoQ without exposing individual payroll details.",
    setupDetails: "Vanteloq is preparing a read-only Deel connection for aggregate payroll-cycle evidence. Public access requires a Deel organization app, sandbox payroll verification, partner review and production approval. Employee names, banking details and payslip files are outside the initial connection.",
  },
  {
    id: "slack",
    name: "Slack",
    providerCompany: "Slack Technologies, LLC, a Salesforce company",
    category: "Collaboration",
    availability: "credentials_required",
    activationRequirement: "Share a secure Vanteloq link with one approved Slack channel. Choose the channel, confirm each message and keep business records inside Vanteloq.",
    setupDetails: "Direct installation is enabled for Slack workspaces. Test delivery, share a sign-in link or disconnect access. Vanteloq does not read messages, files or conversations. Incoming activity and automatic alerts need additional implementation and permissions; they are not enabled by this connection.",
  },
] as const;

export const preSyncControls = [
  {
    id: "tenant",
    label: "Organization separation",
    detail: "Records are limited to the signed-in organization, with automated boundary tests in place.",
    status: "verified",
  },
  {
    id: "permissions",
    label: "Access by role",
    detail: "Integration, finance, and export permissions are checked on the server for every request.",
    status: "verified",
  },
  {
    id: "integrity",
    label: "Change history and duplicate safety",
    detail: "Important changes are recorded, and repeated requests do not create duplicate work.",
    status: "verified",
  },
  {
    id: "money",
    label: "Financial precision",
    detail: "Financial amounts retain exact cents throughout calculations and storage.",
    status: "verified",
  },
  {
    id: "authorization",
    label: "Provider authorization",
    detail: "Lightspeed, Clover, Stripe, QuickBooks, Google, and Meta use state-bound authorization with only the required access; Plaid uses short-lived Link sessions. Provider credentials stay server-side and encrypted where stored, and providers without a working connection remain disabled.",
    status: "verified",
  },
  {
    id: "webhooks",
    label: "Change-signal security",
    detail: "Built X-Series, Stripe, and Plaid update endpoints verify signed events, reject oversized payloads, and preserve idempotent webhook receipts. Scheduled refresh remains the fallback while durable delivery recovery is still gated.",
    status: "verified",
  },
  {
    id: "normalization",
    label: "Backfill and normalization",
    detail: "Both Lightspeed connections import history in safe batches, map locations, and recover from interrupted updates; Stripe and Plaid use bounded pagination, retries, or resumable cursors. Only reviewed, approved, and reconciled records can reach dependent metrics.",
    status: "verified",
  },
  {
    id: "reconciliation",
    label: "Reconciliation and recovery",
    detail: "Source totals, tax, discounts, refunds, duplicates, payout timing, and recovery checks must pass before dashboard results can use the data.",
    status: "gated",
  },
] as const;
