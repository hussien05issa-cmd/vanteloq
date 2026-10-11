import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { foodserviceAccess, readFoodservice, readFoodserviceHistory, saveFoodservice } from "../../../../server/foodservice";
import { recordAudit } from "../../../../server/audit";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const access = await foodserviceAccess(request);
    await enforceRateLimit("foodservice:read", access.context.userId, 90, 60);
    const historyId = new URL(request.url).searchParams.get("history");
    if (historyId !== null) return jsonResponse(await readFoodserviceHistory(access.context, access.permissions.periodRead, historyId));
    const result = await readFoodservice(access.context, access.permissions.periodRead, new URL(request.url).searchParams.get("locationId"));
    return jsonResponse({ ...result, permissions: access.permissions, boundary: "Reviewed operational estimates. Saving does not post to BookLoQ or change inventory balances." });
  });
}
export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const access = await foodserviceAccess(request);
    await enforceRateLimit("foodservice:write", access.context.userId, 30, 3600);
    const body = await readJsonObject(request, 100_000);
    if (body.action !== "save") throw new ApiError(400, "FOODSERVICE_ACTION", "Choose a supported save action.");
    const record = await saveFoodservice(access.context, access.permissions, body);
    await recordAudit({ request, requestId, organizationId: access.context.organizationId, actorUserId: access.context.userId, action: "foodservice.record_saved", resourceType: "foodservice_record", resourceId: record.id, details: { kind: record.kind, locationId: record.locationId, version: record.version } });
    return jsonResponse({ saved: true, record }, { status: body.id == null ? 201 : 200 });
  });
}
