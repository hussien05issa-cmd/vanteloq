import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { buildSquareAuthorizationUrl, newSquareState, SQUARE_API_VERSION, SQUARE_PROVIDER, SQUARE_READ_SCOPES, squareSha256 } from "../../../../../../server/integrations/square";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("square:authorize", context.userId, 10, 3600);
    const state = newSquareState();
    const connectionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await getDb().insert(integrationConnections).values({
      id: connectionId, organizationId: context.organizationId, provider: SQUARE_PROVIDER,
      sourceNamespace: connectionId, status: "pending", externalAccountRef: null,
      externalAccountName: "New Square seller", domainPrefix: null, apiVersion: SQUARE_API_VERSION,
      scopesJson: JSON.stringify(SQUARE_READ_SCOPES), dataPromotionStatus: "blocked",
      connectedAt: null, lastSuccessfulSyncAt: null, lastSyncCursor: null,
      lastErrorCode: null, createdAt: now, updatedAt: now,
    });
    await getDb().insert(integrationOAuthStates).values({
      stateHash: await squareSha256(state), organizationId: context.organizationId,
      actorUserId: context.userId, provider: SQUARE_PROVIDER, connectionId,
      expiresAt, consumedAt: null, createdAt: now,
    });
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.authorization_started", resourceType: "integration", resourceId: connectionId, details: { provider: SQUARE_PROVIDER, permissions: SQUARE_READ_SCOPES.join(" "), expiresInSeconds: 600 } });
    return jsonResponse({ authorizationUrl: buildSquareAuthorizationUrl(state), expiresAt: expiresAt.toISOString(), connectionId, permissions: [...SQUARE_READ_SCOPES], mode: "read_only_staged_sync" });
  });
}
