import { getD1 } from "../../../../../db";
import { requireAccess } from "../../../../../server/authorization";
import { requireAddon } from "../../../../../server/entitlements/engine";
import { effectivePermissions, requirePermission } from "../../../../../server/permissions";
import { bookloqAccessForPermissions } from "../../../../../server/bookloq";
import { authorizedLocationDataScope } from "../../../../../server/location-access";
import { ApiError, enforceRateLimit, handleApi, jsonResponse } from "../../../../../server/api";
import { businessClock } from "../../../../../domain/intraday-sales";
import { buildCollectionsDashboard, collectionBuckets, filterCollections, type CollectionRecord, type CollectionsFilter } from "../../../../../domain/collections-dashboard";

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, ["owner", "admin", "manager", "employee", "read_only"], "bookloq.dashboard");
    await requireAddon(context, "bookloq");
    await requirePermission(context, "finance.statements");
    const access = bookloqAccessForPermissions(await effectivePermissions(context));
    if (!access.accountsPayableReceivable) throw new ApiError(403, "COLLECTIONS_ACCESS_REQUIRED", "Your role does not include invoice and bill balances.");
    const scope = await authorizedLocationDataScope(context, null);
    if (!scope.organizationWide) throw new ApiError(403, "BOOKLOQ_ORGANIZATION_SCOPE_REQUIRED", "Invoice and bill balances require organization-wide access.");
    await enforceRateLimit("bookloq:collections", context.userId, 120, 60);
    const db = getD1();
    const settings = await db.prepare("SELECT base_currency currency, data_mode mode, status FROM bookloq_settings WHERE organization_id=?").bind(context.organizationId).first<{currency:string;mode:string;status:string}>();
    if (settings?.status === "suspended") throw new ApiError(409, "BOOKLOQ_SUSPENDED", "BookLoQ is suspended. Restore access before reviewing invoices and bills.");
    // Document balances can be reviewed before ledger setup, using the same defaults as BookLoQ.
    const currency = (settings?.currency ?? context.organization.currency).toUpperCase();
    const demonstration = settings?.mode === "demonstration";
    const results = await db.prepare(`SELECT * FROM (
      SELECT i.id, 'receivable' kind, i.invoice_number reference, i.customer_id contactId, c.name contactName,
        i.invoice_date invoiceDate, i.due_date dueDate, i.status, 'not_required' approvalStatus,
        i.total_cents totalCents, i.paid_cents paidCents, i.currency, i.updated_at updatedAt
      FROM customer_invoices i LEFT JOIN bookloq_contacts c ON c.id=i.customer_id AND c.organization_id=i.organization_id
      WHERE i.organization_id=? AND i.demo_record=? AND i.status NOT IN ('draft','void','paid','written_off')
      UNION ALL
      SELECT b.id, 'payable' kind, b.bill_number reference, b.supplier_id contactId, c.name contactName,
        b.invoice_date invoiceDate, b.due_date dueDate, b.status, b.approval_status approvalStatus,
        b.total_cents totalCents, b.paid_cents paidCents, b.currency, b.updated_at updatedAt
      FROM supplier_bills b LEFT JOIN bookloq_contacts c ON c.id=b.supplier_id AND c.organization_id=b.organization_id
      WHERE b.organization_id=? AND b.demo_record=? AND b.status NOT IN ('draft','void','paid','reconciled')
    ) LIMIT 10001`).bind(context.organizationId, demonstration ? 1 : 0, context.organizationId, demonstration ? 1 : 0).all<CollectionRecord>();
    if ((results.results?.length ?? 0) > 10000) throw new ApiError(422, "COLLECTIONS_REPORT_LIMIT", "This view supports up to 10,000 open documents. Use detailed accounting reports for larger volumes; no partial total is shown.");
    const params = new URL(request.url).searchParams;
    const horizon = params.get("horizon") === "7" ? 7 : params.get("horizon") === "90" ? 90 : 30;
    const asOf = businessClock(new Date(), context.organization.timezone)!.date;
    const { records, ...report } = buildCollectionsDashboard((results.results ?? []).map(r => ({ ...r, contactName: r.contactName || "Unassigned contact" })), asOf, currency, horizon);
    const kind = params.get("kind") === "payable" ? "payable" : "receivable";
    const filterValue = params.get("filter") ?? "all";
    const filter = (["all", "overdue", "due", "disputed", "unapproved", ...collectionBuckets] as string[]).includes(filterValue) ? filterValue as CollectionsFilter : "all";
    const safeRecords = records.map(r => access.contactIdentity ? r : { ...r, contactId: "", contactName: r.kind === "receivable" ? "Customer" : "Supplier" });
    const filtered = filterCollections(safeRecords, kind, filter, asOf, horizon, (params.get("q") ?? "").slice(0, 120));
    const requestedPage = Number(params.get("page") ?? 0);
    const page = Math.min(Math.max(0, Number.isSafeInteger(requestedPage) ? requestedPage : 0), Math.max(0, Math.ceil(filtered.length / 25) - 1));
    return jsonResponse({ report: { ...report, largestCustomer: access.contactIdentity ? report.largestCustomer : report.largestCustomer ? { ...report.largestCustomer, contactId: "", contactName: "One customer" } : null },
      records: filtered.slice(page * 25, (page + 1) * 25), total: filtered.length, page, pageSize: 25, kind, filter, demonstration });
  });
}
