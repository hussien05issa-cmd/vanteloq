import { enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import { requireAccess } from "../../../../server/authorization";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { readLocationIntelligence } from "../../../../server/location-intelligence";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "multi_location.basic");
    await requirePermission(context, "dashboard.view");
    await enforceRateLimit("locations:read", context.userId, 90, 60);
    return jsonResponse(await readLocationIntelligence(context, await effectivePermissions(context)));
  });
}
