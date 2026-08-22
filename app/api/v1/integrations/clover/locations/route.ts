import { and, eq, or, isNotNull } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationConnections, integrationLocationMappings, organizationLocations } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { CLOVER_PROVIDER, fetchCloverMerchant } from "../../../../../../server/integrations/clover";
import { acquireIntegrationSyncLease, releaseIntegrationSyncLease, requireOwnedIntegrationConnection, type IntegrationSyncLease } from "../../../../../../server/integrations/connection";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";
import { requirePermission } from "../../../../../../server/permissions";

async function list(organizationId: string, connectionId: string, accountName: string | null) {
  const mappings = await getDb().select().from(integrationLocationMappings).where(and(
    eq(integrationLocationMappings.organizationId, organizationId), eq(integrationLocationMappings.provider, CLOVER_PROVIDER), eq(integrationLocationMappings.connectionId, connectionId),
  ));
  const localLocations = await getDb().select({ id: organizationLocations.id, name: organizationLocations.name, status: organizationLocations.status }).from(organizationLocations).where(eq(organizationLocations.organizationId, organizationId));
  return { provider: CLOVER_PROVIDER, connectionId, accountName, locationLabel: "merchant location", mappings, localLocations };
}

async function revoke(organizationId: string, connectionId: string, lease: IntegrationSyncLease) {
  await getDb().update(integrationConnections).set({ dataPromotionStatus: "staging", promotionAuthorizedAt: null, updatedAt: new Date() }).where(and(
    eq(integrationConnections.id, connectionId), eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, CLOVER_PROVIDER),
    eq(integrationConnections.syncLeaseOwner, lease.owner), eq(integrationConnections.syncVersion, lease.version),
    or(eq(integrationConnections.dataPromotionStatus, "approved"), isNotNull(integrationConnections.promotionAuthorizedAt)),
  ));
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await requireOrganizationWideLocationAccess(context);
    const connection = await requireOwnedIntegrationConnection(context.organizationId, CLOVER_PROVIDER, new URL(request.url).searchParams.get("connection"), { connected: true });
    return jsonResponse(await list(context.organizationId, connection.id, connection.externalAccountName));
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const input = await readJsonObject(request);
    const context = await requireAccess(request, input.action === "discover" ? ["owner", "admin", "manager"] : ["owner", "admin"], "pos.reporting.core");
    await requirePermission(context, "integrations.manage");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("clover:location", context.userId, 60, 3600);
    const connection = await requireOwnedIntegrationConnection(context.organizationId, CLOVER_PROVIDER, typeof input.connectionId === "string" ? input.connectionId : null, { connected: true });
    const lease = await acquireIntegrationSyncLease(context.organizationId, CLOVER_PROVIDER, connection.id);
    if (!lease) throw new ApiError(409, "INTEGRATION_SYNC_IN_PROGRESS", "Another Clover operation is already running.");
    try {
      if (input.action === "discover") {
        if (!connection.externalAccountRef) throw new ApiError(409, "CLOVER_NOT_CONNECTED", "Connect Clover before refreshing its merchant location.");
        const merchant = await fetchCloverMerchant(context.organizationId, connection.id, connection.externalAccountRef);
        const name = typeof merchant.name === "string" && merchant.name.trim() ? merchant.name.trim().slice(0, 160) : "Clover merchant";
        await getDb().update(integrationLocationMappings).set({ externalName: name, lastSeenAt: new Date(), updatedAt: new Date() }).where(and(
          eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, CLOVER_PROVIDER), eq(integrationLocationMappings.connectionId, connection.id), eq(integrationLocationMappings.externalLocationRef, connection.externalAccountRef),
        ));
        return jsonResponse(await list(context.organizationId, connection.id, name));
      }
      const externalLocationRef = typeof input.externalLocationRef === "string" ? input.externalLocationRef.trim() : "";
      const localLocationId = typeof input.localLocationId === "string" && input.localLocationId.trim() ? input.localLocationId.trim() : null;
      const status = String(input.status);
      if (!externalLocationRef || !["mapped", "unmapped", "ignored"].includes(status)) throw new ApiError(400, "INVALID_LOCATION_MAPPING", "Choose a valid Clover location mapping.");
      if (status === "mapped" && !localLocationId) throw new ApiError(400, "LOCAL_LOCATION_REQUIRED", "Choose a Vanteloq location.");
      if (localLocationId) {
        const [local] = await getDb().select({ id: organizationLocations.id }).from(organizationLocations).where(and(eq(organizationLocations.id, localLocationId), eq(organizationLocations.organizationId, context.organizationId))).limit(1);
        if (!local) throw new ApiError(400, "LOCAL_LOCATION_INVALID", "The selected Vanteloq location is unavailable.");
      }
      const result = await getDb().update(integrationLocationMappings).set({ localLocationId, status: status as "mapped" | "unmapped" | "ignored", updatedAt: new Date() }).where(and(
        eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, CLOVER_PROVIDER), eq(integrationLocationMappings.connectionId, connection.id), eq(integrationLocationMappings.externalLocationRef, externalLocationRef),
      ));
      if (!result.meta.changes) throw new ApiError(404, "CLOVER_LOCATION_NOT_FOUND", "Reconnect Clover before mapping this merchant.");
      await revoke(context.organizationId, connection.id, lease);
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.location_mapping_changed", resourceType: "integration_location", resourceId: `${connection.id}:${externalLocationRef}`, details: { provider: CLOVER_PROVIDER, status, mapped: Boolean(localLocationId) } });
      return jsonResponse(await list(context.organizationId, connection.id, connection.externalAccountName));
    } finally {
      await releaseIntegrationSyncLease(lease);
    }
  });
}
