import { getD1 } from "../../../../../db";
import { recordAudit } from "../../../../../server/audit";
import { requireAccess } from "../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { requireBookLoQPermission } from "../../../../../server/bookloq";

const writers = ["owner", "admin"] as const;

function identifier(value: unknown): string | null {
  return typeof value === "string" && value.length >= 3 && value.length <= 180 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers);
    await enforceRateLimit("bookloq:actions", context.userId, 60, 60);
    const body = await readJsonObject(request, 16_000);
    const allowed = ["type", "itemId", "status", "alertId", "periodId", "reason"];
    const unknown = Object.keys(body).find((field) => !allowed.includes(field));
    if (unknown) return jsonResponse({ error: { code: "UNKNOWN_FIELD", message: `Unexpected field: ${unknown}.` } }, { status: 400 });
    const database = getD1();
    const timestamp = Math.floor(Date.now() / 1_000);

    if (body.type === "month_end_status") {
      requireBookLoQPermission(context.role, "reconcile_accounts");
      const itemId = identifier(body.itemId);
      const status = typeof body.status === "string" && ["not_started", "in_progress", "blocked", "complete"].includes(body.status) ? body.status : null;
      if (!itemId || !status) return jsonResponse({ error: { code: "INVALID_CLOSE_ITEM", message: "Select a valid month-end item and status." } }, { status: 400 });
      const before = await database.prepare(`SELECT status FROM month_end_items WHERE organization_id = ? AND id = ?`).bind(context.organizationId, itemId).first<{ status: string }>();
      if (!before) return jsonResponse({ error: { code: "CLOSE_ITEM_NOT_FOUND", message: "Month-end item not found." } }, { status: 404 });
      await database.prepare(`UPDATE month_end_items SET status = ?, completed_at = ?, updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(status, status === "complete" ? timestamp : null, timestamp, context.organizationId, itemId).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "month_end.status_changed", resourceType: "bookloq_close_item", resourceId: itemId,
        details: { before: before.status, after: status } });
      return jsonResponse({ updated: true, type: body.type, id: itemId, status });
    }

    if (body.type === "alert_status") {
      requireBookLoQPermission(context.role, "create_transactions");
      const alertId = identifier(body.alertId);
      const status = typeof body.status === "string" && ["open", "in_progress", "resolved", "dismissed"].includes(body.status) ? body.status : null;
      if (!alertId || !status) return jsonResponse({ error: { code: "INVALID_ALERT", message: "Select a valid financial alert and status." } }, { status: 400 });
      const before = await database.prepare(`SELECT status, resolution_history_json history FROM bookloq_alerts WHERE organization_id = ? AND id = ?`).bind(context.organizationId, alertId).first<{ status: string; history: string }>();
      if (!before) return jsonResponse({ error: { code: "ALERT_NOT_FOUND", message: "Financial alert not found." } }, { status: 404 });
      let history: unknown[] = [];
      try { const parsed = JSON.parse(before.history); if (Array.isArray(parsed)) history = parsed.slice(-49); } catch { history = []; }
      history.push({ at: new Date().toISOString(), by: context.userId, from: before.status, to: status });
      await database.prepare(`UPDATE bookloq_alerts SET status = ?, resolution_history_json = ?, updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(status, JSON.stringify(history), timestamp, context.organizationId, alertId).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "bookloq_alert.status_changed", resourceType: "bookloq_alert", resourceId: alertId,
        details: { before: before.status, after: status } });
      return jsonResponse({ updated: true, type: body.type, id: alertId, status });
    }

    if (body.type === "lock_period") {
      requireBookLoQPermission(context.role, "lock_periods");
      const periodId = identifier(body.periodId);
      if (!periodId) return jsonResponse({ error: { code: "INVALID_PERIOD", message: "Select a valid accounting period." } }, { status: 400 });
      const period = await database.prepare(`SELECT status FROM accounting_periods WHERE organization_id = ? AND id = ?`).bind(context.organizationId, periodId).first<{ status: string }>();
      if (!period) return jsonResponse({ error: { code: "PERIOD_NOT_FOUND", message: "Accounting period not found." } }, { status: 404 });
      const incomplete = await database.prepare(`SELECT COUNT(*) count FROM month_end_items WHERE organization_id = ? AND period_id = ? AND status != 'complete'`)
        .bind(context.organizationId, periodId).first<{ count: number }>();
      if ((incomplete?.count ?? 0) > 0) return jsonResponse({ error: { code: "CLOSE_INCOMPLETE", message: "Complete every month-end item before locking this period." } }, { status: 409 });
      await database.prepare(`UPDATE accounting_periods SET status = 'locked', locked_at = ?, locked_by_user_id = ?, updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(timestamp, context.userId, timestamp, context.organizationId, periodId).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "accounting_period.locked", resourceType: "accounting_period", resourceId: periodId,
        details: { before: period.status, after: "locked" } });
      return jsonResponse({ updated: true, type: body.type, id: periodId, status: "locked" });
    }

    if (body.type === "unlock_period") {
      requireBookLoQPermission(context.role, "unlock_periods");
      const periodId = identifier(body.periodId);
      const reason = typeof body.reason === "string" ? body.reason.trim().normalize("NFC") : "";
      if (!periodId || !reason || reason.length > 1_000) return jsonResponse({ error: { code: "INVALID_UNLOCK", message: "A valid period and reason are required to unlock." } }, { status: 400 });
      const period = await database.prepare(`SELECT status FROM accounting_periods WHERE organization_id = ? AND id = ?`).bind(context.organizationId, periodId).first<{ status: string }>();
      if (!period || period.status !== "locked") return jsonResponse({ error: { code: "PERIOD_NOT_LOCKED", message: "Only a locked period can be unlocked." } }, { status: 409 });
      await database.prepare(`UPDATE accounting_periods SET status = 'review', locked_at = NULL, locked_by_user_id = NULL, updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(timestamp, context.organizationId, periodId).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "accounting_period.unlocked", resourceType: "accounting_period", resourceId: periodId,
        details: { before: "locked", after: "review", reason } });
      return jsonResponse({ updated: true, type: body.type, id: periodId, status: "review" });
    }

    return jsonResponse({ error: { code: "INVALID_ACTION", message: "Select a supported BookLoQ action." } }, { status: 400 });
  });
}
