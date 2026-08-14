import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { integrationLocationMappings, organizationLocations } from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { fetchSquareLocations, SQUARE_PROVIDER } from "../../../../../../server/integrations/square";
import { requireOwnedIntegrationConnection } from "../../../../../../server/integrations/connection";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";
import { requirePermission } from "../../../../../../server/permissions";

async function list(organizationId: string, connectionId: string, accountName: string | null) {
  const mappings = await getDb().select().from(integrationLocationMappings).where(and(eq(integrationLocationMappings.organizationId, organizationId), eq(integrationLocationMappings.provider, SQUARE_PROVIDER), eq(integrationLocationMappings.connectionId, connectionId)));
  const localLocations = await getDb().select({ id: organizationLocations.id, name: organizationLocations.name, status: organizationLocations.status }).from(organizationLocations).where(eq(organizationLocations.organizationId, organizationId));
  return { provider: SQUARE_PROVIDER, connectionId, accountName, locationLabel: "location", mappings, localLocations };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager"]);
    await requirePermission(context, "integrations.manage");
    await requireOrganizationWideLocationAccess(context);
    const connection = await requireOwnedIntegrationConnection(context.organizationId, SQUARE_PROVIDER, new URL(request.url).searchParams.get("connection"), { connected: true });
    return jsonResponse(await list(context.organizationId, connection.id, connection.externalAccountName));
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const input = await readJsonObject(request);
    const context = await requireAccess(request, input.action === "discover" ? ["owner", "admin", "manager"] : ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("square:location", context.userId, 60, 3600);
    const connection = await requireOwnedIntegrationConnection(context.organizationId, SQUARE_PROVIDER, typeof input.connectionId === "string" ? input.connectionId : null, { connected: true });
    if (input.action === "discover") {
      const locations = await fetchSquareLocations(context.organizationId, connection.id);
      const now = new Date();
      for (const location of locations) {
        const externalLocationRef = typeof location.id === "string" ? location.id : "";
        if (!externalLocationRef) continue;
        const externalName = typeof location.name === "string" && location.name.trim() ? location.name.trim().slice(0, 160) : "Square location";
        await getDb().insert(integrationLocationMappings).values({ id: crypto.randomUUID(), organizationId: context.organizationId, provider: SQUARE_PROVIDER, connectionId: connection.id, externalLocationRef, externalName, localLocationId: null, status: "unmapped", lastSeenAt: now, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [integrationLocationMappings.organizationId, integrationLocationMappings.provider, integrationLocationMappings.connectionId, integrationLocationMappings.externalLocationRef], set: { externalName, lastSeenAt: now, updatedAt: now } });
      }
      return jsonResponse(await list(context.organizationId, connection.id, connection.externalAccountName));
    }
    const externalLocationRef = typeof input.externalLocationRef === "string" ? input.externalLocationRef.trim() : "";
    const localLocationId = typeof input.localLocationId === "string" && input.localLocationId.trim() ? input.localLocationId.trim() : null;
    const status = String(input.status);
    if (!externalLocationRef || !["mapped", "unmapped", "ignored"].includes(status)) throw new ApiError(400, "INVALID_LOCATION_MAPPING", "Choose a valid Square location mapping.");
    if (status === "mapped" && !localLocationId) throw new ApiError(400, "LOCAL_LOCATION_REQUIRED", "Choose a Vanteloq location.");
    if (localLocationId) {
      const [local] = await getDb().select({ id: organizationLocations.id }).from(organizationLocations).where(and(eq(organizationLocations.id, localLocationId), eq(organizationLocations.organizationId, context.organizationId))).limit(1);
      if (!local) throw new ApiError(400, "LOCAL_LOCATION_INVALID", "The selected Vanteloq location is unavailable.");
    }
    const updated = await getDb().update(integrationLocationMappings).set({ localLocationId, status: status as "mapped" | "unmapped" | "ignored", updatedAt: new Date() }).where(and(eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.provider, SQUARE_PROVIDER), eq(integrationLocationMappings.connectionId, connection.id), eq(integrationLocationMappings.externalLocationRef, externalLocationRef)));
    if (!updated.meta.changes) throw new ApiError(404, "SQUARE_LOCATION_NOT_FOUND", "Refresh Square locations before mapping this location.");
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "integration.location_mapping_changed", resourceType: "integration_location", resourceId: `${connection.id}:${externalLocationRef}`, details: { provider: SQUARE_PROVIDER, status, mapped: Boolean(localLocationId) } });
    return jsonResponse(await list(context.organizationId, connection.id, connection.externalAccountName));
  });
}
