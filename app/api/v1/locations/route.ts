import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dailyBusinessMetrics, integrationConnections, integrationLocationMappings } from "../../../../db/schema";
import { scopeExternalRef } from "../../../../domain/integration-source";
import { enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import { requireAccess } from "../../../../server/authorization";
import { accessibleLocations } from "../../../../server/location-access";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { approvedFactSource, noActiveIntegrationLease } from "../../../../server/integrations/trusted-data";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "dashboard.view");
    await enforceRateLimit("locations:read", context.userId, 90, 60);
    const permissions = await effectivePermissions(context);
    const [locations, mappings, rows, squareCostConnections] = await Promise.all([
      accessibleLocations(context),
      getDb().select({
        provider: integrationLocationMappings.provider,
        sourceNamespace: integrationConnections.sourceNamespace,
        externalLocationRef: integrationLocationMappings.externalLocationRef,
        externalName: integrationLocationMappings.externalName,
        localLocationId: integrationLocationMappings.localLocationId,
        status: integrationLocationMappings.status,
      }).from(integrationLocationMappings).innerJoin(integrationConnections, and(
        eq(integrationConnections.id, integrationLocationMappings.connectionId),
        eq(integrationConnections.organizationId, integrationLocationMappings.organizationId),
        eq(integrationConnections.status, "connected"),
        eq(integrationConnections.dataPromotionStatus, "approved"),
        noActiveIntegrationLease(integrationConnections.syncLeaseOwner, integrationConnections.syncLeaseExpiresAt),
      )).where(eq(integrationLocationMappings.organizationId, context.organizationId)),
      getDb().select({
        businessDate: dailyBusinessMetrics.businessDate,
        locationRef: dailyBusinessMetrics.locationRef,
        netSalesCents: dailyBusinessMetrics.netSalesCents,
        costOfGoodsCents: dailyBusinessMetrics.costOfGoodsCents,
        transactionCount: dailyBusinessMetrics.transactionCount,
        inventoryValueCents: dailyBusinessMetrics.inventoryValueCents,
        updatedAt: dailyBusinessMetrics.updatedAt,
      }).from(dailyBusinessMetrics)
        .where(and(
          eq(dailyBusinessMetrics.organizationId, context.organizationId),
          approvedFactSource(dailyBusinessMetrics.organizationId, dailyBusinessMetrics.sourceProvider, dailyBusinessMetrics.sourceConnectionId),
        ))
        .orderBy(desc(dailyBusinessMetrics.businessDate))
        .limit(2_500),
      getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, "square"),
        eq(integrationConnections.status, "connected"),
        eq(integrationConnections.dataPromotionStatus, "approved"),
        eq(integrationConnections.lastErrorCode, "SQUARE_PRODUCT_COST_UNAVAILABLE"),
      )).limit(1),
    ]);
    const canViewVerifiedProfit = permissions.includes("metrics.profit") && squareCostConnections.length === 0;
    const accessibleIds = new Set(locations.map((location) => location.id));
    const visibleMappings = mappings.filter((mapping) =>
      mapping.localLocationId !== null && accessibleIds.has(mapping.localLocationId),
    );
    const accessibleRefs = new Set<string>();
    for (const location of locations) {
      accessibleRefs.add(location.id);
      accessibleRefs.add(location.name);
    }
    for (const mapping of visibleMappings) {
      const externalRef = scopeExternalRef(mapping.sourceNamespace, mapping.externalLocationRef)!;
      accessibleRefs.add(externalRef);
      accessibleRefs.add(`${mapping.provider}:${externalRef}`);
    }
    const visibleRows = rows.filter((row) => accessibleRefs.has(row.locationRef));
    visibleRows.reverse();

    const latestDate = visibleRows.at(-1)?.businessDate ?? null;
    const cutoff = latestDate
      ? new Date(`${latestDate}T00:00:00Z`).getTime() - 29 * 86_400_000
      : null;
    const result = locations.map((location) => {
      const locationMappings = visibleMappings.filter((mapping) => mapping.localLocationId === location.id && mapping.status === "mapped");
      const refs = new Set<string>([location.id, location.name]);
      for (const mapping of locationMappings) {
        const externalRef = scopeExternalRef(mapping.sourceNamespace, mapping.externalLocationRef)!;
        refs.add(externalRef);
        refs.add(`${mapping.provider}:${externalRef}`);
      }
      const scopedRows = visibleRows.filter((row) => {
        if (!refs.has(row.locationRef)) return false;
        if (cutoff === null) return true;
        return new Date(`${row.businessDate}T00:00:00Z`).getTime() >= cutoff;
      });
      const latestInventory = [...scopedRows].reverse().find((row) => row.inventoryValueCents !== null)?.inventoryValueCents ?? null;
      const netSalesCents = scopedRows.reduce((sum, row) => sum + row.netSalesCents, 0);
      const costOfGoodsCents = scopedRows.reduce((sum, row) => sum + row.costOfGoodsCents, 0);
      return {
        id: location.id,
        name: location.name,
        address: [location.addressLine1, location.locality, location.administrativeArea].filter(Boolean).join(", "),
        timezone: location.timezone,
        validationStatus: location.validationStatus,
        sourceMappings: locationMappings.map((mapping) => ({ provider: mapping.provider, name: mapping.externalName })),
        metrics: {
          period: latestDate ? `30 days through ${latestDate}` : null,
          days: new Set(scopedRows.map((row) => row.businessDate)).size,
          netSalesCents: permissions.includes("metrics.revenue") && scopedRows.length ? netSalesCents : null,
          grossProfitCents: canViewVerifiedProfit && scopedRows.length ? netSalesCents - costOfGoodsCents : null,
          transactionCount: permissions.includes("metrics.revenue") && scopedRows.length ? scopedRows.reduce((sum, row) => sum + row.transactionCount, 0) : null,
          inventoryValueCents: permissions.includes("inventory.value") ? latestInventory : null,
          lastUpdatedAt: scopedRows.at(-1)?.updatedAt.toISOString() ?? null,
        },
      };
    });

    const canManageMappings = context.role === "owner" || context.role === "admin";
    return jsonResponse({
      scopeLabel: canManageMappings ? "All locations" : "All accessible locations",
      latestBusinessDate: latestDate,
      profitAvailability: canViewVerifiedProfit ? "verified" : squareCostConnections.length ? "Square product cost is unavailable, so profit is withheld." : "permission_required",
      locations: result,
      unmappedSourceLocations: canManageMappings
        ? mappings.filter((mapping) => mapping.status === "unmapped").length
        : 0,
    });
  });
}
