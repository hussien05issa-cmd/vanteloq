import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { recordAudit } from "../../../../server/audit";
import { acknowledgeFollowup, followupAccess, readWorkflowFollowup, saveCollectionFollowup, saveFollowupPreferences } from "../../../../server/workflow-followup";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const mode = new URL(request.url).searchParams.get("mode") === "collections" ? "collections" : "briefings";
    const context = await followupAccess(request, mode);
    await enforceRateLimit("workflow-followup:read", context.userId, 90, 60);
    return jsonResponse(await readWorkflowFollowup(context, mode));
  });
}
export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const body = await readJsonObject(request, 24_000), mode = body.mode === "collections" ? "collections" : "briefings";
    if (!["save_followup", "save_preferences", "acknowledge"].includes(String(body.action)) || body.action === "save_followup" && mode !== "collections" || body.action === "acknowledge" && mode !== "briefings") throw new ApiError(400, "FOLLOWUP_ACTION", "Choose a supported follow-up action.");
    const context = await followupAccess(request, mode);
    await enforceRateLimit("workflow-followup:write", context.userId, 40, 3600);
    const result = body.action === "save_followup" ? await saveCollectionFollowup(context, body) : body.action === "save_preferences" ? await saveFollowupPreferences(context, body) : await acknowledgeFollowup(context, body.id);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: `workflow.${body.action}`, resourceType: "workflow_followup", resourceId: String(body.invoiceId ?? body.id ?? context.userId), details: { mode } });
    return jsonResponse(result);
  });
}
