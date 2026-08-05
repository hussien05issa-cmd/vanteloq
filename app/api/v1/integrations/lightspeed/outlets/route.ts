import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  integrationLocationMappings,
  integrationSyncRuns,
  organizationLocations,
} from "../../../../../../db/schema";
import { recordAudit } from "../../../../../../server/audit";
import { requireAccess } from "../../../../../../server/authorization";
import {
  ApiError,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
} from "../../../../../../server/api";
import { fetchLightspeedCollection, LIGHTSPEED_PROVIDER } from "../../../../../../server/integrations/lightspeed";
import { requirePermission } from "../../../../../../server/permissions";

const roles = ["owner", "admin", "manager"] as const;

async function list(organizationId: string) {
  const mappings = await getDb().select().from(integrationLocationMappings).where(and(
    eq(integrationLocationMappings.organizationId, organizationId),
    eq(integrationLocationMappings.provider, LIGHTSPEED_PROVIDER),
  )).orderBy(integrationLocationMappings.externalName);
  const localLocations = await getDb().select({
    id: organizationLocations.id,
    name: organizationLocations.name,
    status: organizationLocations.status,
  }).from(organizationLocations).where(eq(organizationLocations.organizationId, organizationId));
  const [lastDiscovery] = await getDb().select().from(integrationSyncRuns).where(and(
    eq(integrationSyncRuns.organizationId, organizationId),
    eq(integrationSyncRuns.provider, LIGHTSPEED_PROVIDER),
    eq(integrationSyncRuns.mode, "discovery"),
  )).orderBy(desc(integrationSyncRuns.startedAt)).limit(1);
  return { mappings, localLocations, lastDiscovery: lastDiscovery ?? null };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, roles);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("lightspeed:outlets", context.userId, 20, 3_600);
    const runId = crypto.randomUUID();
    const now = new Date();
    await getDb().insert(integrationSyncRuns).values({
      id: runId, organizationId: context.organizationId, provider: LIGHTSPEED_PROVIDER,
      mode: "discovery", status: "running", cursorBefore: null, cursorAfter: null,
      recordsRead: 0, recordsStaged: 0, duplicatesSkipped: 0, warningCount: 0,
      errorCode: null, startedAt: now, completedAt: null, createdByUserId: context.userId,
    });
    try {
      const outlets = await fetchLightspeedCollection(context.organizationId, "outlets", { maxPages: 10 });
      let staged = 0;
      for (const outlet of outlets.data) {
        const externalLocationRef = typeof outlet.id === "string" ? outlet.id : "";
        if (!externalLocationRef) continue;
        const externalName = typeof outlet.name === "string" && outlet.name.trim()
          ? outlet.name.trim().slice(0, 160)
          : "Lightspeed outlet";
        await getDb().insert(integrationLocationMappings).values({
          id: crypto.randomUUID(), organizationId: context.organizationId, provider: LIGHTSPEED_PROVIDER,
          externalLocationRef, externalName, localLocationId: null, status: "unmapped",
          lastSeenAt: now, createdAt: now, updatedAt: now,
        }).onConflictDoUpdate({
          target: [integrationLocationMappings.organizationId, integrationLocationMappings.provider, integrationLocationMappings.externalLocationRef],
          set: { externalName, lastSeenAt: now, updatedAt: now },
        });
        staged += 1;
      }
      await getDb().update(integrationSyncRuns).set({
        status: "completed", cursorAfter: outlets.cursor, recordsRead: outlets.data.length,
        recordsStaged: staged, completedAt: new Date(),
      }).where(eq(integrationSyncRuns.id, runId));
      return jsonResponse(await list(context.organizationId));
    } catch (error) {
      await getDb().update(integrationSyncRuns).set({
        status: "failed", errorCode: error instanceof ApiError ? error.code : "DISCOVERY_FAILED", completedAt: new Date(),
      }).where(eq(integrationSyncRuns.id, runId));
      throw error;
    }
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"]);
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("lightspeed:outlet-map", context.userId, 60, 3_600);
    const input = await readJsonObject(request);
    const externalLocationRef = typeof input.externalLocationRef === "string" ? input.externalLocationRef.trim() : "";
    const localLocationId = typeof input.localLocationId === "string" && input.localLocationId.trim() ? input.localLocationId.trim() : null;
    const status = input.status;
    if (!externalLocationRef || externalLocationRef.length > 160 || !["mapped", "unmapped", "ignored"].includes(String(status))) {
      throw new ApiError(400, "INVALID_LOCATION_MAPPING", "Choose a valid Lightspeed outlet mapping.");
    }
    if (status === "mapped" && !localLocationId) {
      throw new ApiError(400, "LOCAL_LOCATION_REQUIRED", "Choose a Vanteloq location for this outlet.");
    }
    if (localLocationId) {
      const [local] = await getDb().select({ id: organizationLocations.id }).from(organizationLocations).where(and(
        eq(organizationLocations.id, localLocationId),
        eq(organizationLocations.organizationId, context.organizationId),
      )).limit(1);
      if (!local) throw new ApiError(400, "LOCAL_LOCATION_INVALID", "The selected Vanteloq location is unavailable.");
    }
    const result = await getDb().update(integrationLocationMappings).set({
      localLocationId, status: String(status) as "mapped" | "unmapped" | "ignored", updatedAt: new Date(),
    }).where(and(
      eq(integrationLocationMappings.organizationId, context.organizationId),
      eq(integrationLocationMappings.provider, LIGHTSPEED_PROVIDER),
      eq(integrationLocationMappings.externalLocationRef, externalLocationRef),
    ));
    if (!result.meta.changes) throw new ApiError(404, "OUTLET_NOT_FOUND", "Discover the Lightspeed outlet before mapping it.");
    await recordAudit({
      request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "integration.location_mapping_changed", resourceType: "integration_location", resourceId: externalLocationRef,
      details: { provider: LIGHTSPEED_PROVIDER, status: String(status), mapped: Boolean(localLocationId) },
    });
    return jsonResponse(await list(context.organizationId));
  });
}
