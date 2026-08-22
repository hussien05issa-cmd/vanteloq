import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates } from "../../../../../../db/schema";
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
  lightspeedReadiness,
  newOAuthState,
  sha256Hex,
} from "../../../../../../server/integrations/lightspeed";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("lightspeed:authorize", context.userId, 10, 3_600);
    const state = newOAuthState();
    const stateHash = await sha256Hex(state);
    const connectionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const readiness = lightspeedReadiness();
    const authorizationUrl = buildLightspeedAuthorizationUrl(state);
    await getDb().insert(integrationConnections).values({
      id: connectionId,
      organizationId: context.organizationId,
      provider: LIGHTSPEED_PROVIDER,
      sourceNamespace: connectionId,
      status: "pending",
      externalAccountRef: null,
      externalAccountName: "New X-Series account",
      domainPrefix: null,
      apiVersion: readiness.apiVersion,
      scopesJson: JSON.stringify(LIGHTSPEED_SCOPES),
      dataPromotionStatus: "blocked",
      connectedAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncCursor: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(integrationOAuthStates).values({
      stateHash,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      provider: LIGHTSPEED_PROVIDER,
      connectionId,
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
      details: { provider: LIGHTSPEED_PROVIDER, connectionId, mode: "read_only", expiresInSeconds: 600 },
    });
    return jsonResponse({
      authorizationUrl,
      expiresAt: expiresAt.toISOString(),
      connectionId,
      scopes: [...LIGHTSPEED_SCOPES],
      mode: "read_only_staging",
    });
  });
}
