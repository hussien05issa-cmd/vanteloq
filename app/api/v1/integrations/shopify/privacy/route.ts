import { getD1 } from "../../../../../../db";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requirePrivacyAccess } from "../../../../../../server/authorization";
import { requirePermission } from "../../../../../../server/permissions";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";
import { completeShopifyPrivacyRequest, exportShopifyPrivacyRequest, listShopifyPrivacyRequests } from "../../../../../../server/integrations/shopify-privacy";
import { recordAudit } from "../../../../../../server/audit";

async function access(request: Request) {
  // Privacy response work remains possible after billing access expires.
  const context = await requirePrivacyAccess(request, ["owner", "admin"]);
  await requirePermission(context, "privacy.manage");
  await requireOrganizationWideLocationAccess(context);
  return context;
}
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await access(request);
    await enforceRateLimit("shopify:privacy:read", context.userId, 60, 60);
    return jsonResponse(await listShopifyPrivacyRequests(getD1(), context.organizationId));
  });
}
export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await access(request);
    await requirePermission(context, "customers.export");
    await enforceRateLimit("shopify:privacy:write", context.userId, 20, 60);
    const input = await readJsonObject(request);
    if (typeof input.id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.id)) throw new ApiError(400, "SHOPIFY_PRIVACY_ID_INVALID", "Choose a valid privacy request.");
    if (input.action === "export") {
      const exported = await exportShopifyPrivacyRequest(getD1(), context.organizationId, input.id);
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "privacy.shopify_export_downloaded", resourceType: "shopify_privacy_request", resourceId: input.id, details: { transmitted: false } });
      return new Response(JSON.stringify(exported, null, 2), { headers: {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="shopify-privacy-${input.id}.json"`, "X-Content-Type-Options": "nosniff",
      } });
    }
    if (input.action === "complete") {
      const result = await completeShopifyPrivacyRequest(getD1(), { organizationId: context.organizationId, userId: context.userId,
        id: input.id, method: typeof input.method === "string" ? input.method : "", reference: typeof input.reference === "string" ? input.reference : "", confirmed: input.confirmed === true });
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "privacy.shopify_response_confirmed", resourceType: "shopify_privacy_request", resourceId: input.id, details: { scopeErased: true, operatorConfirmed: true } });
      return jsonResponse(result);
    }
    throw new ApiError(400, "SHOPIFY_PRIVACY_ACTION_INVALID", "Choose a supported privacy action.");
  });
}
