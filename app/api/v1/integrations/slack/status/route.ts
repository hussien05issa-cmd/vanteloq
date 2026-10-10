import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections } from "../../../../../../db/schema";
import { requireIntegrationAccess } from "../../../../../../server/integrations/free-selection";
import { handleApi, jsonResponse } from "../../../../../../server/api";
import { SLACK_PROVIDER, slackModeForScopes, slackScopesForMode, slackReadiness } from "../../../../../../server/integrations/slack";
import type { SlackMode } from "../../../../../../domain/slack-conversations";
import { pendingSlackCleanupConnectionIds } from "../../../../../../server/integrations/slack-grant";
import { requirePermission } from "../../../../../../server/permissions";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireIntegrationAccess(request, ["owner", "admin", "manager", "employee", "read_only"], "slack", false);
    await requirePermission(context, "integrations.view");
    const [connection] = await getDb().select({
      id: integrationConnections.id,
      status: integrationConnections.status,
      workspaceId: integrationConnections.externalAccountRef,
      displayName: integrationConnections.externalAccountName,
      channelId: integrationConnections.domainPrefix,
      scopesJson: integrationConnections.scopesJson,
      connectedAt: integrationConnections.connectedAt,
      lastErrorCode: integrationConnections.lastErrorCode,
      updatedAt: integrationConnections.updatedAt,
    }).from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, SLACK_PROVIDER),
      eq(integrationConnections.status, "connected"),
    )).orderBy(desc(integrationConnections.updatedAt)).limit(1);
    const scopes = (() => {
      try {
        const value = connection ? JSON.parse(connection.scopesJson) : [];
        return Array.isArray(value) ? value.filter((scope): scope is string => typeof scope === "string") : [];
      } catch {
        return [];
      }
    })();
    let mode: SlackMode = "single_channel_notifications";
    try { mode = slackModeForScopes(scopes); } catch { /* Unsupported grants never enable conversation reads. */ }
    return jsonResponse({
      connected: Boolean(connection),
      mode,
      pendingRemovalConnectionIds: await pendingSlackCleanupConnectionIds(context.organizationId),
      connection: connection ? {
        id: connection.id,
        status: connection.status,
        workspaceId: connection.workspaceId,
        displayName: connection.displayName,
        channelId: connection.channelId,
        scopes,
        connectedAt: connection.connectedAt?.toISOString() ?? null,
        lastErrorCode: connection.lastErrorCode,
        updatedAt: connection.updatedAt.toISOString(),
      } : null,
      leastPrivilege: {
        requestedScopes: [...slackScopesForMode(mode)],
        approvedChannelOnly: true,
        readsMessages: Boolean(connection) && mode === "single_channel_conversations",
        ownerOnlyConversationReads: true,
        accessesFiles: false,
      },
      readiness: slackReadiness(),
    });
  });
}
