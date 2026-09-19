export type SignupPlan = "starter" | "growth" | "pro" | "bookloq";
export type PlanSelection = { plan: SignupPlan; bookloq: boolean };
const KEY = "vanteloq:plan-selection:v1";
export function parsePlanSelection(plan: unknown, bookloq: unknown): PlanSelection | null {
  if (plan !== "starter" && plan !== "growth" && plan !== "pro" && plan !== "bookloq") return null;
  return { plan, bookloq: plan === "bookloq" ? false : bookloq === true || bookloq === "1" };
}
export function planSelectionUrl(selection: PlanSelection) {
  return "/?start=signup&plan=" + selection.plan + (selection.plan !== "bookloq" && selection.bookloq ? "&bookloq=1" : "");
}
/** A local purchase preference only, never an entitlement or a trusted price. */
export function readPlanSelection(): PlanSelection | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const requested = parsePlanSelection(params.get("plan"), params.get("bookloq"));
  if (requested) { savePlanSelection(requested); return requested; }
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null");
    if (!stored || typeof stored.savedAt !== "number" || Date.now() - stored.savedAt > 7 * 86400000 || stored.savedAt > Date.now()) return null;
    return parsePlanSelection(stored.plan, stored.bookloq);
  } catch { return null; }
}
export function savePlanSelection(selection: PlanSelection) {
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ ...selection, savedAt: Date.now() })); } catch { /* The URL still carries the preference when storage is blocked. */ }
}
export function clearPlanSelection() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* No purchase authority is stored here. */ }
}
