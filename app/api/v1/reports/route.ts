import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { dailyBusinessMetrics, integrationConnections } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import {
  ApiError,
  enforceRateLimit,
  handleApi,
  jsonResponse,
} from "../../../../server/api";
import {
  effectivePermissions,
  requirePermission,
} from "../../../../server/permissions";
import { authorizedLocationDataScope } from "../../../../server/location-access";
import { approvedFactSource } from "../../../../server/integrations/trusted-data";

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

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
    grossProfitCents: totals.netSalesCents - totals.costOfGoodsCents,
    averageTransactionCents: totals.transactionCount ? Math.round(totals.netSalesCents / totals.transactionCount) : null,
  };
}

function change(current: number, previous: number) {
  return previous === 0 ? null : (current - previous) / Math.abs(previous);
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, users);
    await requirePermission(context, "reports.operational");
    await enforceRateLimit("reports:read", context.userId, 60, 60);
    const url = new URL(request.url);
    const report = url.searchParams.get("report") as ReportId | null;
    const format = url.searchParams.get("format") || "json";
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
    const locationAccess = await authorizedLocationDataScope(context, requestedLocationId);
    const selectedLocation = locationAccess.selectedLocation;
    const locationRefs = locationAccess.locationRefs;
    const locationRestricted = locationRefs !== null;
    if ((start && !DATE.test(start)) || (end && !DATE.test(end)))
      throw new ApiError(400, "INVALID_DATE", "Enter valid report dates.");
    if (start && end && start > end)
      throw new ApiError(400, "INVALID_DATE_RANGE", "The start date must be on or before the end date.");
    const connectedRows = await getDb().select({
      id: integrationConnections.id,
      provider: integrationConnections.provider,
      sourceNamespace: integrationConnections.sourceNamespace,
      status: integrationConnections.status,
      dataPromotionStatus: integrationConnections.dataPromotionStatus,
      syncLeaseOwner: integrationConnections.syncLeaseOwner,
      syncLeaseExpiresAt: integrationConnections.syncLeaseExpiresAt,
    }).from(integrationConnections)
      .where(eq(integrationConnections.organizationId, context.organizationId));
    const posProviders = new Set(["lightspeed", "lightspeed-r", "shopify", "shopify-pos", "square", "clover", "moneris"]);
    const posRows = connectedRows.filter((row) => posProviders.has(row.provider));
    const connectedPosRows = posRows.filter((row) => row.status === "connected");
    const now = Date.now();
    const approvedPosRows = connectedPosRows.filter((row) => row.dataPromotionStatus === "approved"
      && (!row.syncLeaseOwner || !row.syncLeaseExpiresAt || row.syncLeaseExpiresAt.getTime() <= now));
    const connectedPosProviders = new Set(approvedPosRows.map((row) => row.provider));
    const approvedConnectionIds = approvedPosRows.map((row) => row.id);
    const filters = [
      eq(dailyBusinessMetrics.organizationId, context.organizationId),
      approvedFactSource(dailyBusinessMetrics.organizationId, dailyBusinessMetrics.sourceProvider, dailyBusinessMetrics.sourceConnectionId),
    ];
    if (start) filters.push(gte(dailyBusinessMetrics.businessDate, start));
    if (end) filters.push(lte(dailyBusinessMetrics.businessDate, end));
    if (locationRefs !== null)
      filters.push(inArray(dailyBusinessMetrics.locationRef, locationRefs));
    const unscopedRows = await getDb()
      .select()
      .from(dailyBusinessMetrics)
      .where(and(...filters))
      .orderBy(asc(dailyBusinessMetrics.businessDate))
      .limit(1000);
    const rows = unscopedRows;
    const generatedAt = new Date().toISOString();
    const distinctDates = [...new Set(rows.map((row) => row.businessDate))];
    const resolvedStart = start ?? distinctDates.at(0) ?? null;
    const resolvedEnd = end ?? distinctDates.at(-1) ?? null;
    const expectedDays = resolvedStart && resolvedEnd ? inclusiveDays(resolvedStart, resolvedEnd) : 0;
    const source = {
      type: connectedPosProviders.size
        ? `${[...connectedPosProviders].map((provider) => provider.replaceAll("-", " ")).join(", ")} normalized records`
        : "Imported daily summaries",
      rowCount: rows.length,
      verifiedDays: distinctDates.length,
      expectedDays,
      completenessRate: expectedDays ? distinctDates.length / expectedDays : null,
      earliestBusinessDate: rows.at(0)?.businessDate ?? null,
      latestBusinessDate: rows.at(-1)?.businessDate ?? null,
      generatedAt,
      organizationId: context.organizationId,
      location: selectedLocation?.name ?? (locationRestricted ? "Accessible locations" : "All locations"),
      locationId: selectedLocation?.id ?? null,
      periodStart: resolvedStart,
      periodEnd: resolvedEnd,
      providerScoped: connectedPosProviders.size > 0,
    };
    if (format === "csv") {
      await requirePermission(context, "reports.export");
      const headers = [
        "Business date",
        "Location",
        "Gross sales (minor units)",
        "Net sales (minor units)",
        "Transactions",
        "Units",
        "Discounts (minor units)",
        "Refunds (minor units)",
        "Cost of goods (minor units)",
        "Gross profit (minor units)",
        "Labour cost (minor units)",
      ];
      const lines = rows.map((row) =>
        [
          row.businessDate,
          row.locationRef,
          row.grossSalesCents,
          row.netSalesCents,
          row.transactionCount,
          row.unitsSold,
          canViewRefunds ? row.discountsCents : null,
          canViewRefunds ? row.refundsCents : null,
          canViewProfit ? row.costOfGoodsCents : null,
          canViewProfit
            ? row.netSalesCents - row.costOfGoodsCents
            : null,
          canViewPayroll ? row.labourCostCents : null,
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
      comparisonRows = await getDb().select().from(dailyBusinessMetrics).where(and(...comparisonFilters)).orderBy(asc(dailyBusinessMetrics.businessDate)).limit(1000);
    }
    const comparisonTotals = totalsFor(comparisonRows);
    const paymentLocations = locationAccess.providerLocations ?? [];
    const paymentLocationClause = locationRestricted
      ? ` AND (${paymentLocations.map(() => "(provider = ? AND connection_id = ? AND outlet_ref = ?)").join(" OR ") || "0 = 1"})`
      : "";
    const paymentLocationBindings = paymentLocations.flatMap((location) => [
      location.provider,
      location.connectionId,
      location.externalLocationRef,
    ]);
    const paymentMixResult = connectedPosProviders.size && resolvedStart && resolvedEnd && (!locationRestricted || paymentLocations.length)
      ? await getD1().prepare(`
          SELECT provider, category, payment_type_name AS paymentTypeName,
                 SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS amountCents,
                 COUNT(DISTINCT CASE WHEN amount_cents > 0 THEN external_sale_id END) AS transactionCount
          FROM commerce_payments
          WHERE organization_id = ? AND connection_id IN (${approvedConnectionIds.map(() => "?").join(", ")}) AND paid_at IS NOT NULL
            AND substr(paid_at, 1, 10) BETWEEN ? AND ?
            ${paymentLocationClause}
          GROUP BY provider, category, payment_type_name
          ORDER BY amountCents DESC
        `).bind(context.organizationId, ...approvedConnectionIds, resolvedStart, resolvedEnd, ...paymentLocationBindings).all<{
          provider: string;
          category: string;
          paymentTypeName: string | null;
          amountCents: number;
          transactionCount: number;
        }>()
      : { results: [] };
    const paymentMix = (paymentMixResult.results ?? [])
      .filter((row) => connectedPosProviders.has(row.provider))
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
    return jsonResponse({
      report,
      source,
      canExport: permissions.includes("reports.export"),
      totals: {
        ...totals,
        discountsCents: canViewRefunds ? totals.discountsCents : null,
        refundsCents: canViewRefunds ? totals.refundsCents : null,
        costOfGoodsCents: canViewProfit
          ? totals.costOfGoodsCents
          : null,
        labourCostCents: canViewPayroll
          ? totals.labourCostCents
          : null,
        grossProfitCents: canViewProfit ? totals.grossProfitCents : null,
      },
      comparison: comparisonPeriod && comparisonRows.length ? {
        periodStart: comparisonPeriod.start,
        periodEnd: comparisonPeriod.end,
        verifiedDays: new Set(comparisonRows.map((row) => row.businessDate)).size,
        totals: {
          netSalesCents: comparisonTotals.netSalesCents,
          grossProfitCents: canViewProfit ? comparisonTotals.grossProfitCents : null,
          transactionCount: comparisonTotals.transactionCount,
          averageTransactionCents: comparisonTotals.averageTransactionCents,
        },
        changes: {
          netSalesRate: change(totals.netSalesCents, comparisonTotals.netSalesCents),
          grossProfitRate: canViewProfit ? change(totals.grossProfitCents, comparisonTotals.grossProfitCents) : null,
          transactionRate: change(totals.transactionCount, comparisonTotals.transactionCount),
          averageTransactionRate: totals.averageTransactionCents !== null && comparisonTotals.averageTransactionCents !== null
            ? change(totals.averageTransactionCents, comparisonTotals.averageTransactionCents)
            : null,
        },
      } : null,
      paymentMix,
      rows: rows.map((row) => ({
        businessDate: row.businessDate,
        locationRef: row.locationRef,
        netSalesCents: row.netSalesCents,
        costOfGoodsCents: canViewProfit ? row.costOfGoodsCents : null,
        transactionCount: row.transactionCount,
      })),
      explainAndAct: {
        executiveSummary: rows.length
          ? `${distinctDates.length} verified day${distinctDates.length === 1 ? "" : "s"} are included${expectedDays && distinctDates.length < expectedDays ? ` across a ${expectedDays}-day range` : ""}.`
          : "No verified records match the selected filters.",
        significantChanges: comparisonRows.length
          ? `Net sales changed ${new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(change(totals.netSalesCents, comparisonTotals.netSalesCents) ?? 0)} versus the immediately preceding matched period.`
          : "A complete preceding matched period is not available for comparison.",
        likelyDrivers:
          "Daily aggregates cannot isolate product, customer, supplier or hourly drivers.",
        confidence: distinctDates.length >= 7 && distinctDates.length === expectedDays ? "high" : distinctDates.length >= 7 ? "medium" : "low",
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
