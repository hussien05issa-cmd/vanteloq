import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import { commercePayments, integrationConnections, integrationSyncRuns } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { acquireIntegrationSyncLease, releaseIntegrationSyncLease, requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { fetchMonerisPayments, MONERIS_PROVIDER, normalizeMonerisPayment } from "../../../../../../server/integrations/moneris";
import { requirePermission } from "../../../../../../server/permissions";

type MonerisCursor = { nextDay: string; providerCursor: string | null };
const DAY = 86_400_000;
function parseCursor(value: string | null): MonerisCursor {
  const fallback = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  if (!value) return { nextDay: fallback, providerCursor: null };
  try {
    const parsed = JSON.parse(value) as Partial<MonerisCursor>;
    return { nextDay: typeof parsed.nextDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.nextDay) ? parsed.nextDay : fallback, providerCursor: typeof parsed.providerCursor === "string" ? parsed.providerCursor : null };
  } catch { return { nextDay: fallback, providerCursor: null }; }
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("moneris:sync", context.userId, 12, 3_600);
    const body = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(context.organizationId, MONERIS_PROVIDER, typeof body.connectionId === "string" ? body.connectionId : null, { connected: true });
    const lease = await acquireIntegrationSyncLease(context.organizationId, MONERIS_PROVIDER, connection.id);
    if (!lease) throw new ApiError(409, "MONERIS_SYNC_IN_PROGRESS", "This Moneris account is already synchronizing.");
    const runId = crypto.randomUUID();
    const startedAt = new Date();
    const cursorBefore = parseCursor(connection.lastSyncCursor);
    await getDb().insert(integrationSyncRuns).values({ id: runId, organizationId: context.organizationId, provider: MONERIS_PROVIDER, connectionId: connection.id, mode: "incremental", status: "running", cursorBefore: connection.lastSyncCursor, cursorAfter: null, recordsRead: 0, recordsStaged: 0, duplicatesSkipped: 0, warningCount: 0, errorCode: null, startedAt, completedAt: null, createdByUserId: context.userId });
    try {
      let day = new Date(`${cursorBefore.nextDay}T00:00:00.000Z`);
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      let providerCursor = cursorBefore.providerCursor;
      let recordsRead = 0, staged = 0, warnings = 0, pages = 0, daysProcessed = 0;
      while (day.getTime() <= today.getTime() && daysProcessed < 7) {
        const end = new Date(Math.min(day.getTime() + DAY - 1, Date.now()));
        const result = await fetchMonerisPayments(context.organizationId, connection.id, { createdFrom: day.toISOString(), createdTo: end.toISOString(), cursor: providerCursor, maxPages: 10 });
        recordsRead += result.data.length; pages += result.pages; providerCursor = result.cursor;
        for (const raw of result.data) {
          try {
            const payment = await normalizeMonerisPayment(raw);
            if (!payment) continue;
            const inserted = await getDb().insert(commercePayments).values({ id: crypto.randomUUID(), organizationId: context.organizationId, provider: MONERIS_PROVIDER, connectionId: connection.id, ...payment, outletRef: null, syncRunId: runId, updatedAt: new Date() }).onConflictDoNothing().returning({ id: commercePayments.id });
            staged += inserted.length;
          } catch { warnings += 1; }
        }
        if (providerCursor) break;
        day = new Date(day.getTime() + DAY); daysProcessed += 1;
      }
      const cursorAfter: MonerisCursor = { nextDay: day.toISOString().slice(0, 10), providerCursor };
      const cursorJson = JSON.stringify(cursorAfter);
      const completedAt = new Date();
      await getDb().update(integrationSyncRuns).set({ status: "completed", cursorAfter: cursorJson, recordsRead, recordsStaged: staged, duplicatesSkipped: Math.max(0, recordsRead - staged - warnings), warningCount: warnings, completedAt }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({ lastSuccessfulSyncAt: completedAt, lastSyncCursor: cursorJson, dataPromotionStatus: "staging", lastErrorCode: warnings ? "MONERIS_PAYMENT_ROWS_SKIPPED" : null, syncLeaseOwner: null, syncLeaseExpiresAt: null, updatedAt: completedAt }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, MONERIS_PROVIDER), eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version)));
      const totals = await getD1().prepare("SELECT COUNT(*) count, COALESCE(SUM(amount_cents),0) amountCents FROM commerce_payments WHERE organization_id = ? AND provider = ? AND connection_id = ?").bind(context.organizationId, MONERIS_PROVIDER, connection.id).first<{ count: number; amountCents: number }>();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.sample_staged", resourceType: "integration_sync_run", resourceId: runId, details: { provider: MONERIS_PROVIDER, recordsRead, recordsStaged: staged, warningCount: warnings, rawCardDataStored: false } });
      return jsonResponse({ run: { id: runId, recordsRead, recordsStaged: staged, duplicatesSkipped: Math.max(0, recordsRead - staged - warnings), warningCount: warnings }, reconciliation: { payments: Number(totals?.count ?? 0), grossCents: Number(totals?.amountCents ?? 0), pages, daysProcessed }, readyForReview: Number(totals?.count ?? 0) > 0 && warnings === 0, nextStep: providerCursor || day.getTime() <= today.getTime() ? "Payment history is staged. Sync again to continue the resumable backfill." : "Payment history is staged. Compare its count and amount with Moneris before approval." });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "MONERIS_SYNC_FAILED";
      await getDb().update(integrationSyncRuns).set({ status: "failed", errorCode: code, completedAt: new Date() }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({ lastErrorCode: code, updatedAt: new Date() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, MONERIS_PROVIDER)));
      await releaseIntegrationSyncLease(lease);
      throw error;
    }
  });
}
