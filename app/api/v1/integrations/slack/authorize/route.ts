import { requireProviderPrivacy } from "../../../../../../server/integrations/provider-privacy";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationOAuthStates } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireIntegrationAccess, integrationGrantId } from "../../../../../../server/integrations/free-selection";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { oauthBrowserCookie } from "../../../../../../server/integrations/oauth-browser";
import { requireIntegrationRollout } from "../../../../../../server/integrations/rollout-access";
import {
  buildSlackAuthorizationUrl,
  newSlackOAuthState,
  SLACK_API_VERSION,
  SLACK_PROVIDER,
  slackScopesForMode,
  slackStateHash,
} from "../../../../../../server/integrations/slack";
import { requireNoPendingSlackCleanup } from "../../../../../../server/integrations/slack-grant";
import { requirePermission } from "../../../../../../server/permissions";
import { SLACK_CONVERSATION_READ_NOTICE_VERSION } from "../../../../../../domain/slack-conversations";

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireIntegrationAccess(request, ["owner", "admin"], "slack", true);
    const input = await readJsonObject(request.clone(), 16_000);
    const mode = input.mode ?? "single_channel_notifications";
    if (mode !== "single_channel_notifications" && mode !== "single_channel_conversations") throw new ApiError(400, "SLACK_MODE_INVALID", "Choose a supported Slack connection mode.");
    if (mode === "single_channel_conversations") {
      if (context.role !== "owner") throw new ApiError(403, "SLACK_CONVERSATION_OWNER_REQUIRED", "Only the workspace owner can approve Slack conversation access.");
      if (input.slackConversationReadAccepted !== true || input.slackConversationReadNoticeVersion !== SLACK_CONVERSATION_READ_NOTICE_VERSION) {
        throw new ApiError(400, "SLACK_CONVERSATION_CONSENT_REQUIRED", "Review and approve the current Slack conversation notice before connecting.");
      }
    }
    const requestedScopes = slackScopesForMode(mode);
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
      scopesJson: JSON.stringify(requestedScopes),
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
        scopes: requestedScopes.join(","),
        mode,
        ...(mode === "single_channel_conversations" ? { conversationNoticeVersion: SLACK_CONVERSATION_READ_NOTICE_VERSION } : {}),
        expiresInSeconds: 600,
      },
    });
    return jsonResponse({
      authorizationUrl: buildSlackAuthorizationUrl(state, mode),
      connectionId,
      expiresAt: expiresAt.toISOString(),
      scopes: [...requestedScopes],
      mode,
    }, { headers: { "Set-Cookie": oauthBrowserCookie(SLACK_PROVIDER, state) } });
  });
}
