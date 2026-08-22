import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { dataImports } from "../../../../db/schema";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, hashIdentifier, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { dailyMetricImportInput, idempotencyKey } from "../../../../server/validation";
import { requirePermission } from "../../../../server/permissions";
import { authorizedLocationDataScope, requireOrganizationWideLocationAccess } from "../../../../server/location-access";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;
const writers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "analytics.sales.basic");
    await requirePermission(context, "integrations.view");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("daily-metrics:read", context.userId, 60, 60);
    const imports = await getDb().select({
      id: dataImports.id,
      importType: dataImports.importType,
      status: dataImports.status,
      fileName: dataImports.fileName,
      rowCount: dataImports.rowCount,
      createdAt: dataImports.createdAt,
    }).from(dataImports).where(eq(dataImports.organizationId, context.organizationId)).orderBy(desc(dataImports.createdAt)).limit(20);
    return jsonResponse({ imports });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers, "analytics.sales.basic");
    await requirePermission(context, "data.import");
    await enforceRateLimit("daily-metrics:write", context.userId, 12, 3_600);
    const key = idempotencyKey(request);
    const input = dailyMetricImportInput(await readJsonObject(request, 512_000));
    const scope = await authorizedLocationDataScope(context, new URL(request.url).searchParams.get("location"));
    if (scope.locationRefs !== null) {
      const allowed = new Set(scope.locationRefs);
      if (input.rows.some((row) => !allowed.has(row.locationRef))) {
        throw new ApiError(403, "LOCATION_ACCESS_DENIED", "The import contains a location that is not available to your account.");
      }
    }
    const [existing] = await getDb().select().from(dataImports).where(and(
      eq(dataImports.organizationId, context.organizationId),
      eq(dataImports.idempotencyKey, key),
    )).limit(1);
    if (existing?.status === "completed") {
      if (existing.importedByUserId !== context.userId) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_CONFLICT",
          "This idempotency key is already associated with another import request.",
        );
      }
      return jsonResponse({
        import: {
          id: existing.id,
          status: existing.status,
          rowCount: existing.rowCount,
        },
        replayed: true,
      });
    }

    const importHash = (await hashIdentifier(`${context.organizationId}:${key}`)).slice(0, 40);
    const importId = `import-${importHash}`;
    const now = Date.now();
    const database = getD1();
    await database.prepare(`
      INSERT INTO data_imports (id, organization_id, import_type, status, file_name, row_count, idempotency_key, imported_by_user_id, created_at)
      VALUES (?, ?, ?, 'processing', ?, 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = 'processing', file_name = excluded.file_name
    `).bind(importId, context.organizationId, input.importType, input.fileName, key, context.userId, now).run();

    try {
      const statements = input.rows.map((row) => database.prepare(`
        INSERT INTO daily_business_metrics (
          organization_id, business_date, location_ref, gross_sales_cents, net_sales_cents,
          cost_of_goods_cents, transaction_count, units_sold, refunds_cents, discounts_cents,
          labour_cost_cents, inventory_value_cents, cash_balance_cents, accounts_payable_cents,
          source_provider, source_connection_id, source_import_id,
          created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
        ON CONFLICT(organization_id, business_date, location_ref) DO UPDATE SET
          gross_sales_cents = excluded.gross_sales_cents,
          net_sales_cents = excluded.net_sales_cents,
          cost_of_goods_cents = excluded.cost_of_goods_cents,
          transaction_count = excluded.transaction_count,
          units_sold = excluded.units_sold,
          refunds_cents = excluded.refunds_cents,
          discounts_cents = excluded.discounts_cents,
          labour_cost_cents = excluded.labour_cost_cents,
          inventory_value_cents = excluded.inventory_value_cents,
          cash_balance_cents = excluded.cash_balance_cents,
          accounts_payable_cents = excluded.accounts_payable_cents,
          source_provider = NULL,
          source_connection_id = NULL,
          source_import_id = excluded.source_import_id,
          updated_at = excluded.updated_at
      `).bind(
        context.organizationId, row.businessDate, row.locationRef, row.grossSalesCents, row.netSalesCents,
        row.costOfGoodsCents, row.transactionCount, row.unitsSold, row.refundsCents, row.discountsCents,
        row.labourCostCents, row.inventoryValueCents, row.cashBalanceCents, row.accountsPayableCents,
        importId, context.userId, now, now,
      ));
      await database.batch(statements);
      await database.prepare("UPDATE data_imports SET status = 'completed', row_count = ? WHERE id = ? AND organization_id = ?")
        .bind(input.rows.length, importId, context.organizationId).run();
    } catch (error) {
      await database.prepare("UPDATE data_imports SET status = 'failed' WHERE id = ? AND organization_id = ?")
        .bind(importId, context.organizationId).run();
      if (error instanceof Error && /constraint/i.test(error.message)) {
        throw new ApiError(400, "IMPORT_CONSTRAINT_FAILED", "The import contains inconsistent business data.");
      }
      throw error;
    }

    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "daily_metrics.imported",
      resourceType: "data_import",
      resourceId: importId,
      details: { importType: input.importType, rowCount: input.rows.length },
    });
    return jsonResponse({ import: { id: importId, status: "completed", rowCount: input.rows.length } }, { status: 201 });
  });
}
