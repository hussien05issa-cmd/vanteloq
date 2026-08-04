import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { integrationConnections } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse } from "../../../../server/api";
import { requirePermission } from "../../../../server/permissions";
import { integrationCatalog, preSyncControls } from "../../../integration-catalog";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"]);
    await requirePermission(context, "integrations.view");
    const rows = await getDb()
      .select({
        provider: integrationConnections.provider,
        status: integrationConnections.status,
        lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
        lastErrorCode: integrationConnections.lastErrorCode,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, context.organizationId));
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    return jsonResponse({
      preSyncControls,
      syncEnabled: false,
      integrations: integrationCatalog.map((provider) => ({
        ...provider,
        status: byProvider.get(provider.id)?.status ?? "not_connected",
        lastSuccessfulSyncAt: byProvider.get(provider.id)?.lastSuccessfulSyncAt ?? null,
        lastErrorCode: byProvider.get(provider.id)?.lastErrorCode ?? null,
      })),
    });
  });
}
