import { desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { dataImports } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, hashIdentifier, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { dailyMetricImportInput, idempotencyKey } from "../../../../server/validation";
import { requirePermission } from "../../../../server/permissions";
import { authorizedLocationDataScope, requireOrganizationWideLocationAccess } from "../../../../server/location-access";

import { saveDailyMetricImport } from "../../../../server/daily-metric-import";
import { getTenantEntitlements } from "../../../../server/entitlements/engine";
import { reserveFreeUsage } from "../../../../server/entitlements/free";

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
    const access = await getTenantEntitlements(context);
    if (access.accessType === "free" && (new Set(input.rows.map(row => row.locationRef)).size > 1
      || input.rows.some(row => !["all", `${context.organizationId}:location:primary`, "Primary location"].includes(row.locationRef)))) {
      throw new ApiError(403, "FREE_PLAN_LOCATION_LIMIT", "Free supports your primary location only. Use 'all' or 'Primary location' for daily records.");
    }
    if (access.accessType === "free") input.rows.forEach(row => { row.locationRef = "all"; });
    // A retry of a completed import must still work when the monthly allowance is full.
    const existing = await getD1().prepare("SELECT id FROM data_imports WHERE organization_id=? AND idempotency_key=?")
      .bind(context.organizationId,key).first();
    const reservation = access.accessType === "free" && !existing
      ? await reserveFreeUsage(getD1(),context.organizationId,"import_rows",input.rows.length) : null;
    let result;
    try { result = await saveDailyMetricImport(getD1(), {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      requestId,
      sourceHash: await hashIdentifier(clientSource(request)),
    }, key, input);
    if (result.kind === "review" || result.replayed) await reservation?.release();
    } catch (error) { await reservation?.release(); throw error; }
    if (result.kind === "review") {
      return jsonResponse({ error: { code: result.code, message: result.message }, review: result.review }, { status: 409 });
    }
    return jsonResponse({ import: result.import, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  });
}
