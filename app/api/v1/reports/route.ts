import { verifiedPosPublicationSql } from "../../../../server/integrations/pos-publication";
import { recordedLabourCost } from "../../../../domain/labour-evidence";
import { businessTimestampRange, businessTimestampExtrema, businessDatesFromExtrema, type TimestampExtrema } from "../../../../domain/business-period";
import { and, asc, eq, gt, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { dailyBusinessMetrics, dataImports, integrationConnections, integrationLocationMappings } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import {
  ApiError,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
} from "../../../../server/api";
import {
  effectivePermissions,
  requirePermission,
} from "../../../../server/permissions";
import { authorizedLocationDataScope, requireAccessibleLocation } from "../../../../server/location-access";
import { approvedFactSource, noActiveIntegrationLease } from "../../../../server/integrations/trusted-data";
import { authoritativeDailySalesScope } from "../../../../server/integrations/daily-sales-scope";
import { commerceSourceAuthority, defaultCommerceChannel } from "../../../../server/integrations/source-authority";
import { buildCanonicalReportCatalog, buildProviderReportCatalog, reportCapableCommerceProviders } from "../../../../domain/provider-report-contracts";
import type { CanonicalCommerceCoverage } from "../../../../domain/provider-feature-coverage";
import { buildRecordedReportReadiness, recordedDateScopeCoverage, recordedReportCatalogItem } from "../../../../domain/integration-data-readiness";
import { scopeExternalRef } from "../../../../domain/integration-source";
import { providerDisplayName } from "../../../../domain/display-labels";
import { recordAudit } from "../../../../server/audit";
import { reportRequestFeature } from "../../../../domain/paid-feature-routing";

const users = ["owner", "admin", "manager", "employee", "read_only"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const supported = [
  "sales_totals",
  "sales_over_time",
  "gross_profit_summary",
  "discounts_refunds",
  "labour_summary",
] as const;
type ReportId = (typeof supported)[number];
const REPORT_PAGE_SIZE = 500;

import { csvCell } from "../../../../domain/csv";

/** Append provenance columns so existing data columns and one-row-per-record CSVs remain intact. */
export function reportExportProvenance(report: string, readiness: ReturnType<typeof buildRecordedReportReadiness>, lineage: unknown) {
  const { scope, freshness, coverage } = readiness;
  return {
    headers: ["Report", "Organization ID", "Currency", "Business time zone", "Period start", "Period end", "Generated UTC", "Source authority", "Metric certification", "Evidence state", "Oldest source sync UTC", "Latest record update UTC", "Freshness", "Observed date-source records", "Expected date-source records", "Stored query complete", "Provider coverage verified", "Reconciliation", "Calculation version", "Source lineage", "Limitations"],
    values: [report, scope.organizationId, scope.currency, scope.timeZone, scope.from, scope.to, freshness.checkedAt, readiness.authority, readiness.certification, readiness.state, freshness.oldestSourceSyncAt, freshness.latestRecordUpdatedAt, freshness.state, coverage.dateScopes?.observedRecords ?? null, coverage.dateScopes?.expectedRecords ?? null, "yes", "not verified", readiness.reconciliation, readiness.calculationVersion, JSON.stringify(lineage), readiness.limitations.join(" ")],
  };
}

function dateOffset(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDays(start: string, end: string) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function totalsFor(rows: Array<typeof dailyBusinessMetrics.$inferSelect>) {
  const totals = rows.reduce(
    (sum, row) => ({
      grossSalesCents: sum.grossSalesCents + row.grossSalesCents,
      netSalesCents: sum.netSalesCents + row.netSalesCents,
      transactionCount: sum.transactionCount + row.transactionCount,
      unitsSold: sum.unitsSold + row.unitsSold,
      discountsCents: sum.discountsCents + row.discountsCents,
      refundsCents: sum.refundsCents + row.refundsCents,
      costOfGoodsCents: sum.costOfGoodsCents + row.costOfGoodsCents,
      labourCostCents: sum.labourCostCents + row.labourCostCents,
    }),
    { grossSalesCents: 0, netSalesCents: 0, transactionCount: 0, unitsSold: 0, discountsCents: 0, refundsCents: 0, costOfGoodsCents: 0, labourCostCents: 0 },
  );
  return {
    ...totals,
    labourCostCents: rows.length && rows.every(row => recordedLabourCost(row) !== null) ? totals.labourCostCents : null,
    grossProfitCents: totals.netSalesCents - totals.costOfGoodsCents,
    averageTransactionCents: totals.transactionCount ? Math.round(totals.netSalesCents / totals.transactionCount) : null,
  };
}

function change(current: number, previous: number) {
  return previous === 0 ? null : (current - previous) / Math.abs(previous);
}

async function loadAllDailyMetricRows(where: SQL | undefined) {
  const result: Array<typeof dailyBusinessMetrics.$inferSelect> = [];
  let lastId: number | null = null;
  for (;;) {
    const page = await getDb()
      .select()
      .from(dailyBusinessMetrics)
      .where(lastId ? and(where, gt(dailyBusinessMetrics.id, lastId)) : where)
      .orderBy(asc(dailyBusinessMetrics.id))
      .limit(REPORT_PAGE_SIZE);
    result.push(...page);
    if (page.length < REPORT_PAGE_SIZE) break;
    lastId = page.at(-1)!.id;
  }
  return result.sort((left, right) => left.businessDate.localeCompare(right.businessDate) || left.id - right.id);
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const url = new URL(request.url);
    const format = url.searchParams.get("format") || "json";
    const context = await requireAccess(request, users, reportRequestFeature(format));
    await requirePermission(context, "reports.operational");
    await enforceRateLimit("reports:read", context.userId, 60, 60);
    const report = url.searchParams.get("report") as ReportId | null;
    if (!report)
      return jsonResponse({
        supportedReports: supported,
        formats: {
          csv: "live",
          xlsx: "not_configured",
          pdf: "not_configured",
          scheduledDelivery: "not_configured",
        },
      });
    if (!supported.includes(report))
      throw new ApiError(
        400,
        "UNSUPPORTED_REPORT",
        "This report requires a deeper source contract and is not yet available.",
      );
    const permissions = await effectivePermissions(context);
    const canViewProfit = permissions.includes("metrics.profit");
    const canViewRefunds = permissions.includes("sales.refunds");
    const canViewPayroll = permissions.includes("payroll.totals");
    const canViewIntegrationMetadata = permissions.includes("integrations.view");
    const canViewImportMetadata = canViewIntegrationMetadata;
    await requirePermission(context, "metrics.revenue");
    if (report === "gross_profit_summary")
      await requirePermission(context, "metrics.profit");
    if (report === "discounts_refunds")
      await requirePermission(context, "sales.refunds");
    if (report === "labour_summary")
      await requirePermission(context, "payroll.totals");
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const requestedLocationId = url.searchParams.get("location");
    const requestedConnectionId = url.searchParams.get("connection");
    if (requestedConnectionId && !canViewIntegrationMetadata) {
      throw new ApiError(403, "REPORT_SOURCE_UNAVAILABLE", "Viewing a provider-specific source requires integration access.");
    }
    const locationAccess = await authorizedLocationDataScope(context, requestedLocationId);
    const selectedLocation = locationAccess.selectedLocation;
    const locationRefs = locationAccess.locationRefs;
    const locationRestricted = locationRefs !== null;
    const validDate = (value: string) => DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if ((start && !validDate(start)) || (end && !validDate(end)))
      throw new ApiError(400, "INVALID_DATE", "Enter valid report dates.");
    if (start && end && start > end)
      throw new ApiError(400, "INVALID_DATE_RANGE", "The start date must be on or before the end date.");
    const connectedRows = await getDb().select({
      id: integrationConnections.id,
      provider: integrationConnections.provider,
      externalAccountName: integrationConnections.externalAccountName,
      sourceNamespace: integrationConnections.sourceNamespace,
      status: integrationConnections.status,
      dataPromotionStatus: integrationConnections.dataPromotionStatus,
      publicationVerified: sql<boolean>`(${sql.raw(verifiedPosPublicationSql("integration_connections"))})`.mapWith(Boolean),
      lastErrorCode: integrationConnections.lastErrorCode,
      lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
      syncLeaseOwner: integrationConnections.syncLeaseOwner,
      syncLeaseExpiresAt: integrationConnections.syncLeaseExpiresAt,
    }).from(integrationConnections)
      .where(eq(integrationConnections.organizationId, context.organizationId));
    const posProviders = new Set<string>(reportCapableCommerceProviders);
    const posRows = connectedRows.filter((row) => posProviders.has(row.provider));
    const connectedPosRows = posRows.filter((row) => row.status === "connected");
    const now = Date.now();
    const approvedPosRows = connectedPosRows.filter((row) => row.publicationVerified && row.dataPromotionStatus === "approved"
      && (!row.syncLeaseOwner || !row.syncLeaseExpiresAt || row.syncLeaseExpiresAt.getTime() <= now));
    // Provider daily aggregates do not prove attributable cost completeness.
    // Only explicit owner-reviewed summaries may supply recorded costs here.
    const recordedCostFor = (row: typeof dailyBusinessMetrics.$inferSelect) => canViewProfit && !row.sourceConnectionId && (!row.sourceProvider || row.sourceProvider === "manual") ? row.costOfGoodsCents : null;
    const connectedPosProviders = new Set(approvedPosRows.map((row) => row.provider));
    const localLocationIds = locationAccess.locationIds ?? locationAccess.locations.map((location) => location.id);
    const [salesAuthority, paymentAuthority] = await Promise.all([
      commerceSourceAuthority({ organizationId: context.organizationId, localLocationIds, factFamily: "sales" }),
      commerceSourceAuthority({ organizationId: context.organizationId, localLocationIds, factFamily: "payments" }),
    ]);
    const accessibleConnectionIds = new Set([
      ...salesAuthority.candidates.map((candidate) => candidate.connectionId),
      ...paymentAuthority.candidates.map((candidate) => candidate.connectionId),
    ]);
    const scopedApprovedPosRows = approvedPosRows.filter((row) => accessibleConnectionIds.has(row.id));
    if (requestedConnectionId && !scopedApprovedPosRows.some((row) => row.id === requestedConnectionId)) {
      throw new ApiError(403, "REPORT_SOURCE_UNAVAILABLE", "The selected reporting source is not approved and mapped to an accessible location.");
    }
    const presentation = url.searchParams.get("view") === "payment_mix" ? "payment_mix" : "sales";
    const consolidationBlocked = !requestedConnectionId && (salesAuthority.status === "conflict" || (presentation === "payment_mix" && paymentAuthority.status === "conflict"));
    const selectedLocations = new Set(salesAuthority.selections.map(selection => selection.localLocationId));
    const manualLocationIds = localLocationIds.filter(locationId => !selectedLocations.has(locationId));
    const sourcePredicate = authoritativeDailySalesScope({ authority: salesAuthority, localLocationIds, locationRestricted, requestedConnectionId, blocked: consolidationBlocked });
    const paymentScopes = [...new Map((requestedConnectionId
      ? paymentAuthority.candidates.filter((candidate) => candidate.connectionId === requestedConnectionId)
      : paymentAuthority.selections
    ).filter((candidate) => Boolean(candidate.externalOutletRef)).map((candidate) => [
      `${candidate.provider}:${candidate.connectionId}:${candidate.externalOutletRef}`,
      candidate,
    ])).values()];
    const paymentScopeClause = paymentScopes.map(() => "(p.provider = ? AND p.connection_id = ? AND p.outlet_ref = ?)").join(" OR ");
    const paymentScopeBindings = paymentScopes.flatMap((scope) => [
      scope.provider,
      scope.connectionId,
      scope.externalOutletRef!,
    ]);
    const filters = [
      eq(dailyBusinessMetrics.organizationId, context.organizationId),
      approvedFactSource(dailyBusinessMetrics.organizationId, dailyBusinessMetrics.sourceProvider, dailyBusinessMetrics.sourceConnectionId),
    ];
    if (start) filters.push(gte(dailyBusinessMetrics.businessDate, start));
    if (end) filters.push(lte(dailyBusinessMetrics.businessDate, end));
    if (locationRefs !== null)
      filters.push(inArray(dailyBusinessMetrics.locationRef, locationRefs));
    const unscopedRows = await loadAllDailyMetricRows(and(...filters, sourcePredicate));
    const rows = unscopedRows;
    const canViewVerifiedProfit = rows.length > 0 && rows.every(row => recordedCostFor(row) !== null);
    const generatedAt = new Date().toISOString();
    const distinctDates = [...new Set(rows.map((row) => row.businessDate))];
    const paymentWindow = businessTimestampRange("p.paid_at", start, end, context.organization.timezone);
    const rawPaymentBounds = presentation === "payment_mix" && paymentScopes.length && (!start || !end)
      ? await getD1().prepare(`
          SELECT ${businessTimestampExtrema("p.paid_at")}
          FROM commerce_payments p
          WHERE p.organization_id = ? AND (${paymentScopeClause})
            AND p.paid_at IS NOT NULL AND p.amount_cents > 0
            AND ${paymentWindow.sql}
            AND EXISTS (
              SELECT 1 FROM integration_connections approved_source
              WHERE approved_source.id = p.connection_id
                AND approved_source.organization_id = p.organization_id
                AND approved_source.provider = p.provider
                AND approved_source.status = 'connected'
                AND approved_source.data_promotion_status = 'approved'
                AND ${verifiedPosPublicationSql('approved_source')}
                AND (approved_source.sync_lease_owner IS NULL OR approved_source.sync_lease_expires_at IS NULL
                  OR approved_source.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER)))
        `).bind(
          context.organizationId,
          ...paymentScopeBindings,
          ...paymentWindow.bindings,
        ).first<TimestampExtrema>()
      : null;
    const paymentBounds = businessDatesFromExtrema(rawPaymentBounds, context.organization.timezone);
    const resolvedStart = start ?? (presentation === "payment_mix" ? paymentBounds?.earliestDate : distinctDates.at(0)) ?? null;
    const resolvedEnd = end ?? (presentation === "payment_mix" ? paymentBounds?.latestDate : distinctDates.at(-1)) ?? null;
    const expectedDays = resolvedStart && resolvedEnd ? inclusiveDays(resolvedStart, resolvedEnd) : 0;
    const selectedConnection = scopedApprovedPosRows.find((row) => row.id === requestedConnectionId);
    const returnedProviders = [...new Set(rows.map((row) => row.sourceProvider).filter((provider): provider is string => Boolean(provider) && provider !== "manual"))];
    const manualRows = rows.filter((row) => !row.sourceConnectionId);
    const manualImportIds = [...new Set(manualRows.map((row) => row.sourceImportId).filter((importId): importId is string => Boolean(importId)))];
    const manualImports = manualImportIds.length
      ? await getDb().select({ id: dataImports.id, importType: dataImports.importType })
          .from(dataImports)
          .where(and(
            eq(dataImports.organizationId, context.organizationId),
            inArray(dataImports.id, manualImportIds),
          ))
      : [];
    const importTypeById = new Map(manualImports.map((row) => [row.id, row.importType]));
    const sourceKind = (row: typeof dailyBusinessMetrics.$inferSelect) => row.sourceConnectionId
      ? "provider_sync" as const
      : row.sourceImportId
        ? importTypeById.get(row.sourceImportId) ?? "unknown_import"
        : "owner_entry" as const;
    const locationNameById = new Map(locationAccess.locations.map((location) => [location.id, location.name]));
    const selectedSalesLineage = requestedConnectionId
      ? salesAuthority.candidates.filter((candidate) => candidate.connectionId === requestedConnectionId)
      : salesAuthority.selections;
    const selectedPaymentLineage = requestedConnectionId
      ? paymentAuthority.candidates.filter((candidate) => candidate.connectionId === requestedConnectionId)
      : paymentAuthority.selections;
    const selectedSalesConnectionIds = new Set(selectedSalesLineage.map((selection) => selection.connectionId));
    const expectedLocationIds = new Set(requestedConnectionId
      ? salesAuthority.candidates
          .filter((candidate) => selectedSalesConnectionIds.has(candidate.connectionId))
          .map((candidate) => candidate.localLocationId)
      : localLocationIds);
    const localLocationByMetricRef = new Map(salesAuthority.candidates
      .filter((candidate) => Boolean(candidate.metricLocationRef))
      .map((candidate) => [`${candidate.connectionId}:${candidate.metricLocationRef}`, candidate.localLocationId]));
    const normalizedRowLocation = (row: typeof dailyBusinessMetrics.$inferSelect) => row.sourceConnectionId
      ? localLocationByMetricRef.get(`${row.sourceConnectionId}:${row.locationRef}`) ?? row.locationRef
      : row.locationRef;
    if (!expectedLocationIds.size) {
      for (const row of rows) expectedLocationIds.add(normalizedRowLocation(row));
    }
    const currencyAligned = !locationAccess.locations.some(location => expectedLocationIds.has(location.id) && location.currency !== context.organization.currency);
    const verifiedScopeDays = new Set(rows.map((row) => `${row.businessDate}:${normalizedRowLocation(row)}`));
    const expectedRecords = expectedDays * expectedLocationIds.size;
    const manualEvidenceLocations = new Set(manualRows.map((row) => row.locationRef));
    const salesScopeNeedsData = requestedConnectionId
      ? salesAuthority.candidates.some((candidate) => candidate.connectionId === requestedConnectionId && (!candidate.hasFacts || candidate.availability !== "ready"))
      : (salesAuthority.needsData ?? []).some((entry) => !manualEvidenceLocations.has(entry.localLocationId));
    const expectedSalesScopes = [...selectedSalesLineage.flatMap(selection => selection.metricLocationRef ? [JSON.stringify([selection.connectionId, selection.metricLocationRef])] : []),
      ...(!requestedConnectionId ? manualLocationIds.map(id => JSON.stringify([null, id])) : [])];
    const salesDateCoverage = recordedDateScopeCoverage({ from: resolvedStart, to: resolvedEnd, expectedScopes: expectedSalesScopes,
      records: rows.map(row => ({ date: row.businessDate, scope: JSON.stringify([row.sourceConnectionId, row.locationRef]) })) });
    const latestRowTime = rows.reduce((latest, row) => Math.max(latest, Number.isFinite(row.updatedAt.getTime()) ? row.updatedAt.getTime() : 0), 0);
    const readinessFor = (basis: "sales" | "payments", recordCount: number, sourcesAvailable: boolean, latestRecordUpdatedAt: string | null) => {
      const lineage = basis === "sales" ? selectedSalesLineage : selectedPaymentLineage;
      const ids = [...new Set(lineage.map(entry => entry.connectionId))];
      const scopedLocationIds = basis === "sales" ? [...expectedLocationIds] : [...new Set(lineage.map(entry => entry.localLocationId))];
      return buildRecordedReportReadiness({ organizationId: context.organizationId,
        connectionIds: canViewIntegrationMetadata ? ids : [], locationIds: scopedLocationIds,
        currency: context.organization.currency, timeZone: context.organization.timezone, from: resolvedStart, to: resolvedEnd, generatedAt,
        authority: requestedConnectionId ? "provider_specific" : basis === "sales" ? salesAuthority.status : paymentAuthority.status,
        sourceConflict: consolidationBlocked, sourcesAvailable, recordCount,
        dateCoverage: basis === "sales" ? salesDateCoverage : null,
        providerLastSuccessfulSyncAt: ids.map(id => connectedRows.find(connection => connection.id === id)?.lastSuccessfulSyncAt?.toISOString() ?? null),
        latestRecordUpdatedAt,
        limitations: ["Amounts are recorded in workspace currency; no currency conversion is performed.",
          ...(locationAccess.locations.some(location => scopedLocationIds.includes(location.id) && location.currency !== context.organization.currency) ? ["At least one selected location uses another currency. Its currency alignment with normalized facts requires review; growth comparisons are withheld."] : []),
          ...(!canViewVerifiedProfit ? ["Profit and cost values are unavailable under the current permissions or source cost evidence."] : [])],
      });
    };
    const source = {
      type: !canViewIntegrationMetadata && returnedProviders.length
        ? manualRows.length ? "Approved authoritative records plus owner-reviewed summaries" : "Approved authoritative records"
        : selectedConnection
        ? `${providerDisplayName(selectedConnection.provider)} account records`
        : returnedProviders.length && manualRows.length
          ? `${returnedProviders.map((provider) => providerDisplayName(provider)).join(", ")} authoritative records plus owner-reviewed summaries`
          : returnedProviders.length
          ? `${returnedProviders.map((provider) => providerDisplayName(provider)).join(", ")} authoritative records`
          : "Owner-reviewed daily summaries",
      rowCount: rows.length,
      verifiedDays: distinctDates.length,
      expectedDays,
      verifiedRecords: verifiedScopeDays.size,
      expectedRecords,
      expectedLocations: expectedLocationIds.size,
      expectedScopes: expectedLocationIds.size,
      completenessRate: expectedRecords ? verifiedScopeDays.size / expectedRecords : null,
      earliestBusinessDate: presentation === "payment_mix" ? paymentBounds?.earliestDate ?? null : rows.at(0)?.businessDate ?? null,
      latestBusinessDate: presentation === "payment_mix" ? paymentBounds?.latestDate ?? null : rows.at(-1)?.businessDate ?? null,
      generatedAt,
      currency: context.organization.currency,
      timeZone: context.organization.timezone,
      observedDays: distinctDates.length,
      profitAvailability: !canViewProfit ? "permission_required" : canViewVerifiedProfit ? "owner_reviewed" : "needs_cost_evidence",
      readiness: readinessFor("sales", rows.length, !salesScopeNeedsData, latestRowTime ? new Date(latestRowTime).toISOString() : null),
      organizationId: context.organizationId,
      location: selectedLocation?.name ?? (locationRestricted ? "Accessible locations" : "All locations"),
      locationId: selectedLocation?.id ?? null,
      periodStart: resolvedStart,
      periodEnd: resolvedEnd,
      providerScoped: Boolean(selectedConnection || returnedProviders.length),
      connectionId: canViewIntegrationMetadata ? requestedConnectionId : null,
      accountName: canViewIntegrationMetadata ? selectedConnection?.externalAccountName ?? null : null,
      consolidationStatus: requestedConnectionId ? "provider_specific" : salesAuthority.status,
      lineage: {
        sales: canViewIntegrationMetadata ? selectedSalesLineage.map((selection) => {
          const locationId = selection.localLocationId;
          return ({
          locationId,
          locationName: locationNameById.get(locationId) ?? "Accessible location",
          channel: selection.channel ?? defaultCommerceChannel(selection.provider),
          provider: selection.provider,
          accountName: selection.accountName ?? null,
          connectionId: selection.connectionId,
          mode: "mode" in selection ? selection.mode : "provider_specific",
          metricLocationRef: selection.metricLocationRef ?? null,
        });}) : [],
        payments: canViewIntegrationMetadata ? selectedPaymentLineage.map((selection) => {
          const locationId = selection.localLocationId;
          return ({
          locationId,
          locationName: locationNameById.get(locationId) ?? "Accessible location",
          channel: selection.channel ?? defaultCommerceChannel(selection.provider),
          provider: selection.provider,
          accountName: selection.accountName ?? null,
          connectionId: selection.connectionId,
          mode: "mode" in selection ? selection.mode : "provider_specific",
          externalOutletRef: selection.externalOutletRef ?? null,
        });}) : [],
        manualLocationIds,
        manual: {
          rowCount: manualRows.length,
          imports: canViewImportMetadata
            ? manualImportIds.map((id) => ({ id, importType: importTypeById.get(id) ?? "unknown_import" }))
            : [],
          locationRefs: [...new Set(manualRows.map((row) => row.locationRef))],
        },
      },
    };
    if (format === "csv" && consolidationBlocked) {
      throw new ApiError(409, "SOURCE_AUTHORITY_REQUIRED", "Resolve the reporting source conflict before exporting consolidated data.");
    }
    if (format === "csv" && presentation === "sales") {
      if (salesScopeNeedsData || !rows.length) {
        throw new ApiError(409, "REPORT_DATA_INCOMPLETE", "Recorded sales evidence is not available for every authoritative location in this export.");
      }
      await requirePermission(context, "reports.export");
      const provenance = reportExportProvenance(report, source.readiness, source.lineage);
      const headers = [
        "Business date",
        "Location",
        "Source kind",
        "Source provider",
        "Source account",
        "Source connection",
        "Source import",
        "Gross sales (minor units)",
        "Net sales (minor units)",
        "Transactions",
        "Units",
        "Discounts (minor units)",
        "Refunds (minor units)",
        "Cost of goods (minor units)",
        "Gross profit (minor units)",
        "Labour cost (minor units)",
        ...provenance.headers,
      ];
      const lines = rows.map((row) =>
        [
          row.businessDate,
          row.locationRef,
          sourceKind(row),
          canViewIntegrationMetadata ? row.sourceProvider ?? "manual" : "",
          canViewIntegrationMetadata ? connectedRows.find((connection) => connection.id === row.sourceConnectionId)?.externalAccountName ?? "" : "",
          canViewIntegrationMetadata ? row.sourceConnectionId ?? "manual" : "",
          canViewImportMetadata ? row.sourceImportId ?? "" : "",
          row.grossSalesCents,
          row.netSalesCents,
          row.transactionCount,
          row.unitsSold,
          canViewRefunds ? row.discountsCents : null,
          canViewRefunds ? row.refundsCents : null,
          recordedCostFor(row),
          recordedCostFor(row) !== null
            ? row.netSalesCents - row.costOfGoodsCents
            : null,
          canViewPayroll ? recordedLabourCost(row) : null,
          ...provenance.values,
        ]
          .map(csvCell)
          .join(","),
      );
      return new Response([headers.join(","), ...lines].join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="vanteloq-${report}-${generatedAt.slice(0, 10)}.csv"`,
          "Cache-Control": "private, no-store",
          "X-Report-Generated-At": generatedAt,
        },
      });
    }
    const totals = totalsFor(rows);
    let comparisonRows: Array<typeof dailyBusinessMetrics.$inferSelect> = [];
    let comparisonPeriod: { start: string; end: string } | null = null;
    if (resolvedStart && resolvedEnd) {
      const days = inclusiveDays(resolvedStart, resolvedEnd);
      const comparisonEnd = dateOffset(resolvedStart, -1);
      const comparisonStart = dateOffset(comparisonEnd, -(days - 1));
      comparisonPeriod = { start: comparisonStart, end: comparisonEnd };
      const comparisonFilters = [
        eq(dailyBusinessMetrics.organizationId, context.organizationId),
        approvedFactSource(dailyBusinessMetrics.organizationId, dailyBusinessMetrics.sourceProvider, dailyBusinessMetrics.sourceConnectionId),
        gte(dailyBusinessMetrics.businessDate, comparisonStart),
        lte(dailyBusinessMetrics.businessDate, comparisonEnd),
      ];
      if (locationRefs !== null) comparisonFilters.push(inArray(dailyBusinessMetrics.locationRef, locationRefs));
      comparisonRows = await loadAllDailyMetricRows(and(...comparisonFilters, sourcePredicate));
    }
    const comparisonCostsVerified = comparisonRows.length > 0 && comparisonRows.every(row => recordedCostFor(row) !== null);
    const comparisonTotals = totalsFor(comparisonRows);
    const comparisonDateCoverage = recordedDateScopeCoverage({ from: comparisonPeriod?.start ?? null, to: comparisonPeriod?.end ?? null, expectedScopes: expectedSalesScopes,
      records: comparisonRows.map(row => ({ date: row.businessDate, scope: JSON.stringify([row.sourceConnectionId, row.locationRef]) })) });
    const comparisonLimitations = [
      ...(!salesDateCoverage.complete || !comparisonDateCoverage.complete ? ["Both periods must contain every selected date and source record. Missing dates remain unknown."] : []),
      ...(!currencyAligned ? ["Currency alignment is unresolved across the selected locations."] : []),
      ...(selectedSalesLineage.length && source.readiness.freshness.state !== "current" ? ["At least one selected provider has stale or unknown sync freshness."] : []),
      ...(salesScopeNeedsData || consolidationBlocked ? ["Authoritative source evidence is unavailable or unresolved."] : []),
    ];
    const comparable = presentation === "sales" && comparisonLimitations.length === 0;
    const resolvedPaymentWindow = businessTimestampRange("p.paid_at", resolvedStart, resolvedEnd, context.organization.timezone);
    const paymentMixResult = !consolidationBlocked && paymentScopes.length && resolvedStart && resolvedEnd
      ? await getD1().prepare(`
          SELECT p.provider, p.connection_id AS connectionId, p.category, p.payment_type_name AS paymentTypeName,
                 SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS amountCents,
                 COUNT(DISTINCT CASE WHEN amount_cents > 0 THEN external_sale_id END) AS transactionCount,
                 MAX(p.updated_at) AS latestUpdatedAt
          FROM commerce_payments p
          WHERE p.organization_id = ? AND (${paymentScopeClause}) AND p.paid_at IS NOT NULL AND p.amount_cents > 0
            AND ${resolvedPaymentWindow.sql}
            AND EXISTS (
              SELECT 1 FROM integration_connections approved_source
              WHERE approved_source.id = p.connection_id
                AND approved_source.organization_id = p.organization_id
                AND approved_source.provider = p.provider
                AND approved_source.status = 'connected'
                AND approved_source.data_promotion_status = 'approved'
                AND ${verifiedPosPublicationSql('approved_source')}
                AND (approved_source.sync_lease_owner IS NULL OR approved_source.sync_lease_expires_at IS NULL
                  OR approved_source.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER)))
          GROUP BY p.provider, p.connection_id, p.category, p.payment_type_name
          ORDER BY amountCents DESC
        `).bind(context.organizationId, ...paymentScopeBindings, ...resolvedPaymentWindow.bindings).all<{
          provider: string;
          connectionId: string;
          category: string;
          paymentTypeName: string | null;
          amountCents: number;
          transactionCount: number;
          latestUpdatedAt: number;
        }>()
      : { results: [] };
    const paymentRows = (paymentMixResult.results ?? [])
      .filter((row) => connectedPosProviders.has(row.provider))
      .map((row) => ({ ...row, amountCents: Number(row.amountCents), transactionCount: Number(row.transactionCount) }));
    const paymentMix = paymentRows
      .reduce<Array<{ category: string; paymentTypeName: string | null; amountCents: number; transactionCount: number }>>((combined, row) => {
        const existing = combined.find((item) => item.category === row.category && item.paymentTypeName === row.paymentTypeName);
        if (existing) {
          existing.amountCents += Number(row.amountCents);
          existing.transactionCount += Number(row.transactionCount);
        } else {
          combined.push({ category: row.category, paymentTypeName: row.paymentTypeName, amountCents: Number(row.amountCents), transactionCount: Number(row.transactionCount) });
        }
        return combined;
      }, []);
    const paymentScopeNeedsData = requestedConnectionId
      ? paymentAuthority.candidates.some((candidate) => candidate.connectionId === requestedConnectionId && (!candidate.hasFacts || candidate.availability !== "ready"))
      : paymentAuthority.status === "needs_data";
    if (presentation === "payment_mix") {
      const latest = paymentRows.reduce((value, row) => Math.max(value, Number(row.latestUpdatedAt) || 0), 0);
      source.readiness = readinessFor("payments", paymentRows.length, !paymentScopeNeedsData, latest ? new Date(latest * 1000).toISOString() : null);
    }
    if (format === "csv" && presentation === "payment_mix") {
      if (paymentScopeNeedsData || !paymentMix.length) {
        throw new ApiError(409, "REPORT_DATA_INCOMPLETE", "Recorded payment evidence is not available for every authoritative location in this export.");
      }
      await requirePermission(context, "reports.export");
      const provenance = reportExportProvenance("payment_mix", source.readiness, source.lineage);
      const headers = ["Source provider", "Source account", "Source connection", "Payment category", "Payment type", "Amount (minor units)", "Recorded payments", ...provenance.headers];
      const lines = paymentRows.map((row) => [
        row.provider,
        canViewIntegrationMetadata ? connectedRows.find((connection) => connection.id === row.connectionId)?.externalAccountName ?? "" : "",
        canViewIntegrationMetadata ? row.connectionId : "",
        row.category,
        row.paymentTypeName,
        row.amountCents,
        row.transactionCount,
        ...provenance.values,
      ].map(csvCell).join(","));
      return new Response([headers.join(","), ...lines].join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="vanteloq-payment-mix-${generatedAt.slice(0, 10)}.csv"`,
          "Cache-Control": "private, no-store",
          "X-Report-Generated-At": generatedAt,
        },
      });
    }
    const catalogDimensionsAllowed = canViewIntegrationMetadata && !locationRestricted;
    const connectionCoverage = await Promise.all(scopedApprovedPosRows.map(async (connection) => {
      const connectionScopes = salesAuthority.candidates.filter((candidate) => candidate.connectionId === connection.id);
      const metricRefs = [...new Set(connectionScopes.map((candidate) => candidate.metricLocationRef).filter((value): value is string => Boolean(value)))];
      const outletRefs = [...new Set(connectionScopes.map((candidate) => candidate.externalOutletRef).filter((value): value is string => Boolean(value)))];
      const scopedLocationIds = [...new Set(connectionScopes.map((candidate) => candidate.localLocationId))];
      const metricPlaceholders = metricRefs.map(() => "?").join(", ") || "NULL";
      const outletPlaceholders = outletRefs.map(() => "?").join(", ") || "NULL";
      const locationPlaceholders = scopedLocationIds.map(() => "?").join(", ") || "NULL";
      const salesDateClause = `${start ? " AND business_date >= ?" : ""}${end ? " AND business_date <= ?" : ""}`;
      const coverageWindow = businessTimestampRange("paid_at", start, end, context.organization.timezone);
      const paymentDateClause = ` AND ${coverageWindow.sql}`;
      const salesDates = [start, end].filter((value): value is string => Boolean(value));
      const [salesFact, paymentFact, productFact, inventoryFact, customerFact, supplierFact, locationFact] = await Promise.all([
        getD1().prepare(`SELECT COUNT(*) count FROM daily_business_metrics WHERE organization_id = ? AND source_connection_id = ? AND location_ref IN (${metricPlaceholders})${salesDateClause}`).bind(context.organizationId, connection.id, ...metricRefs, ...salesDates).first<{ count: number }>(),
        getD1().prepare(`SELECT COUNT(*) count FROM commerce_payments WHERE organization_id = ? AND connection_id = ? AND outlet_ref IN (${outletPlaceholders}) AND paid_at IS NOT NULL AND amount_cents > 0${paymentDateClause}`).bind(context.organizationId, connection.id, ...outletRefs, ...coverageWindow.bindings).first<{ count: number }>(),
        catalogDimensionsAllowed
          ? getD1().prepare("SELECT COUNT(*) count FROM commerce_products WHERE organization_id = ? AND connection_id = ? AND archived = 0").bind(context.organizationId, connection.id).first<{ count: number }>()
          : Promise.resolve(null),
        getD1().prepare(`SELECT COUNT(*) count FROM inventory_balances WHERE organization_id = ? AND source_connection_id = ? AND location_ref IN (${metricPlaceholders})`).bind(context.organizationId, connection.id, ...metricRefs).first<{ count: number }>(),
        catalogDimensionsAllowed
          ? getD1().prepare("SELECT COUNT(*) count FROM commerce_customers WHERE organization_id = ? AND connection_id = ? AND archived = 0").bind(context.organizationId, connection.id).first<{ count: number }>()
          : Promise.resolve(null),
        catalogDimensionsAllowed
          ? getD1().prepare("SELECT COUNT(*) count FROM commerce_suppliers WHERE organization_id = ? AND connection_id = ? AND archived = 0").bind(context.organizationId, connection.id).first<{ count: number }>()
          : Promise.resolve(null),
        getD1().prepare(`SELECT COUNT(*) count FROM integration_location_mappings WHERE organization_id = ? AND connection_id = ? AND status = 'mapped' AND local_location_id IN (${locationPlaceholders})`).bind(context.organizationId, connection.id, ...scopedLocationIds).first<{ count: number }>(),
      ]);
      const coverage: CanonicalCommerceCoverage = {
        sales: Number(salesFact?.count ?? 0) > 0,
        payments: Number(paymentFact?.count ?? 0) > 0,
        products: Number(productFact?.count ?? 0) > 0,
        inventory: Number(inventoryFact?.count ?? 0) > 0,
        customers: Number(customerFact?.count ?? 0) > 0,
        suppliers: Number(supplierFact?.count ?? 0) > 0,
        locations: Number(locationFact?.count ?? 0) > 0,
      };
      const catalog = buildProviderReportCatalog({ provider: connection.provider, connectionId: connection.id, coverage });
      return {
        coverage,
        catalog: {
          ...catalog,
          canonicalReports: catalog.canonicalReports.map(item => recordedReportCatalogItem(item)),
          providerReports: catalog.providerReports.map(item => recordedReportCatalogItem(item)),
          accountName: connection.externalAccountName,
        },
      };
    }));
    const canonicalCoverage: CanonicalCommerceCoverage = {
      sales: rows.length > 0 || connectionCoverage.some((entry) => entry.coverage.sales),
      payments: paymentMix.length > 0 || connectionCoverage.some((entry) => entry.coverage.payments),
      products: connectionCoverage.some((entry) => entry.coverage.products),
      inventory: connectionCoverage.some((entry) => entry.coverage.inventory),
      customers: connectionCoverage.some((entry) => entry.coverage.customers),
      suppliers: connectionCoverage.some((entry) => entry.coverage.suppliers),
      locations: new Set(rows.map((row) => row.locationRef)).size > 0 || connectionCoverage.some((entry) => entry.coverage.locations),
    };
    const reportHasData = presentation === "payment_mix"
      ? paymentMix.length > 0 && !paymentScopeNeedsData
      : rows.length > 0 && !salesScopeNeedsData;
    const reportStatus = consolidationBlocked ? "source_conflict" as const : reportHasData ? "ready" as const : "needs_data" as const;
    const redactAuthority = (authority: typeof salesAuthority) => canViewIntegrationMetadata ? authority : ({
      status: authority.status,
      authoritativeConnectionIds: [],
      conflicts: authority.conflicts.map(({ localLocationId, channel, expectedVersion }) => ({ localLocationId, channel, expectedVersion, candidates: [] })),
      selections: authority.selections.map(({ localLocationId, channel, provider, mode }) => ({ localLocationId, channel, provider, mode })),
      candidates: [],
      needsData: (authority.needsData ?? []).map(({ localLocationId, channel }) => ({ localLocationId, channel, candidates: [] })),
    });
    const visibleSalesAuthority = redactAuthority(salesAuthority);
    const visiblePaymentAuthority = redactAuthority(paymentAuthority);
    return jsonResponse({
      report,
      reportStatus,
      source,
      sourceAuthority: {
        sales: { ...visibleSalesAuthority, conflicts: visibleSalesAuthority.conflicts.map((conflict) => ({ ...conflict, locationName: locationNameById.get(conflict.localLocationId) ?? "Accessible location" })) },
        payments: { ...visiblePaymentAuthority, conflicts: visiblePaymentAuthority.conflicts.map((conflict) => ({ ...conflict, locationName: locationNameById.get(conflict.localLocationId) ?? "Accessible location" })) },
        providerSpecific: Boolean(requestedConnectionId),
      },
      canonicalReportCatalog: buildCanonicalReportCatalog(canonicalCoverage).map(item => recordedReportCatalogItem(item, consolidationBlocked)),
      providerReportCatalogs: canViewIntegrationMetadata ? connectionCoverage.map((entry) => entry.catalog) : [],
      canResolveSourceAuthority: permissions.includes("integrations.manage"),
      canExport: permissions.includes("reports.export"),
      totals: consolidationBlocked || !reportHasData ? null : {
        ...totals,
        discountsCents: canViewRefunds ? totals.discountsCents : null,
        refundsCents: canViewRefunds ? totals.refundsCents : null,
        costOfGoodsCents: canViewVerifiedProfit
          ? totals.costOfGoodsCents
          : null,
        labourCostCents: canViewPayroll
          ? totals.labourCostCents
          : null,
        grossProfitCents: canViewVerifiedProfit ? totals.grossProfitCents : null,
      },
      comparison: !consolidationBlocked && comparisonPeriod && comparisonRows.length ? {
        periodStart: comparisonPeriod.start,
        periodEnd: comparisonPeriod.end,
        comparable,
        coverage: comparisonDateCoverage,
        limitations: comparisonLimitations,
        verifiedDays: new Set(comparisonRows.map((row) => row.businessDate)).size,
        totals: {
          netSalesCents: comparisonTotals.netSalesCents,
          grossProfitCents: comparisonCostsVerified ? comparisonTotals.grossProfitCents : null,
          transactionCount: comparisonTotals.transactionCount,
          averageTransactionCents: comparisonTotals.averageTransactionCents,
        },
        changes: {
          netSalesRate: comparable ? change(totals.netSalesCents, comparisonTotals.netSalesCents) : null,
          grossProfitRate: comparable && canViewVerifiedProfit && comparisonCostsVerified ? change(totals.grossProfitCents, comparisonTotals.grossProfitCents) : null,
          transactionRate: comparable ? change(totals.transactionCount, comparisonTotals.transactionCount) : null,
          averageTransactionRate: comparable && totals.averageTransactionCents !== null && comparisonTotals.averageTransactionCents !== null
            ? change(totals.averageTransactionCents, comparisonTotals.averageTransactionCents)
            : null,
        },
      } : null,
      paymentMix,
      rows: consolidationBlocked ? [] : rows.map((row) => ({
        businessDate: row.businessDate,
        locationRef: row.locationRef,
        sourceProvider: canViewIntegrationMetadata ? row.sourceProvider : null,
        sourceConnectionId: canViewIntegrationMetadata ? row.sourceConnectionId : null,
        sourceImportId: canViewImportMetadata ? row.sourceImportId : null,
        sourceKind: sourceKind(row),
        netSalesCents: row.netSalesCents,
        costOfGoodsCents: recordedCostFor(row),
        transactionCount: row.transactionCount,
      })),
      explainAndAct: consolidationBlocked ? {
        executiveSummary: "Consolidated totals are withheld until an authoritative source is selected for each overlapping location.",
        likelyDrivers: "Two or more approved sources cover the same location and channel.",
        confidence: "blocked",
        recommendedAction: "Ask an owner or admin to choose the authoritative reporting source.",
      } : presentation === "payment_mix" ? {
        executiveSummary: paymentRows.length ? "Recorded collections are grouped by payment type for the selected business-date range. They are not reconciled sales or profit." : "No recorded payments match the selected filters.",
        significantChanges: "Comparable payment-period completeness has not been verified.",
        likelyDrivers: "Payment categories do not establish product, customer or revenue drivers.",
        confidence: "not_certified",
        recommendedAction: "Review the source payments and reconcile collections against sales and bank evidence.",
      } : {
        executiveSummary: rows.length
          ? `${distinctDates.length} recorded day${distinctDates.length === 1 ? "" : "s"} are included${expectedDays && distinctDates.length < expectedDays ? ` across a ${expectedDays}-day range` : ""}. Completeness and reconciliation are not certified.`
          : "No recorded daily sales match the selected filters.",
        significantChanges: comparable && comparisonRows.length && comparisonTotals.netSalesCents !== 0
          ? `Recorded net sales changed ${new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(change(totals.netSalesCents, comparisonTotals.netSalesCents)!)} versus the preceding date range. This is a comparison of stored facts, not certified performance.`
          : "Comparable date and source coverage, currency alignment and a nonzero preceding baseline are required to report a percentage change.",
        likelyDrivers:
          "Daily aggregates cannot isolate product, customer, supplier or hourly drivers.",
        confidence: "not_certified",
        supportingRecords: rows
          .map((row) => `${row.businessDate}:${row.locationRef}`)
          .slice(0, 50),
        recommendedAction: rows.length
          ? "Review the supporting daily records, then connect line-item data for driver analysis."
          : "Adjust the report filters or import the missing period.",
      },
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, ["owner", "admin"], "reporting.basic");
    await requirePermission(context, "integrations.manage");
    await enforceRateLimit("reports:source-authority", context.userId, 30, 3_600);
    const body = await readJsonObject(request, 8_192);
    const families = ["sales", "payments", "inventory", "products", "customers", "suppliers"] as const;
    if (body.action !== "set_source_authority" || typeof body.locationId !== "string" || typeof body.connectionId !== "string" || typeof body.factFamily !== "string" || !families.includes(body.factFamily as typeof families[number]) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
      throw new ApiError(400, "INVALID_SOURCE_AUTHORITY", "Choose a location and an approved reporting connection.");
    }
    await requireAccessibleLocation(context, body.locationId);
    const mappings = await getDb().select({
      provider: integrationLocationMappings.provider,
      connectionId: integrationLocationMappings.connectionId,
      externalLocationRef: integrationLocationMappings.externalLocationRef,
      sourceNamespace: integrationConnections.sourceNamespace,
    }).from(integrationLocationMappings).innerJoin(integrationConnections, and(
      eq(integrationConnections.id, integrationLocationMappings.connectionId),
      eq(integrationConnections.organizationId, integrationLocationMappings.organizationId),
      eq(integrationConnections.status, "connected"),
      eq(integrationConnections.dataPromotionStatus, "approved"),
      sql.raw(verifiedPosPublicationSql("integration_connections")),
      noActiveIntegrationLease(integrationConnections.syncLeaseOwner, integrationConnections.syncLeaseExpiresAt),
    )).where(and(
      eq(integrationLocationMappings.organizationId, context.organizationId),
      eq(integrationLocationMappings.localLocationId, body.locationId),
      eq(integrationLocationMappings.connectionId, body.connectionId),
      eq(integrationLocationMappings.status, "mapped"),
    ));
    const mapping = mappings[0];
    if (!mapping) throw new ApiError(404, "REPORT_SOURCE_UNAVAILABLE", "This connection is not an approved source mapped to the selected location.");
    const scopedOutletRefs = mappings.map((item) => scopeExternalRef(item.sourceNamespace, item.externalLocationRef)).filter((value): value is string => Boolean(value));
    if (!scopedOutletRefs.length) throw new ApiError(409, "REPORT_SOURCE_LOCATION_MISSING", "This connection does not have a usable external location reference.");
    const metricLocationRefs = scopedOutletRefs.map((outletRef) => `${mapping.provider}:${outletRef}`);
    const outletPlaceholders = scopedOutletRefs.map(() => "?").join(", ");
    const metricPlaceholders = metricLocationRefs.map(() => "?").join(", ");
    const factCountSql: Record<typeof families[number], { sql: string; bindings: string[] }> = {
      sales: { sql: `SELECT COUNT(*) count FROM daily_business_metrics WHERE organization_id = ? AND source_connection_id = ? AND location_ref IN (${metricPlaceholders})`, bindings: [context.organizationId, mapping.connectionId, ...metricLocationRefs] },
      payments: { sql: `SELECT COUNT(*) count FROM commerce_payments WHERE organization_id = ? AND connection_id = ? AND outlet_ref IN (${outletPlaceholders}) AND paid_at IS NOT NULL AND amount_cents > 0`, bindings: [context.organizationId, mapping.connectionId, ...scopedOutletRefs] },
      inventory: { sql: `SELECT COUNT(*) count FROM inventory_balances WHERE organization_id = ? AND source_connection_id = ? AND location_ref IN (${metricPlaceholders})`, bindings: [context.organizationId, mapping.connectionId, ...metricLocationRefs] },
      products: { sql: "SELECT COUNT(*) count FROM commerce_products WHERE organization_id = ? AND connection_id = ? AND archived = 0", bindings: [context.organizationId, mapping.connectionId] },
      customers: { sql: "SELECT COUNT(*) count FROM commerce_customers WHERE organization_id = ? AND connection_id = ? AND archived = 0", bindings: [context.organizationId, mapping.connectionId] },
      suppliers: { sql: "SELECT COUNT(*) count FROM commerce_suppliers WHERE organization_id = ? AND connection_id = ? AND archived = 0", bindings: [context.organizationId, mapping.connectionId] },
    };
    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const channel = defaultCommerceChannel(mapping.provider);
    const database = getD1();
    const factFamily = body.factFamily as typeof families[number];
    const factCheck = factCountSql[factFamily];
    const factCount = await database.prepare(factCheck.sql).bind(...factCheck.bindings).first<{ count: number }>();
    if (Number(factCount?.count ?? 0) === 0) {
      throw new ApiError(409, "REPORT_SOURCE_FACTS_MISSING", `This connection has no approved ${factFamily} facts for the selected location.`);
    }
    const expectedVersion = Number(body.expectedVersion);
    const eligibilitySql = `EXISTS (
      SELECT 1
      FROM integration_location_mappings mapped
      JOIN integration_connections active
        ON active.id = mapped.connection_id
       AND active.organization_id = mapped.organization_id
       AND active.provider = mapped.provider
      WHERE mapped.organization_id = ? AND mapped.local_location_id = ?
        AND mapped.connection_id = ? AND mapped.provider = ? AND mapped.status = 'mapped'
        AND active.status = 'connected' AND active.data_promotion_status = 'approved'
        AND (active.sync_lease_owner IS NULL OR active.sync_lease_expires_at IS NULL
          OR active.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
    )`;
    const eligibilityBindings = [context.organizationId, body.locationId, mapping.connectionId, mapping.provider];
    const result = expectedVersion === 0
      ? await database.prepare(`
          INSERT OR IGNORE INTO integration_source_authorities (
            id, organization_id, local_location_id, channel, fact_family, provider,
            connection_id, created_by_user_id, updated_by_user_id, version, created_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
          WHERE ${eligibilitySql}
            AND (SELECT count FROM (${factCheck.sql})) > 0
        `).bind(
          crypto.randomUUID(), context.organizationId, body.locationId, channel,
          factFamily, mapping.provider, mapping.connectionId, context.userId,
          context.userId, nowSeconds, nowSeconds,
          ...eligibilityBindings, ...factCheck.bindings,
        ).run()
      : await database.prepare(`
          UPDATE integration_source_authorities
          SET provider = ?, connection_id = ?, updated_by_user_id = ?,
              version = version + 1, updated_at = ?
          WHERE organization_id = ? AND local_location_id = ? AND channel = ?
            AND fact_family = ? AND version = ?
            AND ${eligibilitySql}
            AND (SELECT count FROM (${factCheck.sql})) > 0
        `).bind(
          mapping.provider, mapping.connectionId, context.userId, nowSeconds,
          context.organizationId, body.locationId, channel, factFamily, expectedVersion,
          ...eligibilityBindings, ...factCheck.bindings,
        ).run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, "REPORT_SOURCE_CHANGED", "The reporting source or its data changed before this choice could be saved. Refresh and try again.");
    }
    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "reports.source_authority_selected",
      resourceType: "integration_source_authority",
      resourceId: `${body.locationId}:${channel}`,
      details: { locationId: body.locationId, channel, factFamily, provider: mapping.provider, connectionId: mapping.connectionId },
    });
    return jsonResponse({ selected: true, locationId: body.locationId, channel, factFamily, provider: mapping.provider, connectionId: mapping.connectionId });
  });
}
