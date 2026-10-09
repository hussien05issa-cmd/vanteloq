import { requireProviderPrivacy } from "../../../../../../server/integrations/provider-privacy";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireIntegrationAccess, integrationGrantId } from "../../../../../../server/integrations/free-selection";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, requireSameOrigin } from "../../../../../../server/api";
import { oauthBrowserCookie } from "../../../../../../server/integrations/oauth-browser";
import { requireIntegrationRollout } from "../../../../../../server/integrations/rollout-access";
import {
  buildSlackAuthorizationUrl,
  newSlackOAuthState,
  SLACK_API_VERSION,
  SLACK_PROVIDER,
  SLACK_SCOPES,
  slackStateHash,
} from "../../../../../../server/integrations/slack";
import { requireNoPendingSlackCleanup } from "../../../../../../server/integrations/slack-grant";
import { requirePermission } from "../../../../../../server/permissions";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireIntegrationAccess(request, ["owner", "admin"], "slack", true);
    await requirePermission(context, "integrations.manage");
    await requireIntegrationRollout(context, SLACK_PROVIDER);
    await enforceRateLimit("slack:authorize", context.userId, 10, 3_600);
    await requireProviderPrivacy(request, context, "slack", requestId);

    const [existing] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, SLACK_PROVIDER),
      or(eq(integrationConnections.status, "connected"), eq(integrationConnections.status, "error")),
    )).limit(1);
    if (existing) {
      throw new ApiError(409, "SLACK_ALREADY_CONNECTED", "Disconnect the current Slack workspace before choosing another workspace or channel.");
    }

    await requireNoPendingSlackCleanup(context.organizationId);
    const state = newSlackOAuthState();
    const connectionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await getDb().insert(integrationConnections).values({
      freeGrantId: await integrationGrantId(context, "slack"),
      id: connectionId,
      organizationId: context.organizationId,
      provider: SLACK_PROVIDER,
      sourceNamespace: connectionId,
      status: "pending",
      externalAccountRef: null,
      externalAccountName: "New Slack workspace",
      domainPrefix: null,
      apiVersion: SLACK_API_VERSION,
      scopesJson: JSON.stringify(SLACK_SCOPES),
      dataPromotionStatus: "blocked",
      connectedAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncCursor: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(integrationOAuthStates).values({
      stateHash: await slackStateHash(state),
      organizationId: context.organizationId,
      actorUserId: context.userId,
      provider: SLACK_PROVIDER,
      connectionId,
      initiatorAuthSubject: context.identity.subject,
      initiatorAuthProvider: context.identity.provider,
      initiatorAssuranceLevel: context.identity.assuranceLevel,
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
      resourceId: connectionId,
      details: {
        provider: SLACK_PROVIDER,
        connectionId,
        scopes: SLACK_SCOPES.join(","),
        mode: "single_channel_notifications",
        expiresInSeconds: 600,
      },
    });
    return jsonResponse({
      authorizationUrl: buildSlackAuthorizationUrl(state),
      connectionId,
      expiresAt: expiresAt.toISOString(),
      scopes: [...SLACK_SCOPES],
      mode: "single_channel_notifications",
    }, { headers: { "Set-Cookie": oauthBrowserCookie(SLACK_PROVIDER, state) } });
  });
}
