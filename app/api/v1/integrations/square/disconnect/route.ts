import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates, integrationSecrets } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requirePrivacyAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { revokeSquareToken, SQUARE_PROVIDER } from "../../../../../../server/integrations/square";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("square:disconnect", context.userId, 10, 3600);
    const input = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(context.organizationId, SQUARE_PROVIDER, typeof input.connectionId === "string" ? input.connectionId : null);
    const providerRevoked = await revokeSquareToken(context.organizationId, connection.id);
    await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, context.organizationId), eq(integrationSecrets.provider, SQUARE_PROVIDER), eq(integrationSecrets.connectionId, connection.id)));
    await getDb().delete(integrationOAuthStates).where(and(eq(integrationOAuthStates.organizationId, context.organizationId), eq(integrationOAuthStates.provider, SQUARE_PROVIDER), eq(integrationOAuthStates.connectionId, connection.id)));
    await getDb().update(integrationConnections).set({ status: "revoked", externalAccountRef: null, scopesJson: "[]", dataPromotionStatus: "blocked", promotionAuthorizedAt: null, connectedAt: null, lastErrorCode: null, updatedAt: new Date() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, SQUARE_PROVIDER)));
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.disconnected", resourceType: "integration", resourceId: connection.id, details: { provider: SQUARE_PROVIDER, providerRevoked, localTokensDeleted: true } });
    return jsonResponse({ disconnected: true, connectionId: connection.id, providerRevoked, localCredentialsDeleted: true });
  });
}
