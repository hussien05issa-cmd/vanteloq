import { requireIntegrationCallbackAccess, releaseIntegrationSelectionIfUnused } from "../../../../../../server/integrations/free-selection";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  integrationConnections,
  integrationOAuthStates,
  memberships,
  users,
  workspaces,
} from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import type { AccessContext } from "../../../../../../server/authorization";
import { ApiError, handleApi } from "../../../../../../server/api";
import { requireOAuthBrowser } from "../../../../../../server/integrations/oauth-browser";
import {
  exchangeSlackAuthorizationCode,
  SLACK_PROVIDER,
  slackStateHash,
  slackModeForStoredScopes,
  slackCredentialEnvelope,
} from "../../../../../../server/integrations/slack";
import { acquireSlackGrantLease, activateSlackGrant, requireNoPendingSlackCleanup } from "../../../../../../server/integrations/slack-grant";
import { releaseIntegrationSyncLease } from "../../../../../../server/integrations/connection";
import { requirePermission } from "../../../../../../server/permissions";
import { validateSlackPublicChannel } from "../../../../../../server/integrations/slack-conversation";

function returnUrl(request: Request, status: "connected" | "declined" | "failed") {
  return new URL(`/?integration=slack&connection=${status}`, new URL(request.url).origin).toString();
}

function returnToVanteloq(request: Request, status: "connected" | "declined" | "failed") {
  return new Response(null, {
    status: 303,
    headers: {
      Location: returnUrl(request, status),
      "Set-Cookie": "__Host-vanteloq-oauth-slack=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    },
  });
}

async function callbackStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.error(JSON.stringify({
        level: "error",
        event: "slack.callback_stage_failed",
        stage,
        errorName: error instanceof Error ? error.name : "unknown",
      }));
    }
    throw error;
  }
}

async function callbackActor(initiation: typeof integrationOAuthStates.$inferSelect): Promise<AccessContext> {
  const [actor] = await getDb().select({
    userId: users.id,
    email: users.email,
    displayName: users.displayName,
    authSubject: users.authSubject,
    authProvider: users.authProvider,
    role: memberships.role,
    organizationId: memberships.organizationId,
    organization: workspaces,
  }).from(users).innerJoin(memberships, and(
    eq(memberships.userId, users.id),
    eq(memberships.organizationId, initiation.organizationId),
  )).innerJoin(workspaces, eq(workspaces.id, memberships.organizationId)).where(and(
    eq(users.id, initiation.actorUserId),
    eq(users.status, "active"),
    eq(memberships.status, "active"),
  )).limit(1);
  if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
    throw new ApiError(403, "SLACK_INITIATOR_INELIGIBLE", "The account that started this connection can no longer manage integrations.");
  }
  if (!initiation.initiatorAuthSubject || initiation.initiatorAuthSubject !== actor.authSubject
    || initiation.initiatorAuthProvider !== actor.authProvider) {
    throw new ApiError(403, "SLACK_INITIATOR_SESSION_INVALID", "Start a new Slack connection from your signed-in workspace.");
  }
  const context: AccessContext = {
    identity: {
      email: actor.email,
      displayName: actor.displayName,
      subject: actor.authSubject,
      provider: actor.authProvider ?? "sites",
      emailVerified: true,
      assuranceLevel: initiation.initiatorAssuranceLevel === "aal2" ? "aal2" : initiation.initiatorAssuranceLevel === "aal1" ? "aal1" : null,
      sessionId: null,
    },
    userId: actor.userId,
    organizationId: actor.organizationId,
    role: actor.role,
    authSubject: actor.authSubject,
    authProvider: actor.authProvider,
    organization: actor.organization,
  };
  await requirePermission(context, "integrations.manage");
  return context;
}

export async function GET(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    const state = url.searchParams.get("state")?.trim() ?? "";
    const code = url.searchParams.get("code")?.trim() ?? "";
    const providerError = url.searchParams.get("error")?.trim() ?? "";
    requireOAuthBrowser(request, SLACK_PROVIDER, state);
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || (!providerError && (!code || code.length > 2_048))) {
      throw new ApiError(400, "SLACK_CALLBACK_INVALID", "Slack returned an incomplete callback.");
    }

    const now = new Date();
    const stateHash = await callbackStage("state_hash", () => slackStateHash(state));
    const [storedState] = await callbackStage("state_lookup", () => getDb().select().from(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, SLACK_PROVIDER),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).limit(1));
    if (!storedState) throw new ApiError(400, "SLACK_STATE_INVALID", "The Slack authorization attempt expired or was already used. Start again.");
    const context = await callbackStage("actor_validation", () => callbackActor(storedState));
    await requireIntegrationCallbackAccess(context, "slack", storedState.connectionId);
    const [consumed] = await callbackStage("state_consume", () => getDb().update(integrationOAuthStates).set({ consumedAt: now }).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, SLACK_PROVIDER),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).returning({ stateHash: integrationOAuthStates.stateHash }));
    if (!consumed) throw new ApiError(400, "SLACK_STATE_INVALID", "The Slack authorization attempt expired or was already used. Start again.");

    const [pending] = await callbackStage("pending_lookup", () => getDb().select({ id: integrationConnections.id, sourceNamespace: integrationConnections.sourceNamespace, scopesJson: integrationConnections.scopesJson }).from(integrationConnections).where(and(
      eq(integrationConnections.id, storedState.connectionId),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, SLACK_PROVIDER),
      eq(integrationConnections.status, "pending"),
    )).limit(1));
    if (!pending) throw new ApiError(409, "SLACK_CONNECTION_MISSING", "The Slack connection attempt is no longer available. Start again.");
    const mode = slackModeForStoredScopes(pending.scopesJson);
    if (mode === "single_channel_conversations" && context.role !== "owner") throw new ApiError(403, "SLACK_CONVERSATION_OWNER_REQUIRED", "The account that approved Slack conversation access must still be the workspace owner.");

    if (providerError) {
      await getDb().delete(integrationConnections).where(and(
        eq(integrationConnections.id, pending.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, SLACK_PROVIDER),
        eq(integrationConnections.status, "pending"),
      ));
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.authorization_declined",
        resourceType: "integration",
        resourceId: pending.id,
        details: { provider: SLACK_PROVIDER, connectionId: pending.id },
      });
      await releaseIntegrationSelectionIfUnused(context.organizationId, SLACK_PROVIDER);
      return returnToVanteloq(request, "declined");
    }

    const lease = await acquireSlackGrantLease(context.organizationId, pending.id, 10 * 60_000);
    try {
    await requireNoPendingSlackCleanup(context.organizationId);
    const grant = await callbackStage("token_exchange", () => exchangeSlackAuthorizationCode(code, fetch, mode));
    if (mode === "single_channel_conversations") await callbackStage("public_channel_validation", () => validateSlackPublicChannel(slackCredentialEnvelope(grant, context.userId)));
    const [alreadyAssigned] = await callbackStage("assignment_lookup", () => getDb().select({
      id: integrationConnections.id,
      organizationId: integrationConnections.organizationId,
      status: integrationConnections.status,
    }).from(integrationConnections).where(and(
      eq(integrationConnections.provider, SLACK_PROVIDER),
      eq(integrationConnections.externalAccountRef, grant.teamId),
    )).limit(1));
    if (alreadyAssigned) {
      await getDb().delete(integrationConnections).where(and(
        eq(integrationConnections.id, pending.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, SLACK_PROVIDER),
        eq(integrationConnections.status, "pending"),
      ));
      throw new ApiError(409, "SLACK_WORKSPACE_UNAVAILABLE", "This Slack workspace is already connected. Disconnect it before selecting another channel.");
    }

    const freshContext = await callbackActor(storedState);
    if (mode === "single_channel_conversations" && freshContext.role !== "owner") throw new ApiError(403, "SLACK_CONVERSATION_OWNER_REQUIRED", "The account that approved Slack conversation access must still be the workspace owner.");
    await requireIntegrationCallbackAccess(freshContext, "slack", pending.id);
    await callbackStage("grant_activation", () => activateSlackGrant(lease, pending.sourceNamespace, grant, mode === "single_channel_conversations" ? freshContext : undefined));

    await callbackStage("audit", () => recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.connected",
      resourceType: "integration_connection",
      resourceId: pending.id,
      details: {
        provider: SLACK_PROVIDER,
        connectionId: pending.id,
        teamId: grant.teamId,
        channelId: grant.channelId,
        scopes: grant.scopes.join(","),
        mode,
        readsSlackMessages: mode === "single_channel_conversations",
        accessesSlackFiles: false,
      },
    }));
    return returnToVanteloq(request, "connected");
    } finally { await releaseIntegrationSyncLease(lease); }
  });
}
