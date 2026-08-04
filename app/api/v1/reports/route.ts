import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dailyBusinessMetrics } from "../../../../db/schema";
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
    const filters = [
      eq(dailyBusinessMetrics.organizationId, context.organizationId),
    ];
    if (start) filters.push(gte(dailyBusinessMetrics.businessDate, start));
    if (end) filters.push(lte(dailyBusinessMetrics.businessDate, end));
    if (location !== "all")
      filters.push(eq(dailyBusinessMetrics.locationRef, location));
    const rows = await getDb()
      .select()
      .from(dailyBusinessMetrics)
      .where(and(...filters))
      .orderBy(asc(dailyBusinessMetrics.businessDate))
      .limit(1000);
    const generatedAt = new Date().toISOString();
    const source = {
      type: "Imported daily summaries",
      rowCount: rows.length,
      latestBusinessDate: rows.at(-1)?.businessDate ?? null,
      generatedAt,
      organizationId: context.organizationId,
      location,
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
      {
        grossSalesCents: 0,
        netSalesCents: 0,
        transactionCount: 0,
        unitsSold: 0,
        discountsCents: 0,
        refundsCents: 0,
        costOfGoodsCents: 0,
        labourCostCents: 0,
      },
    );
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
        grossProfitCents: permissions.includes("metrics.profit")
          ? totals.netSalesCents - totals.costOfGoodsCents
          : null,
        averageTransactionCents: totals.transactionCount
          ? Math.round(totals.netSalesCents / totals.transactionCount)
          : null,
      },
      rows: report === "sales_over_time" ? rows : undefined,
      explainAndAct: {
        executiveSummary: rows.length
          ? `${rows.length} verified daily records are included.`
          : "No verified records match the selected filters.",
        significantChanges:
          "Period comparison requires a comparison range selected in the dashboard.",
        likelyDrivers:
          "Daily aggregates cannot isolate product, customer, supplier or hourly drivers.",
        confidence: rows.length >= 7 ? "medium" : "low",
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
