import { requirePrivacyAccess } from "../../../../../../server/authorization";
import { recordAudit } from "../../../../../../server/audit";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { disconnectPlaid, PLAID_PROVIDER, plaidReadiness } from "../../../../../../server/integrations/plaid";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";
import { requirePermission } from "../../../../../../server/permissions";
import { withdrawPlaidConsents } from "../../../../../../server/privacy";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, ["owner", "admin", "manager"]);
    await requirePermission(context, "finance.connections");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("plaid:disconnect", context.userId, 6, 3_600);
    try {
      await disconnectPlaid(context.organizationId);
      await withdrawPlaidConsents(context.organizationId, context.userId);
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.disconnected",
        resourceType: "integration",
        resourceId: PLAID_PROVIDER,
        details: {
          provider: PLAID_PROVIDER,
          mode: plaidReadiness().mode,
          providerAuthorizationRevoked: true,
          localCredentialsDeleted: true,
          consentWithdrawn: true,
          historyRetained: true,
          dataPromotionEnabled: false,
        },
      });
      return jsonResponse({ disconnected: true, retained: "Reviewed accounting records and audit history remain. Plaid access tokens were deleted." });
    } catch (error) {
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.disconnected",
        resourceType: "integration",
        resourceId: PLAID_PROVIDER,
        outcome: "failure",
        details: {
          provider: PLAID_PROVIDER,
          mode: plaidReadiness().mode,
          errorCode: error instanceof ApiError ? error.code : "PLAID_DISCONNECT_FAILED",
        },
      });
      throw error;
    }
  });
}
