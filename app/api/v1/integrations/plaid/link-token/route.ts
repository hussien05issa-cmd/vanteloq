import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { recordAudit } from "../../../../../../server/audit";
import { createPlaidLinkToken, plaidReadiness } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requirePermission(context, "finance.connections");
    await enforceRateLimit("plaid:link-token", context.userId, 10, 3_600);
    const input = await readJsonObject(request, 2_000);
    const mode = input.mode === "update" ? "update" : input.mode === "connect" ? "connect" : null;
    if (!mode) throw new ApiError(400, "PLAID_LINK_MODE_INVALID", "Choose a new connection or repair an existing one.");
    const token = await createPlaidLinkToken(context.userId, context.organizationId, mode);
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.authorization_started",
      resourceType: "integration",
      resourceId: "plaid",
      details: { provider: "plaid", mode, expiresAt: token.expiration },
    });
    return jsonResponse({ linkToken: token.link_token, expiration: token.expiration, environment: plaidReadiness().mode, mode });
  });
}
