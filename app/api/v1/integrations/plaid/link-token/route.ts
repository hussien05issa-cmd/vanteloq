import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { createPlaidLinkToken, plaidReadiness } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requirePermission(context, "finance.connections");
    await enforceRateLimit("plaid:link-token", context.userId, 10, 3_600);
    const token = await createPlaidLinkToken(context.userId, context.organizationId);
    return jsonResponse({ linkToken: token.link_token, expiration: token.expiration, environment: plaidReadiness().mode });
  });
}
