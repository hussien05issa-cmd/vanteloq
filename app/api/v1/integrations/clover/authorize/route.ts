import { requireIntegrationRollout } from "../../../../../../server/integrations/rollout-access";
import { oauthBrowserCookie } from "../../../../../../server/integrations/oauth-browser";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import {
  buildCloverAuthorizationUrl,
  CLOVER_PROVIDER,
  CLOVER_READ_PERMISSIONS,
  cloverSha256,
  newCloverState,
} from "../../../../../../server/integrations/clover";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await requireIntegrationRollout(context, "clover");
    await enforceRateLimit("clover:authorize", context.userId, 10, 3600);
    const state = newCloverState();
    const connectionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await getDb().insert(integrationConnections).values({
      id: connectionId,
      organizationId: context.organizationId,
      provider: CLOVER_PROVIDER,
      sourceNamespace: connectionId,
      status: "pending",
      externalAccountRef: null,
      externalAccountName: "New Clover merchant",
      domainPrefix: null,
      apiVersion: "v3",
      scopesJson: JSON.stringify(CLOVER_READ_PERMISSIONS),
      dataPromotionStatus: "blocked",
      connectedAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncCursor: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(integrationOAuthStates).values({
      stateHash: await cloverSha256(state),
      organizationId: context.organizationId,
      actorUserId: context.userId,
      provider: CLOVER_PROVIDER,
      connectionId,
      expiresAt,
      consumedAt: null,
      createdAt: now,
    });
    await recordAudit({
      request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.authorization_started", resourceType: "integration", resourceId: connectionId,
      details: { provider: CLOVER_PROVIDER, connectionId, mode: "read_only", expiresInSeconds: 600 },
    });
    return jsonResponse({
      authorizationUrl: buildCloverAuthorizationUrl(state),
      expiresAt: expiresAt.toISOString(),
      connectionId,
      permissions: [...CLOVER_READ_PERMISSIONS],
      mode: "read_only_staged_sync",
    }, { headers: { "Set-Cookie": oauthBrowserCookie("clover", state) } });
  });
}
