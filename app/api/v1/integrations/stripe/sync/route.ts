import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import { integrationConnections, integrationSyncRuns } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import {
  fetchStripeFinancialCollection,
  normalizeStripeBalanceTransaction,
  normalizeStripePayout,
  STRIPE_PROVIDER,
  type NormalizedStripeFinancialRecord,
} from "../../../../../../server/integrations/stripe";
import { requirePermission } from "../../../../../../server/permissions";

type StripeCursor = { balanceTransactions: string | null; payouts: string | null };

function parseCursor(value: string | null): StripeCursor {
  if (!value) return { balanceTransactions: null, payouts: null };
  try {
    const parsed = JSON.parse(value) as Partial<StripeCursor>;
    return {
      balanceTransactions: typeof parsed.balanceTransactions === "string" ? parsed.balanceTransactions : null,
      payouts: typeof parsed.payouts === "string" ? parsed.payouts : null,
    };
  } catch {
    return { balanceTransactions: null, payouts: null };
  }
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("stripe:sample-sync", context.userId, 12, 3_600);
    const [connection] = await getDb().select().from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, STRIPE_PROVIDER),
      eq(integrationConnections.status, "connected"),
    )).limit(1);
    if (!connection) throw new ApiError(409, "STRIPE_NOT_CONNECTED", "Authorize and verify Stripe before staging a sample.");
    const cursorBefore = parseCursor(connection.lastSyncCursor);
    const runId = crypto.randomUUID();
    const startedAt = new Date();
    await getDb().insert(integrationSyncRuns).values({
      id: runId,
      organizationId: context.organizationId,
      provider: STRIPE_PROVIDER,
      mode: "sample",
      status: "running",
      cursorBefore: connection.lastSyncCursor,
      cursorAfter: null,
      recordsRead: 0,
      recordsStaged: 0,
      duplicatesSkipped: 0,
      warningCount: 0,
      errorCode: null,
      startedAt,
      completedAt: null,
      createdByUserId: context.userId,
    });
    try {
      const [transactions, payouts] = await Promise.all([
        fetchStripeFinancialCollection(context.organizationId, "balance_transactions", {
          after: cursorBefore.balanceTransactions,
          maxPages: 3,
        }),
        fetchStripeFinancialCollection(context.organizationId, "payouts", {
          after: cursorBefore.payouts,
          maxPages: 3,
        }),
      ]);
      const normalized: NormalizedStripeFinancialRecord[] = [];
      let warnings = 0;
      for (const transaction of transactions.data) {
        try { normalized.push(await normalizeStripeBalanceTransaction(transaction)); } catch { warnings += 1; }
      }
      for (const payout of payouts.data) {
        try { normalized.push(await normalizeStripePayout(payout)); } catch { warnings += 1; }
      }
      let staged = 0;
      for (const record of normalized) {
        const result = await getD1().prepare(`
          INSERT OR IGNORE INTO integration_staged_financial_records
            (id, organization_id, provider, external_record_id, record_type,
             category, source_ref, occurred_at, available_at, currency,
             gross_cents, fee_cents, net_cents, state, livemode,
             source_payload_hash, sync_run_id, staged_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), context.organizationId, STRIPE_PROVIDER,
          record.externalRecordId, record.recordType, record.category,
          record.sourceRef, record.occurredAt, record.availableAt, record.currency,
          record.grossCents, record.feeCents, record.netCents, record.state,
          record.livemode ? 1 : 0, record.sourcePayloadHash, runId, Date.now(),
        ).run();
        staged += Number(result.meta.changes ?? 0);
      }
      const recordsRead = transactions.data.length + payouts.data.length;
      const duplicatesSkipped = normalized.length - staged;
      const cursorAfter: StripeCursor = warnings > 0 ? cursorBefore : {
        balanceTransactions: transactions.cursor,
        payouts: payouts.cursor,
      };
      const cursorAfterJson = JSON.stringify(cursorAfter);
      const completedAt = new Date();
      await getDb().update(integrationSyncRuns).set({
        status: "completed",
        cursorAfter: cursorAfterJson,
        recordsRead,
        recordsStaged: staged,
        duplicatesSkipped,
        warningCount: warnings,
        completedAt,
      }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({
        lastSuccessfulSyncAt: completedAt,
        lastSyncCursor: cursorAfterJson,
        dataPromotionStatus: "staging",
        lastErrorCode: null,
        updatedAt: completedAt,
      }).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, STRIPE_PROVIDER),
      ));
      const totals = normalized.reduce((sum, record) => ({
        grossCents: sum.grossCents + record.grossCents,
        feeCents: sum.feeCents + record.feeCents,
        netCents: sum.netCents + record.netCents,
      }), { grossCents: 0, feeCents: 0, netCents: 0 });
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.sample_staged",
        resourceType: "integration_sync_run",
        resourceId: runId,
        details: {
          provider: STRIPE_PROVIDER,
          recordsRead,
          recordsStaged: staged,
          duplicatesSkipped,
          warningCount: warnings,
          dataPromotionEnabled: false,
        },
      });
      return jsonResponse({
        run: {
          id: runId,
          status: "completed",
          recordsRead,
          recordsStaged: staged,
          duplicatesSkipped,
          warningCount: warnings,
          pages: transactions.pages + payouts.pages,
          cursorPreserved: cursorAfter,
        },
        reconciliation: {
          balanceTransactions: transactions.data.length,
          payouts: payouts.data.length,
          ...totals,
        },
        stagingOnly: true,
        dataPromotionEnabled: false,
        nextStep: "Review Stripe gross, fee, net and payout totals against the Stripe Dashboard before approving any downstream metric or BookLoQ posting.",
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "STRIPE_SAMPLE_FAILED";
      await getDb().update(integrationSyncRuns).set({ status: "failed", errorCode: code, completedAt: new Date() }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({ lastErrorCode: code, updatedAt: new Date() }).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, STRIPE_PROVIDER),
      ));
      throw error;
    }
  });
}
