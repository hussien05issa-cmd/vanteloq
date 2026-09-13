export const POS_SYNC_CONSENT_VERSION = "pos-background-data-v1";
export function posSyncDataCategories(provider: string) {
  return provider === "stripe" || provider === "moneris"
    ? ["Authorized account and connection identifiers", "Payment amounts, statuses, dates and reconciliation references"]
    : ["Authorized account and outlet identifiers", "Sales, returns, discounts and payment totals", "Products, categories, stock levels and available costs", "Customer identifiers and permitted customer directory fields", "Supplier identifiers and directory fields"];
}
export const POS_SYNC_PURPOSES = ["Continue authorized read-only imports while the browser is closed", "Refresh approved business reports and retain import audit evidence"];
