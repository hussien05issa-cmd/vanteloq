import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { createPlaidLinkToken, plaidReadiness } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";
import { requireAddon } from "../../../../../../server/entitlements/engine";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requireAddon(context, "bookloq");
    await requirePermission(context, "finance.connections");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("plaid:link-token", context.userId, 10, 3_600);
    const token = await createPlaidLinkToken(context.userId, context.organizationId);
    return jsonResponse({ linkToken: token.link_token, expiration: token.expiration, environment: plaidReadiness().mode });
  });
}
