import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { recordAudit } from "../../../../../../server/audit";
import { disconnectPlaid } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";
import { withdrawPlaidConsents } from "../../../../../../server/privacy";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requirePermission(context, "finance.connections");
    await enforceRateLimit("plaid:disconnect", context.userId, 6, 3_600);
    await disconnectPlaid(context.organizationId);
    await withdrawPlaidConsents(context.organizationId, context.userId);
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.disconnected",
      resourceType: "integration",
      resourceId: "plaid",
      details: { provider: "plaid", providerRevoked: true, encryptedTokensDeleted: true, consentWithdrawn: true, reviewedHistoryRetained: true },
    });
    return jsonResponse({ disconnected: true, retained: "Reviewed accounting records and audit history remain. Plaid access tokens were deleted." });
  });
}
