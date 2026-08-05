import { getDb } from "../../../../../../db";
import { integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import {
  enforceRateLimit,
  handleApi,
  jsonResponse,
  requireSameOrigin,
} from "../../../../../../server/api";
import {
  buildLightspeedAuthorizationUrl,
  LIGHTSPEED_PROVIDER,
  LIGHTSPEED_SCOPES,
  newOAuthState,
  sha256Hex,
} from "../../../../../../server/integrations/lightspeed";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("lightspeed:authorize", context.userId, 10, 3_600);
    const state = newOAuthState();
    const stateHash = await sha256Hex(state);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await getDb().insert(integrationOAuthStates).values({
      stateHash,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      provider: LIGHTSPEED_PROVIDER,
      expiresAt,
      consumedAt: null,
      createdAt: now,
    });
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.authorization_started",
      resourceType: "integration",
      resourceId: LIGHTSPEED_PROVIDER,
      details: { provider: LIGHTSPEED_PROVIDER, mode: "read_only", expiresInSeconds: 600 },
    });
    return jsonResponse({
      authorizationUrl: buildLightspeedAuthorizationUrl(state),
      expiresAt: expiresAt.toISOString(),
      scopes: [...LIGHTSPEED_SCOPES],
      mode: "read_only_staging",
    });
  });
}
