import { releaseIntegrationSelectionIfUnused } from "../../../../../../server/integrations/free-selection";
import { recordAudit } from "../../../../../../server/audit";
import { requirePrivacyAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { SLACK_PROVIDER } from "../../../../../../server/integrations/slack";
import { withdrawSlackGrant } from "../../../../../../server/integrations/slack-grant";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("slack:disconnect", context.userId, 10, 3_600);
    const input = await readJsonObject(request);
    const connection = await requireOwnedIntegrationConnection(context.organizationId, SLACK_PROVIDER,
      typeof input.connectionId === "string" ? input.connectionId : null);
    const result = await withdrawSlackGrant(context.organizationId, connection.id, connection.sourceNamespace, fetch, input.confirmedProviderRemoval === true);
    await recordAudit({request,requestId,organizationId:context.organizationId,actorUserId:context.userId,
      action:"integration.disconnected",resourceType:"integration_connection",resourceId:connection.id,
      details:{provider:SLACK_PROVIDER,localAccessRemoved:true,localCredentialsDeleted:result.localCredentialsDeleted,
        providerAuthorizationRevoked:result.providerAuthorizationRevoked,cleanupPending:result.cleanupPending}});
    await releaseIntegrationSelectionIfUnused(context.organizationId,"slack");
    return jsonResponse({...result,connectionId:connection.id,
      message:result.providerRemovalRequired
        ? "Slack was disconnected locally. Provider removal is unconfirmed. Remove Vanteloq in Slack, or retry Disconnect. Encrypted cleanup material, when available, cannot send messages."
        : result.manualRemovalAcknowledged ? "Local cleanup is complete. Your confirmation of removal in Slack was recorded."
        : "Slack was disconnected and the provider installation was removed."});
  });
}
