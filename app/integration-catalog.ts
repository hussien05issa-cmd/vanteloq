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
  "Manual imports": { enables: "Reviewed operating or financial history when a supported direct connection is unavailable.", data: "A validated file format, stable row identifiers, dates, locations, currencies, and reviewable source totals." },
};

export type IntegrationCatalogEntry = {
  id: string;
  name: string;
  category: IntegrationCategory;
  availability: IntegrationAvailability;
  activationRequirement: string;
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
  if (provider.id === "quickbooks") return { label: "Sandbox only", tone: "staging" };
  if (provider.id === "plaid") return { label: "Production approval needed", tone: "staging" };

  switch (provider.availability) {
    case "credentials_required":
      return { label: "Setup required", tone: "setup" };
    case "provider_access_required":
      return { label: "Provider access needed", tone: "setup" };
    case "provider_build_required":
      return { label: "In development", tone: "development" };
    case "provider_selection_required":
      return { label: "Provider selection needed", tone: "development" };
    case "coming_soon":
      return { label: "Coming soon", tone: "future" };
  }
}

export const salesChannelGroups = [
  { label: "Point of Sale", providers: ["Lightspeed", "Square", "Clover", "Shopify POS", "Moneris"] },
  { label: "E-commerce", providers: ["Shopify"] },
  { label: "Delivery", providers: ["DoorDash", "Uber Eats"] },
  { label: "Payments", providers: ["Stripe", "Square", "Moneris"] },
  { label: "Accounting", providers: ["QuickBooks", "Xero"] },
  { label: "Marketing", providers: ["Google", "Meta"] },
] as const;

export const integrationCatalog: readonly IntegrationCatalogEntry[] = [
  {
    id: "lightspeed",
    name: "Lightspeed Retail X-Series",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "The X-Series connection is built. Authorize a store, map outlets, and review a sample before dashboard results can use the data.",
  },
  {
    id: "lightspeed-r",
    name: "Lightspeed Retail R-Series",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "The R-Series connection securely imports sales and inventory for each authorized retailer account while keeping every source traceable.",
  },
  {
    id: "shopify",
    name: "Shopify",
    category: "Commerce",
    availability: "credentials_required",
    activationRequirement:
      "Authorize each Shopify store, map its online storefront and fulfilment locations, then import and review e-commerce orders, refunds, products, stock, customers and payment activity before results reach Vanteloq.",
  },
  {
    id: "shopify-pos",
    name: "Shopify POS",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "Authorize each Shopify store, map its retail locations, then import and review POS orders, tenders, products, stock, customers and suppliers before results reach Vanteloq.",
  },
  {
    id: "square",
    name: "Square",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "Authorize each seller with read-only access, map locations, then securely import and reconcile completed orders, tenders, catalog, customers and inventory. Signed Square updates trigger recoverable refreshes without exposing card data.",
  },
  {
    id: "clover",
    name: "Clover",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "Authorize each merchant with read-only access, map its business location, stage orders, items, inventory, customers and tender activity, then review the reconciliation before publishing dashboards.",
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "Payments",
    availability: "credentials_required",
    activationRequirement:
      "The Stripe Connect adapter is built for balance transactions and payouts. Authorize an account, then reconcile a staged sample before promotion.",
  },
  {
    id: "moneris",
    name: "Moneris",
    category: "Payments",
    availability: "credentials_required",
    activationRequirement:
      "Connect each merchant with its own read-only Moneris client credentials. Vanteloq imports payment amounts, status and timing for reconciliation without storing raw card data.",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "Accounting",
    availability: "credentials_required",
    activationRequirement:
      "The read only QuickBooks Online authorization and company verification boundary is built. Sandbox remains staging only while ledger import, account and tax mapping, reconciliation, closed-period handling, recovery tests, and Intuit production review are completed.",
  },
  {
    id: "xero",
    name: "Xero",
    category: "Accounting",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs authorization, tenant selection, account and tax mapping, incremental import, and conflict recovery tests.",
  },
  {
    id: "doordash",
    name: "DoorDash",
    category: "Delivery",
    availability: "coming_soon",
    activationRequirement:
      "Coming soon. DoorDash Marketplace orders, menus, stores, fees, and payout reconciliation will remain unavailable until partner access and Vanteloq reconciliation tests are complete.",
  },
  {
    id: "uber-eats",
    name: "Uber Eats",
    category: "Delivery",
    availability: "coming_soon",
    activationRequirement:
      "Coming soon. Uber Eats orders, stores, fees, refunds, and settlement reconciliation will remain unavailable until partner access and Vanteloq reconciliation tests are complete.",
  },
  {
    id: "google",
    name: "Google",
    category: "Marketing",
    availability: "credentials_required",
    activationRequirement:
      "Connect an owned Business Profile location, Search Console site and Analytics property for verified visibility reporting. Current reviews load only when requested and a reply is sent only after explicit confirmation. Google Ads reporting activates separately when its developer token is configured.",
  },
  {
    id: "meta",
    name: "Meta",
    category: "Marketing",
    availability: "credentials_required",
    activationRequirement:
      "Authorize Meta, select the exact ad account, and approve a sample before reporting begins. Spend, reach, clicks, CTR and CPC remain source-linked; campaign status and supported daily-budget changes require an explicit owner confirmation.",
  },
  {
    id: "plaid",
    name: "Plaid",
    category: "Banking",
    availability: "credentials_required",
    activationRequirement:
      "The BookLoQ bank-feed adapter uses resumable Plaid Link, encrypted tokens, signed webhooks, repair mode, cursor sync, balances, and reviewed transactions. Production access still requires Plaid approval, Canadian institution testing, and hosted credentials.",
  },
  {
    id: "payroll",
    name: "Payroll",
    category: "Labour",
    availability: "provider_selection_required",
    activationRequirement:
      "Choose a payroll provider before Vanteloq can define account permissions, pay-period mapping, privacy boundaries, and reconciliation tests.",
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
