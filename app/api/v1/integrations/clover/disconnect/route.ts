import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates, integrationSecrets } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { CLOVER_PROVIDER } from "../../../../../../server/integrations/clover";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("clover:disconnect", context.userId, 10, 3600);
    const input = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(
      context.organizationId, CLOVER_PROVIDER,
      typeof input.connectionId === "string" ? input.connectionId : null,
    );
    await getDb().delete(integrationSecrets).where(and(
      eq(integrationSecrets.organizationId, context.organizationId),
      eq(integrationSecrets.provider, CLOVER_PROVIDER),
      eq(integrationSecrets.connectionId, connection.id),
    ));
    await getDb().delete(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.organizationId, context.organizationId),
      eq(integrationOAuthStates.provider, CLOVER_PROVIDER),
      eq(integrationOAuthStates.connectionId, connection.id),
    ));
    await getDb().update(integrationConnections).set({
      status: "revoked", externalAccountRef: null, scopesJson: "[]",
      dataPromotionStatus: "blocked", promotionAuthorizedAt: null,
      connectedAt: null, lastErrorCode: null, updatedAt: new Date(),
    }).where(and(
      eq(integrationConnections.id, connection.id),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, CLOVER_PROVIDER),
    ));
    await recordAudit({
      request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.disconnected", resourceType: "integration", resourceId: connection.id,
      details: { provider: CLOVER_PROVIDER, connectionId: connection.id, localTokensDeleted: true, stagedHistoryRetained: true },
    });
    return jsonResponse({ disconnected: true, connectionId: connection.id, localCredentialsDeleted: true });
  });
}
