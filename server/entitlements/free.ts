import { getD1 } from "../../db";
import { ApiError } from "../api";
import { FREE_PLAN } from "./catalog";

export type FreeUsageMetric = "ai_replies" | "import_rows";
export function freeUsagePeriod(now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  return { month, resetsAt };
}
export async function hasFreeEnrollment(organizationId: string) {
  return Boolean(await getD1().prepare(`SELECT organization_id FROM free_plan_enrollments WHERE organization_id=?
    AND (SELECT COUNT(*) FROM organization_locations WHERE organization_id=? AND status='active')<=1
    AND (SELECT COUNT(*) FROM memberships WHERE organization_id=? AND status='active')<=1`)
    .bind(organizationId, organizationId, organizationId).first());
}
export async function freeUsage(organizationId: string) {
  const period = freeUsagePeriod();
  const rows = (await getD1().prepare("SELECT metric,used FROM free_plan_usage WHERE organization_id=? AND month=?")
    .bind(organizationId, period.month).all<{metric: FreeUsageMetric; used: number}>()).results ?? [];
  const used = (metric: FreeUsageMetric) => rows.find(row => row.metric === metric)?.used ?? 0;
  return { ...period, aiReplies: { used: used("ai_replies"), limit: FREE_PLAN.limits.ai.requestsPerMonth },
    importRows: { used: used("import_rows"), limit: FREE_PLAN.importRowsPerMonth } };
}
/** Atomically reserve capacity before work. Failed, reviewed and replayed work releases it. */
export async function reserveFreeUsage(database: D1Database, organizationId: string, metric: FreeUsageMetric, amount: number, now = new Date()) {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Invalid free usage amount.");
  const limit = metric === "ai_replies" ? FREE_PLAN.limits.ai.requestsPerMonth : FREE_PLAN.importRowsPerMonth;
  const { month } = freeUsagePeriod(now);
  const row = await database.prepare(`INSERT INTO free_plan_usage (organization_id,month,metric,used)
    SELECT ?,?,?,? WHERE ?<=?
    ON CONFLICT(organization_id,month,metric) DO UPDATE SET used=used+excluded.used WHERE used+excluded.used<=?
    RETURNING used`).bind(organizationId,month,metric,amount,amount,limit,limit).first<{used:number}>();
  if (!row) throw new ApiError(402, "FREE_PLAN_LIMIT_REACHED",
    `Your Free plan includes ${limit} ${metric === "ai_replies" ? "AI replies" : "daily sales records"} per calendar month. Upgrade in Settings > Billing & plans, or wait for the next monthly reset. Your saved records remain available.`);
  let released = false;
  return { async release() {
    if (released) return;
    await database.prepare("UPDATE free_plan_usage SET used=MAX(0,used-?) WHERE organization_id=? AND month=? AND metric=?")
      .bind(amount,organizationId,month,metric).run();
    released = true;
  } };
}
