import { releaseIntegrationSelectionIfUnused } from "../../../../../../server/integrations/free-selection";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates, integrationSecrets } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requirePrivacyAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { decryptSlackCredentials, revokeSlackInstallation, SLACK_PROVIDER } from "../../../../../../server/integrations/slack";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("slack:disconnect", context.userId, 10, 3_600);
    const input = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(
      context.organizationId,
      SLACK_PROVIDER,
      typeof input.connectionId === "string" ? input.connectionId : null,
    );
    const [secret] = await getDb().select({
      accessTokenCiphertext: integrationSecrets.accessTokenCiphertext,
    }).from(integrationSecrets).where(and(
      eq(integrationSecrets.organizationId, context.organizationId),
      eq(integrationSecrets.provider, SLACK_PROVIDER),
      eq(integrationSecrets.connectionId, connection.id),
    )).limit(1);
    if (connection.status === "connected" && !secret) {
      throw new ApiError(409, "SLACK_CREDENTIALS_MISSING", "Slack credentials are unavailable. Restore the encrypted credential record before disconnecting the provider installation.");
    }
    if (secret) {
      const credentials = await decryptSlackCredentials(secret.accessTokenCiphertext);
      if (!(await revokeSlackInstallation(credentials))) {
        throw new ApiError(502, "SLACK_DEAUTHORIZATION_FAILED", "Slack did not confirm app removal. The local credential was retained so the removal can be retried safely.");
      }
    }

    await getDb().delete(integrationSecrets).where(and(
      eq(integrationSecrets.organizationId, context.organizationId),
      eq(integrationSecrets.provider, SLACK_PROVIDER),
      eq(integrationSecrets.connectionId, connection.id),
    ));
    await getDb().delete(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.organizationId, context.organizationId),
      eq(integrationOAuthStates.provider, SLACK_PROVIDER),
      eq(integrationOAuthStates.connectionId, connection.id),
    ));
    await getDb().update(integrationConnections).set({
      status: "revoked",
      externalAccountRef: null,
      externalAccountName: null,
      domainPrefix: null,
      scopesJson: "[]",
      dataPromotionStatus: "blocked",
      connectedAt: null,
      lastErrorCode: null,
      updatedAt: new Date(),
    }).where(and(
      eq(integrationConnections.id, connection.id),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, SLACK_PROVIDER),
    ));
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.disconnected",
      resourceType: "integration_connection",
      resourceId: connection.id,
      details: { provider: SLACK_PROVIDER, providerAuthorizationRevoked: Boolean(secret), localCredentialsDeleted: true },
    });
    await releaseIntegrationSelectionIfUnused(context.organizationId, "slack");
      return jsonResponse({
      disconnected: true,
      connectionId: connection.id,
      providerAuthorizationRevoked: Boolean(secret),
      localCredentialsDeleted: true,
    });
  });
}
