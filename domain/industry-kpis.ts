import type { DashboardPreferences, DashboardWidgetId } from "./dashboard-preferences";

export type IndustryKpiRecommendation = {
  industry: string;
  summary: string;
  recommended: readonly { key: DashboardWidgetId; reason: string }[];
  nextMeasures: readonly { name: string; definition: string; requiredEvidence: string }[];
};

const recommendation = (
  industry: string,
  summary: string,
  recommended: IndustryKpiRecommendation["recommended"],
  nextMeasures: IndustryKpiRecommendation["nextMeasures"],
): IndustryKpiRecommendation => ({ industry, summary, recommended, nextMeasures });

const commerceNext = [
  { name: "Inventory Turnover", definition: "Recorded cost of goods sold divided by average inventory at cost for the same period.", requiredEvidence: "Matched period costs and opening and closing inventory values." },
  { name: "Sell-through Rate", definition: "Units sold divided by units available to sell for the defined receipt cohort and period.", requiredEvidence: "Dated receipts, sales, returns and item-level inventory." },
  { name: "Days of Inventory on Hand", definition: "Average inventory at cost divided by period cost of goods sold, multiplied by the number of days.", requiredEvidence: "Matched period costs and average inventory at cost." },
] as const;

const guides: Record<string, IndustryKpiRecommendation> = {
  retail: recommendation("Retail", "Start with sales quality, merchandise economics and the cash tied up in stock.", [
    { key: "net_revenue", reason: "Shows recorded sales after discounts and returns." },
    { key: "gross_profit", reason: "Shows the dollars retained after recorded product cost." },
    { key: "gross_margin", reason: "Makes product economics comparable across periods." },
    { key: "inventory_value", reason: "Shows recorded capital held in stock at cost." },
    { key: "average_order_value", reason: "Separates transaction value from transaction volume." },
    { key: "transactions", reason: "Shows whether revenue changed because of traffic or basket value." },
  ], commerceNext),
  "health & wellness": recommendation("Health & Wellness", "Track retail economics first, then add expiry and replenishment evidence for products with shelf-life risk.", [
    { key: "net_revenue", reason: "Shows recorded sales after discounts and returns." },
    { key: "gross_profit", reason: "Shows dollars retained after recorded product cost." },
    { key: "gross_margin", reason: "Reveals whether mix and discounts support product economics." },
    { key: "inventory_value", reason: "Shows recorded capital held in products." },
    { key: "units_sold", reason: "Supports product velocity and replenishment review." },
    { key: "cash_flow", reason: "Connects purchasing decisions with recorded cash movement." },
  ], [...commerceNext, { name: "Expiry Exposure", definition: "Units and cost at risk before their recorded expiry date.", requiredEvidence: "Lot-level quantity, unit cost, expiry date and expected selling pace." }]),
  "food & beverage": recommendation("Food & Beverage", "Monitor transaction volume, basket value, margin and cash while keeping waste and expiry separate from sales.", [
    { key: "net_revenue", reason: "Shows sales after recorded discounts and returns." },
    { key: "transactions", reason: "Measures completed guest or customer purchases." },
    { key: "average_order_value", reason: "Shows net revenue per completed transaction." },
    { key: "gross_margin", reason: "Tracks supported product economics when costs are complete." },
    { key: "operating_profit", reason: "Connects revenue, product cost and posted operating expenses." },
    { key: "cash_flow", reason: "Shows recorded cash received less cash paid in the period." },
  ], [{ name: "Waste Rate", definition: "Recorded waste quantity or cost divided by available quantity or cost for the same period.", requiredEvidence: "Dated waste adjustments, receipts, sales and a consistent cost basis." }, ...commerceNext]),
  "e-commerce": recommendation("E-commerce", "Separate demand, basket economics, product margin and cash settlement timing.", [
    { key: "net_revenue", reason: "Shows sales after recorded discounts and returns." },
    { key: "transactions", reason: "Shows completed order volume." },
    { key: "average_order_value", reason: "Shows net revenue per completed order." },
    { key: "gross_profit", reason: "Shows dollars retained after recorded product cost." },
    { key: "gross_margin", reason: "Makes product economics comparable across periods." },
    { key: "cash_flow", reason: "Keeps sales separate from recorded cash movement and payout timing." },
  ], commerceNext),
  hospitality: recommendation("Hospitality", "Use revenue and transaction volume with supported margin, operating profit and cash movement.", [
    { key: "net_revenue", reason: "Shows recorded revenue after discounts and returns." },
    { key: "transactions", reason: "Shows completed guest purchases." },
    { key: "average_order_value", reason: "Shows revenue per completed purchase." },
    { key: "gross_margin", reason: "Tracks supported economics when costs are complete." },
    { key: "operating_profit", reason: "Connects revenue with posted operating costs." },
    { key: "cash_flow", reason: "Shows recorded cash movement across the selected period." },
  ], [{ name: "Revenue per Available Capacity Unit", definition: "Recorded revenue divided by the available capacity unit used by the business.", requiredEvidence: "A defined room, seat or service capacity and matched operating dates." }]),
  "professional services": recommendation("Professional Services", "Prioritize revenue quality, operating earnings, cash and the pace of customer billing and collection.", [
    { key: "net_revenue", reason: "Shows recorded operating revenue for the selected period." },
    { key: "operating_profit", reason: "Connects revenue with posted operating expenses." },
    { key: "net_margin", reason: "Shows recorded earnings as a share of positive ledger revenue." },
    { key: "cash_balance", reason: "Shows recorded cash at period end." },
    { key: "cash_flow", reason: "Shows recorded cash received less cash paid." },
    { key: "transactions", reason: "Provides activity context when the connected source defines a completed transaction." },
  ], [{ name: "Receivables Age", definition: "Outstanding customer balances grouped by days past due.", requiredEvidence: "Reviewed invoices, payments, due dates and customer balances." }, { name: "Utilization", definition: "Billable hours divided by available working hours for the same period.", requiredEvidence: "Reviewed time records, capacity rules and billable classification." }]),
};

const fallback = recommendation("Your Business", "Begin with revenue, profit, cash and activity, then keep only the measures that change a recurring decision.", [
  { key: "net_revenue", reason: "Shows recorded revenue for the selected period." },
  { key: "gross_profit", reason: "Shows supported dollars retained after direct product cost." },
  { key: "operating_profit", reason: "Connects revenue with posted operating expenses." },
  { key: "cash_balance", reason: "Shows recorded cash at the period end." },
  { key: "cash_flow", reason: "Shows recorded cash received less cash paid." },
  { key: "transactions", reason: "Provides operating activity context when the source supports it." },
], [{ name: "Decision-specific KPI", definition: "A consistently defined measure tied to a recurring business decision.", requiredEvidence: "A named owner, reporting period, source, calculation and review cadence." }]);

export function industryKpiRecommendation(industry: string | null | undefined) {
  return guides[(industry ?? "").trim().toLowerCase()] ?? fallback;
}

export function applyIndustryKpis(preferences: DashboardPreferences, industry: string | null | undefined): DashboardPreferences {
  const recommended = industryKpiRecommendation(industry).recommended.map(item => item.key);
  const order = [...recommended, ...preferences.widgets.map(item => item.id).filter(id => !recommended.includes(id))];
  const byId = new Map(preferences.widgets.map(item => [item.id, item]));
  return {
    ...preferences,
    widgets: order.map((id, index) => ({
      ...(byId.get(id) ?? { id, size: "standard" as const, visible: false }),
      visible: recommended.includes(id),
      size: index < 2 ? "wide" : "standard",
    })),
  };
}
