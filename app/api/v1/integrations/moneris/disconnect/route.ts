import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationSecrets } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { MONERIS_PROVIDER } from "../../../../../../server/integrations/moneris";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("moneris:disconnect", context.userId, 10, 3_600);
    const body = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(context.organizationId, MONERIS_PROVIDER, typeof body.connectionId === "string" ? body.connectionId : null);
    await getDb().delete(integrationSecrets).where(and(eq(integrationSecrets.organizationId, context.organizationId), eq(integrationSecrets.provider, MONERIS_PROVIDER), eq(integrationSecrets.connectionId, connection.id)));
    await getDb().update(integrationConnections).set({ status: "revoked", externalAccountRef: null, scopesJson: "[]", dataPromotionStatus: "blocked", promotionAuthorizedAt: null, connectedAt: null, lastErrorCode: null, syncLeaseOwner: null, syncLeaseExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, MONERIS_PROVIDER)));
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.disconnected", resourceType: "integration_connection", resourceId: connection.id, details: { provider: MONERIS_PROVIDER, localCredentialsDeleted: true, importedPaymentAuditRetained: true } });
    return jsonResponse({ disconnected: true, connectionId: connection.id, localCredentialsDeleted: true });
  });
}
