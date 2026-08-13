export const PRIVACY_POLICY_VERSION = "2026-08-12";
export const PLAID_CONSENT_NOTICE_VERSION = "plaid-financial-data-v2";

export const PLAID_DATA_CATEGORIES = [
  "Institution and account names",
  "Account type and masked account number",
  "Current and available balances",
  "Transaction dates, amounts, descriptions, currency, and pending or posted status (up to 24 months when your institution makes it available)",
  "Provider identifiers and connection-security metadata",
] as const;

export const PLAID_PROCESSING_PURPOSES = [
  "Bookkeeping review and reconciliation",
  "Cash-position and liquidity analysis",
  "Purchasing and reorder-capacity analysis",
  "Financial reports, connection support, security, and audit evidence",
] as const;

export const PLAID_CONSENT_MAX_AGE_MS = 30 * 60 * 1_000;
