import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections } from "../../../../../../db/schema";
import { requireIntegrationAccess } from "../../../../../../server/integrations/free-selection";
import { handleApi, jsonResponse } from "../../../../../../server/api";
import { SLACK_PROVIDER, SLACK_SCOPES, slackReadiness } from "../../../../../../server/integrations/slack";
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
    return jsonResponse({
      connected: Boolean(connection),
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
        requestedScopes: [...SLACK_SCOPES],
        approvedChannelOnly: true,
        readsMessages: false,
        accessesFiles: false,
      },
      readiness: slackReadiness(),
    });
  });
}
