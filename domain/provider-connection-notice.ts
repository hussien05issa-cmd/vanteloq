import type { PrivacyProvider } from "./provider-privacy";

export type PermissionSummary = { title: string; description: string };

const summaries: Record<Exclude<PrivacyProvider, "google">, readonly PermissionSummary[]> = {
  square: [{ title: "Commerce records", description: "Read permitted sales, orders, payments, products, stock, locations and customer records for reporting and source review." }],
  stripe: [{ title: "Payment reporting", description: "Stripe grants read-only account access. Vanteloq imports balance transactions, fees and payouts for review, separately from sales revenue and posted accounting totals. This connection is separate from your Vanteloq subscription." }],
  lightspeed: [{ title: "X-Series records", description: "Read permitted sales, products, stock, customers, suppliers, outlets and payment types for commerce reporting." }],
  "lightspeed-r": [{ title: "R-Series records", description: "Read permitted register and inventory records. Returned sales, products and locations support commerce reporting." }],
  clover: [{ title: "Merchant records", description: "Read permitted merchant, order, payment, product, inventory and customer records for reporting and source review. Clover controls these permissions through its app settings." }],
  shopify: [{ title: "Store records", description: "Read permitted orders, products, inventory, locations and customers. Historical access depends on Shopify permissions and approval." }],
  "shopify-pos": [{ title: "Store and POS records", description: "Read permitted orders, products, inventory, locations and customers. Reporting uses the records Shopify makes available to this app." }],
  meta: [
    { title: "Advertising reports", description: "Read measurements from the advertising accounts you select, including spend, clicks and provider-attributed outcomes." },
    { title: "Ad management permission", description: "Meta also grants ad management access. Supported campaign status or daily-budget changes require a separate confirmation. Connecting does not change your ads." },
  ],
  slack: [{ title: "One chosen channel", description: "Allow Vanteloq to send messages to the Slack channel you authorise. This connection does not grant access to conversations or files. Sending a message is a separate action." }],
  plaid: [{ title: "Bank records", description: "Read selected account balances and transactions for review and reconciliation. This connection cannot move money or make payments." }],
  quickbooks: [{ title: "Accounting permission", description: "Intuit grants accounting access that can include reading and changing company records. This stage of Vanteloq uses company identification and connection verification; it does not create or change QuickBooks transactions." }],
  deel: [{ title: "Payroll permission", description: "Deel grants read access to organisations, accounting, legal entities and payslips. Provider responses can contain worker-level details; Vanteloq discards those details and excludes worker identities, payment details and individual pay from its stored payroll reports. It retains category totals by currency from available reports. Report availability does not prove payroll is finalised, approved or paid." }],
  moneris: [{ title: "Merchant reporting", description: "Read payment amounts, currency, status, timestamps and references using payment.read. This adapter does not initiate charges or refunds." }],
};

/** Explain configured grants, rather than treating a broad provider grant as read-only. */
export function connectionPermissionSummary(provider: PrivacyProvider, scopes?: readonly string[]): readonly PermissionSummary[] {
  if (provider !== "google") return summaries[provider];
  const requested = scopes ? new Set(scopes) : null;
  const includes = (scope: string) => !requested || requested.has(`https://www.googleapis.com/auth/${scope}`);
  const rows: PermissionSummary[] = [
    { title: "Account identity", description: "Use your Google account identifier and email to identify this connection." },
  ];
  if (includes("analytics.readonly")) rows.push({ title: "Google Analytics", description: "Read accessible properties and traffic measurements from the property you select." });
  if (includes("webmasters.readonly")) rows.push({ title: "Search Console", description: "Read accessible sites and search-performance measurements from the site you select." });
  if (includes("business.manage")) rows.push({ title: "Business Profile", description: "Google grants management access. Vanteloq reads selected location measurements and requested reviews. Publishing a review reply requires your separate confirmation." });
  if (requested?.has("https://www.googleapis.com/auth/adwords")) rows.push({ title: "Google Ads", description: "Google grants permission to view, edit, create and delete Ads data. Vanteloq uses it for account selection and reporting and does not change Google campaigns." });
  if (!requested) rows.push({ title: "Google Ads, if enabled", description: "If the next screen includes Google Ads, its permission can include editing access. Vanteloq uses it for reporting and does not change Google campaigns." });
  return rows;
}

export function connectionDataUse(provider: PrivacyProvider) {
  if (provider === "google" || provider === "meta") return "Choose the exact business resources and workspace or location they belong to. Review a sample before approving imported measurements. Provider-attributed outcomes are not accounting revenue.";
  if (provider === "slack") return "Choose the destination in Slack. Only information included in a separately requested message is sent to that channel.";
  if (provider === "quickbooks") return "This connection is currently limited to company verification. Connecting alone does not import an accounting ledger or post entries.";
  if (provider === "deel") return "Review the entity, currency, payroll period and aggregate categories before using a payroll report. Connecting alone does not post a journal or pay employees.";
  return "Review the selected account, locations and source records before relying on imported totals. Connecting alone does not approve accounting entries or financial actions.";
}
