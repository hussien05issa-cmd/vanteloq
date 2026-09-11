import { authorizeDeletionJob, advanceDeletion } from "../../../../../../server/account-deletion";
import { handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";

export async function POST(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const input = await readJsonObject(request, 1_000);
    const job = await authorizeDeletionJob(input.jobId, input.token);
    return jsonResponse(await advanceDeletion(job, input.token as string));
  });
}
