import { and, eq, or } from "drizzle-orm";
import { getDb, getD1 } from "../../../../../../db";
import { integrationConnections } from "../../../../../../db/schema";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { requireIntegrationAccess } from "../../../../../../server/integrations/free-selection";
import { decryptSlackCredentials, slackModeForStoredScopes, SLACK_PROVIDER } from "../../../../../../server/integrations/slack";
import { withSlackConversationGrant } from "../../../../../../server/integrations/slack-grant";
import { readSlackRecentConversation, slackChannelUrl, SlackConversationCooldownError, SlackConversationRateLimitError } from "../../../../../../server/integrations/slack-conversation";
import { requirePermission } from "../../../../../../server/permissions";
import { getTenantEntitlements, requireFeatureEntitlement } from "../../../../../../server/entitlements/engine";
import { recordAudit } from "../../../../../../server/audit";
import type { SlackConversationPage, SlackConversationStatus } from "../../../../../../domain/slack-conversations";

async function owner(request: Request) {
  const context = await requireIntegrationAccess(request, ["owner"], SLACK_PROVIDER, false);
  await requirePermission(context, "integrations.view");
  await requirePermission(context, "operations.tasks");
  requireFeatureEntitlement(await getTenantEntitlements(context), "operations.basic");
  return context;
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await owner(request);
    await enforceRateLimit("slack:conversation-status", context.userId, 60, 60);
    const requestedId = new URL(request.url).searchParams.get("connectionId");
    const connection = requestedId ? await requireOwnedIntegrationConnection(context.organizationId, SLACK_PROVIDER, requestedId)
      : (await getDb().select().from(integrationConnections).where(and(eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, SLACK_PROVIDER), or(eq(integrationConnections.status, "connected"), eq(integrationConnections.status, "error")))).limit(1))[0];
    const result: SlackConversationStatus = { mode: "single_channel_notifications", connected: connection?.status === "connected", readsMessages: false,
      requiresReconnect: Boolean(connection), connectionId: connection?.id ?? null, channelName: null, channelUrl: null, nextReadAt: null };
    if (!connection) return jsonResponse(result);
    result.channelName = connection.externalAccountName?.split(" · #").at(-1) ?? null;
    if (connection.externalAccountRef && connection.domainPrefix) result.channelUrl = slackChannelUrl(connection.externalAccountRef, connection.domainPrefix);
    try { result.mode = slackModeForStoredScopes(connection.scopesJson); } catch { return jsonResponse(result); }
    if (result.mode === "single_channel_conversations" && result.connected) {
      const row = await getD1().prepare(`SELECT s.access_token_ciphertext AS ciphertext FROM integration_secrets s JOIN integration_connections c
        ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.provider=s.provider
        WHERE s.organization_id=? AND s.connection_id=? AND s.provider='slack' AND c.status='connected' AND c.source_namespace=?`)
        .bind(context.organizationId, connection.id, connection.sourceNamespace).first<{ ciphertext: string }>();
      if (row) {
        const credentials = await decryptSlackCredentials(row.ciphertext);
        result.readsMessages = credentials.conversationRead?.enabled === true && credentials.teamId === connection.externalAccountRef && credentials.channelId === connection.domainPrefix;
        result.requiresReconnect = !result.readsMessages;
        if (result.readsMessages && credentials.conversationRead!.nextReadAt > 0) result.nextReadAt = new Date(credentials.conversationRead!.nextReadAt * 1000).toISOString();
      }
    }
    return jsonResponse(result);
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await owner(request);
    await enforceRateLimit("slack:conversation-read", context.userId, 30, 3_600);
    const input = await readJsonObject(request, 8_000);
    if (typeof input.connectionId !== "string" || !input.connectionId || input.connectionId.length > 200) throw new ApiError(400, "INTEGRATION_CONNECTION_REQUIRED", "Choose the connected Slack account before refreshing.");
    const connection = await requireOwnedIntegrationConnection(context.organizationId, SLACK_PROVIDER, input.connectionId, { connected: true });
    try {
      const page = await withSlackConversationGrant(context.organizationId, connection.id, connection.sourceNamespace, context, async (credentials, checkCurrent) => {
        const read = await readSlackRecentConversation(credentials, fetch, checkCurrent);
        await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
          action: "integration.slack_conversation_read", resourceType: "integration_connection", resourceId: connection.id,
          details: { provider: SLACK_PROVIDER, connectionId: connection.id, messageCount: read.messages.length, hasMore: read.hasMore,
            persistedMessageContent: false, automaticAiContext: false } });
        return { ...read, mode: "single_channel_conversations" as const, connected: true, readsMessages: true, requiresReconnect: false,
          connectionId: connection.id, nextReadAt: new Date(credentials.conversationRead!.nextReadAt * 1000).toISOString() } satisfies SlackConversationPage;
      });
      return jsonResponse(page);
    } catch (error) {
      if (error instanceof SlackConversationCooldownError || error instanceof SlackConversationRateLimitError) {
        const nextReadAt = error.nextReadAt ?? Math.floor(Date.now() / 1000) + 60;
        return jsonResponse({ error: { code: error.code, message: error.message }, nextReadAt: new Date(nextReadAt * 1000).toISOString() },
          { status: 429, headers: { "Retry-After": String(Math.max(1, nextReadAt - Math.floor(Date.now() / 1000))) } });
      }
      throw error;
    }
  });
}
