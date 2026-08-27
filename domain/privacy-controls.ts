export { PRIVACY_POLICY_VERSION } from "../shared/legal-versions";
export const PLAID_CONSENT_NOTICE_VERSION = "plaid-financial-data-v3";
export const GEMINI_CONSENT_NOTICE_VERSION = "gemini-evidence-advisor-v1";

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

export const GEMINI_DATA_CATEGORIES = [
  "The question entered by the authorized user",
  "Dated aggregate sales, gross profit, transaction, discount, and refund metrics",
  "Connected-source status and freshness details",
  "Aggregate cash available only when the user has bank-balance permission",
  "A short tenant-scoped conversation history and an evidence summary",
] as const;

export const GEMINI_PROCESSING_PURPOSES = [
  "Explain verified business performance and calculations",
  "Identify missing evidence and data-quality limits",
  "Maintain the authorized user's organization-scoped advisor conversation",
] as const;

export const PLAID_CONSENT_MAX_AGE_MS = 30 * 60 * 1_000;
