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
  readJsonObject,
  requireSameOrigin,
} from "../../../../../../server/api";
import { LIGHTSPEED_PROVIDER } from "../../../../../../server/integrations/lightspeed";
import { requirePermission } from "../../../../../../server/permissions";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("lightspeed:disconnect", context.userId, 10, 3_600);
    const input = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(
      context.organizationId, LIGHTSPEED_PROVIDER,
      typeof input.connectionId === "string" ? input.connectionId : null,
    );
    await getDb().delete(integrationSecrets).where(and(
      eq(integrationSecrets.connectionId, connection.id),
      eq(integrationSecrets.organizationId, context.organizationId),
      eq(integrationSecrets.provider, LIGHTSPEED_PROVIDER),
    ));
    await getDb().delete(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.connectionId, connection.id),
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
      eq(integrationConnections.id, connection.id),
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
      resourceId: connection.id,
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
