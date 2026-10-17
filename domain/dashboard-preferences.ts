import { validDashboardDates, type GoalRule, type OverviewPriority } from "./dashboard-personalization";
import type { ExecutiveKey } from "./executive-metrics";
import { normalizeCollectionsPreferences, type CollectionsPreferences } from "./collections-dashboard";

export const dashboardProfiles = ["owner", "manager", "finance", "inventory", "sales"] as const;
export const dashboardPeriods = ["today", "yesterday", "7d", "30d", "90d", "mtd", "qtd", "ytd", "1y", "custom"] as const;
export const dashboardComparisons = ["previous", "yoy", "budget", "target"] as const;
export const dashboardWidgetIds = [
  "net_revenue", "gross_profit", "gross_margin", "operating_profit", "net_margin",
  "cash_balance", "cash_flow", "inventory_value", "transactions", "average_order_value", "units_sold",
] as const satisfies readonly ExecutiveKey[];

export type DashboardProfile = typeof dashboardProfiles[number];
export type DashboardPeriod = typeof dashboardPeriods[number];
export type DashboardComparison = typeof dashboardComparisons[number];
export type DashboardWidgetId = typeof dashboardWidgetIds[number];
export type DashboardView = { name: string; layout: Omit<DashboardPreferences, "views" | "collections"> };
export type DashboardPreferences = {
  views: DashboardView[];
  priorities: OverviewPriority[];
  customDates: {from:string;to:string};
  chart: "line" | "bar";
  goalRules: Partial<Record<DashboardWidgetId, GoalRule>>;
  collections: CollectionsPreferences;
  profile: DashboardProfile;
  defaultPeriod: DashboardPeriod;
  comparison: DashboardComparison;
  widgets: Array<{ id: DashboardWidgetId; size: "standard" | "wide"; visible: boolean }>;
  sections: { needsAttention: boolean; financialDetail: boolean; collections: boolean };
  goalRings: [DashboardWidgetId, DashboardWidgetId, DashboardWidgetId];
  targets: Partial<Record<DashboardWidgetId, number>>;
};

const defaultGoalRings: DashboardPreferences["goalRings"] = ["net_revenue", "gross_margin", "cash_balance"];
const commerceOverviewMetrics: readonly DashboardWidgetId[] = ["net_revenue", "gross_profit", "gross_margin", "transactions"];
const commerceOverviewOrder = [...commerceOverviewMetrics, ...dashboardWidgetIds.filter(id => !commerceOverviewMetrics.includes(id))];

const profileOrder: Record<DashboardProfile, readonly DashboardWidgetId[]> = {
  owner: commerceOverviewOrder,
  manager: ["net_revenue", "gross_profit", "transactions", "average_order_value", "units_sold", "inventory_value", "gross_margin", "cash_balance", "cash_flow", "operating_profit", "net_margin"],
  finance: ["net_revenue", "gross_profit", "gross_margin", "operating_profit", "net_margin", "cash_balance", "cash_flow", "inventory_value", "transactions", "average_order_value", "units_sold"],
  inventory: ["inventory_value", "units_sold", "net_revenue", "gross_profit", "gross_margin", "transactions", "average_order_value", "cash_balance", "cash_flow", "operating_profit", "net_margin"],
  sales: [...commerceOverviewMetrics, "average_order_value", "units_sold", "inventory_value", "cash_balance", "cash_flow", "operating_profit", "net_margin"],
};
const visibleByProfile: Record<DashboardProfile, ReadonlySet<DashboardWidgetId>> = {
  owner: new Set(commerceOverviewMetrics),
  manager: new Set(["net_revenue", "gross_profit", "transactions", "average_order_value", "units_sold", "inventory_value"]),
  finance: new Set(["net_revenue", "gross_profit", "gross_margin", "operating_profit", "cash_balance", "cash_flow"]),
  inventory: new Set(["inventory_value", "units_sold", "net_revenue", "gross_profit", "gross_margin", "transactions"]),
  sales: new Set(commerceOverviewMetrics),
};

const includes = <T extends readonly string[]>(items: T, value: unknown): value is T[number] => typeof value === "string" && items.includes(value as T[number]);

export function dashboardPreferencePreset(profile: DashboardProfile = "owner"): DashboardPreferences {
  const visible = visibleByProfile[profile];
  return {
    collections: normalizeCollectionsPreferences(null),
    views: [], priorities: [], customDates: {from:"",to:""}, chart: "line", goalRules: {},
    profile,
    defaultPeriod: "30d",
    comparison: "previous",
    widgets: profileOrder[profile].map((id, index) => ({ id, visible: visible.has(id), size: profile !== "owner" && profile !== "sales" && index < 2 ? "wide" : "standard" })),
    sections: { needsAttention: true, collections: true, financialDetail: profile === "owner" || profile === "finance" },
    goalRings: [...defaultGoalRings],
    targets: {},
  };
}

export function normalizeDashboardPreferences(value: unknown, includeViews = true): DashboardPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return dashboardPreferencePreset();
  const input = value as Record<string, unknown>;
  const profile: DashboardProfile = includes(dashboardProfiles, input.profile) ? input.profile : "owner";
  const defaults = dashboardPreferencePreset(profile);
  const seen = new Set<DashboardWidgetId>();
  const widgets: DashboardPreferences["widgets"] = [];
  if (Array.isArray(input.widgets)) {
    for (const candidate of input.widgets) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const item = candidate as Record<string, unknown>;
      if (!includes(dashboardWidgetIds, item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      widgets.push({ id: item.id, visible: item.visible !== false, size: item.size === "wide" ? "wide" : "standard" });
    }
  }
  for (const item of defaults.widgets) if (!seen.has(item.id)) widgets.push(item);
  const sectionsInput = input.sections && typeof input.sections === "object" && !Array.isArray(input.sections) ? input.sections as Record<string, unknown> : {};
  const targetsInput = input.targets && typeof input.targets === "object" && !Array.isArray(input.targets) ? input.targets as Record<string, unknown> : {};
  const targets: DashboardPreferences["targets"] = {};
  for (const id of dashboardWidgetIds) {
    const target = targetsInput[id];
    if (typeof target === "number" && Number.isFinite(target) && target > 0 && target <= 1_000_000_000) targets[id] = target;
  }
  const dates = input.customDates as {from?:unknown;to?:unknown} | undefined;
  const customDates = validDashboardDates(dates?.from, dates?.to) ? {from:String(dates!.from),to:String(dates!.to)} : {from:"",to:""};
  const rules = input.goalRules && typeof input.goalRules === "object" ? input.goalRules as Record<string, unknown> : {};
  const goalRules: DashboardPreferences["goalRules"] = {};
  for(const id of dashboardWidgetIds) {
    const rule=rules[id] as Partial<GoalRule> | undefined;
    if(rule && validDashboardDates(rule.from,rule.to)) goalRules[id]={direction:rule.direction==="lower"?"lower":"higher",from:String(rule.from),to:String(rule.to),locationId:typeof rule.locationId==="string"&&rule.locationId.length<=128?rule.locationId:null,...(typeof rule.start==="number"&&Number.isFinite(rule.start)&&Math.abs(rule.start)<=1e9?{start:rule.start}:{})};
  }
  const priorities = Array.isArray(input.priorities) ? [...new Set(input.priorities.filter((p):p is OverviewPriority=>["sales","profit","cash","collect","bills","stock"].includes(String(p))))].slice(0,6) : [];
  const names = new Set<string>();
  const views: DashboardView[]=[];
  if(includeViews && Array.isArray(input.views)) for(const item of input.views.slice(0,5)) {
    if(!item || typeof item!=="object" || typeof item.name!=="string") continue;
    const name=item.name.trim().replace(/[\u0000-\u001f]/g,"").slice(0,40);
    if(!name || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    const {views:_views,collections:_collections,...layout}=normalizeDashboardPreferences(item.layout,false);
    void _views; void _collections;
    views.push({name,layout});
  }
  const requestedGoalRings = Array.isArray(input.goalRings) ? input.goalRings : [];
  const uniqueGoalRings = requestedGoalRings.filter((id): id is DashboardWidgetId => includes(dashboardWidgetIds, id)).filter((id, index, items) => items.indexOf(id) === index).slice(0, 3);
  for (const id of defaultGoalRings) if (uniqueGoalRings.length < 3 && !uniqueGoalRings.includes(id)) uniqueGoalRings.push(id);
  return {
    collections: normalizeCollectionsPreferences(input.collections),
    views, priorities, customDates, goalRules, chart: input.chart === "bar" ? "bar" : "line",
    profile,
    defaultPeriod: includes(dashboardPeriods, input.defaultPeriod) && (input.defaultPeriod !== "custom" || customDates.from) ? input.defaultPeriod : defaults.defaultPeriod,
    comparison: includes(dashboardComparisons, input.comparison) ? input.comparison : defaults.comparison,
    widgets,
    sections: {
      needsAttention: sectionsInput.needsAttention !== false,
      collections: sectionsInput.collections !== false,
      financialDetail: sectionsInput.financialDetail === undefined ? defaults.sections.financialDetail : sectionsInput.financialDetail !== false,
    },
    goalRings: uniqueGoalRings as DashboardPreferences["goalRings"],
    targets,
  };
}

export function parseDashboardPreferencesJson(value: string | null | undefined): DashboardPreferences {
  if (!value) return dashboardPreferencePreset();
  try { return normalizeDashboardPreferences(JSON.parse(value)); } catch { return dashboardPreferencePreset(); }
}
