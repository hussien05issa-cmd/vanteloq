import { getD1 } from "../../../../../db";
import { requireAccess } from "../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse } from "../../../../../server/api";
import { effectivePermissions } from "../../../../../server/permissions";
import { requireAddon } from "../../../../../server/entitlements/engine";
import { requireOrganizationWideLocationAccess } from "../../../../../server/location-access";
import { businessClock } from "../../../../../domain/intraday-sales";
import { bookloqReportCsv, bookloqReportQuery, canReadBookloqReportDetails, loadBookloqDatedReport, requireBookloqReportScope } from "../../../../../server/bookloq-reports";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "bookloq.financial_statements");
    await requireAddon(context, "bookloq");
    const permissions = await effectivePermissions(context);
    const params = new URL(request.url).searchParams;
    requireBookloqReportScope(permissions, true, params.get("location"), params.get("format") === "csv");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("bookloq:dated-reports", context.userId, 60, 60);
    const today = businessClock(new Date(), context.organization.timezone)!.date;
    const query = bookloqReportQuery(params, today);
    const report = await loadBookloqDatedReport(getD1(), {
      organizationId: context.organizationId,
      currency: context.organization.currency,
      timeZone: context.organization.timezone,
      contactIdentity: permissions.includes("customers.identity"),
      individualDetails: canReadBookloqReportDetails(permissions),
      query,
    });
    if (query.format === "csv") return new Response(bookloqReportCsv(report, query.report), { headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="bookloq-${query.report}-${query.to}${query.accountId ? "-account" : ""}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
    return jsonResponse(report);
  });
}
