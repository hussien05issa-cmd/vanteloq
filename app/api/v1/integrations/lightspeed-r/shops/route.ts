import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationLocationMappings, integrationSyncRuns, organizationLocations } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { fetchLightspeedRCollection, LIGHTSPEED_R_PROVIDER } from "../../../../../../server/integrations/lightspeed-r";
import {
  acquireIntegrationSyncLease,
  releaseIntegrationSyncLease,
  requireOwnedIntegrationConnection,
  type IntegrationSyncLease,
} from "../../../../../../server/integrations/connection";
import { requirePermission } from "../../../../../../server/permissions";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";

async function list(
  organizationId: string,
  connectionId: string,
  accountName: string | null,
  autoMapped = 0,
) {
  const mappings = await getDb().select().from(integrationLocationMappings).where(and(
    eq(integrationLocationMappings.organizationId, organizationId), eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
    eq(integrationLocationMappings.connectionId, connectionId),
  )).orderBy(integrationLocationMappings.externalName);
  const localLocations = await getDb().select({ id: organizationLocations.id, name: organizationLocations.name, status: organizationLocations.status })
    .from(organizationLocations).where(eq(organizationLocations.organizationId, organizationId));
  const [lastDiscovery] = await getDb().select().from(integrationSyncRuns).where(and(
    eq(integrationSyncRuns.organizationId, organizationId), eq(integrationSyncRuns.provider, LIGHTSPEED_R_PROVIDER),
    eq(integrationSyncRuns.connectionId, connectionId),
    eq(integrationSyncRuns.mode, "discovery"),
  )).orderBy(desc(integrationSyncRuns.startedAt)).limit(1);
  return { provider: LIGHTSPEED_R_PROVIDER, connectionId, accountName, locationLabel: "shop", mappings, localLocations, lastDiscovery: lastDiscovery ?? null, autoMapped };
}

async function revokePublicationAuthorization(
  organizationId: string,
  connectionId: string,
  lease: IntegrationSyncLease,
) {
  const invalidated = await getDb().update(integrationConnections).set({
    dataPromotionStatus: "staging",
    promotionAuthorizedAt: null,
    updatedAt: new Date(),
  }).where(and(
    eq(integrationConnections.id, connectionId),
    eq(integrationConnections.organizationId, organizationId),
    eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
    eq(integrationConnections.syncLeaseOwner, lease.owner),
    eq(integrationConnections.syncVersion, lease.version),
    or(
      eq(integrationConnections.dataPromotionStatus, "approved"),
      isNotNull(integrationConnections.promotionAuthorizedAt),
    ),
  )).returning({ id: integrationConnections.id });
  if (invalidated.length) return;

  const [leaseHeld] = await getDb().select({ id: integrationConnections.id })
    .from(integrationConnections).where(and(
      eq(integrationConnections.id, connectionId),
      eq(integrationConnections.organizationId, organizationId),
      eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      eq(integrationConnections.syncLeaseOwner, lease.owner),
      eq(integrationConnections.syncVersion, lease.version),
    )).limit(1);
  if (!leaseHeld) {
    throw new ApiError(409, "INTEGRATION_SYNC_LEASE_LOST", "The R-Series connection changed before its publication authorization could be revoked safely.");
  }
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("lightspeed-r:shops:list", context.userId, 120, 3600);
    const connection = await requireOwnedIntegrationConnection(
      context.organizationId,
      LIGHTSPEED_R_PROVIDER,
      new URL(request.url).searchParams.get("connection"),
      { connected: true },
    );
    return jsonResponse(await list(context.organizationId, connection.id, connection.externalAccountName));
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const input = await readJsonObject(request);
    const discovering = input.action === "discover";
    const context = await requireAccess(request, discovering ? ["owner", "admin", "manager"] : ["owner", "admin"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit(discovering ? "lightspeed-r:shop-discover" : "lightspeed-r:shop-map", context.userId, discovering ? 20 : 60, 3600);
    const requestedConnectionId = typeof input.connectionId === "string" ? input.connectionId.trim() : "";
    const connection = await requireOwnedIntegrationConnection(context.organizationId, LIGHTSPEED_R_PROVIDER, requestedConnectionId, { connected: true });
    const syncLease = await acquireIntegrationSyncLease(context.organizationId, LIGHTSPEED_R_PROVIDER, connection.id);
    if (!syncLease) throw new ApiError(409, "INTEGRATION_SYNC_IN_PROGRESS", "Another operation is already running for this R-Series account.");
    try {
      if (discovering) {
        if (!connection.externalAccountRef) throw new ApiError(409, "LIGHTSPEED_R_NOT_CONNECTED", "Connect R-Series before discovering shops.");
        const runId = crypto.randomUUID();
        const now = new Date();
        await getDb().insert(integrationSyncRuns).values({
          id: runId, organizationId: context.organizationId, provider: LIGHTSPEED_R_PROVIDER, connectionId: connection.id,
          mode: "discovery", status: "running", cursorBefore: null, cursorAfter: null,
          recordsRead: 0, recordsStaged: 0, duplicatesSkipped: 0, warningCount: 0,
          errorCode: null, startedAt: now, completedAt: null, createdByUserId: context.userId,
        });
        try {
          const shops = await fetchLightspeedRCollection(context.organizationId, connection.id, connection.externalAccountRef, "Shop", { maxPages: 10 });
          let staged = 0;
          const discoveredRefs: string[] = [];
          for (const shop of shops.data) {
            const ref = typeof shop.shopID === "string" || typeof shop.shopID === "number" ? String(shop.shopID) : "";
            if (!ref) continue;
            const name = typeof shop.name === "string" && shop.name.trim() ? shop.name.trim().slice(0, 160) : "R-Series shop";
            await getDb().insert(integrationLocationMappings).values({
              id: crypto.randomUUID(), organizationId: context.organizationId, provider: LIGHTSPEED_R_PROVIDER, connectionId: connection.id,
              externalLocationRef: ref, externalName: name, localLocationId: null, status: "unmapped",
              lastSeenAt: now, createdAt: now, updatedAt: now,
            }).onConflictDoUpdate({
              target: [integrationLocationMappings.organizationId, integrationLocationMappings.provider, integrationLocationMappings.connectionId, integrationLocationMappings.externalLocationRef],
              set: { externalName: name, lastSeenAt: now, updatedAt: now },
            });
            discoveredRefs.push(ref);
            staged += 1;
          }
          let autoMapped = 0;
          const currentMappings = await getDb().select({
            externalLocationRef: integrationLocationMappings.externalLocationRef,
            status: integrationLocationMappings.status,
          }).from(integrationLocationMappings).where(and(
            eq(integrationLocationMappings.organizationId, context.organizationId),
            eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
            eq(integrationLocationMappings.connectionId, connection.id),
          ));
          const activeLocalLocations = await getDb().select({ id: organizationLocations.id })
            .from(organizationLocations).where(and(
              eq(organizationLocations.organizationId, context.organizationId),
              eq(organizationLocations.status, "active"),
            ));
          const discoveredMappings = currentMappings.filter((mapping) => discoveredRefs.includes(mapping.externalLocationRef));
          // A single-shop retailer with a single Vanteloq location has no
          // ambiguous choice. Map that exact pair so a connected account does
          // not remain silently blocked behind a redundant setup step.
          if (
            discoveredRefs.length === 1
            && discoveredMappings.length === 1
            && discoveredMappings[0].status === "unmapped"
            && activeLocalLocations.length === 1
          ) {
            const result = await getDb().update(integrationLocationMappings).set({
              localLocationId: activeLocalLocations[0].id,
              status: "mapped",
              updatedAt: now,
            }).where(and(
              eq(integrationLocationMappings.organizationId, context.organizationId),
              eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
              eq(integrationLocationMappings.connectionId, connection.id),
              eq(integrationLocationMappings.externalLocationRef, discoveredRefs[0]),
              eq(integrationLocationMappings.status, "unmapped"),
            ));
            autoMapped = Number(result.meta.changes ?? 0);
          }
          const [unmapped] = await getDb().select({ id: integrationLocationMappings.id })
            .from(integrationLocationMappings).where(and(
              eq(integrationLocationMappings.organizationId, context.organizationId),
              eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
              eq(integrationLocationMappings.connectionId, connection.id),
              eq(integrationLocationMappings.status, "unmapped"),
            )).limit(1);
          if (unmapped || autoMapped > 0) {
            await revokePublicationAuthorization(context.organizationId, connection.id, syncLease);
          }
          await getDb().update(integrationSyncRuns).set({ status: "completed", cursorAfter: shops.cursor, recordsRead: shops.data.length, recordsStaged: staged, completedAt: new Date() }).where(eq(integrationSyncRuns.id, runId));
          return jsonResponse(await list(context.organizationId, connection.id, connection.externalAccountName, autoMapped));
        } catch (error) {
          await getDb().update(integrationSyncRuns).set({ status: "failed", errorCode: error instanceof ApiError ? error.code : "DISCOVERY_FAILED", completedAt: new Date() }).where(eq(integrationSyncRuns.id, runId));
          throw error;
        }
      }
      const externalLocationRef = typeof input.externalLocationRef === "string" ? input.externalLocationRef.trim() : "";
      const localLocationId = typeof input.localLocationId === "string" && input.localLocationId.trim() ? input.localLocationId.trim() : null;
      const status = String(input.status);
      if (!externalLocationRef || externalLocationRef.length > 160 || !["mapped", "unmapped", "ignored"].includes(status)) throw new ApiError(400, "INVALID_LOCATION_MAPPING", "Choose a valid R-Series shop mapping.");
      if (status === "mapped" && !localLocationId) throw new ApiError(400, "LOCAL_LOCATION_REQUIRED", "Choose a Vanteloq location for this shop.");
      if (localLocationId) {
        const [local] = await getDb().select({ id: organizationLocations.id }).from(organizationLocations).where(and(
          eq(organizationLocations.id, localLocationId), eq(organizationLocations.organizationId, context.organizationId),
        )).limit(1);
        if (!local) throw new ApiError(400, "LOCAL_LOCATION_INVALID", "The selected Vanteloq location is unavailable.");
      }
      const result = await getDb().update(integrationLocationMappings).set({
        localLocationId, status: status as "mapped" | "unmapped" | "ignored", updatedAt: new Date(),
      }).where(and(
        eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationLocationMappings.connectionId, connection.id),
        eq(integrationLocationMappings.externalLocationRef, externalLocationRef),
      ));
      if (!result.meta.changes) throw new ApiError(404, "SHOP_NOT_FOUND", "Discover the R-Series shop before mapping it.");
      await revokePublicationAuthorization(context.organizationId, connection.id, syncLease);
      await recordAudit({
        request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "integration.location_mapping_changed", resourceType: "integration_location", resourceId: `${connection.id}:${externalLocationRef}`,
        details: { provider: LIGHTSPEED_R_PROVIDER, connectionId: connection.id, status, mapped: Boolean(localLocationId) },
      });
      return jsonResponse(await list(context.organizationId, connection.id, connection.externalAccountName));
    } finally {
      await releaseIntegrationSyncLease(syncLease);
    }
  });
}
