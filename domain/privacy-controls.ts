export { PRIVACY_POLICY_VERSION } from "../shared/legal-versions";
export const PLAID_CONSENT_NOTICE_VERSION = "plaid-financial-data-v3";
export const ADVISOR_CONSENT_NOTICE_VERSION = "vanteloq-ai-v8-reviewed-cash";
export const QUICKBOOKS_CONSENT_NOTICE_VERSION = "quickbooks-accounting-read-v1";

export const PLAID_DATA_CATEGORIES = [
  "Institution and account names",
  "Account type and masked account number",
  "Current and available balances",
  "Transaction dates, amounts, descriptions, currency, and pending or posted status (up to 24 months when your institution makes it available)",
  "Provider identifiers and connection-security metadata",
] as const;

export const PLAID_PROCESSING_PURPOSES = [
  "Bookkeeping review, expense categorization, and bank reconciliation",
  "Current cash, 13-week cash-flow forecasting, and liquidity analysis",
  "Purchasing affordability and reorder-capacity analysis when combined with inventory and supplier records",
  "Financial reports, tax working papers, connection support, security, and audit evidence",
] as const;

export const ADVISOR_DATA_CATEGORIES = [
  "The question entered by the authorized user",
  "Dated aggregate sales, gross profit, transaction, discount, refund and unit metrics; permission-filtered labour totals, inventory values and accounts payable snapshots",
  "Permitted synchronized website, search and paid-advertising totals, with source-specific periods and coverage limits; no queries, URLs, Business Profile content or advertising amounts",
  "Permitted organization-wide BookLoQ ledger and cash summaries, including dated totals from reviewed bank statements, only with the required finance access; demonstration records, raw documents, transaction descriptions and identities are excluded",
  "Product guidance for Vanteloq and BookLoQ; disabling Workspace data excludes business records",
  "Connected-source status and freshness details",
  "Aggregate cash available only when the user has bank-balance permission",
  "An optional short user-and-workspace-scoped conversation history, only when memory is enabled and its evidence and access fingerprint match the current request",
] as const;

export const ADVISOR_PROCESSING_PURPOSES = [
  "Explain verified business performance and calculations",
  "Explain financial and analytical concepts and how to use Vanteloq and BookLoQ",
  "Identify missing evidence and data-quality limits",
  "Maintain the authorized user's organization-scoped advisor conversation only when they enable memory",
] as const;

export const QUICKBOOKS_DATA_CATEGORIES = [
  "QuickBooks company name and company identifier",
  "Authorization and connection status",
  "Accounting records selected for a future reviewed import",
] as const;

export const QUICKBOOKS_PROCESSING_PURPOSES = [
  "Verify the QuickBooks Online company selected by the workspace owner",
  "Prepare a read only accounting connection for mapping and reconciliation",
  "Support connection security, troubleshooting, and audit evidence",
] as const;

export const PLAID_CONSENT_MAX_AGE_MS = 30 * 60 * 1_000;
