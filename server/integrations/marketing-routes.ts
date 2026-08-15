import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getD1, getDb } from "../../db";
import {
  integrationConnections,
  integrationOAuthStates,
  integrationSecrets,
  integrationSyncRuns,
  marketingResourceSelections,
  memberships,
  organizationLocations,
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
  renewIntegrationSyncLease,
  requireOwnedIntegrationConnection,
} from "./connection";
import {
  buildMarketingAuthorizationUrl,
  discoverGoogleMarketingResources,
  discoverMetaMarketingResources,
  encryptedMarketingTokens,
  exchangeMarketingAuthorizationCode,
  marketingAccessToken,
  marketingReadiness,
  marketingStateHash,
  fetchGoogleBusinessReviews,
  fetchMetaCampaignDirectory,
  newMarketingOAuthState,
  revokeMarketingAccess,
  storedMarketingAccessToken,
  syncGoogleMarketing,
  syncMetaMarketing,
  publishGoogleBusinessReviewReply,
  updateMetaCampaign,
  verifyMarketingIdentity,
  type MarketingProvider,
  type MarketingDataset,
  type SelectedMarketingResource,
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
        const reauthorizationLease = await acquireIntegrationSyncLease(context.organizationId, provider, existing.id, 10 * 60_000);
        if (!reauthorizationLease) throw new ApiError(409, "MARKETING_SYNC_IN_PROGRESS", "Wait for the current synchronization before reauthorizing this account.");
        try {
          const [staged] = await getDb().update(integrationConnections).set({
            externalAccountName: identity.name,
            scopesJson: JSON.stringify(token.scopes),
            apiVersion: readiness.apiVersion,
            status: "connected",
            dataPromotionStatus: "staging",
            connectedAt: now,
            lastSuccessfulSyncAt: null,
            promotionAuthorizedAt: null,
            lastSyncCursor: null,
            lastErrorCode: null,
            resourceSelectionVersion: sql`${integrationConnections.resourceSelectionVersion} + 1`,
            updatedAt: now,
          }).where(and(
            eq(integrationConnections.id, existing.id),
            eq(integrationConnections.organizationId, context.organizationId),
            eq(integrationConnections.provider, provider),
            eq(integrationConnections.syncLeaseOwner, reauthorizationLease.owner),
            eq(integrationConnections.syncVersion, reauthorizationLease.version),
          )).returning({ id: integrationConnections.id });
          if (!staged) throw new ApiError(409, "MARKETING_CONNECTION_CHANGED", "The account changed before reauthorization could be saved.");
          await saveSecret(context.organizationId, provider, existing.id, encrypted, now);
          await getDb().delete(integrationConnections).where(and(
            eq(integrationConnections.id, pending.id),
            eq(integrationConnections.organizationId, context.organizationId),
            eq(integrationConnections.status, "pending"),
          ));
        } finally {
          await releaseIntegrationSyncLease(reauthorizationLease);
        }
        return Response.redirect(returnUrl(request, provider, "connected"), 303);
      }
      const [connected] = await getDb().update(integrationConnections).set({
        status: "connected",
        externalAccountRef: identity.id,
        externalAccountName: identity.name,
        apiVersion: readiness.apiVersion,
        scopesJson: JSON.stringify(token.scopes),
        dataPromotionStatus: "staging",
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

const providerDatasets: Record<MarketingProvider, readonly MarketingDataset[]> = {
  google: ["google_analytics", "google_search_console", "google_business_profile", "google_ads"],
  meta: ["meta_ads"],
};

async function discoverResources(provider: MarketingProvider, accessToken: string) {
  return provider === "google"
    ? discoverGoogleMarketingResources(accessToken)
    : discoverMetaMarketingResources(accessToken);
}

export function marketingResources(request: Request, provider: MarketingProvider) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requireMarketingPermissions(context);
    await enforceRateLimit(`${provider}:marketing:resources`, context.organizationId, 30, 3_600);
    const body = await readJsonObject(request, 65_536);
    const requestedConnectionId = typeof body.connectionId === "string" ? body.connectionId : null;
    const connection = await requireOwnedIntegrationConnection(context.organizationId, provider, requestedConnectionId, { connected: true });
    const locations = await getDb().select({
      id: organizationLocations.id,
      name: organizationLocations.name,
    }).from(organizationLocations).where(and(
      eq(organizationLocations.organizationId, context.organizationId),
      eq(organizationLocations.status, "active"),
    ));
    const existing = await getDb().select().from(marketingResourceSelections).where(and(
      eq(marketingResourceSelections.organizationId, context.organizationId),
      eq(marketingResourceSelections.connectionId, connection.id),
      eq(marketingResourceSelections.provider, provider),
    ));
    const accessToken = await marketingAccessToken(context.organizationId, connection.id, provider);
    const discovered = await discoverResources(provider, accessToken);

    if (body.action === "discover") {
      const selectedByKey = new Map(existing.map((selection) => [
        `${selection.dataset}\u0000${selection.externalResourceRef}`,
        selection,
      ]));
      return jsonResponse({
        connectionId: connection.id,
        provider,
        selectionVersion: connection.resourceSelectionVersion,
        datasets: providerDatasets[provider].map((dataset) => ({
          dataset,
          resources: discovered.filter((resource) => resource.dataset === dataset).map((resource) => {
            const selected = selectedByKey.get(`${resource.dataset}\u0000${resource.externalResourceRef}`);
            return {
              ...resource,
              selected: Boolean(selected),
              scopeKind: selected?.scopeKind ?? null,
              localLocationId: selected?.localLocationId ?? null,
            };
          }),
        })),
        selections: existing.map((selection) => ({
          id: selection.id,
          dataset: selection.dataset,
          externalResourceRef: selection.externalResourceRef,
          name: selection.externalResourceName,
          scopeKind: selection.scopeKind,
          localLocationId: selection.localLocationId,
        })),
        locations,
      });
    }

    if (body.action !== "replace" || !Number.isInteger(body.expectedSelectionVersion) || !Array.isArray(body.selections)) {
      throw new ApiError(400, "MARKETING_SELECTION_INVALID", "Discover resources, then submit the exact resources and scopes to select.");
    }
    if (body.selections.length > 100) throw new ApiError(400, "MARKETING_SELECTION_LIMIT", "Select no more than 100 marketing resources per account.");
    if (body.expectedSelectionVersion !== connection.resourceSelectionVersion) {
      throw new ApiError(409, "MARKETING_SELECTION_CHANGED", "The resource selection changed. Refresh the resource list and try again.");
    }
    const discoveredByKey = new Map(discovered.map((resource) => [
      `${resource.dataset}\u0000${resource.externalResourceRef}`,
      resource,
    ]));
    const locationIds = new Set(locations.map((location) => location.id));
    const selectedKeys = new Set<string>();
    const replacements: Array<{
      id: string;
      dataset: MarketingDataset;
      externalResourceRef: string;
      externalResourceName: string;
      scopeKind: "organization" | "location";
      localLocationId: string | null;
    }> = [];
    for (const raw of body.selections) {
      if (!raw || typeof raw !== "object") throw new ApiError(400, "MARKETING_SELECTION_INVALID", "Every resource selection must include a discovered resource and scope.");
      const item = raw as Record<string, unknown>;
      if (typeof item.dataset !== "string" || !providerDatasets[provider].includes(item.dataset as MarketingDataset) || typeof item.externalResourceRef !== "string") {
        throw new ApiError(400, "MARKETING_SELECTION_INVALID", "A selected resource does not belong to this provider.");
      }
      const dataset = item.dataset as MarketingDataset;
      const externalResourceRef = item.externalResourceRef.trim();
      const key = `${dataset}\u0000${externalResourceRef}`;
      const canonical = discoveredByKey.get(key);
      if (!canonical) throw new ApiError(409, "MARKETING_RESOURCE_UNAVAILABLE", "A selected resource is no longer available to this provider account.");
      if (selectedKeys.has(key)) throw new ApiError(400, "MARKETING_SELECTION_DUPLICATE", "Each provider resource can be selected only once.");
      selectedKeys.add(key);
      const scopeKind = item.scopeKind === "organization" || item.scopeKind === "location" ? item.scopeKind : null;
      const localLocationId = typeof item.localLocationId === "string" ? item.localLocationId : null;
      if (!scopeKind || (scopeKind === "organization" && localLocationId !== null) || (scopeKind === "location" && (!localLocationId || !locationIds.has(localLocationId)))) {
        throw new ApiError(400, "MARKETING_SELECTION_SCOPE_INVALID", "Choose either the organization or one accessible active location for each resource.");
      }
      replacements.push({
        id: crypto.randomUUID(),
        dataset,
        externalResourceRef: canonical.externalResourceRef,
        externalResourceName: canonical.name,
        scopeKind,
        localLocationId,
      });
    }

    const lease = await acquireIntegrationSyncLease(context.organizationId, provider, connection.id, 10 * 60_000);
    if (!lease) throw new ApiError(409, "MARKETING_SYNC_IN_PROGRESS", "Wait for the current synchronization or selection update to finish.");
    try {
      const database = getD1();
      const now = Math.floor(Date.now() / 1_000);
      const fresh = await database.prepare(`SELECT resource_selection_version selectionVersion
        FROM integration_connections
        WHERE id = ? AND organization_id = ? AND provider = ? AND sync_lease_owner = ? AND sync_version = ?`)
        .bind(connection.id, context.organizationId, provider, lease.owner, lease.version)
        .first<{ selectionVersion: number }>();
      if (!fresh || Number(fresh.selectionVersion) !== body.expectedSelectionVersion) {
        throw new ApiError(409, "MARKETING_SELECTION_CHANGED", "The resource selection changed. Refresh the resource list and try again.");
      }
      const statements: D1PreparedStatement[] = [
        database.prepare(`INSERT INTO integration_connections (id)
          SELECT ?
          WHERE NOT EXISTS (
            SELECT 1 FROM integration_connections
            WHERE id = ? AND organization_id = ? AND provider = ? AND status = 'connected'
              AND sync_lease_owner = ? AND sync_version = ? AND resource_selection_version = ?
          )`).bind(
            connection.id, connection.id, context.organizationId, provider,
            lease.owner, lease.version, body.expectedSelectionVersion,
          ),
        database.prepare(`DELETE FROM marketing_daily_metrics WHERE resource_selection_id IN (
          SELECT id FROM marketing_resource_selections WHERE organization_id = ? AND connection_id = ? AND provider = ?
        )`).bind(context.organizationId, connection.id, provider),
        database.prepare(`DELETE FROM marketing_resource_selections WHERE organization_id = ? AND connection_id = ? AND provider = ?`)
          .bind(context.organizationId, connection.id, provider),
        ...replacements.map((selection) => database.prepare(`INSERT INTO marketing_resource_selections (
          id, organization_id, connection_id, provider, dataset, external_resource_ref,
          external_resource_name, scope_kind, local_location_id, selected_by_user_id,
          selected_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            selection.id, context.organizationId, connection.id, provider, selection.dataset,
            selection.externalResourceRef, selection.externalResourceName, selection.scopeKind,
            selection.localLocationId, context.userId, now, now, now,
          )),
        database.prepare(`UPDATE integration_connections
          SET resource_selection_version = resource_selection_version + 1,
              data_promotion_status = 'staging', last_successful_sync_at = NULL,
              last_error_code = NULL, updated_at = ?
          WHERE id = ? AND organization_id = ? AND provider = ?
            AND sync_lease_owner = ? AND sync_version = ? AND resource_selection_version = ?`)
          .bind(now, connection.id, context.organizationId, provider, lease.owner, lease.version, body.expectedSelectionVersion),
      ];
      let results: D1Result<unknown>[];
      try {
        results = await database.batch(statements);
      } catch (error) {
        const stillOwned = await database.prepare(`SELECT id FROM integration_connections
          WHERE id = ? AND organization_id = ? AND provider = ? AND status = 'connected'
            AND sync_lease_owner = ? AND sync_version = ? AND resource_selection_version = ?`)
          .bind(
            connection.id, context.organizationId, provider,
            lease.owner, lease.version, body.expectedSelectionVersion,
          )
          .first<{ id: string }>();
        if (!stillOwned) throw new ApiError(409, "MARKETING_SELECTION_CHANGED", "The resource selection changed before it could be saved.");
        throw error;
      }
      if (Number(results.at(-1)?.meta.changes ?? 0) !== 1) throw new ApiError(409, "MARKETING_SELECTION_CHANGED", "The resource selection changed before it could be saved.");
      await recordAudit({
        request,
        requestId,
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "integration.marketing_resources_selected",
        resourceType: "integration_connection",
        resourceId: connection.id,
        details: {
          provider,
          connectionId: connection.id,
          selectionVersion: connection.resourceSelectionVersion + 1,
          selectedResourceCount: replacements.length,
          resourcesJson: JSON.stringify(replacements.map((selection) => ({
            selectionId: selection.id,
            dataset: selection.dataset,
            scopeKind: selection.scopeKind,
          }))),
        },
      });
      return jsonResponse({
        connectionId: connection.id,
        provider,
        selectionVersion: connection.resourceSelectionVersion + 1,
        dataPromotionStatus: "staging",
        syncEligible: replacements.length > 0,
        selections: replacements.map((selection) => ({
          id: selection.id,
          dataset: selection.dataset,
          externalResourceRef: selection.externalResourceRef,
          name: selection.externalResourceName,
          scopeKind: selection.scopeKind,
          localLocationId: selection.localLocationId,
        })),
      });
    } finally {
      await releaseIntegrationSyncLease(lease);
    }
  });
}

async function persistSnapshot(
  snapshot: MarketingSyncSnapshot,
  input: { organizationId: string; connectionId: string; provider: MarketingProvider; mode: "sample" | "incremental" },
) {
  const database = getD1();
  const now = Math.floor(Date.now() / 1_000);
  const metricStatements = [
    ...(input.mode === "sample" ? [database.prepare(`
      DELETE FROM marketing_daily_metrics
      WHERE resource_selection_id IN (
        SELECT id FROM marketing_resource_selections
        WHERE organization_id = ? AND connection_id = ? AND provider = ?
      )
    `).bind(input.organizationId, input.connectionId, input.provider)] : []),
    ...snapshot.metrics.map((row) => database.prepare(`
    INSERT INTO marketing_daily_metrics (
      id, resource_selection_id, metric_date, metric_key, value_milli,
      source_event_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(resource_selection_id, source_event_id) DO UPDATE SET
      metric_date = excluded.metric_date,
      metric_key = excluded.metric_key,
      value_milli = excluded.value_milli,
      updated_at = excluded.updated_at
    `).bind(
    crypto.randomUUID(), row.resourceSelectionId, row.metricDate, row.metricKey,
    row.valueMilli, row.sourceEventId, now, now,
    )),
  ];
  await batchStatements(metricStatements);
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
    const mode = body.mode === "sample" || body.mode === "incremental" ? body.mode : null;
    const expectedSelectionVersion = Number.isInteger(body.expectedSelectionVersion) ? Number(body.expectedSelectionVersion) : null;
    if (!mode || expectedSelectionVersion === null) throw new ApiError(400, "MARKETING_SYNC_REQUEST_INVALID", "Choose sample or incremental sync and include the current resource-selection version.");
    if (expectedSelectionVersion !== connection.resourceSelectionVersion) throw new ApiError(409, "MARKETING_SELECTION_CHANGED", "The selected resources changed. Refresh and try again.");
    if (mode === "sample" && connection.dataPromotionStatus !== "staging") throw new ApiError(409, "MARKETING_SAMPLE_UNAVAILABLE", "Sample sync is available while selected resources are staged for review.");
    if (mode === "incremental" && connection.dataPromotionStatus !== "approved") throw new ApiError(409, "MARKETING_APPROVAL_REQUIRED", "Approve a warning-free sample before incremental synchronization.");
    const lease = await acquireIntegrationSyncLease(context.organizationId, provider, connection.id, 20 * 60_000);
    if (!lease) throw new ApiError(409, "MARKETING_SYNC_IN_PROGRESS", `A ${providerName(provider)} synchronization is already in progress.`);
    const runId = crypto.randomUUID();
    const startedAt = new Date();
    try {
      const fresh = await getD1().prepare(`SELECT resource_selection_version selectionVersion, data_promotion_status promotionStatus
        FROM integration_connections
        WHERE id = ? AND organization_id = ? AND provider = ? AND sync_lease_owner = ? AND sync_version = ?`)
        .bind(connection.id, context.organizationId, provider, lease.owner, lease.version)
        .first<{ selectionVersion: number; promotionStatus: string }>();
      if (!fresh || Number(fresh.selectionVersion) !== expectedSelectionVersion) throw new ApiError(409, "MARKETING_SELECTION_CHANGED", "The selected resources changed before synchronization began.");
      const selectionRows = await getDb().select().from(marketingResourceSelections).where(and(
        eq(marketingResourceSelections.organizationId, context.organizationId),
        eq(marketingResourceSelections.connectionId, connection.id),
        eq(marketingResourceSelections.provider, provider),
      ));
      const selections: SelectedMarketingResource[] = selectionRows.map((selection) => ({
        id: selection.id,
        provider: selection.provider,
        dataset: selection.dataset,
        externalResourceRef: selection.externalResourceRef,
        scopeKind: selection.scopeKind,
        localLocationId: selection.localLocationId,
      }));
      if (!selections.length) throw new ApiError(409, "MARKETING_RESOURCE_SELECTION_REQUIRED", `Choose the exact ${providerName(provider)} resources and scopes before synchronization.`);
      await getDb().insert(integrationSyncRuns).values({
        id: runId,
        organizationId: context.organizationId,
        provider,
        connectionId: connection.id,
        mode,
        status: "running",
        resourceSelectionVersion: expectedSelectionVersion,
        startedAt,
        createdByUserId: context.userId,
      });
      const accessToken = await marketingAccessToken(context.organizationId, connection.id, provider);
      const snapshot = provider === "google"
        ? await syncGoogleMarketing(accessToken, selections)
        : await syncMetaMarketing(accessToken, selections);
      const selectedIds = new Set(selections.map((selection) => selection.id));
      const metricCounts = new Map<string, number>();
      for (const metric of snapshot.metrics) {
        if (!selectedIds.has(metric.resourceSelectionId)) {
          throw new ApiError(502, "MARKETING_RESOURCE_MISMATCH", `${providerName(provider)} returned measurements for an unselected resource.`);
        }
        metricCounts.set(metric.resourceSelectionId, (metricCounts.get(metric.resourceSelectionId) ?? 0) + 1);
      }
      const providerResults = new Map<string, MarketingSyncSnapshot["resourceResults"][number]>();
      for (const result of snapshot.resourceResults) {
        if (!selectedIds.has(result.resourceSelectionId) || providerResults.has(result.resourceSelectionId)) {
          throw new ApiError(502, "MARKETING_RESOURCE_MISMATCH", `${providerName(provider)} returned inconsistent resource evidence.`);
        }
        providerResults.set(result.resourceSelectionId, result);
      }
      const resourceResults = selections.map((selection) => {
        const recordsRead = metricCounts.get(selection.id) ?? 0;
        const providerResult = providerResults.get(selection.id);
        return {
          resourceSelectionId: selection.id,
          recordsRead,
          warningCodes: [...new Set([
            ...(providerResult?.warningCodes ?? []),
            ...(recordsRead === 0 ? ["NO_MEASUREMENTS_RETURNED"] : []),
          ])],
        };
      });
      const warnings = [...new Set([
        ...snapshot.warnings,
        ...resourceResults.flatMap((result) => result.warningCodes),
      ])];
      const normalizedSnapshot: MarketingSyncSnapshot = { ...snapshot, resourceResults };
      if (mode === "incremental" && warnings.length) {
        await getDb().update(integrationSyncRuns).set({
          recordsRead: snapshot.metrics.length,
          recordsStaged: 0,
          warningCount: warnings.length,
        }).where(and(
          eq(integrationSyncRuns.id, runId),
          eq(integrationSyncRuns.organizationId, context.organizationId),
          eq(integrationSyncRuns.connectionId, connection.id),
        ));
        throw new ApiError(409, "MARKETING_PARTIAL_SYNC", `${providerName(provider)} returned an incomplete refresh. Existing approved measurements were preserved.`);
      }
      const leaseRenewed = await renewIntegrationSyncLease(lease, 20 * 60_000);
      if (!leaseRenewed) throw new ApiError(409, "MARKETING_SYNC_LEASE_LOST", "The marketing synchronization lease expired before the replacement snapshot could be saved.");
      await persistSnapshot(normalizedSnapshot, {
        organizationId: context.organizationId,
        connectionId: connection.id,
        provider,
        mode,
      });
      const completedAt = new Date();
      await getDb().update(integrationSyncRuns).set({
        status: "completed",
        recordsRead: snapshot.metrics.length,
        recordsStaged: snapshot.metrics.length,
        warningCount: warnings.length,
        errorCode: null,
        completedAt,
      }).where(and(
        eq(integrationSyncRuns.id, runId),
        eq(integrationSyncRuns.organizationId, context.organizationId),
        eq(integrationSyncRuns.connectionId, connection.id),
      ));
      const [published] = await getDb().update(integrationConnections).set({
        status: "connected",
        dataPromotionStatus: mode === "sample" ? "staging" : "approved",
        lastSuccessfulSyncAt: completedAt,
        lastErrorCode: warnings.length ? "MARKETING_SAMPLE_WARNINGS" : null,
        updatedAt: completedAt,
      }).where(and(
        eq(integrationConnections.id, connection.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, provider),
        eq(integrationConnections.syncLeaseOwner, lease.owner),
        eq(integrationConnections.syncVersion, lease.version),
        eq(integrationConnections.resourceSelectionVersion, expectedSelectionVersion),
      )).returning({ id: integrationConnections.id });
      if (!published) throw new ApiError(409, "MARKETING_SELECTION_CHANGED", "The selected resources changed before synchronization could be published.");
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
          resourcesRead: snapshot.resourcesRead,
          warningCodes: JSON.stringify(warnings),
          mode,
          selectionVersion: expectedSelectionVersion,
          runId,
        },
      });
      return jsonResponse({
        run: {
          id: runId,
          mode,
          selectionVersion: expectedSelectionVersion,
          recordsRead: snapshot.metrics.length,
          recordsImported: snapshot.metrics.length,
          warningCount: warnings.length,
        },
        metrics: snapshot.metrics.length,
        resources: snapshot.resourcesRead,
        warnings,
        resourceResults,
        nextStep: mode === "sample"
          ? warnings.length
            ? `${providerName(provider)} remains staged because the sample completed with warnings.`
            : `Review this exact-resource sample before making ${providerName(provider)} measurements available.`
          : `${providerName(provider)} measurements were refreshed from the approved resources.`,
      });
    } catch (error) {
      const errorCode = error instanceof ApiError ? error.code : "MARKETING_SYNC_FAILED";
      await getDb().update(integrationSyncRuns).set({
        status: "failed",
        errorCode,
        completedAt: new Date(),
      }).where(and(
        eq(integrationSyncRuns.id, runId),
        eq(integrationSyncRuns.organizationId, context.organizationId),
        eq(integrationSyncRuns.connectionId, connection.id),
      ));
      await getDb().update(integrationConnections).set({
        lastErrorCode: errorCode,
        updatedAt: new Date(),
      }).where(and(
        eq(integrationConnections.id, connection.id),
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.syncLeaseOwner, lease.owner),
        eq(integrationConnections.syncVersion, lease.version),
      ));
      throw error;
    } finally {
      await releaseIntegrationSyncLease(lease);
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
    const accessToken = await (async () => {
      try {
        return await storedMarketingAccessToken(context.organizationId, connection.id, provider);
      } catch {
        return null;
      }
    })();
    const deletedAt = new Date();
    const deletedAtSeconds = Math.floor(deletedAt.getTime() / 1_000);
    const database = getD1();
    await database.batch([
      database.prepare(`
        DELETE FROM marketing_daily_metrics
        WHERE resource_selection_id IN (
          SELECT id FROM marketing_resource_selections
          WHERE organization_id = ? AND connection_id = ? AND provider = ?
        )
      `).bind(context.organizationId, connection.id, provider),
      database.prepare(`
        DELETE FROM marketing_resource_selections
        WHERE organization_id = ? AND connection_id = ? AND provider = ?
      `).bind(context.organizationId, connection.id, provider),
      database.prepare(`
        DELETE FROM integration_secrets
        WHERE organization_id = ? AND connection_id = ? AND provider = ?
      `).bind(context.organizationId, connection.id, provider),
      database.prepare(`
        DELETE FROM integration_oauth_states
        WHERE organization_id = ? AND connection_id = ? AND provider = ?
      `).bind(context.organizationId, connection.id, provider),
      database.prepare(`
        UPDATE integration_connections
        SET status = 'revoked', data_promotion_status = 'blocked',
            last_successful_sync_at = NULL, last_sync_cursor = NULL,
            last_error_code = NULL, privacy_data_deleted_at = ?, updated_at = ?,
            external_account_ref = NULL, external_account_name = NULL,
            domain_prefix = NULL, api_version = NULL, scopes_json = '[]',
            promotion_authorized_at = NULL, connected_at = NULL,
            sync_lease_owner = NULL, sync_lease_expires_at = NULL,
            sync_version = sync_version + 1,
            resource_selection_version = resource_selection_version + 1
        WHERE id = ? AND organization_id = ? AND provider = ?
      `).bind(deletedAtSeconds, deletedAtSeconds, connection.id, context.organizationId, provider),
    ]);
    const providerRevoked = accessToken ? await revokeMarketingAccess(provider, accessToken).catch(() => false) : false;
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "integration.disconnected",
      resourceType: "integration",
      resourceId: connection.id,
      details: { provider, connectionId: connection.id, importedMarketingDataDeleted: true, providerRevoked },
    });
    return jsonResponse({
      disconnected: true,
      connectionId: connection.id,
      provider,
      providerRevoked,
      nextStep: providerRevoked ? null : `Local access was removed. Revoke Vanteloq in your ${providerName(provider)} account settings to finish provider-side disconnection.`,
    });
  });
}

async function requireBusinessProfileSelection(organizationId: string, selectionId: string) {
  const [selection] = await getDb().select().from(marketingResourceSelections).where(and(
    eq(marketingResourceSelections.id, selectionId),
    eq(marketingResourceSelections.organizationId, organizationId),
    eq(marketingResourceSelections.provider, "google"),
    eq(marketingResourceSelections.dataset, "google_business_profile"),
  )).limit(1);
  if (!selection) throw new ApiError(404, "GOOGLE_BUSINESS_SELECTION_NOT_FOUND", "The selected Google Business Profile location was not found.");
  await requireOwnedIntegrationConnection(organizationId, "google", selection.connectionId, { connected: true });
  return selection;
}

async function requireMetaAdSelection(organizationId: string, selectionId: string) {
  const [selection] = await getDb().select().from(marketingResourceSelections).where(and(
    eq(marketingResourceSelections.id, selectionId),
    eq(marketingResourceSelections.organizationId, organizationId),
    eq(marketingResourceSelections.provider, "meta"),
    eq(marketingResourceSelections.dataset, "meta_ads"),
  )).limit(1);
  if (!selection) throw new ApiError(404, "META_AD_SELECTION_NOT_FOUND", "The selected Meta advertising account was not found.");
  await requireOwnedIntegrationConnection(organizationId, "meta", selection.connectionId, { connected: true });
  return selection;
}

export function metaCampaigns(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requirePermission(context, "marketing.view");
    const url = new URL(request.url);
    const selectionId = (request.method === "GET" ? url.searchParams.get("selectionId") : null)?.trim() ?? "";

    if (request.method === "GET") {
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(selectionId)) throw new ApiError(400, "META_AD_SELECTION_INVALID", "Choose a valid Meta advertising account.");
      await enforceRateLimit("meta:campaigns:read", context.organizationId, 60, 60);
      const selection = await requireMetaAdSelection(context.organizationId, selectionId);
      const accessToken = await marketingAccessToken(context.organizationId, selection.connectionId, "meta");
      const directory = await fetchMetaCampaignDirectory(accessToken, selection.externalResourceRef);
      return jsonResponse({ ...directory, selectionId, fetchedAt: new Date().toISOString(), storage: "not_persisted" });
    }

    if (request.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET to review campaigns or POST to apply one confirmed campaign change.");
    requireSameOrigin(request);
    await requirePermission(context, "marketing.manage");
    await enforceRateLimit("meta:campaigns:change", context.userId, 20, 3_600);
    const body = await readJsonObject(request, 16_384);
    const postedSelectionId = typeof body.selectionId === "string" ? body.selectionId.trim() : "";
    const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";
    const expectedCampaignName = typeof body.expectedCampaignName === "string" ? body.expectedCampaignName.trim() : "";
    if (body.confirmChange !== true) throw new ApiError(400, "META_CAMPAIGN_CONFIRMATION_REQUIRED", "Confirm this exact campaign change before sending it to Meta.");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(postedSelectionId)) throw new ApiError(400, "META_AD_SELECTION_INVALID", "Choose a valid Meta advertising account.");
    const selection = await requireMetaAdSelection(context.organizationId, postedSelectionId);
    const accessToken = await marketingAccessToken(context.organizationId, selection.connectionId, "meta");
    const status = body.action === "set_status" && (body.status === "ACTIVE" || body.status === "PAUSED") ? body.status : undefined;
    const dailyBudgetMinor = body.action === "set_daily_budget" && Number.isSafeInteger(body.dailyBudgetMinor) ? Number(body.dailyBudgetMinor) : undefined;
    if (!status && dailyBudgetMinor === undefined) throw new ApiError(400, "META_CAMPAIGN_ACTION_INVALID", "Choose pause, resume, or a supported daily-budget change.");
    const result = await updateMetaCampaign({ accessToken, adAccountRef: selection.externalResourceRef, campaignId, expectedCampaignName, status, dailyBudgetMinor });
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: status ? "meta_ads.campaign_status_changed" : "meta_ads.campaign_budget_changed",
      resourceType: "meta_campaign",
      resourceId: campaignId,
      details: {
        selectionId: postedSelectionId,
        connectionId: selection.connectionId,
        campaignName: expectedCampaignName,
        confirmed: true,
        status: result.status,
        dailyBudgetMinor: result.dailyBudgetMinor,
        previousStatus: result.previousStatus,
        previousDailyBudgetMinor: result.previousDailyBudgetMinor,
      },
    });
    return jsonResponse({ applied: true, ...result, appliedAt: new Date().toISOString() });
  });
}

export function googleBusinessReviews(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requirePermission(context, "marketing.view");
    const url = new URL(request.url);
    const selectionId = url.searchParams.get("selectionId")?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(selectionId)) throw new ApiError(400, "GOOGLE_BUSINESS_SELECTION_INVALID", "Choose a valid Business Profile location.");
    const selection = await requireBusinessProfileSelection(context.organizationId, selectionId);
    const accessToken = await marketingAccessToken(context.organizationId, selection.connectionId, "google");

    if (request.method === "GET") {
      await enforceRateLimit("google:business-reviews:read", context.organizationId, 60, 60);
      const result = await fetchGoogleBusinessReviews(accessToken, selection.externalResourceRef, url.searchParams.get("pageToken")?.trim() ?? "");
      return jsonResponse({ ...result, profileName: selection.externalResourceName, fetchedAt: new Date().toISOString(), storage: "not_persisted" });
    }

    if (request.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET to read reviews or POST to publish a confirmed reply.");
    requireSameOrigin(request);
    await requirePermission(context, "marketing.manage");
    await enforceRateLimit("google:business-reviews:reply", context.userId, 20, 3_600);
    const body = await readJsonObject(request, 16_384);
    const reviewName = typeof body.reviewName === "string" ? body.reviewName.trim() : "";
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (body.confirmPublish !== true) throw new ApiError(400, "GOOGLE_REVIEW_CONFIRMATION_REQUIRED", "Confirm this exact reply before publishing it to Google.");
    if (!reviewName.startsWith(`${selection.externalResourceRef}/reviews/`)) throw new ApiError(400, "GOOGLE_REVIEW_SCOPE_INVALID", "That review does not belong to the selected business location.");
    if (!comment || comment.length > 4_096) throw new ApiError(400, "GOOGLE_REVIEW_REPLY_INVALID", "A review reply must contain 1 to 4,096 characters.");
    const reply = await publishGoogleBusinessReviewReply(accessToken, reviewName, comment);
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "google_business.review_reply_published",
      resourceType: "google_business_review",
      resourceId: reviewName.slice(-120),
      details: { selectionId, connectionId: selection.connectionId, confirmed: true, commentLength: comment.length },
    });
    return jsonResponse({ published: true, reply: { updateTime: reply.updateTime || new Date().toISOString() } });
  });
}
