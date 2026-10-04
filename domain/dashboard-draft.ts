import { normalizeDashboardPreferences, type DashboardPreferences } from "./dashboard-preferences";

export type DashboardDraftScope = { userId: string; workspaceId: string };
export const DASHBOARD_DRAFT_LIFETIME = 24 * 60 * 60 * 1000;
const VERSION = 1;
const MAX_LENGTH = 12_000;

export function dashboardDraftScope(value: unknown): DashboardDraftScope | null {
  if (!value || typeof value !== "object") return null;
  const scope = value as Record<string, unknown>;
  const valid = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 128 && !/[\u0000-\u001f]/.test(id);
  return valid(scope.userId) && valid(scope.workspaceId) ? { userId: scope.userId, workspaceId: scope.workspaceId } : null;
}

export function dashboardDraftKey(scope: DashboardDraftScope) {
  return `vanteloq:dashboard-layout-draft:v${VERSION}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.workspaceId)}`;
}

/** Only enumerated display choices and reporting dates may enter browser storage.
 * Targets, goal rules, named-view text, collections and source records never do. */
export function dashboardLayoutDraft(value: DashboardPreferences) {
  const layout = normalizeDashboardPreferences(value);
  return {
    profile: layout.profile, defaultPeriod: layout.defaultPeriod, comparison: layout.comparison,
    chart: layout.chart, customDates: layout.customDates, priorities: layout.priorities,
    widgets: layout.widgets, sections: layout.sections, goalRings: layout.goalRings,
  };
}

/** A one-way baseline fingerprint detects changed server preferences without caching them. */
export async function dashboardDraftFingerprint(value: DashboardPreferences): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(normalizeDashboardPreferences(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function serializeDashboardDraft(draft: DashboardPreferences, baseline: string, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(baseline) || !Number.isFinite(now)) throw new Error("A verified dashboard baseline is required.");
  return JSON.stringify({ version: VERSION, savedAt: now, baseline, layout: dashboardLayoutDraft(draft) });
}

export type DashboardDraftRecovery = { status: "none" | "invalid" | "expired" | "changed"; draft: null } | { status: "available"; draft: DashboardPreferences };

export function recoverDashboardDraft(raw: string | null, baseline: string, saved: DashboardPreferences, now = Date.now()): DashboardDraftRecovery {
  if (!raw) return { status: "none", draft: null };
  if (raw.length > MAX_LENGTH) return { status: "invalid", draft: null };
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== VERSION || typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)
      || value.savedAt > now || !value.layout || typeof value.layout !== "object" || Array.isArray(value.layout)
      || !/^[a-f0-9]{64}$/.test(value.baseline)) return { status: "invalid", draft: null };
    if (now - value.savedAt >= DASHBOARD_DRAFT_LIFETIME) return { status: "expired", draft: null };
    if (value.baseline !== baseline) return { status: "changed", draft: null };
    // Reapply the whitelist even to a modified cache, and retain current server-only fields.
    const layout = dashboardLayoutDraft(value.layout);
    const draft = normalizeDashboardPreferences({ ...saved, ...layout });
    return JSON.stringify(dashboardLayoutDraft(saved)) === JSON.stringify(layout)
      ? { status: "none", draft: null } : { status: "available", draft };
  } catch { return { status: "invalid", draft: null }; }
}
