import { and, asc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { dailyBusinessMetrics, integrationConnections, integrationLocationMappings } from "../db/schema";
import { locationPeriodMetrics, locationReportingPeriod } from "../domain/location-intelligence";
import { businessClock } from "../domain/intraday-sales";
import type { AccessContext } from "./authorization";
import { authorizedLocationScope } from "./location-access";
import { commerceSourceAuthority } from "./integrations/source-authority";
import { authoritativeDailySalesScope } from "./integrations/daily-sales-scope";
import { approvedFactSource, noActiveIntegrationLease } from "./integrations/trusted-data";

const PAGE_SIZE = 1000;
const MAX_ROWS = 20_000;

/** Scope is always resolved from the authenticated actor, never caller-supplied IDs. */
export async function readLocationIntelligence(context: AccessContext, permissions: readonly string[]) {
  const access = await authorizedLocationScope(context, null);
  const locations = access.locations;
  const localIds = locations.map(location => location.id);
  const authority = await commerceSourceAuthority({ organizationId: context.organizationId, localLocationIds: localIds, factFamily: "sales" });
  const conflicts = new Set(authority.conflicts.map(entry => entry.localLocationId));
  const missing = new Set((authority.needsData ?? []).map(entry => entry.localLocationId));
  const readyIds = localIds.filter(id => !conflicts.has(id) && !missing.has(id));
  const readySet = new Set(readyIds);
  const readableAuthority = { ...authority, status: "ready" as const, conflicts: [], needsData: [], selections: authority.selections.filter(entry => readySet.has(entry.localLocationId)) };
  const today = businessClock(new Date(), context.organization.timezone)!.date;
  const sourceScope = authoritativeDailySalesScope({ authority: readableAuthority, localLocationIds: readyIds, locationRestricted: true });
  const sourceWhere = and(
    eq(dailyBusinessMetrics.organizationId, context.organizationId),
    approvedFactSource(dailyBusinessMetrics.organizationId, dailyBusinessMetrics.sourceProvider, dailyBusinessMetrics.sourceConnectionId),
    sourceScope,
    lte(dailyBusinessMetrics.businessDate, today),
    sql`date(${dailyBusinessMetrics.businessDate}, '+0 days') = ${dailyBusinessMetrics.businessDate}`,
  );
  const [bounds] = await getDb().select({ latestDate: sql<string | null>`max(${dailyBusinessMetrics.businessDate})` }).from(dailyBusinessMetrics).where(sourceWhere);
  const period = locationReportingPeriod(bounds?.latestDate ?? null);
  const rows: Array<typeof dailyBusinessMetrics.$inferSelect> = [];
  if (period) {
    let after: number | null = null;
    for (;;) {
      const page = await getDb().select().from(dailyBusinessMetrics).where(and(sourceWhere,
        gte(dailyBusinessMetrics.businessDate, period.from), lte(dailyBusinessMetrics.businessDate, period.to),
        after === null ? undefined : gt(dailyBusinessMetrics.id, after),
      )).orderBy(asc(dailyBusinessMetrics.id)).limit(Math.min(PAGE_SIZE, MAX_ROWS + 1 - rows.length));
      rows.push(...page);
      if (page.length < PAGE_SIZE || rows.length > MAX_ROWS) break;
      after = page.at(-1)!.id;
    }
  }
  const queryComplete = rows.length <= MAX_ROWS;
  const canReadMappings = permissions.includes("integrations.view");
  const canManageMappings = access.organizationWide && permissions.includes("integrations.manage");
  const mappings = canReadMappings && localIds.length ? await getDb().select({
    provider: integrationLocationMappings.provider,
    externalName: integrationLocationMappings.externalName,
    localLocationId: integrationLocationMappings.localLocationId,
  }).from(integrationLocationMappings).innerJoin(integrationConnections, and(
    eq(integrationConnections.id, integrationLocationMappings.connectionId),
    eq(integrationConnections.organizationId, integrationLocationMappings.organizationId),
    eq(integrationConnections.status, "connected"), eq(integrationConnections.dataPromotionStatus, "approved"),
    noActiveIntegrationLease(integrationConnections.syncLeaseOwner, integrationConnections.syncLeaseExpiresAt),
  )).where(and(eq(integrationLocationMappings.organizationId, context.organizationId),
    eq(integrationLocationMappings.status, "mapped"), inArray(integrationLocationMappings.localLocationId, localIds))) : [];
  const [unmapped] = canManageMappings ? await getDb().select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(integrationLocationMappings).where(and(eq(integrationLocationMappings.organizationId, context.organizationId), eq(integrationLocationMappings.status, "unmapped"))) : [];
  const canReadActivity = permissions.some(permission => ["metrics.revenue", "metrics.profit", "inventory.value"].includes(permission));
  return {
    scopeLabel: access.organizationWide ? "All locations" : "All accessible locations",
    latestBusinessDate: canReadActivity ? period?.to ?? null : null,
    profitAvailability: permissions.includes("metrics.profit") ? "Recorded manual costs only; provider cost completeness must be verified separately." : "permission_required",
    comparisonEligible: false,
    comparisonLimitations: ["Location ranking and like-for-like comparisons are withheld until opening calendars, currencies and complete source coverage are verified."],
    locations: locations.map(location => ({
      id: location.id, name: location.name,
      address: [location.addressLine1, location.locality, location.administrativeArea].filter(Boolean).join(", "),
      timezone: location.timezone, currency: location.currency, validationStatus: location.validationStatus,
      sourceMappings: mappings.filter(mapping => mapping.localLocationId === location.id).map(mapping => ({ provider: mapping.provider, name: mapping.externalName })),
      metrics: locationPeriodMetrics({ locationId: location.id, locationCurrency: location.currency,
        currency: context.organization.currency, timeZone: context.organization.timezone, today, period, rows,
        scopes: authority.selections.filter(entry => entry.localLocationId === location.id),
        authority: conflicts.has(location.id) ? "conflict" : missing.has(location.id) ? "needs_data" : "ready",
        queryComplete, permissions }),
    })),
    unmappedSourceLocations: unmapped?.count ?? 0,
  };
}
