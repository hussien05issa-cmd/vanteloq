import {
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireAal2,
  requireIdentity,
  requireSameOrigin,
} from "../../../../server/api.ts";
import { acceptTeamInvitation, pendingTeamInvitation } from "../../../../server/team-invitations.ts";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const identity = await requireIdentity(request);
    await enforceRateLimit("team-invitation:read", identity.email, 30, 3_600);
    return jsonResponse({ invitation: await pendingTeamInvitation(request, identity) });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const identity = await requireIdentity(request);
    requireAal2(identity);
    await enforceRateLimit("team-invitation:accept", identity.email, 5, 3_600);
    const result = await acceptTeamInvitation(request, identity, await readJsonObject(request), requestId);
    return jsonResponse({
      accepted: true,
      organization: { businessName: result.businessName },
      role: result.role,
      console: result.consoleActivationUrl ? { activationUrl: result.consoleActivationUrl } : null,
    });
  });
}
