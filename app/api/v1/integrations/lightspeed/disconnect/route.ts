import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  integrationConnections,
  integrationOAuthStates,
  integrationSecrets,
} from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import {
  enforceRateLimit,
  handleApi,
  jsonResponse,
  requireSameOrigin,
} from "../../../../../../server/api";
import { LIGHTSPEED_PROVIDER } from "../../../../../../server/integrations/lightspeed";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("lightspeed:disconnect", context.userId, 10, 3_600);
    await getDb().delete(integrationSecrets).where(and(
      eq(integrationSecrets.organizationId, context.organizationId),
      eq(integrationSecrets.provider, LIGHTSPEED_PROVIDER),
    ));
    await getDb().delete(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.organizationId, context.organizationId),
      eq(integrationOAuthStates.provider, LIGHTSPEED_PROVIDER),
    ));
    await getDb().update(integrationConnections).set({
      status: "revoked",
      externalAccountRef: null,
      domainPrefix: null,
      scopesJson: "[]",
      dataPromotionStatus: "blocked",
      connectedAt: null,
      lastErrorCode: null,
      updatedAt: new Date(),
    }).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, LIGHTSPEED_PROVIDER),
    ));
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.disconnected",
      resourceType: "integration",
      resourceId: LIGHTSPEED_PROVIDER,
      details: {
        provider: LIGHTSPEED_PROVIDER,
        localTokensDeleted: true,
        stagedHistoryRetained: true,
        dataPromotionEnabled: false,
      },
    });
    return jsonResponse({
      disconnected: true,
      localCredentialsDeleted: true,
      retainedForAudit: ["outlet mappings", "sync runs", "staged records", "audit events"],
      providerRevocation:
        "If the app remains listed in Lightspeed, remove it from the retailer's connected-app settings as well.",
    });
  });
}
