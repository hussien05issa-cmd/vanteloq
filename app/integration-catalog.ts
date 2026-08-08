export type IntegrationAvailability =
  | "provider_build_required"
  | "credentials_required"
  | "provider_selection_required";

export type IntegrationCatalogEntry = {
  id: string;
  name: string;
  category: string;
  availability: IntegrationAvailability;
  activationRequirement: string;
};

export const integrationCatalog: readonly IntegrationCatalogEntry[] = [
  {
    id: "lightspeed",
    name: "Lightspeed X-Series",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "The read-only X-Series pilot is built. Add developer credentials, authorize a store, map outlets and pass sample reconciliation before promoting data.",
  },
  {
    id: "lightspeed-r",
    name: "Lightspeed R-Series",
    category: "Point of sale",
    availability: "credentials_required",
    activationRequirement:
      "The multi-tenant read-only R-Series connector is built. Register one Vanteloq OAuth client, then each business securely authorizes and maps its own account.",
  },
  {
    id: "shopify",
    name: "Shopify",
    category: "Commerce",
    availability: "provider_build_required",
    activationRequirement:
      "Production OAuth, store and location mapping, webhooks, order/refund normalization and payout reconciliation tests.",
  },
  {
    id: "square",
    name: "Square",
    category: "POS and payments",
    availability: "provider_build_required",
    activationRequirement:
      "Production OAuth, location mapping, signed events, catalog and payment backfill, retry and reconciliation tests.",
  },
  {
    id: "clover",
    name: "Clover",
    category: "Point of sale",
    availability: "provider_build_required",
    activationRequirement:
      "Production merchant approval, OAuth, webhooks, item mapping, backfill and settlement reconciliation tests.",
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "Payments",
    availability: "provider_build_required",
    activationRequirement:
      "Restricted Connect scopes, signed events, balance transaction mapping, dispute handling and payout reconciliation tests.",
  },
  {
    id: "moneris",
    name: "Moneris",
    category: "Payments",
    availability: "provider_build_required",
    activationRequirement:
      "Approved merchant integration, server-held credentials, settlement mapping, retry controls and reconciliation tests.",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "Accounting",
    availability: "provider_build_required",
    activationRequirement:
      "Production OAuth, company selection, account and tax mapping, closed-period policy and conflict recovery tests.",
  },
  {
    id: "xero",
    name: "Xero",
    category: "Accounting",
    availability: "provider_build_required",
    activationRequirement:
      "Production OAuth, tenant selection, account and tax mapping, incremental sync and conflict recovery tests.",
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    category: "Commerce",
    availability: "provider_build_required",
    activationRequirement:
      "Verified store credentials, signed webhooks, order and refund mapping, pagination and replay tests.",
  },
  {
    id: "amazon",
    name: "Amazon",
    category: "Marketplace",
    availability: "provider_build_required",
    activationRequirement:
      "Approved seller application, marketplace scopes, report ingestion, fee mapping and settlement reconciliation tests.",
  },
  {
    id: "doordash",
    name: "DoorDash",
    category: "Delivery",
    availability: "provider_build_required",
    activationRequirement:
      "Approved partner access, store mapping, order and fee normalization, retry and reconciliation tests.",
  },
  {
    id: "uber-eats",
    name: "Uber Eats",
    category: "Delivery",
    availability: "provider_build_required",
    activationRequirement:
      "Approved partner access, store mapping, order and fee normalization, retry and reconciliation tests.",
  },
  {
    id: "plaid",
    name: "Plaid",
    category: "Banking",
    availability: "provider_build_required",
    activationRequirement:
      "Production agreement, Canadian institution coverage, hosted consent, signed webhooks and pending-to-posted reconciliation tests.",
  },
  {
    id: "manual-bank",
    name: "Bank feeds",
    category: "Manual statements",
    availability: "provider_build_required",
    activationRequirement:
      "Bank-format parser, duplicate detection, review queue, rollback and statement-to-ledger reconciliation tests.",
  },
  {
    id: "payroll",
    name: "Payroll",
    category: "Labour",
    availability: "provider_selection_required",
    activationRequirement:
      "A payroll provider must be selected before scopes, pay-period mapping, privacy boundaries and reconciliation can be tested.",
  },
] as const;

export const preSyncControls = [
  {
    id: "tenant",
    label: "Tenant isolation",
    detail: "Membership-scoped records and cross-tenant tests are in place.",
    status: "verified",
  },
  {
    id: "permissions",
    label: "Least-privilege access",
    detail: "Integration, finance and export permissions are enforced server-side.",
    status: "verified",
  },
  {
    id: "integrity",
    label: "Audit and replay controls",
    detail: "Append-only audit events and idempotency primitives are implemented.",
    status: "verified",
  },
  {
    id: "money",
    label: "Financial precision",
    detail: "Normalized financial values use integer minor units.",
    status: "verified",
  },
  {
    id: "authorization",
    label: "Provider authorization",
    detail: "Lightspeed X-Series and R-Series use scoped OAuth, one-time state and encrypted rotating credentials; providers without an adapter remain disabled.",
    status: "verified",
  },
  {
    id: "webhooks",
    label: "Change-signal security",
    detail: "X-Series verifies signed webhooks and rejects replays; verified polling remains authoritative while durable delivery recovery is gated.",
    status: "verified",
  },
  {
    id: "normalization",
    label: "Backfill and normalization",
    detail: "Both Lightspeed pilots use bounded pagination, mapping, retries, resumable cursors and isolated staging with data promotion disabled.",
    status: "verified",
  },
  {
    id: "reconciliation",
    label: "Reconciliation and recovery",
    detail: "Source totals, tax, discounts, refunds, duplicates, payout timing and rollback acceptance must pass before live metric promotion.",
    status: "gated",
  },
] as const;
