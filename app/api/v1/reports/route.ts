import { and, asc, eq, gte, like, lte } from "drizzle-orm";
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
import { LIGHTSPEED_R_PROVIDER } from "../../../../server/integrations/lightspeed-r";

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
    await requirePermission(context, "metrics.revenue");
    if (report === "gross_profit_summary")
      await requirePermission(context, "metrics.profit");
    if (report === "discounts_refunds")
      await requirePermission(context, "sales.refunds");
    if (report === "labour_summary")
      await requirePermission(context, "payroll.totals");
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const location = url.searchParams.get("location") || "all";
    if ((start && !DATE.test(start)) || (end && !DATE.test(end)))
      throw new ApiError(400, "INVALID_DATE", "Enter valid report dates.");
    if (start && end && start > end)
      throw new ApiError(400, "INVALID_DATE_RANGE", "The start date must be on or before the end date.");
    const [lightspeedConnection] = await getDb().select({ id: integrationConnections.id }).from(integrationConnections).where(and(
      eq(integrationConnections.organizationId, context.organizationId),
      eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
      eq(integrationConnections.status, "connected"),
    )).limit(1);
    const filters = [
      eq(dailyBusinessMetrics.organizationId, context.organizationId),
    ];
    if (start) filters.push(gte(dailyBusinessMetrics.businessDate, start));
    if (end) filters.push(lte(dailyBusinessMetrics.businessDate, end));
    if (location !== "all")
      filters.push(eq(dailyBusinessMetrics.locationRef, location));
    else if (lightspeedConnection)
      filters.push(like(dailyBusinessMetrics.locationRef, `${LIGHTSPEED_R_PROVIDER}:%`));
    const rows = await getDb()
      .select()
      .from(dailyBusinessMetrics)
      .where(and(...filters))
      .orderBy(asc(dailyBusinessMetrics.businessDate))
      .limit(1000);
    const generatedAt = new Date().toISOString();
    const distinctDates = [...new Set(rows.map((row) => row.businessDate))];
    const resolvedStart = start ?? distinctDates.at(0) ?? null;
    const resolvedEnd = end ?? distinctDates.at(-1) ?? null;
    const expectedDays = resolvedStart && resolvedEnd ? inclusiveDays(resolvedStart, resolvedEnd) : 0;
    const source = {
      type: lightspeedConnection ? "Lightspeed R-Series" : "Imported daily summaries",
      rowCount: rows.length,
      verifiedDays: distinctDates.length,
      expectedDays,
      completenessRate: expectedDays ? distinctDates.length / expectedDays : null,
      earliestBusinessDate: rows.at(0)?.businessDate ?? null,
      latestBusinessDate: rows.at(-1)?.businessDate ?? null,
      generatedAt,
      organizationId: context.organizationId,
      location,
      periodStart: resolvedStart,
      periodEnd: resolvedEnd,
      providerScoped: Boolean(lightspeedConnection),
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
          row.discountsCents,
          row.refundsCents,
          permissions.includes("metrics.profit") ? row.costOfGoodsCents : null,
          permissions.includes("metrics.profit")
            ? row.netSalesCents - row.costOfGoodsCents
            : null,
          row.labourCostCents,
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
        gte(dailyBusinessMetrics.businessDate, comparisonStart),
        lte(dailyBusinessMetrics.businessDate, comparisonEnd),
      ];
      if (location !== "all") comparisonFilters.push(eq(dailyBusinessMetrics.locationRef, location));
      else if (lightspeedConnection) comparisonFilters.push(like(dailyBusinessMetrics.locationRef, `${LIGHTSPEED_R_PROVIDER}:%`));
      comparisonRows = await getDb().select().from(dailyBusinessMetrics).where(and(...comparisonFilters)).orderBy(asc(dailyBusinessMetrics.businessDate)).limit(1000);
    }
    const comparisonTotals = totalsFor(comparisonRows);
    const paymentMix = lightspeedConnection && resolvedStart && resolvedEnd
      ? await getD1().prepare(`
          SELECT category, payment_type_name AS paymentTypeName,
                 SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS amountCents,
                 COUNT(DISTINCT CASE WHEN amount_cents > 0 THEN external_sale_id END) AS transactionCount
          FROM commerce_payments
          WHERE organization_id = ? AND provider = ? AND paid_at IS NOT NULL
            AND substr(paid_at, 1, 10) BETWEEN ? AND ?
          GROUP BY category, payment_type_name
          ORDER BY amountCents DESC
        `).bind(context.organizationId, LIGHTSPEED_R_PROVIDER, resolvedStart, resolvedEnd).all()
      : { results: [] };
    return jsonResponse({
      report,
      source,
      canExport: permissions.includes("reports.export"),
      totals: {
        ...totals,
        costOfGoodsCents: permissions.includes("metrics.profit")
          ? totals.costOfGoodsCents
          : null,
        labourCostCents: permissions.includes("payroll.totals")
          ? totals.labourCostCents
          : null,
        grossProfitCents: permissions.includes("metrics.profit") ? totals.grossProfitCents : null,
      },
      comparison: comparisonPeriod && comparisonRows.length ? {
        periodStart: comparisonPeriod.start,
        periodEnd: comparisonPeriod.end,
        verifiedDays: new Set(comparisonRows.map((row) => row.businessDate)).size,
        totals: {
          netSalesCents: comparisonTotals.netSalesCents,
          grossProfitCents: permissions.includes("metrics.profit") ? comparisonTotals.grossProfitCents : null,
          transactionCount: comparisonTotals.transactionCount,
          averageTransactionCents: comparisonTotals.averageTransactionCents,
        },
        changes: {
          netSalesRate: change(totals.netSalesCents, comparisonTotals.netSalesCents),
          grossProfitRate: permissions.includes("metrics.profit") ? change(totals.grossProfitCents, comparisonTotals.grossProfitCents) : null,
          transactionRate: change(totals.transactionCount, comparisonTotals.transactionCount),
          averageTransactionRate: totals.averageTransactionCents !== null && comparisonTotals.averageTransactionCents !== null
            ? change(totals.averageTransactionCents, comparisonTotals.averageTransactionCents)
            : null,
        },
      } : null,
      paymentMix: paymentMix.results ?? [],
      rows: rows.map((row) => ({
        businessDate: row.businessDate,
        locationRef: row.locationRef,
        netSalesCents: row.netSalesCents,
        costOfGoodsCents: permissions.includes("metrics.profit") ? row.costOfGoodsCents : 0,
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
