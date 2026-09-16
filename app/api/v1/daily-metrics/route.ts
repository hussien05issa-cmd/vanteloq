import { desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { dataImports } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, hashIdentifier, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { dailyMetricImportInput, idempotencyKey } from "../../../../server/validation";
import { requirePermission } from "../../../../server/permissions";
import { authorizedLocationDataScope, requireOrganizationWideLocationAccess } from "../../../../server/location-access";

import { saveDailyMetricImport } from "../../../../server/daily-metric-import";

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
    const result = await saveDailyMetricImport(getD1(), {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      requestId,
      sourceHash: await hashIdentifier(clientSource(request)),
    }, key, input);
    if (result.kind === "review") {
      return jsonResponse({ error: { code: result.code, message: result.message }, review: result.review }, { status: 409 });
    }
    return jsonResponse({ import: result.import, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  });
}
