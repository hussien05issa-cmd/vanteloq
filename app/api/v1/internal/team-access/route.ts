import {
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireAal2,
  requireIdentity,
} from "../../../../../server/api.ts";
import { manageTeamAccess, type TeamAccessOperation } from "../../../../../server/team-access-management.ts";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const identity = await requireIdentity(request);
    requireAal2(identity);
    await enforceRateLimit("internal-team-access", identity.email, 20, 3_600);
    const body = await readJsonObject(request);
    const email = typeof body.email === "string" ? body.email : "";
    const authUserId = typeof body.authUserId === "string" ? body.authUserId : null;
    const operation = typeof body.operation === "string" ? body.operation as TeamAccessOperation : "" as TeamAccessOperation;
    return jsonResponse(await manageTeamAccess(identity, { email, authUserId, operation }, requestId));
  });
}
