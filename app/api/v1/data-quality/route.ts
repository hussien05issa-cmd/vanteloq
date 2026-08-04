import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  dailyBusinessMetrics,
  dataImports,
  goodsReceipts,
  integrationConnections,
  invoiceMatches,
  workspaceDocuments,
} from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import {
  enforceRateLimit,
  handleApi,
  jsonResponse,
} from "../../../../server/api";
import { requirePermission } from "../../../../server/permissions";

const users = ["owner", "admin", "manager", "employee", "read_only"] as const;
const day = 86_400_000;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, users);
    await requirePermission(context, "integrations.view");
    await enforceRateLimit("data-quality:read", context.userId, 60, 60);
    const [rows, imports, connections, documents, receipts, matches] =
      await Promise.all([
        getDb()
          .select()
          .from(dailyBusinessMetrics)
          .where(
            eq(dailyBusinessMetrics.organizationId, context.organizationId),
          )
          .orderBy(asc(dailyBusinessMetrics.businessDate))
          .limit(730),
        getDb()
          .select()
          .from(dataImports)
          .where(eq(dataImports.organizationId, context.organizationId))
          .orderBy(desc(dataImports.createdAt))
          .limit(100),
        getDb()
          .select()
          .from(integrationConnections)
          .where(
            eq(integrationConnections.organizationId, context.organizationId),
          ),
        getDb()
          .select()
          .from(workspaceDocuments)
          .where(eq(workspaceDocuments.organizationId, context.organizationId))
          .limit(500),
        getDb()
          .select()
          .from(goodsReceipts)
          .where(eq(goodsReceipts.organizationId, context.organizationId))
          .limit(500),
        getDb()
          .select()
          .from(invoiceMatches)
          .where(eq(invoiceMatches.organizationId, context.organizationId))
          .limit(500),
      ]);
    const dates = [...new Set(rows.map((row) => row.businessDate))];
    const missingPeriods: string[] = [];
    for (let index = 1; index < dates.length; index++) {
      const previous = Date.parse(`${dates[index - 1]}T00:00:00Z`);
      const current = Date.parse(`${dates[index]}T00:00:00Z`);
      if (current - previous > day)
        missingPeriods.push(`${dates[index - 1]} → ${dates[index]}`);
    }
    const salesRows = rows.filter((row) => row.netSalesCents > 0);
    const costRows = salesRows.filter((row) => row.costOfGoodsCents > 0);
    const costCoverage = salesRows.length
      ? Math.round((costRows.length / salesRows.length) * 100)
      : 0;
    const latest = rows.at(-1)?.businessDate ?? null;
    const staleDays = latest
      ? Math.max(
          0,
          Math.floor((Date.now() - Date.parse(`${latest}T23:59:59Z`)) / day),
        )
      : null;
    const issues = [
      ...(!rows.length
        ? [
            {
              severity: "critical",
              type: "missing_source",
              title: "No operating records",
              affectedMetrics: ["Dashboard", "Reports", "Recommendations"],
              correction:
                "Import verified daily summaries or connect a tested POS adapter.",
            },
          ]
        : []),
      ...(staleDays !== null && staleDays > 7
        ? [
            {
              severity: "attention",
              type: "stale_data",
              title: `Operating data is ${staleDays} days old`,
              affectedMetrics: ["Dashboard", "Cash", "Reports"],
              correction:
                "Import the missing dates or restore the provider connection.",
            },
          ]
        : []),
      ...(missingPeriods.length
        ? [
            {
              severity: "attention",
              type: "missing_periods",
              title: `${missingPeriods.length} missing date gap${missingPeriods.length === 1 ? "" : "s"}`,
              affectedMetrics: ["Trends", "Comparisons", "Forecasts"],
              correction:
                "Review the identified gaps before relying on period comparisons.",
            },
          ]
        : []),
      ...(costCoverage < 95 && salesRows.length
        ? [
            {
              severity: "attention",
              type: "cost_coverage",
              title: `Gross-margin cost coverage is ${costCoverage}%`,
              affectedMetrics: ["Gross profit", "Margin", "Contribution"],
              correction:
                "Map verified product costs; missing costs are never assumed to be zero.",
            },
          ]
        : []),
      ...imports
        .filter((item) => item.status === "failed")
        .map((item) => ({
          severity: "attention",
          type: "failed_import",
          title: `Failed import: ${item.fileName || item.id}`,
          affectedMetrics: ["Imported period"],
          correction:
            "Review validation errors and retry with a new idempotency key.",
        })),
      ...connections
        .filter((item) => item.status === "error")
        .map((item) => ({
          severity: "critical",
          type: "connection_error",
          title: `${item.provider} connection error`,
          affectedMetrics: [item.provider],
          correction:
            "Reauthorize through the provider-hosted consent flow after the adapter error is resolved.",
        })),
      ...documents
        .filter((item) => item.status === "review_required")
        .slice(0, 10)
        .map((item) => ({
          severity: "informational",
          type: "document_review",
          title: `${item.fileName} awaits secure processing`,
          affectedMetrics: ["Accounts payable", "Invoice matching"],
          correction:
            "Malware scanning and OCR are not configured; review the original file manually.",
        })),
      ...receipts
        .filter((item) => item.discrepancyStatus !== "matched")
        .map((item) => ({
          severity: "attention",
          type: "receiving_discrepancy",
          title: `Goods receipt ${item.id} requires review`,
          affectedMetrics: ["Inventory", "Purchase orders"],
          correction: "Compare ordered and received quantities.",
        })),
      ...matches
        .filter((item) => item.status !== "matched")
        .map((item) => ({
          severity: "attention",
          type: "invoice_match",
          title: `Invoice match ${item.id} has a ${item.status.replaceAll("_", " ")}`,
          affectedMetrics: ["Accounts payable", "Committed cash"],
          correction:
            "Review purchase order, receipt and supplier invoice before approval.",
        })),
    ];
    const completeness = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (rows.length ? 45 : 0) +
            (missingPeriods.length ? 0 : rows.length ? 20 : 0) +
            costCoverage * 0.25 +
            (connections.some((item) => item.status === "connected") ? 10 : 0),
        ),
      ),
    );
    return jsonResponse({
      summary: {
        completeness,
        costCoverage,
        lastSuccessfulSynchronization: latest,
        failedSynchronizationCount:
          connections.filter((item) => item.status === "error").length +
          imports.filter((item) => item.status === "failed").length,
        missingPeriodCount: missingPeriods.length,
        affectedMetricCount: new Set(
          issues.flatMap((issue) => issue.affectedMetrics),
        ).size,
        status: !rows.length
          ? "blocked"
          : completeness >= 85
            ? "usable"
            : "limited",
      },
      issues,
      missingPeriods,
      sources: {
        dailyRows: rows.length,
        imports: imports.length,
        connections: connections.map((item) => ({
          provider: item.provider,
          status: item.status,
          lastSuccessfulSyncAt: item.lastSuccessfulSyncAt,
        })),
        documents: documents.length,
      },
    });
  });
}
