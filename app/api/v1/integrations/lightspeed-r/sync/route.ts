import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../../db";
import {
  integrationConnections,
  integrationLocationMappings,
  integrationSyncRuns,
} from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import {
  buildLightspeedRDailyMetrics,
  fetchLightspeedRCollection,
  LIGHTSPEED_R_PROVIDER,
  normalizeLightspeedRInventoryItem,
  normalizeLightspeedRSale,
  type NormalizedLightspeedRSale,
} from "../../../../../../server/integrations/lightspeed-r";
import { requirePermission } from "../../../../../../server/permissions";

const IMPORT_LABEL = "Lightspeed R-Series live sync";

type SyncCheckpoint = {
  version: 1;
  watermark: string | null;
  salesCursor: string | null;
  itemsCursor: string | null;
  salesComplete: boolean;
  itemsComplete: boolean;
};

type StagedSaleRow = Pick<NormalizedLightspeedRSale,
  "externalSaleId" | "outletRef" | "soldAt" | "state" | "totalCents" |
  "taxCents" | "costCents" | "discountCents" | "lineCount"
>;

function checkpoint(value: string | null): SyncCheckpoint {
  const empty: SyncCheckpoint = {
    version: 1,
    watermark: null,
    salesCursor: null,
    itemsCursor: null,
    salesComplete: false,
    itemsComplete: false,
  };
  if (!value) return empty;
  if (value.startsWith("https://api.lightspeedapp.com/") && value.includes("/Sale.json")) {
    return { ...empty, salesCursor: value };
  }
  if (!Number.isNaN(Date.parse(value))) return { ...empty, watermark: value };
  try {
    const parsed = JSON.parse(value) as Partial<SyncCheckpoint>;
    if (parsed.version !== 1) return empty;
    return {
      version: 1,
      watermark: typeof parsed.watermark === "string" ? parsed.watermark : null,
      salesCursor: typeof parsed.salesCursor === "string" ? parsed.salesCursor : null,
      itemsCursor: typeof parsed.itemsCursor === "string" ? parsed.itemsCursor : null,
      salesComplete: parsed.salesComplete === true,
      itemsComplete: parsed.itemsComplete === true,
    };
  } catch {
    return empty;
  }
}

function nextCheckpoint(
  previous: SyncCheckpoint,
  completedAt: Date,
  salesCursor: string | null,
  itemsCursor: string | null,
  salesComplete: boolean,
  itemsComplete: boolean,
) {
  if (salesComplete && itemsComplete) {
    return JSON.stringify({
      version: 1,
      watermark: completedAt.toISOString(),
      salesCursor: null,
      itemsCursor: null,
      salesComplete: false,
      itemsComplete: false,
    } satisfies SyncCheckpoint);
  }
  return JSON.stringify({
    version: 1,
    watermark: previous.watermark,
    salesCursor,
    itemsCursor,
    salesComplete,
    itemsComplete,
  } satisfies SyncCheckpoint);
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("lightspeed-r:live-sync", context.userId, 12, 3_600);
    const [connection] = await getDb().select().from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      eq(integrationConnections.status, "connected"),
    )).limit(1);
    if (!connection?.externalAccountRef) {
      throw new ApiError(409, "LIGHTSPEED_R_NOT_CONNECTED", "Authorize R-Series before importing its data.");
    }

    const runId = crypto.randomUUID();
    const importId = `provider-${LIGHTSPEED_R_PROVIDER}-${runId}`;
    const startedAt = new Date();
    const previous = checkpoint(connection.lastSyncCursor);
    await getDb().insert(integrationSyncRuns).values({
      id: runId,
      organizationId: context.organizationId,
      provider: LIGHTSPEED_R_PROVIDER,
      mode: "incremental",
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
      const salesPage = previous.salesComplete
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.externalAccountRef, "Sale", {
            maxPages: 5,
            cursor: previous.salesCursor,
            modifiedSince: previous.salesCursor ? null : previous.watermark,
          });
      // Do not make today's dashboard wait behind a long historical backfill.
      // R-Series supports timestamp filters on collection reads, so every run
      // also stages the newest 24 hours before continuing the saved cursor.
      const recentSalesPage = await fetchLightspeedRCollection(
        context.organizationId,
        connection.externalAccountRef,
        "Sale",
        {
          maxPages: 5,
          modifiedSince: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
        },
      );
      const itemsPage = previous.itemsComplete
        ? { data: [], pages: 0, cursor: null as string | null }
        : await fetchLightspeedRCollection(context.organizationId, connection.externalAccountRef, "Item", {
            maxPages: 10,
            cursor: previous.itemsCursor,
            modifiedSince: previous.itemsCursor ? null : previous.watermark,
          });

      const normalizedSales: NormalizedLightspeedRSale[] = [];
      const inventoryBalances = [];
      let warnings = 0;
      for (const source of [...recentSalesPage.data, ...salesPage.data]) {
        try { normalizedSales.push(await normalizeLightspeedRSale(source)); } catch { warnings += 1; }
      }
      for (const source of itemsPage.data) {
        try {
          inventoryBalances.push(...normalizeLightspeedRInventoryItem(source));
        } catch { warnings += 1; }
      }

      const database = getD1();
      let stagedSales = 0;
      for (const sale of normalizedSales) {
        const result = await database.prepare(`
          INSERT OR IGNORE INTO integration_staged_sales
            (id, organization_id, provider, external_sale_id, external_version, outlet_ref, sold_at, state,
             total_cents, tax_cents, cost_cents, discount_cents, line_count, source_payload_hash, sync_run_id, staged_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), context.organizationId, LIGHTSPEED_R_PROVIDER,
          sale.externalSaleId, sale.externalVersion, sale.outletRef, sale.soldAt, sale.state,
          sale.totalCents, sale.taxCents, sale.costCents, sale.discountCents, sale.lineCount,
          sale.sourcePayloadHash, runId, Date.now(),
        ).run();
        stagedSales += Number(result.meta.changes ?? 0);
      }

      const ignoredMappings = await getDb().select({ externalLocationRef: integrationLocationMappings.externalLocationRef })
        .from(integrationLocationMappings).where(and(
          eq(integrationLocationMappings.organizationId, context.organizationId),
          eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
          eq(integrationLocationMappings.status, "ignored"),
        ));
      const ignored = new Set(ignoredMappings.map((row) => row.externalLocationRef));
      const latest = await database.prepare(`
        SELECT external_sale_id AS externalSaleId, outlet_ref AS outletRef, sold_at AS soldAt, state,
               total_cents AS totalCents, tax_cents AS taxCents, cost_cents AS costCents,
               discount_cents AS discountCents, line_count AS lineCount
        FROM (
          SELECT *, row_number() OVER (
            PARTITION BY external_sale_id ORDER BY staged_at DESC, id DESC
          ) AS version_rank
          FROM integration_staged_sales
          WHERE organization_id = ? AND provider = ?
        )
        WHERE version_rank = 1
      `).bind(context.organizationId, LIGHTSPEED_R_PROVIDER).all<StagedSaleRow>();
      const dailyMetrics = buildLightspeedRDailyMetrics(
        (latest.results ?? []).filter((sale) => !sale.outletRef || !ignored.has(sale.outletRef)),
      );

      const now = Date.now();
      await database.prepare(`
        INSERT INTO data_imports
          (id, organization_id, import_type, status, file_name, row_count, idempotency_key, imported_by_user_id, created_at)
        VALUES (?, ?, 'manual_entry', 'processing', ?, 0, ?, ?, ?)
      `).bind(importId, context.organizationId, IMPORT_LABEL, runId, context.userId, now).run();

      for (const row of dailyMetrics) {
        await database.prepare(`
          INSERT INTO daily_business_metrics (
            organization_id, business_date, location_ref, gross_sales_cents, net_sales_cents,
            cost_of_goods_cents, transaction_count, units_sold, refunds_cents, discounts_cents,
            labour_cost_cents, inventory_value_cents, cash_balance_cents, accounts_payable_cents,
            source_import_id, created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, ?, ?)
          ON CONFLICT(organization_id, business_date, location_ref) DO UPDATE SET
            gross_sales_cents = excluded.gross_sales_cents,
            net_sales_cents = excluded.net_sales_cents,
            cost_of_goods_cents = excluded.cost_of_goods_cents,
            transaction_count = excluded.transaction_count,
            units_sold = excluded.units_sold,
            refunds_cents = excluded.refunds_cents,
            discounts_cents = excluded.discounts_cents,
            source_import_id = excluded.source_import_id,
            updated_at = excluded.updated_at
        `).bind(
          context.organizationId, row.businessDate, row.locationRef, row.grossSalesCents,
          row.netSalesCents, row.costOfGoodsCents, row.transactionCount, row.unitsSold,
          row.refundsCents, row.discountsCents, importId, context.userId, now, now,
        ).run();
      }
      await database.prepare(`
        DELETE FROM daily_business_metrics
        WHERE organization_id = ?
          AND location_ref LIKE 'lightspeed-r:%'
          AND source_import_id <> ?
      `).bind(context.organizationId, importId).run();

      let importedInventory = 0;
      for (const externalLocationRef of ignored) {
        await database.prepare(`
          DELETE FROM inventory_balances
          WHERE organization_id = ? AND location_ref = ?
        `).bind(context.organizationId, `${LIGHTSPEED_R_PROVIDER}:${externalLocationRef}`).run();
      }
      for (const balance of inventoryBalances) {
        if (ignored.has(balance.outletRef)) continue;
        const result = await database.prepare(`
          INSERT INTO inventory_balances
            (id, organization_id, location_ref, sku, name, on_hand_quantity, reorder_point, version, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(organization_id, location_ref, sku) DO UPDATE SET
            name = excluded.name,
            on_hand_quantity = excluded.on_hand_quantity,
            reorder_point = excluded.reorder_point,
            version = inventory_balances.version + 1,
            updated_at = excluded.updated_at
        `).bind(
          crypto.randomUUID(), context.organizationId, `${LIGHTSPEED_R_PROVIDER}:${balance.outletRef}`,
          balance.sku, balance.name, balance.onHandQuantity, balance.reorderPoint, now,
        ).run();
        importedInventory += Number(result.meta.changes ?? 0);
      }
      await database.prepare(`
        UPDATE data_imports SET status = 'completed', row_count = ?
        WHERE id = ? AND organization_id = ?
      `).bind(dailyMetrics.length + importedInventory, importId, context.organizationId).run();

      const completedAt = new Date();
      const salesComplete = previous.salesComplete || salesPage.cursor === null;
      const itemsComplete = previous.itemsComplete || itemsPage.cursor === null;
      const computedCheckpoint = nextCheckpoint(
        previous,
        completedAt,
        salesPage.cursor,
        itemsPage.cursor,
        salesComplete,
        itemsComplete,
      );
      const safeCheckpoint = warnings > 0 ? connection.lastSyncCursor : computedCheckpoint;
      const recordsRead = recentSalesPage.data.length + salesPage.data.length + itemsPage.data.length;
      const recordsImported = dailyMetrics.length + importedInventory;
      const duplicatesSkipped = normalizedSales.length - stagedSales;
      await getDb().update(integrationSyncRuns).set({
        status: "completed",
        cursorAfter: safeCheckpoint,
        recordsRead,
        recordsStaged: stagedSales + importedInventory,
        duplicatesSkipped,
        warningCount: warnings,
        completedAt,
      }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({
        lastSuccessfulSyncAt: completedAt,
        lastSyncCursor: safeCheckpoint,
        dataPromotionStatus: warnings === 0 ? "approved" : "staging",
        lastErrorCode: null,
        updatedAt: completedAt,
      }).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      ));
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.data_imported",
        resourceType: "integration_sync_run",
        resourceId: runId,
        details: {
          provider: LIGHTSPEED_R_PROVIDER,
          recordsRead,
          stagedSales,
          dailyMetrics: dailyMetrics.length,
          inventoryBalances: importedInventory,
          duplicatesSkipped,
          warningCount: warnings,
          dataPromotionEnabled: warnings === 0,
        },
      });

      return jsonResponse({
        provider: LIGHTSPEED_R_PROVIDER,
        run: {
          id: runId,
          status: "completed",
          recordsRead,
          recordsStaged: stagedSales + importedInventory,
          duplicatesSkipped,
          warningCount: warnings,
          pages: recentSalesPage.pages + salesPage.pages + itemsPage.pages,
          cursorPreserved: safeCheckpoint,
        },
        reconciliation: {
          sourceRecords: recordsRead,
          stagedRecords: stagedSales,
          duplicateRecords: duplicatesSkipped,
          completedSales: normalizedSales.filter((sale) => sale.state === "completed").length,
          openSales: normalizedSales.filter((sale) => sale.state === "open").length,
          voidedSales: normalizedSales.filter((sale) => sale.state === "voided").length,
          dailyMetrics: dailyMetrics.length,
          inventoryBalances: importedInventory,
        },
        imported: { dailyMetrics: dailyMetrics.length, inventoryBalances: importedInventory },
        stagingOnly: false,
        dataPromotionEnabled: warnings === 0,
        readyForReview: warnings === 0,
        nextStep: warnings > 0
          ? `Imported ${recordsImported} verified records. ${warnings} source record${warnings === 1 ? " needs" : "s need"} attention before the sync cursor can advance.`
          : salesComplete && itemsComplete
            ? `R-Series is current. Imported ${dailyMetrics.length} daily sales summaries and ${importedInventory} inventory balances into Vanteloq.`
            : `Imported ${recordsImported} records. Run sync again to continue the remaining R-Series backfill.` ,
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "LIGHTSPEED_R_SYNC_FAILED";
      await getD1().prepare(`UPDATE data_imports SET status = 'failed' WHERE id = ? AND organization_id = ?`)
        .bind(importId, context.organizationId).run().catch(() => undefined);
      await getDb().update(integrationSyncRuns).set({
        status: "failed",
        errorCode: code,
        completedAt: new Date(),
      }).where(eq(integrationSyncRuns.id, runId));
      await getDb().update(integrationConnections).set({
        lastErrorCode: code,
        updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      ));
      throw error;
    }
  });
}
