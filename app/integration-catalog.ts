export type IntegrationAvailability =
  | "provider_build_required"
  | "credentials_required"
  | "provider_selection_required";

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
};

export const salesChannelGroups = [
  { label: "Point of Sale", providers: ["Lightspeed", "Square", "Clover", "Shopify POS", "Moneris"] },
  { label: "E-commerce", providers: ["Shopify", "Amazon", "WooCommerce"] },
  { label: "Delivery", providers: ["DoorDash", "Uber Eats"] },
  { label: "Payments", providers: ["Stripe", "Square", "Moneris"] },
  { label: "Accounting", providers: ["QuickBooks", "Xero"] },
  { label: "Marketing", providers: ["Google", "Meta"] },
] as const;

export const integrationCatalog: readonly IntegrationCatalogEntry[] = [
  {
    id: "lightspeed",
    name: "Lightspeed X-Series",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "The read-only X-Series pilot is built. Authorize a store, map outlets, and review a sample before dashboard results can use the data.",
  },
  {
    id: "lightspeed-r",
    name: "Lightspeed R-Series",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "The read-only R-Series connector securely imports sales and inventory for each authorized retailer account while keeping every source traceable.",
  },
  {
    id: "shopify",
    name: "Shopify",
    category: "Commerce",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs authorization, store and location mapping, order and refund handling, payout reconciliation, and recovery tests.",
  },
  {
    id: "shopify-pos",
    name: "Shopify POS",
    category: "Point of sale",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs authorization, retail location mapping, register attribution, order and refund handling, and payout reconciliation tests.",
  },
  {
    id: "square",
    name: "Square",
    category: "Point of sale",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs authorization, location mapping, signed updates, catalog and payment history, recovery, and reconciliation tests.",
  },
  {
    id: "clover",
    name: "Clover",
    category: "Point of sale",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs merchant approval, authorization, item and location mapping, historical import, and settlement reconciliation tests.",
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "Payments",
    availability: "credentials_required",
    activationRequirement:
      "The read-only Stripe Connect adapter is built for balance transactions and payouts. Authorize an account, then reconcile a staged sample before promotion.",
  },
  {
    id: "moneris",
    name: "Moneris",
    category: "Payments",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs merchant approval, protected credentials, settlement mapping, recovery controls, and reconciliation tests.",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "Accounting",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs authorization, company selection, account and tax mapping, closed-period rules, and conflict recovery tests.",
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
    id: "woocommerce",
    name: "WooCommerce",
    category: "Commerce",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs verified store credentials, signed updates, order and refund mapping, historical import, and replay tests.",
  },
  {
    id: "amazon",
    name: "Amazon",
    category: "Marketplace",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs seller approval, marketplace permissions, report import, fee mapping, and settlement reconciliation tests.",
  },
  {
    id: "doordash",
    name: "DoorDash",
    category: "Delivery",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs partner access, store mapping, order and fee handling, recovery, and reconciliation tests.",
  },
  {
    id: "uber-eats",
    name: "Uber Eats",
    category: "Delivery",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs partner access, store mapping, order and fee handling, recovery, and reconciliation tests.",
  },
  {
    id: "google",
    name: "Google",
    category: "Marketing",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs verified consent, approved account access, location mapping, attribution rules, and historical import tests.",
  },
  {
    id: "meta",
    name: "Meta",
    category: "Marketing",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A production connection still needs app approval, limited business permissions, account mapping, signed update validation, and attribution reconciliation tests.",
  },
  {
    id: "plaid",
    name: "Plaid",
    category: "Banking",
    availability: "credentials_required",
    activationRequirement:
      "The BookLoQ bank-feed adapter uses resumable Plaid Link, encrypted tokens, signed webhooks, repair mode, cursor sync, balances and reviewed transactions. Production access still requires Plaid approval, Canadian institution testing, and hosted credentials.",
  },
  {
    id: "manual-bank",
    name: "Bank feeds",
    category: "Manual imports",
    availability: "provider_build_required",
    activationRequirement:
      "Not available yet. A safe bank import still needs format validation, duplicate detection, a review queue, rollback, and statement-to-ledger reconciliation tests.",
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
    detail: "Lightspeed X-Series, Lightspeed R-Series, and Stripe use state-bound authorization. Plaid uses short-lived Link sessions. Provider credentials stay server-side and encrypted where stored.",
    status: "verified",
  },
  {
    id: "webhooks",
    label: "Change-signal security",
    detail: "Built X-Series, Stripe, and Plaid update endpoints verify signed events, reject oversized payloads, and preserve idempotent webhook receipts.",
    status: "verified",
  },
  {
    id: "normalization",
    label: "Backfill and normalization",
    detail: "Lightspeed, Stripe, and Plaid adapters use bounded pagination, location mapping, retries, or resumable cursors. Only approved, reconciled records can reach dependent metrics.",
    status: "verified",
  },
  {
    id: "reconciliation",
    label: "Reconciliation and recovery",
    detail: "Source totals, tax, discounts, refunds, duplicates, payout timing, and recovery checks must pass before dashboard results can use the data.",
    status: "gated",
  },
] as const;
