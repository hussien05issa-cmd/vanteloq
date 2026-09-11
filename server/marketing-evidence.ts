import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "../db";
import { integrationConnections, marketingDailyMetrics, marketingResourceSelections } from "../db/schema";
import type { AccessContext } from "./authorization";
import { authorizedLocationDataScope } from "./location-access";
import { getTenantEntitlements } from "./entitlements/engine";
import { marketingDatasetFeature } from "../domain/paid-feature-routing";
import { marketingEvidenceSummary, reportingWindow } from "../domain/marketing-reporting";

export async function accessibleMarketingSources(context: AccessContext, location: string | null = null) {
  const [scope, entitlements] = await Promise.all([authorizedLocationDataScope(context, location), getTenantEntitlements(context)]);
  const rows = await getDb().select({ selection: marketingResourceSelections, connection: {
    id: integrationConnections.id, status: integrationConnections.status, promotion: integrationConnections.dataPromotionStatus,
    lastSyncAt: integrationConnections.lastSuccessfulSyncAt, selectionVersion: integrationConnections.resourceSelectionVersion,
  } }).from(marketingResourceSelections).innerJoin(integrationConnections, and(
    eq(integrationConnections.id, marketingResourceSelections.connectionId),
    eq(integrationConnections.organizationId, marketingResourceSelections.organizationId),
    eq(integrationConnections.provider, marketingResourceSelections.provider),
  )).where(eq(marketingResourceSelections.organizationId, context.organizationId)).limit(500);
  return rows.filter(({ selection }) => {
    const feature = marketingDatasetFeature(selection.dataset);
    if (!feature || !entitlements.features.includes(feature)) return false;
    if (scope.locationIds !== null) return selection.scopeKind === "location" && Boolean(selection.localLocationId && scope.locationIds.includes(selection.localLocationId));
    return scope.organizationWide;
  });
}

export async function advisorMarketingEvidence(context: AccessContext) {
  const sources = (await accessibleMarketingSources(context)).filter(({ selection, connection }) => selection.dataset !== "google_business_profile" && connection.status === "connected" && connection.promotion === "approved");
  const window = reportingWindow(28, new Date(), 3);
  if (!sources.length) return marketingEvidenceSummary([]);
  const rows = await getDb().select({ selectionId: marketingDailyMetrics.resourceSelectionId, dataset: marketingResourceSelections.dataset, metricDate: marketingDailyMetrics.metricDate, metricKey: marketingDailyMetrics.metricKey, valueMilli: marketingDailyMetrics.valueMilli })
    .from(marketingDailyMetrics).innerJoin(marketingResourceSelections, eq(marketingResourceSelections.id, marketingDailyMetrics.resourceSelectionId))
    .innerJoin(integrationConnections, and(eq(integrationConnections.id, marketingResourceSelections.connectionId), eq(integrationConnections.organizationId, context.organizationId), eq(integrationConnections.status, "connected"), eq(integrationConnections.dataPromotionStatus, "approved")))
    .where(and(eq(marketingResourceSelections.organizationId, context.organizationId), inArray(marketingDailyMetrics.resourceSelectionId, sources.map(({ selection }) => selection.id)), gte(marketingDailyMetrics.metricDate, window.previousPeriod.start), lte(marketingDailyMetrics.metricDate, window.period.end)))
    .orderBy(asc(marketingDailyMetrics.metricDate)).limit(25_001);
  // Do not send a silently truncated evidence set to the model.
  if (rows.length > 25_000) return { ...marketingEvidenceSummary([]), limitations: ["Marketing evidence exceeded its safe reporting limit. Choose fewer resources before analysis."] };
  return marketingEvidenceSummary(rows);
}
