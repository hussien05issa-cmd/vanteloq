import { handleApi, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireIntegrationAccess } from "../../../../../../server/integrations/free-selection";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";
import { requireIntegrationRollout } from "../../../../../../server/integrations/rollout-access";
import { runDeelSync } from "../../../../../../server/integrations/sync/deel";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireIntegrationAccess(request, ["owner", "admin"], "deel", false);
    await requirePermission(context, "integrations.manage");
    await requirePermission(context, "payroll.totals");
    await requireOrganizationWideLocationAccess(context);
    await requireIntegrationRollout(context, "deel");
    return runDeelSync(request, requestId, context, await readJsonObject(request));
  });
}
