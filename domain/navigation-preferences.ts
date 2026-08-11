export const NAVIGATION_VIEW_IDS = [
  "Dashboard",
  "Intelligence",
  "Action Centre",
  "Business Brief",
  "Advisor",
  "Sales",
  "Customers",
  "Inventory",
  "Suppliers",
  "Purchase Orders",
  "Operations",
  "Profit",
  "Cash",
  "BookLoQ",
  "Bookkeeping",
  "Reports",
  "Marketing",
  "Communications",
  "Team",
  "Documents",
  "Data Quality",
  "Locations",
  "Decision Journal",
  "Scenario Planner",
  "Industry Modules",
  "Integrations",
  "Settings",
] as const;

export const PROTECTED_NAVIGATION_VIEW_IDS = ["Dashboard", "Settings"] as const;

export function normalizeHiddenNavigation<T extends string>(
  hiddenViews: readonly string[],
  allowedViews: readonly T[],
  protectedViews: readonly T[],
): T[] {
  const allowed = new Set<string>(allowedViews);
  const protectedSet = new Set<string>(protectedViews);
  const seen = new Set<string>();
  const normalized: T[] = [];

  for (const view of hiddenViews) {
    if (!allowed.has(view) || protectedSet.has(view) || seen.has(view)) continue;
    seen.add(view);
    normalized.push(view as T);
  }
  return normalized;
}

export function setNavigationVisibility<T extends string>(
  hiddenViews: readonly string[],
  view: T,
  visible: boolean,
  allowedViews: readonly T[],
  protectedViews: readonly T[],
): T[] {
  const normalized = normalizeHiddenNavigation(hiddenViews, allowedViews, protectedViews);
  if (visible) return normalized.filter((candidate) => candidate !== view);
  return normalizeHiddenNavigation([...normalized, view], allowedViews, protectedViews);
}
