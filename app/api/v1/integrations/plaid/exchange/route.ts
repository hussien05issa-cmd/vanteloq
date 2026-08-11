import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { exchangePlaidPublicToken, syncPlaidTransactions } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requirePermission(context, "finance.connections");
    await enforceRateLimit("plaid:exchange", context.userId, 6, 3_600);
    const input = await readJsonObject(request, 16_000);
    const publicToken = typeof input.publicToken === "string" ? input.publicToken.trim() : "";
    if (!publicToken || publicToken.length > 500 || input.consentAcknowledged !== true) {
      throw new ApiError(400, "PLAID_CONSENT_REQUIRED", "Confirm the disclosed read-only banking purpose before connecting.");
    }
    const connection = await exchangePlaidPublicToken(context.organizationId, publicToken);
    const sync = await syncPlaidTransactions(context.organizationId);
    return jsonResponse({ connected: true, accountsImported: connection.accountsImported, sync });
  });
}
