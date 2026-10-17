import { handleApi, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireIntegrationAccess } from "../../../../../../server/integrations/free-selection";
import { requirePermission } from "../../../../../../server/permissions";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";
import { runSync } from "../../../../../../server/integrations/sync/shopify-pos";
import { shopifyProviderFromRequest } from "../../../../../../server/integrations/shopify-pos";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireIntegrationAccess(request, ["owner", "admin"], shopifyProviderFromRequest(request), false);
    await requirePermission(context, "integrations.manage");
    await requireOrganizationWideLocationAccess(context);
    const input = await readJsonObject(request);
    return runSync(request, requestId, context, input, "manual", shopifyProviderFromRequest(request));
  });
}
