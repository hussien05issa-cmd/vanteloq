import { releaseIntegrationSelectionIfUnused } from "../../../../../../server/integrations/free-selection";
import { recordAudit } from "../../../../../../server/audit";
import { requirePrivacyAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { DEEL_PROVIDER, removeDeelLocalGrant } from "../../../../../../server/integrations/deel";
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
    const { stagedAggregatesDeleted } = await removeDeelLocalGrant(context.organizationId, connection.id, connection.sourceNamespace);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.disconnected", resourceType: "integration_connection", resourceId: connection.id,
      details: { provider: DEEL_PROVIDER, localCredentialsDeleted: true, stagedAggregatesDeleted: stagedAggregatesDeleted,
        providerRevocationSupported: false, employeeRecordsStored: false },
    });
    await releaseIntegrationSelectionIfUnused(context.organizationId, "deel");
      return jsonResponse({
      disconnected: true, connectionId: connection.id, localCredentialsDeleted: true,
      stagedAggregatesDeleted: stagedAggregatesDeleted, providerRevocationSupported: false,
      message: "Deel was removed from Vanteloq. Remove Vanteloq in Deel as well because Deel does not document an OAuth revocation endpoint.",
    });
  });
}
