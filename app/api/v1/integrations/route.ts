import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { integrationConnections } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse } from "../../../../server/api";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { integrationCatalog, preSyncControls } from "../../../integration-catalog";
import { lightspeedReadiness } from "../../../../server/integrations/lightspeed";
import { lightspeedRReadiness } from "../../../../server/integrations/lightspeed-r";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"]);
    await requirePermission(context, "integrations.view");
    const permissions = await effectivePermissions(context);
    const rows = await getDb()
      .select({
        provider: integrationConnections.provider,
        status: integrationConnections.status,
        lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
        lastErrorCode: integrationConnections.lastErrorCode,
        connectedAt: integrationConnections.connectedAt,
        dataPromotionStatus: integrationConnections.dataPromotionStatus,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, context.organizationId));
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    return jsonResponse({
      preSyncControls,
      syncEnabled: false,
      dataPromotionEnabled: false,
      canManage: permissions.includes("integrations.manage"),
      integrations: integrationCatalog.map((provider) => ({
        ...provider,
        status: byProvider.get(provider.id)?.status ?? "not_connected",
        lastSuccessfulSyncAt: byProvider.get(provider.id)?.lastSuccessfulSyncAt ?? null,
        lastErrorCode: byProvider.get(provider.id)?.lastErrorCode ?? null,
        connectedAt: byProvider.get(provider.id)?.connectedAt ?? null,
        dataPromotionStatus: byProvider.get(provider.id)?.dataPromotionStatus ?? "blocked",
        providerReadiness: provider.id === "lightspeed"
          ? lightspeedReadiness()
          : provider.id === "lightspeed-r"
            ? lightspeedRReadiness()
            : null,
      })),
    });
  });
}
