import { ApiError, handleApi, jsonResponse, readJsonObject, readRequestBytes } from "../../../../../server/api";
import { unsubscribeMarketingEmail } from "../../../../../server/communications";
// GET is intentionally absent. Mail security scanners may prefetch email links.
// The high-entropy capability authorizes POST, including future RFC 8058 clients.
export async function POST(request: Request) {
  return handleApi(request, async () => {
    let token: unknown;
    const contentType = request.headers.get("content-type") ?? "";
    if (/^application\/json(?:;|$)/i.test(contentType)) {
      const input = await readJsonObject(request, 2_048);
      if (Object.keys(input).some(key => key !== "token")) throw new ApiError(400, "INVALID_UNSUBSCRIBE_REQUEST", "Use the unsubscribe button to continue.");
      token = input.token;
    } else if (/^application\/x-www-form-urlencoded(?:;|$)/i.test(contentType)) {
      const body = new URLSearchParams(new TextDecoder().decode(await readRequestBytes(request, 2_048)));
      if (body.get("List-Unsubscribe") !== "One-Click") throw new ApiError(400, "INVALID_UNSUBSCRIBE_REQUEST", "Use the unsubscribe button to continue.");
      token = new URL(request.url).searchParams.get("token");
    } else throw new ApiError(415, "UNSUPPORTED_CONTENT_TYPE", "Use the unsubscribe button to continue.");
    await unsubscribeMarketingEmail(token);
    return jsonResponse({ unsubscribed: true });
  });
}
