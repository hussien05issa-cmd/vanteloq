import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationConsents, integrationOAuthStates, integrationSecrets } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requirePrivacyAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { revokeQuickBooksAuthorization, storedQuickBooksRefreshToken, QUICKBOOKS_PROVIDER } from "../../../../../../server/integrations/quickbooks";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("quickbooks:disconnect", context.userId, 10, 3_600);
    const body = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(
      context.organizationId,
      QUICKBOOKS_PROVIDER,
      typeof body.connectionId === "string" ? body.connectionId : null,
    );
    const refreshToken = await storedQuickBooksRefreshToken(context.organizationId, connection.id);
    if (refreshToken && !(await revokeQuickBooksAuthorization(refreshToken))) {
      throw new ApiError(502, "QUICKBOOKS_DEAUTHORIZATION_FAILED", "QuickBooks did not confirm revocation. The local connection was kept so access is not misrepresented.");
    }
    const now = new Date();
    await getDb().delete(integrationSecrets).where(and(
      eq(integrationSecrets.organizationId, context.organizationId),
      eq(integrationSecrets.provider, QUICKBOOKS_PROVIDER),
      eq(integrationSecrets.connectionId, connection.id),
    ));
    await getDb().delete(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.organizationId, context.organizationId),
      eq(integrationOAuthStates.provider, QUICKBOOKS_PROVIDER),
      eq(integrationOAuthStates.connectionId, connection.id),
    ));
    await getDb().update(integrationConsents).set({ status: "withdrawn", withdrawnAt: now, updatedAt: now }).where(and(
      eq(integrationConsents.organizationId, context.organizationId),
      eq(integrationConsents.provider, QUICKBOOKS_PROVIDER),
      eq(integrationConsents.status, "accepted"),
    ));
    await getDb().update(integrationConnections).set({
      status: "revoked",
      externalAccountRef: null,
      domainPrefix: null,
      scopesJson: "[]",
      dataPromotionStatus: "blocked",
      promotionAuthorizedAt: null,
      connectedAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncCursor: null,
      lastErrorCode: null,
      syncLeaseOwner: null,
      syncLeaseExpiresAt: null,
      updatedAt: now,
    }).where(and(
      eq(integrationConnections.id, connection.id),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, QUICKBOOKS_PROVIDER),
    ));
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.disconnected", resourceType: "integration_connection", resourceId: connection.id,
      details: { provider: QUICKBOOKS_PROVIDER, providerAuthorizationRevoked: Boolean(refreshToken), localCredentialsDeleted: true, dataPromotionEnabled: false },
    });
    return jsonResponse({ disconnected: true, connectionId: connection.id, providerAuthorizationRevoked: Boolean(refreshToken), localCredentialsDeleted: true });
  });
}
