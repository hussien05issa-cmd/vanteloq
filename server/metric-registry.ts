export type MetricDefinition = {
  key: string;
  label: string;
  unit: "minor_currency" | "count" | "ratio";
  formula: string;
  sourceFields: string[];
  permission: string;
  aggregation: "sum" | "derived" | "latest";
};

export const metricRegistry: MetricDefinition[] = [
  { key: "gross_sales", label: "Gross sales", unit: "minor_currency", formula: "SUM(gross_sales_cents)", sourceFields: ["daily_business_metrics.gross_sales_cents"], permission: "metrics.revenue", aggregation: "sum" },
  { key: "net_sales", label: "Net sales", unit: "minor_currency", formula: "SUM(net_sales_cents)", sourceFields: ["daily_business_metrics.net_sales_cents"], permission: "metrics.revenue", aggregation: "sum" },
  { key: "cost_of_goods", label: "Cost of goods sold", unit: "minor_currency", formula: "SUM(cost_of_goods_cents)", sourceFields: ["daily_business_metrics.cost_of_goods_cents"], permission: "metrics.profit", aggregation: "sum" },
  { key: "gross_profit", label: "Gross profit", unit: "minor_currency", formula: "net_sales - cost_of_goods", sourceFields: ["daily_business_metrics.net_sales_cents", "daily_business_metrics.cost_of_goods_cents"], permission: "metrics.profit", aggregation: "derived" },
  { key: "gross_margin", label: "Gross margin", unit: "ratio", formula: "gross_profit / net_sales; null when net_sales = 0", sourceFields: ["daily_business_metrics.net_sales_cents", "daily_business_metrics.cost_of_goods_cents"], permission: "metrics.profit", aggregation: "derived" },
  { key: "transactions", label: "Transactions", unit: "count", formula: "SUM(transaction_count)", sourceFields: ["daily_business_metrics.transaction_count"], permission: "metrics.revenue", aggregation: "sum" },
  { key: "average_transaction", label: "Average transaction value", unit: "minor_currency", formula: "net_sales / transactions; null when transactions = 0", sourceFields: ["daily_business_metrics.net_sales_cents", "daily_business_metrics.transaction_count"], permission: "metrics.revenue", aggregation: "derived" },
  { key: "units", label: "Units sold", unit: "count", formula: "SUM(units_sold)", sourceFields: ["daily_business_metrics.units_sold"], permission: "metrics.revenue", aggregation: "sum" },
  { key: "units_per_transaction", label: "Units per transaction", unit: "ratio", formula: "units / transactions; null when transactions = 0", sourceFields: ["daily_business_metrics.units_sold", "daily_business_metrics.transaction_count"], permission: "metrics.revenue", aggregation: "derived" },
  { key: "discounts", label: "Discounts", unit: "minor_currency", formula: "SUM(discounts_cents)", sourceFields: ["daily_business_metrics.discounts_cents"], permission: "sales.refunds", aggregation: "sum" },
  { key: "refunds", label: "Refunds", unit: "minor_currency", formula: "SUM(refunds_cents)", sourceFields: ["daily_business_metrics.refunds_cents"], permission: "sales.refunds", aggregation: "sum" },
  { key: "labour_cost", label: "Labour cost", unit: "minor_currency", formula: "SUM(labour_cost_cents)", sourceFields: ["daily_business_metrics.labour_cost_cents"], permission: "payroll.totals", aggregation: "sum" },
  { key: "labour_rate", label: "Labour cost percentage", unit: "ratio", formula: "labour_cost / net_sales; null when net_sales = 0", sourceFields: ["daily_business_metrics.labour_cost_cents", "daily_business_metrics.net_sales_cents"], permission: "payroll.totals", aggregation: "derived" },
  { key: "contribution_after_labour", label: "Contribution after labour", unit: "minor_currency", formula: "gross_profit - labour_cost", sourceFields: ["daily_business_metrics.net_sales_cents", "daily_business_metrics.cost_of_goods_cents", "daily_business_metrics.labour_cost_cents"], permission: "metrics.profit", aggregation: "derived" },
  { key: "inventory_value", label: "Latest inventory value", unit: "minor_currency", formula: "most recent non-null inventory_value_cents", sourceFields: ["daily_business_metrics.inventory_value_cents"], permission: "inventory.value", aggregation: "latest" },
  { key: "operating_cash", label: "Latest operating cash", unit: "minor_currency", formula: "most recent non-null cash_balance_cents", sourceFields: ["daily_business_metrics.cash_balance_cents"], permission: "metrics.cash", aggregation: "latest" },
  { key: "accounts_payable", label: "Latest accounts payable", unit: "minor_currency", formula: "most recent non-null accounts_payable_cents", sourceFields: ["daily_business_metrics.accounts_payable_cents"], permission: "finance.ap_ar", aggregation: "latest" },
];
