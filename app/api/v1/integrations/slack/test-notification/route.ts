import { recordAudit } from "../../../../../../server/audit";
import { requireIntegrationAccess } from "../../../../../../server/integrations/free-selection";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { sendSlackTestNotification, SLACK_PROVIDER } from "../../../../../../server/integrations/slack";
import { withSlackGrant } from "../../../../../../server/integrations/slack-grant";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireIntegrationAccess(request, ["owner", "admin"], "slack", false);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("slack:test-notification", context.userId, 5, 3_600);
    const input = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(
      context.organizationId,
      SLACK_PROVIDER,
      typeof input.connectionId === "string" ? input.connectionId : null,
      { connected: true },
    );
    const channelId = await withSlackGrant(context.organizationId, connection.id, connection.sourceNamespace, async credentials => {
      await sendSlackTestNotification(credentials);
      return credentials.channelId;
    });
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.test_notification_sent",
      resourceType: "integration_connection",
      resourceId: connection.id,
      details: { provider: SLACK_PROVIDER, connectionId: connection.id, channelId: channelId, containedBusinessData: false },
    });
    return jsonResponse({ sent: true, connectionId: connection.id, channelId: channelId, containedBusinessData: false });
  });
}
