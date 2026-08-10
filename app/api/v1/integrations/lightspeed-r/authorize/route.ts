import { getDb } from "../../../../../../db";
import { integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import {
  buildLightspeedRAuthorizationUrl,
  LIGHTSPEED_R_PROVIDER,
  LIGHTSPEED_R_SCOPES,
  lightspeedRSha256,
  newLightspeedRState,
} from "../../../../../../server/integrations/lightspeed-r";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("lightspeed-r:authorize", context.userId, 10, 3600);
    const state = newLightspeedRState();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await getDb().insert(integrationOAuthStates).values({
      stateHash: await lightspeedRSha256(state), organizationId: context.organizationId,
      actorUserId: context.userId, provider: LIGHTSPEED_R_PROVIDER,
      expiresAt, consumedAt: null, createdAt: now,
    });
    await recordAudit({
      request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.authorization_started", resourceType: "integration", resourceId: LIGHTSPEED_R_PROVIDER,
      details: { provider: LIGHTSPEED_R_PROVIDER, mode: "read_only", expiresInSeconds: 600 },
    });
    return jsonResponse({
      authorizationUrl: buildLightspeedRAuthorizationUrl(state), expiresAt: expiresAt.toISOString(),
      scopes: [...LIGHTSPEED_R_SCOPES], mode: "read_only_live_sync",
    });
  });
}
