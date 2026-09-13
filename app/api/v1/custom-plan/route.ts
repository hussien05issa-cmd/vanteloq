import { getRuntimeEnv } from "../../../../db";
import { clientSource, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { deliverCustomPlanInquiry, inquiryConfiguration } from "../../../../server/custom-plan-inquiry";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const config = inquiryConfiguration(getRuntimeEnv(), new URL(request.url).hostname);
    return jsonResponse(config, { status: config.configured ? 200 : 503 });
  });
}
export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    await enforceRateLimit("custom-plan:submit", clientSource(request), 5, 3600);
    const body = await readJsonObject(request, 16_384);
    const result = await deliverCustomPlanInquiry(body, getRuntimeEnv(), new URL(request.url).hostname);
    return jsonResponse(result, { status: 202 });
  });
}
