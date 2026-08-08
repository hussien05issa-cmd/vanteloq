export type MetricUnit = "minor_currency" | "count" | "ratio";

export type MetricDefinition = {
  key: string;
  label: string;
  description: string;
  unit: MetricUnit;
  formula: string;
  requiredInputs: readonly string[];
  validSourceSystems: readonly string[];
  sourceFields: readonly string[];
  exclusions: readonly string[];
  edgeCases: readonly string[];
  rounding: string;
  timezoneTreatment: string;
  taxTreatment: string;
  refundTreatment: string;
  calculationVersion: string;
  permission: string;
  aggregation: "sum" | "derived" | "latest";
};

const dailySource = ["daily_summary_csv", "manual_entry", "verified_pos_summary"];
const common = {
  validSourceSystems: dailySource,
  exclusions: ["Unverified staged provider records", "Demonstration records outside explicit demonstration mode"],
  edgeCases: ["Missing inputs return unavailable instead of zero", "Periods use the workspace business date"],
  rounding: "Store integer minor units; round derived display values half away from zero at the presentation boundary",
  timezoneTreatment: "Group by workspace-local business date; never derive reporting dates from the browser timezone",
  taxTreatment: "Use the imported source field as defined; tax is not inferred or added unless explicitly named",
  refundTreatment: "Refunds follow the imported canonical net-sales treatment and remain separately traceable",
  calculationVersion: "2026.08.1",
} as const;

function define(
  definition: Omit<MetricDefinition, keyof typeof common>,
): MetricDefinition {
  return { ...common, ...definition };
}

export const metricRegistry: MetricDefinition[] = [
  define({ key: "gross_sales", label: "Gross sales", description: "Recorded sales before discounts and refunds under the source contract.", unit: "minor_currency", formula: "SUM(gross_sales_cents)", requiredInputs: ["gross_sales_cents"], sourceFields: ["daily_business_metrics.gross_sales_cents"], permission: "metrics.revenue", aggregation: "sum" }),
  define({ key: "net_sales", label: "Net sales", description: "Canonical period sales after the source system's recorded discounts and refunds treatment.", unit: "minor_currency", formula: "SUM(net_sales_cents)", requiredInputs: ["net_sales_cents"], sourceFields: ["daily_business_metrics.net_sales_cents"], permission: "metrics.revenue", aggregation: "sum" }),
  define({ key: "cost_of_goods", label: "Cost of goods sold", description: "Recorded product cost attributable to the period's sales.", unit: "minor_currency", formula: "SUM(cost_of_goods_cents)", requiredInputs: ["cost_of_goods_cents"], sourceFields: ["daily_business_metrics.cost_of_goods_cents"], permission: "metrics.profit", aggregation: "sum" }),
  define({ key: "gross_profit", label: "Gross profit", description: "Net sales less recorded product cost; not net operating profit.", unit: "minor_currency", formula: "net_sales - cost_of_goods", requiredInputs: ["net_sales", "cost_of_goods"], sourceFields: ["daily_business_metrics.net_sales_cents", "daily_business_metrics.cost_of_goods_cents"], permission: "metrics.profit", aggregation: "derived" }),
  define({ key: "gross_margin", label: "Gross margin", description: "Gross profit divided by net sales for the same period.", unit: "ratio", formula: "gross_profit / net_sales; unavailable when net_sales = 0", requiredInputs: ["gross_profit", "net_sales"], sourceFields: ["daily_business_metrics.net_sales_cents", "daily_business_metrics.cost_of_goods_cents"], permission: "metrics.profit", aggregation: "derived" }),
  define({ key: "transactions", label: "Transactions", description: "Count of completed transactions represented by verified daily summaries.", unit: "count", formula: "SUM(transaction_count)", requiredInputs: ["transaction_count"], sourceFields: ["daily_business_metrics.transaction_count"], permission: "metrics.revenue", aggregation: "sum" }),
  define({ key: "average_transaction", label: "Average transaction value", description: "Net sales per completed transaction.", unit: "minor_currency", formula: "net_sales / transactions; unavailable when transactions = 0", requiredInputs: ["net_sales", "transactions"], sourceFields: ["daily_business_metrics.net_sales_cents", "daily_business_metrics.transaction_count"], permission: "metrics.revenue", aggregation: "derived" }),
  define({ key: "units", label: "Units sold", description: "Count of units represented by verified daily summaries.", unit: "count", formula: "SUM(units_sold)", requiredInputs: ["units_sold"], sourceFields: ["daily_business_metrics.units_sold"], permission: "metrics.revenue", aggregation: "sum" }),
  define({ key: "units_per_transaction", label: "Units per transaction", description: "Recorded units divided by completed transactions.", unit: "ratio", formula: "units / transactions; unavailable when transactions = 0", requiredInputs: ["units", "transactions"], sourceFields: ["daily_business_metrics.units_sold", "daily_business_metrics.transaction_count"], permission: "metrics.revenue", aggregation: "derived" }),
  define({ key: "discounts", label: "Discounts", description: "Recorded discounts for the reporting period.", unit: "minor_currency", formula: "SUM(discounts_cents)", requiredInputs: ["discounts_cents"], sourceFields: ["daily_business_metrics.discounts_cents"], permission: "sales.refunds", aggregation: "sum" }),
  define({ key: "refunds", label: "Refunds", description: "Recorded refund value for the reporting period.", unit: "minor_currency", formula: "SUM(refunds_cents)", requiredInputs: ["refunds_cents"], sourceFields: ["daily_business_metrics.refunds_cents"], permission: "sales.refunds", aggregation: "sum" }),
  define({ key: "labour_cost", label: "Labour cost", description: "Recorded labour cost attributable to the reporting period.", unit: "minor_currency", formula: "SUM(labour_cost_cents)", requiredInputs: ["labour_cost_cents"], sourceFields: ["daily_business_metrics.labour_cost_cents"], permission: "payroll.totals", aggregation: "sum" }),
  define({ key: "labour_rate", label: "Labour cost percentage", description: "Recorded labour cost divided by net sales.", unit: "ratio", formula: "labour_cost / net_sales; unavailable when net_sales = 0", requiredInputs: ["labour_cost", "net_sales"], sourceFields: ["daily_business_metrics.labour_cost_cents", "daily_business_metrics.net_sales_cents"], permission: "payroll.totals", aggregation: "derived" }),
  define({ key: "contribution_after_labour", label: "Contribution after labour", description: "Gross profit less recorded labour cost; excludes rent, tax, debt and other operating expenses.", unit: "minor_currency", formula: "gross_profit - labour_cost", requiredInputs: ["gross_profit", "labour_cost"], sourceFields: ["daily_business_metrics.net_sales_cents", "daily_business_metrics.cost_of_goods_cents", "daily_business_metrics.labour_cost_cents"], permission: "metrics.profit", aggregation: "derived" }),
  define({ key: "inventory_value", label: "Latest inventory value", description: "Most recent verified aggregate inventory value, not a period sum.", unit: "minor_currency", formula: "latest non-null inventory_value_cents", requiredInputs: ["inventory_value_cents"], sourceFields: ["daily_business_metrics.inventory_value_cents"], permission: "inventory.value", aggregation: "latest" }),
  define({ key: "operating_cash", label: "Latest operating cash", description: "Most recent imported operating cash balance; it is not available cash after all obligations.", unit: "minor_currency", formula: "latest non-null cash_balance_cents", requiredInputs: ["cash_balance_cents"], sourceFields: ["daily_business_metrics.cash_balance_cents"], permission: "metrics.cash", aggregation: "latest" }),
  define({ key: "accounts_payable", label: "Latest accounts payable", description: "Most recent imported accounts-payable balance.", unit: "minor_currency", formula: "latest non-null accounts_payable_cents", requiredInputs: ["accounts_payable_cents"], sourceFields: ["daily_business_metrics.accounts_payable_cents"], permission: "finance.ap_ar", aggregation: "latest" }),
];

export function metricDefinition(key: string): MetricDefinition {
  const definition = metricRegistry.find((item) => item.key === key);
  if (!definition) throw new Error(`Unknown metric definition: ${key}`);
  return definition;
}
