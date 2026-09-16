import { ApiError, handleApi, jsonResponse, readJsonObject, requireIdentity, requireSameOrigin } from "../../../../../server/api";
import { claimMarketingIntent, marketingIntentCookie, saveMarketingIntent } from "../../../../../server/communications";
export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const input = await readJsonObject(request, 2_048);
    if (input.action === "claim") {
      if (Object.keys(input).length !== 1) throw new ApiError(400, "INVALID_MARKETING_CHOICE", "Refresh email preferences and try again.");
      const preference = await claimMarketingIntent(request, await requireIdentity(request));
      return jsonResponse(preference, { headers: { "Set-Cookie": marketingIntentCookie(request, null) } });
    }
    const token = await saveMarketingIntent(request, input);
    return jsonResponse({ saved: true, pendingEmailVerification: true }, { headers: { "Set-Cookie": marketingIntentCookie(request, token) } });
  });
}
