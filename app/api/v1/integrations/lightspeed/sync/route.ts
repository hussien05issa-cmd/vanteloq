import { and, eq, sql } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import {
  integrationConnections,
  integrationLocationMappings,
  integrationSyncRuns,
} from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import {
  ApiError,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  requireSameOrigin,
} from "../../../../../../server/api";
import {
  fetchLightspeedCollection,
  LIGHTSPEED_PROVIDER,
  normalizeLightspeedSale,
} from "../../../../../../server/integrations/lightspeed";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("lightspeed:sample-sync", context.userId, 12, 3_600);
    const [connection] = await getDb().select().from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, LIGHTSPEED_PROVIDER),
      eq(integrationConnections.status, "connected"),
    )).limit(1);
    if (!connection) throw new ApiError(409, "LIGHTSPEED_NOT_CONNECTED", "Authorize and verify Lightspeed before staging a sample.");

    const runId = crypto.randomUUID();
    const startedAt = new Date();
    await getDb().insert(integrationSyncRuns).values({
      id: runId,
      organizationId: context.organizationId,
      provider: LIGHTSPEED_PROVIDER,
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
      const page = await fetchLightspeedCollection(context.organizationId, "sales", {
        after: connection.lastSyncCursor,
        maxPages: 3,
      });
      const normalized = [];
      let warnings = 0;
      for (const sale of page.data) {
        try {
          normalized.push(await normalizeLightspeedSale(sale));
        } catch {
          warnings += 1;
        }
      }
      let staged = 0;
      for (const sale of normalized) {
        const result = await getD1().prepare(`
          INSERT OR IGNORE INTO integration_staged_sales
            (id, organization_id, provider, external_sale_id, external_version,
             outlet_ref, sold_at, state, total_cents, tax_cents, cost_cents,
             discount_cents, line_count, source_payload_hash, sync_run_id, staged_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_PROVIDER,
          sale.externalSaleId, sale.externalVersion, sale.outletRef, sale.soldAt,
          sale.state, sale.totalCents, sale.taxCents, sale.costCents,
          sale.discountCents, sale.lineCount, sale.sourcePayloadHash, runId,
          Date.now(),
        ).run();
        staged += Number(result.meta.changes ?? 0);
      }
      const duplicatesSkipped = normalized.length - staged;
      const completedAt = new Date();
      // Never advance past records that could not be normalized. A later retry
      // must see the same provider page until every record is understood.
      const safeCursor = warnings > 0 ? connection.lastSyncCursor : page.cursor;
      await getDb().update(integrationSyncRuns).set({
        status: "completed",
        cursorAfter: safeCursor,
        recordsRead: page.data.length,
        recordsStaged: staged,
        duplicatesSkipped,
        warningCount: warnings,
        completedAt,
      }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({
        lastSuccessfulSyncAt: completedAt,
        lastSyncCursor: safeCursor,
        dataPromotionStatus: "staging",
        lastErrorCode: null,
        updatedAt: completedAt,
      }).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_PROVIDER),
      ));
      const [locationCounts] = await getDb().select({
        total: sql<number>`count(*)`,
        mapped: sql<number>`sum(case when ${integrationLocationMappings.status} = 'mapped' then 1 else 0 end)`,
        ignored: sql<number>`sum(case when ${integrationLocationMappings.status} = 'ignored' then 1 else 0 end)`,
      }).from(integrationLocationMappings).where(and(
        eq(integrationLocationMappings.organizationId, context.organizationId),
        eq(integrationLocationMappings.provider, LIGHTSPEED_PROVIDER),
      ));
      const sourceTotalCents = normalized.reduce((sum, sale) => sum + sale.totalCents, 0);
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.sample_staged",
        resourceType: "integration_sync_run",
        resourceId: runId,
        details: {
          provider: LIGHTSPEED_PROVIDER,
          recordsRead: page.data.length,
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
          recordsRead: page.data.length,
          recordsStaged: staged,
          duplicatesSkipped,
          warningCount: warnings,
          pages: page.pages,
          cursorPreserved: safeCursor,
          sourceTotalCents,
        },
        reconciliation: {
          mappedOutlets: Number(locationCounts?.mapped ?? 0),
          discoveredOutlets: Number(locationCounts?.total ?? 0),
          ignoredOutlets: Number(locationCounts?.ignored ?? 0),
          unmappedOutlets:
            Number(locationCounts?.total ?? 0) -
            Number(locationCounts?.mapped ?? 0) -
            Number(locationCounts?.ignored ?? 0),
          sourceRecords: normalized.length,
          stagedRecords: staged,
          duplicateRecords: duplicatesSkipped,
        },
        stagingOnly: true,
        dataPromotionEnabled: false,
        nextStep:
          "Map every active outlet, review sample totals and approve a separate promotion gate before any staged sale can affect Vanteloq metrics.",
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "LIGHTSPEED_SAMPLE_FAILED";
      await getDb().update(integrationSyncRuns).set({
        status: "failed", errorCode: code, completedAt: new Date(),
      }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({
        lastErrorCode: code, updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_PROVIDER),
      ));
      throw error;
    }
  });
}
