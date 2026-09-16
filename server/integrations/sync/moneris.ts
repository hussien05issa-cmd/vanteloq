import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { commercePayments, integrationConnections, integrationSyncRuns } from "../../../db/schema";
import { recordAudit } from "../../audit";
import { ApiError, enforceRateLimit, jsonResponse, } from "../../api";
import { acquireIntegrationSyncLease, releaseIntegrationSyncLease, renewIntegrationSyncLease, requireOwnedIntegrationConnection } from "../../integrations/connection";
import { fetchMonerisPayments, legacyMonerisPaymentHash, MONERIS_PROVIDER, MonerisSourceEvidenceError, monerisPaymentId, normalizeMonerisPayment } from "../../integrations/moneris";

type MonerisCursor = { nextDay: string; providerCursor: string | null; windowEnd?: string };
const DAY = 86_400_000;
function parseCursor(value: string | null): MonerisCursor {
  const fallback = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  if (!value) return { nextDay: fallback, providerCursor: null };
  try {
    const parsed = JSON.parse(value) as Partial<MonerisCursor>;
    const nextDay = typeof parsed.nextDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.nextDay) && !Number.isNaN(Date.parse(parsed.nextDay)) && new Date(parsed.nextDay).toISOString().slice(0, 10) === parsed.nextDay ? parsed.nextDay : fallback;
    const windowEnd = typeof parsed.windowEnd === "string" && !Number.isNaN(Date.parse(parsed.windowEnd)) && parsed.windowEnd.slice(0, 10) === nextDay ? parsed.windowEnd : undefined;
    return { nextDay, providerCursor: typeof parsed.providerCursor === "string" ? parsed.providerCursor : null, windowEnd };
  } catch { return { nextDay: fallback, providerCursor: null }; }
}

import type { SyncContext, SyncTrigger } from "./types";

export async function runSync(request: Request, requestId: string, context: SyncContext, input: Record<string, unknown>, trigger: SyncTrigger) {
    if (trigger === "manual") await enforceRateLimit("moneris:sync", context.userId, 12, 3_600);
    const body = input;
    const connection = await requireOwnedIntegrationConnection(context.organizationId, MONERIS_PROVIDER, typeof body.connectionId === "string" ? body.connectionId : null, { connected: true });
    const lease = await acquireIntegrationSyncLease(context.organizationId, MONERIS_PROVIDER, connection.id);
    if (!lease) throw new ApiError(409, "MONERIS_SYNC_IN_PROGRESS", "This Moneris account is already synchronizing.");
    const runId = crypto.randomUUID();
    const startedAt = new Date();
    const cursorBefore = parseCursor(connection.lastSyncCursor);
    try {
      await getDb().insert(integrationSyncRuns).values({ id: runId, organizationId: context.organizationId, provider: MONERIS_PROVIDER, connectionId: connection.id, mode: "incremental", status: "running", cursorBefore: connection.lastSyncCursor, cursorAfter: null, recordsRead: 0, recordsStaged: 0, duplicatesSkipped: 0, warningCount: 0, errorCode: null, startedAt, completedAt: null, createdByUserId: context.userId });
    } catch (error) { await releaseIntegrationSyncLease(lease); throw error; }
    try {
      let day = new Date(`${cursorBefore.nextDay}T00:00:00.000Z`);
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      let providerCursor = cursorBefore.providerCursor;
      let windowEnd = cursorBefore.windowEnd;
      let recordsRead = 0, staged = 0, warnings = 0, pages = 0, daysProcessed = 0, duplicatesSkipped = 0, ignoredPayments = 0, revalidatedPayments = 0;
      const sourceIssues: Record<string, number> = {};
      while (day.getTime() <= today.getTime() && daysProcessed < 7) {
        await renewIntegrationSyncLease(lease);
        const end = new Date(windowEnd ?? Math.min(day.getTime() + DAY - 1, Date.now()));
        windowEnd = end.toISOString();
        const result = await fetchMonerisPayments(context.organizationId, connection.id, { createdFrom: day.toISOString(), createdTo: end.toISOString(), cursor: providerCursor, maxPages: 10 });
        await renewIntegrationSyncLease(lease);
        recordsRead += result.data.length; pages += result.pages; providerCursor = result.cursor;
        for (const raw of result.data) {
          try {
            const externalPaymentId = monerisPaymentId(raw);
            const [existing] = await getDb().select().from(commercePayments).where(and(
              eq(commercePayments.organizationId, context.organizationId), eq(commercePayments.provider, MONERIS_PROVIDER),
              eq(commercePayments.connectionId, connection.id), eq(commercePayments.externalPaymentId, externalPaymentId),
            )).limit(1);
            const payment = await normalizeMonerisPayment(raw, context.organization.currency);
            if (existing) {
              if (!payment || existing.externalSaleId !== payment.externalSaleId || existing.paymentTypeRef !== payment.paymentTypeRef || existing.paymentTypeName !== payment.paymentTypeName || existing.category !== payment.category || existing.amountCents !== payment.amountCents || existing.paidAt !== payment.paidAt || existing.outletRef !== null) throw new MonerisSourceEvidenceError("MONERIS_PAYMENT_CHANGED", "A staged payment changed. Reconcile its amount or status before reporting.");
              if (existing.sourcePayloadHash === payment.sourcePayloadHash) { duplicatesSkipped += 1; continue; }
              if (existing.sourcePayloadHash !== await legacyMonerisPaymentHash(payment)) throw new MonerisSourceEvidenceError("MONERIS_PAYMENT_CHANGED", "A staged payment changed. Reconcile its amount or status before reporting.");
              // Fresh currency evidence can attest an otherwise identical legacy
              // record. Compare all facts again in the write; never overwrite money.
              const attested = await getDb().update(commercePayments).set({ sourcePayloadHash: payment.sourcePayloadHash }).where(and(
                eq(commercePayments.id, existing.id), eq(commercePayments.organizationId, context.organizationId), eq(commercePayments.provider, MONERIS_PROVIDER),
                eq(commercePayments.connectionId, connection.id), eq(commercePayments.externalPaymentId, payment.externalPaymentId),
                eq(commercePayments.sourcePayloadHash, existing.sourcePayloadHash), eq(commercePayments.externalSaleId, payment.externalSaleId),
                payment.paymentTypeRef === null ? isNull(commercePayments.paymentTypeRef) : eq(commercePayments.paymentTypeRef, payment.paymentTypeRef),
                eq(commercePayments.paymentTypeName, payment.paymentTypeName), eq(commercePayments.category, payment.category), eq(commercePayments.amountCents, payment.amountCents),
                payment.paidAt === null ? isNull(commercePayments.paidAt) : eq(commercePayments.paidAt, payment.paidAt), isNull(commercePayments.outletRef),
              )).returning({ id: commercePayments.id });
              if (!attested.length) throw new MonerisSourceEvidenceError("MONERIS_PAYMENT_WRITE_CONFLICT", "A staged payment changed during currency verification. Retry reconciliation.");
              revalidatedPayments += 1;
              continue;
            }
            if (!payment) { ignoredPayments += 1; continue; }
            const inserted = await getDb().insert(commercePayments).values({ id: crypto.randomUUID(), organizationId: context.organizationId, provider: MONERIS_PROVIDER, connectionId: connection.id, ...payment, outletRef: null, syncRunId: runId, updatedAt: new Date() }).onConflictDoNothing().returning({ id: commercePayments.id });
            if (!inserted.length) throw new MonerisSourceEvidenceError("MONERIS_PAYMENT_WRITE_CONFLICT", "A staged payment was changed by another operation. Retry reconciliation.");
            staged += inserted.length;
          } catch (error) {
            if (!(error instanceof MonerisSourceEvidenceError)) throw error;
            warnings += 1; sourceIssues[error.code] = (sourceIssues[error.code] ?? 0) + 1;
          }
        }
        if (providerCursor || warnings) break;
        // A page chain opened during the day may finish after midnight. Its
        // frozen end does not cover later payments on that day. Re-read the
        // full day from its first page before advancing to the next date.
        if (end.getTime() < day.getTime() + DAY - 1 && day.getTime() < today.getTime()) {
          windowEnd = undefined;
          break;
        }
        day = new Date(day.getTime() + DAY); daysProcessed += 1; windowEnd = undefined;
      }
      const hasMore = Boolean(providerCursor) || day.getTime() <= today.getTime();
      // Re-read the current day on the next cycle so later payments are not skipped.
      const cursorAfter: MonerisCursor = warnings ? cursorBefore : { nextDay: new Date(Math.min(day.getTime(), today.getTime())).toISOString().slice(0, 10), providerCursor, ...(providerCursor ? { windowEnd } : {}) };
      const cursorJson = JSON.stringify(cursorAfter);
      const completedAt = new Date();
      await getDb().update(integrationSyncRuns).set({ status: "completed", cursorAfter: cursorJson, recordsRead, recordsStaged: staged, duplicatesSkipped, warningCount: warnings, completedAt }).where(eq(integrationSyncRuns.id, runId));
      await renewIntegrationSyncLease(lease);
      const updated = await getDb().update(integrationConnections).set({ lastSuccessfulSyncAt: warnings ? connection.lastSuccessfulSyncAt : completedAt, lastSyncCursor: cursorJson, dataPromotionStatus: "staging", lastErrorCode: warnings ? "MONERIS_PAYMENT_ROWS_SKIPPED" : null, syncLeaseOwner: null, syncLeaseExpiresAt: null, updatedAt: completedAt }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, MONERIS_PROVIDER), eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version))).returning({ id: integrationConnections.id });
      if (!updated.length) throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "The Moneris sync was superseded.");
      // Historical rows have no currency or refund ledger. Do not present their
      // sum as verified gross sales, net sales or a settlement balance.
      const totals = await getD1().prepare("SELECT COUNT(*) count FROM commerce_payments WHERE organization_id = ? AND provider = ? AND connection_id = ?").bind(context.organizationId, MONERIS_PROVIDER, connection.id).first<{ count: number }>();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.sample_staged", resourceType: "integration_sync_run", resourceId: runId, details: { provider: MONERIS_PROVIDER, recordsRead, recordsStaged: staged, warningCount: warnings, ignoredPayments, revalidatedPayments, currency: context.organization.currency, sourceIssues: JSON.stringify(sourceIssues), rawCardDataStored: false, dataPromotionEnabled: false } });
      return jsonResponse({
        hasMore, retryRequired: warnings > 0, backfillComplete: !hasMore && warnings === 0, sourceIssues,
        stagingOnly: true, dataPromotionEnabled: false,
        run: { id: runId, recordsRead, recordsStaged: staged, duplicatesSkipped, ignoredPayments, revalidatedPayments, warningCount: warnings },
        reconciliation: { payments: Number(totals?.count ?? 0), pages, daysProcessed, currency: context.organization.currency, refundsReconciled: false, settlementReconciled: false },
        readyForReview: false,
        nextStep: warnings ? "Some payment records need reconciliation. Reporting remains off; review the source issues before retrying."
          : hasMore ? "Payment history is staged. Sync again to continue the resumable backfill. Reporting remains off."
          : "Payment history is staged. Refunds, payment changes and settlements still require reconciliation before reporting can be enabled.",
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "MONERIS_SYNC_FAILED";
      await getDb().update(integrationSyncRuns).set({ status: "failed", errorCode: code, completedAt: new Date() }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({ lastErrorCode: code, updatedAt: new Date() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, MONERIS_PROVIDER), eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version)));
      throw error;
    } finally { await releaseIntegrationSyncLease(lease); }
}
