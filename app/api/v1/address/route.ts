import {
  addressCompleteReadiness,
  createAddressVerificationToken,
  findAddressCompleteSuggestions,
  retrieveAddressCompleteAddress,
} from "../../../../server/address/address-complete.ts";
import {
  ApiError,
  clientSource,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireAal2,
  requireIdentity,
  requireSameOrigin,
} from "../../../../server/api.ts";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const identity = await requireIdentity(request);
    requireAal2(identity);
    return jsonResponse(addressCompleteReadiness());
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
    const input = await readJsonObject(request, 2_048);

    if (input.action === "find") {
      if (typeof input.search !== "string" || typeof input.country !== "string") {
        throw new ApiError(400, "ADDRESS_SEARCH_INVALID", "Enter an address and select a country.");
      }
      if (input.lastId !== undefined && typeof input.lastId !== "string") {
        throw new ApiError(400, "ADDRESS_SEARCH_INVALID", "Select a valid address group.");
      }
      return jsonResponse({ suggestions: await findAddressCompleteSuggestions({
        search: input.search,
        country: input.country,
        lastId: input.lastId,
      }) });
    }

    if (input.action === "retrieve") {
      if (typeof input.id !== "string") {
        throw new ApiError(400, "ADDRESS_REFERENCE_INVALID", "Select a valid address suggestion.");
      }
      const address = await retrieveAddressCompleteAddress({ id: input.id });
      return jsonResponse({
        address,
        verificationToken: await createAddressVerificationToken(address),
      });
    }

    throw new ApiError(400, "ADDRESS_ACTION_INVALID", "Select a valid address verification action.");
  });
}
