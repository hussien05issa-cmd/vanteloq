import { authorizeDeletionJob, openDeletionPlan } from "../../../../../../server/account-deletion";
import { ApiError, handleApi, jsonResponse, readJsonObject } from "../../../../../../server/api";

// Server-to-server capability endpoint. No cookies, CORS, configurable callback,
// or caller-supplied targets. The capability cannot create a new deletion job.
export async function POST(request: Request) {
  return handleApi(request, async () => {
    const input = await readJsonObject(request, 1_000);
    const job = await authorizeDeletionJob(input.jobId, input.token);
    if (job.stage === "completed") throw new ApiError(409, "DELETION_FINISHED", "This deletion is complete.");
    const plan = await openDeletionPlan(job);
    return jsonResponse({ stage: job.stage, scope: job.scope, subject: plan.subject, organizationName: plan.organizationName,
      memberSubjects: plan.memberSubjects, remote: plan.remote ?? null });
  });
}
