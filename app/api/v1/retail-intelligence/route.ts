import { requireAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse, enforceRateLimit, clientSource } from "../../../../server/api";
import { requirePermission } from "../../../../server/permissions";
import { readRetailReport } from "../../../../server/retail-intelligence";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"], "analytics.sales.basic");
    await requirePermission(context, "metrics.revenue");
    await requirePermission(context, "dashboard.view");
    await enforceRateLimit("retail-intelligence:read", context.userId + ":" + clientSource(request), 45, 60);
    const url = new URL(request.url);
    return jsonResponse(await readRetailReport(context, url.searchParams.get("location"), url.searchParams.get("from"), url.searchParams.get("to")));
  });
}
