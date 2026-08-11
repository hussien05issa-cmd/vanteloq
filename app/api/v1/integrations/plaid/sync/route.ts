import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { syncPlaidTransactions } from "../../../../../../server/integrations/plaid";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requirePermission(context, "finance.connections");
    await enforceRateLimit("plaid:sync", context.organizationId, 20, 3_600);
    return jsonResponse({ sync: await syncPlaidTransactions(context.organizationId) });
  });
}
