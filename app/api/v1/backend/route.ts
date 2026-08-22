import { requireAccess } from "../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import { requirePermission } from "../../../../server/permissions";
import { probeSupabaseBackend } from "../../../../server/supabase";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin"], "business.settings");
    await requirePermission(context, "integrations.view");
    await enforceRateLimit("backend:readiness", context.userId, 12, 60);
    return jsonResponse({ supabase: await probeSupabaseBackend() });
  });
}
