import { handleApi, jsonResponse, readJsonObject, requireIdentity, requireSameOrigin } from "../../../../../server/api";
import { readMarketingPreference, setMarketingPreference } from "../../../../../server/communications";
export async function GET(request: Request) {
  return handleApi(request, async () => jsonResponse(await readMarketingPreference(await requireIdentity(request))));
}
export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    return jsonResponse(await setMarketingPreference(request, await requireIdentity(request), await readJsonObject(request, 2_048)));
  });
}
