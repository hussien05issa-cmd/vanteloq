import {
  enforceRateLimit,
  handleApi,
  jsonResponse,
  requireAal2,
  requireIdentity,
} from "../../../../../server/api.ts";
import { verifiedTeamProvisioning } from "../../../../../server/team-invitations.ts";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const identity = await requireIdentity(request);
    requireAal2(identity);
    await enforceRateLimit("team-provisioning:verify", identity.email, 20, 3_600);
    const invitationId = new URL(request.url).searchParams.get("invitationId")?.trim() ?? "";
    return jsonResponse({ provisioned: await verifiedTeamProvisioning(request, identity, invitationId) });
  });
}
