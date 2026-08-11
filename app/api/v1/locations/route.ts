import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dailyBusinessMetrics, integrationLocationMappings } from "../../../../db/schema";
import { enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import { requireAccess } from "../../../../server/authorization";
import { accessibleLocations } from "../../../../server/location-access";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "dashboard.view");
    await enforceRateLimit("locations:read", context.userId, 90, 60);
    const permissions = await effectivePermissions(context);
    const [locations, mappings, rows] = await Promise.all([
      accessibleLocations(context),
      getDb().select({
        provider: integrationLocationMappings.provider,
        externalLocationRef: integrationLocationMappings.externalLocationRef,
        externalName: integrationLocationMappings.externalName,
        localLocationId: integrationLocationMappings.localLocationId,
        status: integrationLocationMappings.status,
      }).from(integrationLocationMappings).where(eq(integrationLocationMappings.organizationId, context.organizationId)),
      getDb().select({
        businessDate: dailyBusinessMetrics.businessDate,
        locationRef: dailyBusinessMetrics.locationRef,
        netSalesCents: dailyBusinessMetrics.netSalesCents,
        costOfGoodsCents: dailyBusinessMetrics.costOfGoodsCents,
        transactionCount: dailyBusinessMetrics.transactionCount,
        inventoryValueCents: dailyBusinessMetrics.inventoryValueCents,
        updatedAt: dailyBusinessMetrics.updatedAt,
      }).from(dailyBusinessMetrics)
        .where(eq(dailyBusinessMetrics.organizationId, context.organizationId))
        .orderBy(desc(dailyBusinessMetrics.businessDate))
        .limit(2_500),
    ]);
    rows.reverse();

    const latestDate = rows.at(-1)?.businessDate ?? null;
    const cutoff = latestDate
      ? new Date(`${latestDate}T00:00:00Z`).getTime() - 29 * 86_400_000
      : null;
    const result = locations.map((location) => {
      const locationMappings = mappings.filter((mapping) => mapping.localLocationId === location.id && mapping.status === "mapped");
      const refs = new Set<string>([location.id, location.name]);
      for (const mapping of locationMappings) {
        refs.add(mapping.externalLocationRef);
        refs.add(`${mapping.provider}:${mapping.externalLocationRef}`);
      }
      const scopedRows = rows.filter((row) => {
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
          grossProfitCents: permissions.includes("metrics.profit") && scopedRows.length ? netSalesCents - costOfGoodsCents : null,
          transactionCount: permissions.includes("metrics.revenue") && scopedRows.length ? scopedRows.reduce((sum, row) => sum + row.transactionCount, 0) : null,
          inventoryValueCents: permissions.includes("inventory.value") ? latestInventory : null,
          lastUpdatedAt: scopedRows.at(-1)?.updatedAt.toISOString() ?? null,
        },
      };
    });

    return jsonResponse({ latestBusinessDate: latestDate, locations: result, unmappedSourceLocations: mappings.filter((mapping) => mapping.status === "unmapped").length });
  });
}
