import { enforceRateLimit, handleApi, jsonResponse } from "../../../../../server/api";
import { requirePersonalAdminAccess } from "../../../../../server/personal-admin";

export async function GET(request: Request) {
  const response = await handleApi(request, async () => {
    const context = await requirePersonalAdminAccess(request);
    await enforceRateLimit("personal-admin:eligibility", context.userId, 90, 60);
    return jsonResponse({ personalAdmin: true, capabilities: ["business_preview", "onboarding_rehearsal"] });
  });
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Vary", "Authorization, X-Vanteloq-Workspace");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
