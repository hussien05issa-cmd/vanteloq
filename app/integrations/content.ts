export type PublicIntegrationGuide = {
  name: string;
  markName: string;
  title: string;
  description: string;
  lead: string;
  records: readonly [string, string][];
  permissions: readonly string[];
  scopeExplanation: string;
  refresh: string;
  boundaries: readonly string[];
  providerCompany: string;
  providerPrivacy: string;
  providerDocs: string;
};

export const PUBLIC_INTEGRATION_GUIDES: Readonly<Record<string, PublicIntegrationGuide>> = {
  square: {
    name: "Square",
    markName: "Square",
    title: "Square Sales and Inventory Analytics | Vanteloq",
    description: "Review Square sales, refunds, products and stock with traceable source records in Vanteloq. See permissions, import coverage and reconciliation requirements.",
    lead: "Keep Square for selling. Use authorised order, payment and stock records to inspect sales changes and decide what needs a closer look.",
    records: [
      ["Sales and returns", "Completed orders, order lines and itemised returns, with source identifiers and dates."],
      ["Payments", "Completed payments and their source references. A payment is not automatically an additional sale."],
      ["Products and stock", "Catalogue variations and available in-stock quantities. A selling price does not establish the product's cost."],
      ["Customers and locations", "Authorised customer, merchant and location records for the mapped business scope."],
    ],
    permissions: ["MERCHANT_PROFILE_READ", "ORDERS_READ", "PAYMENTS_READ", "CUSTOMERS_READ", "ITEMS_READ", "INVENTORY_READ"],
    scopeExplanation: "These are read permissions. This connector does not request permission to create orders, change inventory, charge cards or issue refunds.",
    refresh: "Imports run in pages and resume with saved cursors. The initial sales/payment window covers up to two years; later runs overlap the previous watermark to pick up changes. One run does not prove every page or location has been imported. Review the last successful refresh and continuing-history status in your workspace.",
    boundaries: [
      "Inventory coverage depends on the catalogue variations fetched. Check unmapped locations and unfinished pages before relying on stock totals.",
      "Product costs may be missing. Gross profit stays unavailable until the required cost evidence is reviewed.",
      "Ambiguous or custom refunds and unsupported allocations require review. Do not silently spread them across products.",
      "Square account eligibility, permissions and provider limits apply. Imported sales and payments do not establish bank cash or complete financial statements.",
    ],
    providerCompany: "Block, Inc. and its affiliates",
    providerPrivacy: "https://squareup.com/ca/en/legal/general/privacy",
    providerDocs: "https://developer.squareup.com/docs/oauth-api/overview",
  },
  "lightspeed-r": {
    name: "Lightspeed Retail R-Series",
    markName: "Lightspeed",
    title: "Lightspeed Retail R-Series Analytics | Vanteloq",
    description: "Inspect Lightspeed Retail R-Series sales and inventory in Vanteloq. Understand read permissions, location mapping, import coverage and source-total review.",
    lead: "Keep your R-Series register. Bring its authorised sales and inventory records into a review that keeps locations, periods and source rows together.",
    records: [
      ["Sales and tenders", "Sales, sale lines and available payment details, with source references and trading dates."],
      ["Products and categories", "Item records and their category relationships. Missing optional records remain visible."],
      ["Stock by shop", "Available quantities for authorised shops, mapped to the locations in your Vanteloq workspace."],
      ["Customers and suppliers", "Available customer and supplier records within the authorised retailer account."],
    ],
    permissions: ["employee:register_read", "employee:inventory_read"],
    scopeExplanation: "Vanteloq requests register and inventory read scopes. This connector does not request inventory-write or register-write access.",
    refresh: "Imports run in pages and resume historical cursors on subsequent runs. A separate recent sweep checks the preceding 24 hours. Continuing history, optional-data gaps and missing costs or quantities are shown for review. This is not a promise of instant or continuous synchronisation.",
    boundaries: [
      "This guide covers Retail R-Series. X-Series and Lightspeed Restaurant use different connections and must not be treated as interchangeable.",
      "Account permissions determine what can be read. Map shops to Vanteloq locations before approving imported reports.",
      "A completed refresh can still have incomplete reporting coverage. Check dates, source counts, missing costs and continuing-history status.",
      "Sales and tender records do not establish bank deposits, lender balances or a complete ledger. Review those sources separately.",
    ],
    providerCompany: "Lightspeed Commerce Inc. and its affiliates",
    providerPrivacy: "https://www.lightspeedhq.com/legal/privacy-policy/",
    providerDocs: "https://retail-support.lightspeedhq.com/hc/en-us/articles/229129268-Integrating-with-the-Lightspeed-Retail-POS-R-Series-API",
  },
};

export function getPublicIntegrationGuide(provider: string) {
  return Object.prototype.hasOwnProperty.call(PUBLIC_INTEGRATION_GUIDES, provider) ? PUBLIC_INTEGRATION_GUIDES[provider] : null;
}
