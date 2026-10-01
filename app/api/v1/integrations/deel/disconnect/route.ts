import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  integrationConnections, integrationConsents, integrationLocationMappings,
  integrationOAuthStates, integrationSecrets, retailMeasurements,
} from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requirePrivacyAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { DEEL_PROVIDER } from "../../../../../../server/integrations/deel";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("deel:disconnect", context.userId, 10, 3_600);
    const input = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(
      context.organizationId, DEEL_PROVIDER, typeof input.connectionId === "string" ? input.connectionId : null,
    );
    const now = new Date();
    await getDb().delete(integrationSecrets).where(and(
      eq(integrationSecrets.organizationId, context.organizationId), eq(integrationSecrets.provider, DEEL_PROVIDER), eq(integrationSecrets.connectionId, connection.id),
    ));
    await getDb().delete(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.organizationId, context.organizationId), eq(integrationOAuthStates.provider, DEEL_PROVIDER), eq(integrationOAuthStates.connectionId, connection.id),
    ));
    const deletedMeasurements = await getDb().delete(retailMeasurements).where(and(
      eq(retailMeasurements.organizationId, context.organizationId), eq(retailMeasurements.provider, DEEL_PROVIDER), eq(retailMeasurements.connectionId, connection.id),
    )).returning({ id: retailMeasurements.id });
    await getDb().delete(integrationLocationMappings).where(and(
      eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, DEEL_PROVIDER), eq(integrationLocationMappings.connectionId, connection.id),
    ));
    await getDb().update(integrationConsents).set({ status: "withdrawn", withdrawnAt: now, updatedAt: now }).where(and(
      eq(integrationConsents.organizationId, context.organizationId), eq(integrationConsents.provider, DEEL_PROVIDER), eq(integrationConsents.status, "accepted"),
    ));
    await getDb().update(integrationConnections).set({
      status: "revoked", externalAccountRef: null, externalAccountName: null, domainPrefix: null,
      scopesJson: "[]", dataPromotionStatus: "blocked", connectedAt: null,
      lastSuccessfulSyncAt: null, lastSyncCursor: null, lastErrorCode: null,
      privacyDataDeletedAt: now, updatedAt: now,
    }).where(and(
      eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.provider, DEEL_PROVIDER),
    ));
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.disconnected", resourceType: "integration_connection", resourceId: connection.id,
      details: { provider: DEEL_PROVIDER, localCredentialsDeleted: true, stagedAggregatesDeleted: deletedMeasurements.length,
        providerRevocationSupported: false, employeeRecordsStored: false },
    });
    return jsonResponse({
      disconnected: true, connectionId: connection.id, localCredentialsDeleted: true,
      stagedAggregatesDeleted: deletedMeasurements.length, providerRevocationSupported: false,
      message: "Deel was removed from Vanteloq. Remove Vanteloq in Deel as well because Deel does not document an OAuth revocation endpoint.",
    });
  });
}
