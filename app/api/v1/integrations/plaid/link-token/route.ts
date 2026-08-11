import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { recordAudit } from "../../../../../../server/audit";
import { requireAddon } from "../../../../../../server/entitlements/engine";
import { createPlaidLinkToken, plaidReadiness } from "../../../../../../server/integrations/plaid";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";
import { requirePermission } from "../../../../../../server/permissions";
import { recordPlaidConsent } from "../../../../../../server/privacy";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requireAddon(context, "bookloq");
    await requirePermission(context, "finance.connections");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("plaid:link-token", context.userId, 10, 3_600);
    const input = await readJsonObject(request, 2_000);
    const mode = input.mode === "update" ? "update" : input.mode === "connect" ? "connect" : null;
    if (!mode) throw new ApiError(400, "PLAID_LINK_MODE_INVALID", "Choose a new connection or repair an existing one.");
    if (input.consentAcknowledged !== true) {
      throw new ApiError(400, "PLAID_CONSENT_REQUIRED", "Review and accept the financial-data notice before connecting.");
    }
    const consent = await recordPlaidConsent({
      organizationId: context.organizationId,
      actorUserId: context.userId,
      noticeVersion: typeof input.noticeVersion === "string" ? input.noticeVersion : "",
      privacyPolicyVersion: typeof input.privacyPolicyVersion === "string" ? input.privacyPolicyVersion : "",
    });
    const token = await createPlaidLinkToken(context.userId, context.organizationId, mode);
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.authorization_started",
      resourceType: "integration",
      resourceId: "plaid",
      details: { provider: "plaid", mode, expiresAt: token.expiration, consentRecordId: consent.id, consentAcceptedAt: consent.acceptedAt.toISOString() },
    });
    return jsonResponse({ linkToken: token.link_token, expiration: token.expiration, consentRecordId: consent.id, environment: plaidReadiness().mode, mode });
  });
}
