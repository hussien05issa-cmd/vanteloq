import { requireBillingAccess } from "../../../../server/authorization";
import { handleApi, jsonResponse } from "../../../../server/api";
import { getTenantEntitlements } from "../../../../server/entitlements/engine";

// Members can read their own access without receiving billing permissions.
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireBillingAccess(request, ["owner", "admin", "manager", "employee", "read_only"]);
    const access = await getTenantEntitlements(context);
    return jsonResponse({ accessType: access.accessType, current: {
      plan: access.plan, status: access.subscriptionStatus, addons: access.addons,
      features: access.features, limits: access.limits,
    }, canManageBilling: context.role === "owner" || context.role === "admin" });
  });
}
