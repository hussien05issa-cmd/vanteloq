import {
  ApiError,
  clientSource,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  requireAal2,
  requireIdentity,
  requireSameOrigin,
} from "../../../../server/api.ts";

// Older signup tabs also use manual entry while third-party lookup is paused.
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const identity = await requireIdentity(request);
    requireAal2(identity);
    return jsonResponse({ configured: false, provider: null, manualEntry: true });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const identity = await requireIdentity(request);
    requireAal2(identity);
    await enforceRateLimit("address:user", identity.subject ?? identity.email, 80, 3_600);
    const source = clientSource(request);
    if (source !== "unknown") await enforceRateLimit("address:source", source, 160, 3_600);
    throw new ApiError(503, "ADDRESS_LOOKUP_UNAVAILABLE", "Address search is unavailable. Enter your business address manually.");
  });
}
