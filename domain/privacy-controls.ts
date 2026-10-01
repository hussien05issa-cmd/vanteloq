export { PRIVACY_POLICY_VERSION } from "../shared/legal-versions";
export const PLAID_CONSENT_NOTICE_VERSION = "plaid-financial-data-v3";
export const ADVISOR_CONSENT_NOTICE_VERSION = "vanteloq-ai-v9-personalization-context";
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

export const ADVISOR_PERSONALIZATION_DATA_CATEGORY = "A validated preferred first name, workspace role, currency and time zone, and allowlisted response and display preferences";
export const ADVISOR_CONVERSATION_DATA_CATEGORY = "Up to six recent messages from the current open chat, including when saving is off, or from an authorized saved conversation when memory is enabled; current user, workspace, access and reporting scope must match, and earlier replies are historical context rather than current evidence";

export const ADVISOR_DATA_CATEGORIES = [
  "The question entered by the authorized user",
  ADVISOR_PERSONALIZATION_DATA_CATEGORY,
  "Dated aggregate sales, gross profit, transaction, discount, refund and unit metrics; permission-filtered labour totals, inventory values and accounts payable snapshots",
  "Permitted synchronized website, search and paid-advertising totals, with source-specific periods and coverage limits; no queries, URLs, Business Profile content or advertising amounts",
  "Permitted organization-wide BookLoQ ledger and cash summaries, including dated totals from reviewed bank statements, only with the required finance access; demonstration records, raw documents, transaction descriptions and identities in those records are excluded",
  "Product guidance for Vanteloq and BookLoQ; disabling Workspace data excludes business records",
  "Connected-source status and freshness details",
  "Aggregate cash available only when the user has bank-balance permission",
  ADVISOR_CONVERSATION_DATA_CATEGORY,
] as const;

export const ADVISOR_PROCESSING_PURPOSES = [
  "Explain verified business performance and calculations",
  "Explain financial and analytical concepts and how to use Vanteloq and BookLoQ",
  "Identify missing evidence and data-quality limits",
  "Personalize explanation, format and priorities using limited account information and selected preferences",
  "Continue the authorized user's open chat using bounded context; save eligible conversation messages only when memory is enabled",
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
