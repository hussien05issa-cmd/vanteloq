import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { revokeStripeConnection, STRIPE_PROVIDER } from "../../../../../../server/integrations/stripe";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("stripe:disconnect", context.userId, 10, 3_600);
    const [connection] = await getDb().select({ accountId: integrationConnections.externalAccountRef }).from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, STRIPE_PROVIDER),
    )).limit(1);
    if (connection?.accountId && !(await revokeStripeConnection(connection.accountId))) {
      throw new ApiError(502, "STRIPE_DEAUTHORIZATION_FAILED", "Stripe did not confirm revocation. The local connection was kept so access is not misrepresented.");
    }
    await getDb().delete(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.organizationId, context.organizationId),
      eq(integrationOAuthStates.provider, STRIPE_PROVIDER),
    ));
    await getDb().update(integrationConnections).set({
      status: "revoked",
      externalAccountRef: null,
      scopesJson: "[]",
      dataPromotionStatus: "blocked",
      connectedAt: null,
      lastErrorCode: null,
      updatedAt: new Date(),
    }).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, STRIPE_PROVIDER),
    ));
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.disconnected",
      resourceType: "integration",
      resourceId: STRIPE_PROVIDER,
      details: { provider: STRIPE_PROVIDER, providerRevoked: true, stagedHistoryRetained: true, dataPromotionEnabled: false },
    });
    return jsonResponse({
      disconnected: true,
      providerAuthorizationRevoked: true,
      retainedForAudit: ["sync runs", "staged financial records", "webhook receipts", "audit events"],
    });
  });
}
