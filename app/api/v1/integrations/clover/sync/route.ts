import { handleApi, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireAccess } from "../../../../../../server/authorization";
import { requirePermission } from "../../../../../../server/permissions";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";
import { runSync } from "../../../../../../server/integrations/sync/clover";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await requireOrganizationWideLocationAccess(context);
    const input = await readJsonObject(request);
    return runSync(request, requestId, context, input, "manual");
  });
}
