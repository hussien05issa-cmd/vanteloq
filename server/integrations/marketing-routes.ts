import { and, eq, gt, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../db";
import {
  integrationConnections,
  integrationOAuthStates,
  integrationSecrets,
  marketingDailyMetrics,
  marketingReviews,
  memberships,
  users,
  workspaces,
} from "../../db/schema";
import { recordAudit } from "../audit";
import type { AccessContext } from "../authorization";
import { requireAccess } from "../authorization";
import {
  ApiError,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
} from "../api";
import { requirePermission } from "../permissions";
import {
  acquireIntegrationSyncLease,
  releaseIntegrationSyncLease,
  requireOwnedIntegrationConnection,
} from "./connection";
import {
  buildMarketingAuthorizationUrl,
  encryptedMarketingTokens,
  exchangeMarketingAuthorizationCode,
  marketingAccessToken,
  marketingReadiness,
  marketingStateHash,
  newMarketingOAuthState,
  revokeMarketingAccess,
  syncGoogleMarketing,
  syncMetaMarketing,
  verifyMarketingIdentity,
  type MarketingProvider,
  type MarketingSyncSnapshot,
} from "./marketing";

function providerName(provider: MarketingProvider) {
  return provider === "google" ? "Google" : "Meta";
}

function returnUrl(request: Request, provider: MarketingProvider, status: "connected" | "declined" | "failed") {
  return new URL(`/?integration=${provider}&connection=${status}`, new URL(request.url).origin).toString();
}

async function requireMarketingPermissions(context: AccessContext) {
  await requirePermission(context, "integrations.manage");
  await requirePermission(context, "marketing.manage");
}

export function marketingAuthorize(request: Request, provider: MarketingProvider) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requireMarketingPermissions(context);
    await enforceRateLimit(`${provider}:marketing:authorize`, context.userId, 10, 3_600);
    const state = newMarketingOAuthState();
    const connectionId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await getDb().insert(integrationConnections).values({
      id: connectionId,
      organizationId: context.organizationId,
      provider,
      sourceNamespace: connectionId,
      status: "pending",
      externalAccountRef: null,
      externalAccountName: `New ${providerName(provider)} account`,
      apiVersion: marketingReadiness(provider).apiVersion,
      scopesJson: "[]",
      dataPromotionStatus: "blocked",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(integrationOAuthStates).values({
      stateHash: await marketingStateHash(state),
      organizationId: context.organizationId,
      actorUserId: context.userId,
      provider,
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
      resourceId: connectionId,
      details: { provider, connectionId, mode: "measurement", expiresInSeconds: 600 },
    });
    return jsonResponse({
      authorizationUrl: buildMarketingAuthorizationUrl(provider, state),
      expiresAt: expiresAt.toISOString(),
      connectionId,
      mode: "measurement",
    });
  });
}

async function callbackActor(organizationId: string, actorUserId: string): Promise<AccessContext> {
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
    eq(memberships.organizationId, organizationId),
  )).innerJoin(workspaces, eq(workspaces.id, memberships.organizationId)).where(and(
    eq(users.id, actorUserId),
    eq(users.status, "active"),
    eq(memberships.status, "active"),
  )).limit(1);
  if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
    throw new ApiError(403, "MARKETING_INITIATOR_INELIGIBLE", "The account that started this connection can no longer manage marketing integrations.");
  }
  const context: AccessContext = {
    identity: {
      email: actor.email,
      displayName: actor.displayName,
      subject: actor.authSubject,
      provider: actor.authProvider ?? "sites",
      emailVerified: true,
      assuranceLevel: null,
      sessionId: null,
    },
    userId: actor.userId,
    organizationId: actor.organizationId,
    role: actor.role,
    authSubject: actor.authSubject,
    authProvider: actor.authProvider,
    organization: actor.organization,
  };
  await requireMarketingPermissions(context);
  return context;
}

async function saveSecret(
  organizationId: string,
  provider: MarketingProvider,
  connectionId: string,
  token: Awaited<ReturnType<typeof encryptedMarketingTokens>>,
  now: Date,
) {
  const [existing] = await getDb().select({ id: integrationSecrets.id }).from(integrationSecrets).where(and(
    eq(integrationSecrets.organizationId, organizationId),
    eq(integrationSecrets.connectionId, connectionId),
    eq(integrationSecrets.provider, provider),
  )).limit(1);
  if (existing) {
    await getDb().update(integrationSecrets).set({ ...token, updatedAt: now }).where(and(
      eq(integrationSecrets.id, existing.id),
      eq(integrationSecrets.organizationId, organizationId),
    ));
    return;
  }
  await getDb().insert(integrationSecrets).values({
    id: crypto.randomUUID(),
    organizationId,
    provider,
    connectionId,
    ...token,
    createdAt: now,
    updatedAt: now,
  });
}

export function marketingCallback(request: Request, provider: MarketingProvider) {
  return handleApi(request, async ({ requestId }) => {
    const url = new URL(request.url);
    const providerError = url.searchParams.get("error");
    const code = url.searchParams.get("code")?.trim() ?? "";
    const state = url.searchParams.get("state")?.trim() ?? "";
    if ((!providerError && (!code || code.length > 2_048)) || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      throw new ApiError(400, "MARKETING_CALLBACK_INVALID", `${providerName(provider)} returned an incomplete callback.`);
    }
    const stateHash = await marketingStateHash(state);
    const now = new Date();
    const [storedState] = await getDb().select().from(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, provider),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).limit(1);
    if (!storedState) throw new ApiError(400, "MARKETING_STATE_INVALID", "The marketing authorization attempt expired or was already used. Start again.");
    const context = await callbackActor(storedState.organizationId, storedState.actorUserId);
    const [consumed] = await getDb().update(integrationOAuthStates).set({ consumedAt: now }).where(and(
      eq(integrationOAuthStates.stateHash, stateHash),
      eq(integrationOAuthStates.provider, provider),
      isNull(integrationOAuthStates.consumedAt),
      gt(integrationOAuthStates.expiresAt, now),
    )).returning({ stateHash: integrationOAuthStates.stateHash });
    if (!consumed) throw new ApiError(400, "MARKETING_STATE_INVALID", "The marketing authorization attempt expired or was already used. Start again.");
    const [pending] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
      eq(integrationConnections.id, storedState.connectionId),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, provider),
      eq(integrationConnections.status, "pending"),
    )).limit(1);
    if (!pending) throw new ApiError(409, "MARKETING_CONNECTION_MISSING", "The connection attempt is no longer available. Start again.");
    if (providerError) {
      await getDb().delete(integrationConnections).where(eq(integrationConnections.id, pending.id));
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.authorization_declined",
        resourceType: "integration",
        resourceId: pending.id,
        details: { provider, connectionId: pending.id },
      });
      return Response.redirect(returnUrl(request, provider, "declined"), 303);
    }

    let accessToken = "";
    let preserveGrant = false;
    let externalAccountRef = "";
    try {
      const token = await exchangeMarketingAuthorizationCode(provider, code);
      accessToken = token.accessToken;
      const identity = await verifyMarketingIdentity(provider, token.accessToken);
      externalAccountRef = identity.id;
      const [existing] = await getDb().select({
        id: integrationConnections.id,
        organizationId: integrationConnections.organizationId,
      }).from(integrationConnections).where(and(
        eq(integrationConnections.provider, provider),
        eq(integrationConnections.externalAccountRef, identity.id),
        eq(integrationConnections.status, "connected"),
      )).limit(1);
      // A provider account can only belong to one Vanteloq connection. Never
      // revoke a grant that an existing connection may already depend on.
      preserveGrant = Boolean(existing);
      if (existing && existing.organizationId !== context.organizationId) {
        throw new ApiError(409, "MARKETING_ACCOUNT_UNAVAILABLE", `This ${providerName(provider)} account is already assigned to another organization.`);
      }
      const encrypted = await encryptedMarketingTokens(token);
      const readiness = marketingReadiness(provider);
      if (existing) {
        await saveSecret(context.organizationId, provider, existing.id, encrypted, now);
        await getDb().update(integrationConnections).set({
          externalAccountName: identity.name,
          scopesJson: JSON.stringify(token.scopes),
          apiVersion: readiness.apiVersion,
          status: "connected",
          dataPromotionStatus: "approved",
          connectedAt: now,
          lastErrorCode: null,
          updatedAt: now,
        }).where(and(eq(integrationConnections.id, existing.id), eq(integrationConnections.organizationId, context.organizationId)));
        await getDb().delete(integrationConnections).where(and(
          eq(integrationConnections.id, pending.id),
          eq(integrationConnections.organizationId, context.organizationId),
          eq(integrationConnections.status, "pending"),
        ));
        return Response.redirect(returnUrl(request, provider, "connected"), 303);
      }
      const [connected] = await getDb().update(integrationConnections).set({
        status: "connected",
        externalAccountRef: identity.id,
        externalAccountName: identity.name,
        apiVersion: readiness.apiVersion,
        scopesJson: JSON.stringify(token.scopes),
        dataPromotionStatus: "approved",
        connectedAt: now,
        lastSuccessfulSyncAt: null,
        lastErrorCode: null,
        updatedAt: now,
      }).where(and(
        eq(integrationConnections.id, pending.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, provider),
        eq(integrationConnections.status, "pending"),
      )).returning({ id: integrationConnections.id });
      if (!connected) throw new ApiError(409, "MARKETING_CONNECTION_MISSING", "The connection attempt is no longer available. Start again.");
      await saveSecret(context.organizationId, provider, connected.id, encrypted, now);
      preserveGrant = true;
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.connected",
        resourceType: "integration",
        resourceId: connected.id,
        details: { provider, connectionId: connected.id, mode: "measurement", scopes: JSON.stringify(token.scopes) },
      });
      return Response.redirect(returnUrl(request, provider, "connected"), 303);
    } catch (error) {
      if (accessToken && externalAccountRef && !preserveGrant) {
        const [currentConnection] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
          eq(integrationConnections.provider, provider),
          eq(integrationConnections.externalAccountRef, externalAccountRef),
          eq(integrationConnections.status, "connected"),
        )).limit(1);
        preserveGrant = Boolean(currentConnection);
      }
      const providerGrantRevoked = accessToken && !preserveGrant
        ? await revokeMarketingAccess(provider, accessToken).catch(() => false)
        : null;
      const errorCode = error instanceof ApiError ? error.code : "MARKETING_CONNECTION_FAILED";
      await getDb().update(integrationConnections).set({
        status: "error",
        dataPromotionStatus: "blocked",
        connectedAt: null,
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.id, pending.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, provider),
      ));
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.connection_failed",
        resourceType: "integration",
        resourceId: pending.id,
        details: { provider, connectionId: pending.id, errorCode, providerGrantRevoked },
      });
      return Response.redirect(returnUrl(request, provider, "failed"), 303);
    }
  });
}

async function batchStatements(statements: D1PreparedStatement[]) {
  const database = getD1();
  for (let index = 0; index < statements.length; index += 100) {
    await database.batch(statements.slice(index, index + 100));
  }
}

async function persistSnapshot(
  organizationId: string,
  connectionId: string,
  provider: MarketingProvider,
  snapshot: MarketingSyncSnapshot,
) {
  const database = getD1();
  const now = Math.floor(Date.now() / 1_000);
  const metricStatements = snapshot.metrics.map((row) => database.prepare(`
    INSERT INTO marketing_daily_metrics (
      id, organization_id, connection_id, provider, resource_ref, metric_date,
      metric_key, value_milli, source_event_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_id, source_event_id) DO UPDATE SET
      resource_ref = excluded.resource_ref,
      metric_date = excluded.metric_date,
      metric_key = excluded.metric_key,
      value_milli = excluded.value_milli,
      updated_at = excluded.updated_at
  `).bind(
    crypto.randomUUID(), organizationId, connectionId, provider, row.resourceRef,
    row.metricDate, row.metricKey, row.valueMilli, row.sourceEventId, now, now,
  ));
  await batchStatements(metricStatements);
  if (provider === "google") {
    const reviewStatements = snapshot.reviews.map((row) => database.prepare(`
      INSERT INTO marketing_reviews (
        id, organization_id, connection_id, provider, external_location_ref,
        external_review_ref, rating_milli, comment, reviewed_at,
        source_updated_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'google', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id, external_review_ref) DO UPDATE SET
        external_location_ref = excluded.external_location_ref,
        rating_milli = excluded.rating_milli,
        comment = excluded.comment,
        reviewed_at = excluded.reviewed_at,
        source_updated_at = excluded.source_updated_at,
        updated_at = excluded.updated_at
    `).bind(
      crypto.randomUUID(), organizationId, connectionId, row.externalLocationRef,
      row.externalReviewRef, row.ratingMilli, row.comment, row.reviewedAt,
      row.sourceUpdatedAt, now, now,
    ));
    await batchStatements(reviewStatements);
  }
}

export function marketingSync(request: Request, provider: MarketingProvider) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requireMarketingPermissions(context);
    await enforceRateLimit(`${provider}:marketing:sync`, context.organizationId, 20, 3_600);
    const body = await readJsonObject(request, 8_192);
    const requestedConnectionId = typeof body.connectionId === "string" ? body.connectionId : null;
    const connection = await requireOwnedIntegrationConnection(context.organizationId, provider, requestedConnectionId, { connected: true });
    const lease = await acquireIntegrationSyncLease(context.organizationId, provider, connection.id, 20 * 60_000);
    if (!lease) throw new ApiError(409, "MARKETING_SYNC_IN_PROGRESS", `A ${providerName(provider)} synchronization is already in progress.`);
    try {
      const accessToken = await marketingAccessToken(context.organizationId, connection.id, provider);
      const snapshot = provider === "google" ? await syncGoogleMarketing(accessToken) : await syncMetaMarketing(accessToken);
      await persistSnapshot(context.organizationId, connection.id, provider, snapshot);
      const completedAt = new Date();
      await getDb().update(integrationConnections).set({
        status: "connected",
        dataPromotionStatus: "approved",
        lastSuccessfulSyncAt: completedAt,
        lastErrorCode: null,
        updatedAt: completedAt,
      }).where(and(
        eq(integrationConnections.id, connection.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, provider),
        eq(integrationConnections.syncLeaseOwner, lease.owner),
        eq(integrationConnections.syncVersion, lease.version),
      ));
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.sync_completed",
        resourceType: "integration",
        resourceId: connection.id,
        details: {
          provider,
          connectionId: connection.id,
          metricCount: snapshot.metrics.length,
          reviewCount: snapshot.reviews.length,
          resourcesRead: snapshot.resourcesRead,
          warningCodes: JSON.stringify(snapshot.warnings),
        },
      });
      await releaseIntegrationSyncLease(lease);
      return jsonResponse({
        run: {
          recordsRead: snapshot.metrics.length + snapshot.reviews.length,
          recordsImported: snapshot.metrics.length + snapshot.reviews.length,
          warningCount: snapshot.warnings.length,
        },
        metrics: snapshot.metrics.length,
        reviews: snapshot.reviews.length,
        resources: snapshot.resourcesRead,
        warnings: snapshot.warnings,
        nextStep: `${providerName(provider)} measurements are current in Marketing.`,
      });
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "MARKETING_SYNC_FAILED";
      await getDb().update(integrationConnections).set({
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.id, connection.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.syncLeaseOwner, lease.owner),
        eq(integrationConnections.syncVersion, lease.version),
      ));
      await releaseIntegrationSyncLease(lease);
      throw error;
    }
  });
}

export function marketingDisconnect(request: Request, provider: MarketingProvider) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requireMarketingPermissions(context);
    await enforceRateLimit(`${provider}:marketing:disconnect`, context.userId, 20, 3_600);
    const body = await readJsonObject(request, 8_192);
    const requestedConnectionId = typeof body.connectionId === "string" ? body.connectionId : null;
    const connection = await requireOwnedIntegrationConnection(context.organizationId, provider, requestedConnectionId, { connected: true });
    if (connection.syncLeaseOwner) throw new ApiError(409, "MARKETING_SYNC_IN_PROGRESS", "Wait for the current synchronization to finish before disconnecting.");
    const accessToken = await marketingAccessToken(context.organizationId, connection.id, provider);
    if (!await revokeMarketingAccess(provider, accessToken)) {
      throw new ApiError(502, "MARKETING_REVOCATION_FAILED", `${providerName(provider)} access could not be revoked. Try again before removing the local connection.`);
    }
    const deletedAt = new Date();
    await getDb().delete(marketingDailyMetrics).where(and(
      eq(marketingDailyMetrics.organizationId, context.organizationId),
      eq(marketingDailyMetrics.connectionId, connection.id),
    ));
    if (provider === "google") {
      await getDb().delete(marketingReviews).where(and(
        eq(marketingReviews.organizationId, context.organizationId),
        eq(marketingReviews.connectionId, connection.id),
      ));
    }
    await getDb().delete(integrationSecrets).where(and(
      eq(integrationSecrets.organizationId, context.organizationId),
      eq(integrationSecrets.connectionId, connection.id),
      eq(integrationSecrets.provider, provider),
    ));
    await getDb().delete(integrationOAuthStates).where(and(
      eq(integrationOAuthStates.organizationId, context.organizationId),
      eq(integrationOAuthStates.connectionId, connection.id),
      eq(integrationOAuthStates.provider, provider),
    ));
    await getDb().update(integrationConnections).set({
      status: "revoked",
      dataPromotionStatus: "blocked",
      lastSuccessfulSyncAt: null,
      lastSyncCursor: null,
      lastErrorCode: null,
      privacyDataDeletedAt: deletedAt,
      updatedAt: deletedAt,
    }).where(and(
      eq(integrationConnections.id, connection.id),
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, provider),
    ));
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.disconnected",
      resourceType: "integration",
      resourceId: connection.id,
      details: { provider, connectionId: connection.id, importedMarketingDataDeleted: true },
    });
    return jsonResponse({ disconnected: true, connectionId: connection.id, provider });
  });
}
