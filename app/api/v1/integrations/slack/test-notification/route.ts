import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationSecrets } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { decryptSlackCredentials, sendSlackTestNotification, SLACK_PROVIDER } from "../../../../../../server/integrations/slack";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "communications.basic");
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("slack:test-notification", context.userId, 5, 3_600);
    const input = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(
      context.organizationId,
      SLACK_PROVIDER,
      typeof input.connectionId === "string" ? input.connectionId : null,
      { connected: true },
    );
    const [secret] = await getDb().select({
      accessTokenCiphertext: integrationSecrets.accessTokenCiphertext,
    }).from(integrationSecrets).where(and(
      eq(integrationSecrets.organizationId, context.organizationId),
      eq(integrationSecrets.provider, SLACK_PROVIDER),
      eq(integrationSecrets.connectionId, connection.id),
    )).limit(1);
    if (!secret) throw new ApiError(409, "SLACK_CREDENTIALS_MISSING", "Reconnect Slack before sending a test notification.");
    const credentials = await decryptSlackCredentials(secret.accessTokenCiphertext);
    if (credentials.teamId !== connection.externalAccountRef || credentials.channelId !== connection.domainPrefix) {
      throw new ApiError(409, "SLACK_DESTINATION_CHANGED", "Reconnect Slack before sending another notification.");
    }
    await sendSlackTestNotification(credentials);
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.test_notification_sent",
      resourceType: "integration_connection",
      resourceId: connection.id,
      details: { provider: SLACK_PROVIDER, connectionId: connection.id, channelId: credentials.channelId, containedBusinessData: false },
    });
    return jsonResponse({ sent: true, connectionId: connection.id, channelId: credentials.channelId, containedBusinessData: false });
  });
}
