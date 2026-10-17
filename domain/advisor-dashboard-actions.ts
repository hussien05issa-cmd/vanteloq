import { dashboardPreferencePreset, normalizeDashboardPreferences, type DashboardPreferences, type DashboardPeriod, type DashboardWidgetId } from "./dashboard-preferences";

export type DashboardAction =
  | { kind: "metric"; id: DashboardWidgetId; visible: boolean }
  | { kind: "chart"; value: "line" | "bar" }
  | { kind: "period"; value: DashboardPeriod }
  | { kind: "focus"; value: "finance" | "inventory" | "sales" };
const metricNames: Record<DashboardWidgetId, string> = {
  net_revenue: "Net revenue", gross_profit: "Gross profit", gross_margin: "Gross margin", operating_profit: "Operating profit",
  net_margin: "Net margin", cash_balance: "Cash balance", cash_flow: "Cash flow", inventory_value: "Inventory value",
  transactions: "Transactions", average_order_value: "Average order value", units_sold: "Units sold",
};
export function dashboardActionLabel(action: DashboardAction) {
  if (action.kind === "metric") return `${action.visible ? "Show" : "Hide"} ${metricNames[action.id]}`;
  if (action.kind === "chart") return `Use a ${action.value} chart`;
  if (action.kind === "focus") return `Focus your KPI cards on ${action.value === "finance" ? "cash and profitability" : action.value === "inventory" ? "inventory" : "sales"}`;
  const labels: Record<DashboardPeriod, string> = { today: "today", yesterday: "yesterday", "7d": "the last 7 days", "30d": "the last 30 days", "90d": "the last 90 days", mtd: "month to date", qtd: "quarter to date", ytd: "year to date", "1y": "the last year", custom: "custom dates" };
  return `Default to ${labels[action.value]}`;
}

/** Only explicit personal layout requests become proposals. No financial writes. */
export function proposedDashboardActions(question: string): DashboardAction[] {
  const text = question.toLowerCase().replace(/\s+/g, " ").trim();
  if (!/\b(?:dashboard|overview)\b/.test(text) || !/\b(?:show|hide|add|remove|switch|change|use|set|focus|customi[sz]e)\b/.test(text)) return [];
  if (/\b(?:post|pay|delete|transfer|approve|journal|invoice|bank account|subscription)\b|\b(?:don't|do not|never)\b/.test(text)) return [];
  const actions: DashboardAction[] = [];
  if (/\b(?:bar|column) chart\b/.test(text)) actions.push({ kind: "chart", value: "bar" });
  else if (/\bline chart\b/.test(text)) actions.push({ kind: "chart", value: "line" });
  if (/\bfocus\b/.test(text)) {
    if (/\b(?:cash|financ(?:e|ial)|profitability)\b/.test(text)) actions.push({ kind: "focus", value: "finance" });
    else if (/\b(?:inventory|stock)\b/.test(text)) actions.push({ kind: "focus", value: "inventory" });
    else if (/\bsales\b/.test(text)) actions.push({ kind: "focus", value: "sales" });
  }
  const periods: Array<[RegExp, DashboardPeriod]> = [[/\b(?:last |past )?7 days\b/, "7d"], [/\b(?:last |past )?30 days\b/, "30d"], [/\b(?:last |past )?90 days\b/, "90d"], [/\bmonth to date\b|\bmtd\b/, "mtd"], [/\bquarter to date\b|\bqtd\b/, "qtd"], [/\byear to date\b|\bytd\b/, "ytd"], [/\byesterday\b/, "yesterday"], [/\btoday\b/, "today"]];
  const period = periods.find(([pattern]) => pattern.test(text));
  if (period) actions.push({ kind: "period", value: period[1] });
  const clauses = text.split(/(?=\b(?:show|add|hide|remove)\b)|[,;.]|\band then\b|\bbut\b/);
  for (const clause of clauses) {
    const match = /\b(show|add|hide|remove)\b/.exec(clause);
    if (!match) continue;
    const visible = match[1] === "show" || match[1] === "add";
    const aliases: Partial<Record<DashboardWidgetId, string[]>> = { net_revenue: ["net sales", "revenue"], net_margin: ["net profit margin"], transactions: ["orders"], average_order_value: ["aov"] };
    for (const id of Object.keys(metricNames) as DashboardWidgetId[]) {
      const names = [metricNames[id].toLowerCase(), ...(aliases[id] ?? [])];
      if (names.some(name => new RegExp(`\\b${name}\\b`).test(clause))) actions.push({ kind: "metric", id, visible });
    }
  }
  return actions.filter((action, index) => !actions.slice(index + 1).some(next => next.kind === action.kind && (action.kind !== "metric" || (next.kind === "metric" && next.id === action.id))));
}
export function applyDashboardActions(current: unknown, actions: readonly DashboardAction[]): DashboardPreferences {
  const next = normalizeDashboardPreferences(current);
  for (const action of actions) {
    if (action.kind === "chart") next.chart = action.value;
    else if (action.kind === "period" && action.value !== "custom") next.defaultPeriod = action.value;
    else if (action.kind === "focus") {
      const preset = dashboardPreferencePreset(action.value);
      next.profile = action.value;
      next.widgets = preset.widgets.map(widget => ({ ...next.widgets.find(item => item.id === widget.id)!, visible: widget.visible }));
    } else if (action.kind === "metric") next.widgets = next.widgets.map(widget => widget.id === action.id ? { ...widget, visible: action.visible } : widget);
  }
  return normalizeDashboardPreferences(next);
}
export function dashboardReviewMatches(input: { current: unknown; expected: unknown; scope: unknown; userId: string; workspaceId: string }) {
  const scope = input.scope as { userId?: unknown; workspaceId?: unknown } | null;
  return scope?.userId === input.userId && scope.workspaceId === input.workspaceId
    && JSON.stringify(normalizeDashboardPreferences(input.current)) === JSON.stringify(normalizeDashboardPreferences(input.expected));
}
