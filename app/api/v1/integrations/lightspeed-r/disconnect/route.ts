import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates, integrationSecrets } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { LIGHTSPEED_R_PROVIDER } from "../../../../../../server/integrations/lightspeed-r";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("lightspeed-r:disconnect", context.userId, 10, 3600);
    await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, context.organizationId), eq(integrationSecrets.provider, LIGHTSPEED_R_PROVIDER)));
    await getDb().delete(integrationOAuthStates).where(and(eq(integrationOAuthStates.organizationId, context.organizationId), eq(integrationOAuthStates.provider, LIGHTSPEED_R_PROVIDER)));
    await getDb().update(integrationConnections).set({
      status: "revoked", externalAccountRef: null, domainPrefix: null, scopesJson: "[]",
      dataPromotionStatus: "blocked", connectedAt: null, lastErrorCode: null, updatedAt: new Date(),
    }).where(and(eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER)));
    await recordAudit({
      request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.disconnected", resourceType: "integration", resourceId: LIGHTSPEED_R_PROVIDER,
      details: { provider: LIGHTSPEED_R_PROVIDER, localTokensDeleted: true, stagedHistoryRetained: true, dataPromotionEnabled: false },
    });
    return jsonResponse({ disconnected: true, localCredentialsDeleted: true, retainedForAudit: ["shop mappings", "sync runs", "staged records", "audit events"] });
  });
}
