import type { ExecutiveKey } from "./executive-metrics";

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
export type DashboardPreferences = {
  profile: DashboardProfile;
  defaultPeriod: DashboardPeriod;
  comparison: DashboardComparison;
  widgets: Array<{ id: DashboardWidgetId; size: "standard" | "wide"; visible: boolean }>;
  sections: { needsAttention: boolean; financialDetail: boolean };
  targets: Partial<Record<DashboardWidgetId, number>>;
};

const profileOrder: Record<DashboardProfile, readonly DashboardWidgetId[]> = {
  owner: dashboardWidgetIds,
  manager: ["net_revenue", "gross_profit", "transactions", "average_order_value", "units_sold", "inventory_value", "gross_margin", "cash_balance", "cash_flow", "operating_profit", "net_margin"],
  finance: ["net_revenue", "gross_profit", "gross_margin", "operating_profit", "net_margin", "cash_balance", "cash_flow", "inventory_value", "transactions", "average_order_value", "units_sold"],
  inventory: ["inventory_value", "units_sold", "net_revenue", "gross_profit", "gross_margin", "transactions", "average_order_value", "cash_balance", "cash_flow", "operating_profit", "net_margin"],
  sales: ["net_revenue", "transactions", "average_order_value", "units_sold", "gross_profit", "gross_margin", "inventory_value", "cash_balance", "cash_flow", "operating_profit", "net_margin"],
};
const visibleByProfile: Record<DashboardProfile, ReadonlySet<DashboardWidgetId>> = {
  owner: new Set(dashboardWidgetIds),
  manager: new Set(["net_revenue", "gross_profit", "transactions", "average_order_value", "units_sold", "inventory_value"]),
  finance: new Set(["net_revenue", "gross_profit", "gross_margin", "operating_profit", "net_margin", "cash_balance", "cash_flow"]),
  inventory: new Set(["inventory_value", "units_sold", "net_revenue", "gross_profit", "gross_margin", "transactions"]),
  sales: new Set(["net_revenue", "transactions", "average_order_value", "units_sold", "gross_profit", "gross_margin"]),
};

const includes = <T extends readonly string[]>(items: T, value: unknown): value is T[number] => typeof value === "string" && items.includes(value as T[number]);

export function dashboardPreferencePreset(profile: DashboardProfile = "owner"): DashboardPreferences {
  const visible = visibleByProfile[profile];
  return {
    profile,
    defaultPeriod: "30d",
    comparison: "previous",
    widgets: profileOrder[profile].map((id, index) => ({ id, visible: visible.has(id), size: index < 2 ? "wide" : "standard" })),
    sections: { needsAttention: true, financialDetail: profile === "owner" || profile === "finance" },
    targets: {},
  };
}

export function normalizeDashboardPreferences(value: unknown): DashboardPreferences {
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
    if (typeof target === "number" && Number.isFinite(target) && Math.abs(target) <= 1_000_000_000) targets[id] = target;
  }
  return {
    profile,
    defaultPeriod: includes(dashboardPeriods, input.defaultPeriod) ? input.defaultPeriod : defaults.defaultPeriod,
    comparison: includes(dashboardComparisons, input.comparison) ? input.comparison : defaults.comparison,
    widgets,
    sections: {
      needsAttention: sectionsInput.needsAttention !== false,
      financialDetail: sectionsInput.financialDetail === undefined ? defaults.sections.financialDetail : sectionsInput.financialDetail !== false,
    },
    targets,
  };
}

export function parseDashboardPreferencesJson(value: string | null | undefined): DashboardPreferences {
  if (!value) return dashboardPreferencePreset();
  try { return normalizeDashboardPreferences(JSON.parse(value)); } catch { return dashboardPreferencePreset(); }
}
