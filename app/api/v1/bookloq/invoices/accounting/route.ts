import { getD1 } from "../../../../../../db";
import { businessClock } from "../../../../../../domain/intraday-sales";
import { invoiceAccountingCommand } from "../../../../../../domain/invoice-accounting";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../../server/api";
import { requireAccess } from "../../../../../../server/authorization";
import { requireBookLoQPermission } from "../../../../../../server/bookloq";
import { requireAddon } from "../../../../../../server/entitlements/engine";
import { invoiceAccountingHistory, postInvoiceAccounting } from "../../../../../../server/invoice-accounting";
import { requireOrganizationWideLocationAccess } from "../../../../../../server/location-access";
import { effectivePermissions, requirePermission } from "../../../../../../server/permissions";
import { idempotencyKey } from "../../../../../../server/validation";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "bookloq.ar");
    await requireAddon(context, "bookloq");
    await requireOrganizationWideLocationAccess(context);
    await requirePermission(context, "finance.ap_ar");
    const id = new URL(request.url).searchParams.get("invoiceId");
    if (!id || id.length > 80) throw new ApiError(400, "INVOICE_REQUIRED", "Select an invoice to review its accounting history.");
    const permissions = await effectivePermissions(context);
    const history = await invoiceAccountingHistory(getD1(), context.organizationId, id);
    const identity = permissions.includes("customers.identity"), banking = permissions.includes("finance.bank_transactions");
    return jsonResponse({
      invoice: { id: history.invoice.id, status: history.invoice.status, journalEntryId: history.invoice.journalEntryId, totalCents: history.invoice.totalCents, paidCents: history.invoice.paidCents, currency: history.invoice.currency, demoRecord: history.invoice.demoRecord },
      latestDate: history.latestDate, today: businessClock(new Date(), context.organization.timezone)!.date,
      events: history.events.map(({ requestJson: _request, ...event }) => ({ ...event, reference: identity && banking ? event.reference : "", reason: identity ? event.reason : "", cashAccountId: banking ? event.cashAccountId : null, sourceTransactionId: banking ? event.sourceTransactionId : null })),
    });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, readers, "bookloq.ar");
    await requireAddon(context, "bookloq");
    await requireOrganizationWideLocationAccess(context);
    await requirePermission(context, "finance.ap_ar");
    await requirePermission(context, "finance.journal_post");
    requireBookLoQPermission(context.role, "post_journals");
    await enforceRateLimit("bookloq:invoice:accounting", context.userId, 45, 3600);
    const body = await readJsonObject(request, 16000);
    let command;
    try { command = invoiceAccountingCommand(body); } catch (error) { throw new ApiError(400, "INVOICE_ACCOUNTING_INPUT", (error as Error).message); }
    if (command.type === "payment" || command.type === "reverse_payment") {
      await requirePermission(context, "finance.bank_balances");
      await requirePermission(context, "finance.bank_transactions");
      await requirePermission(context, "payroll.totals");
    }
    const result = await postInvoiceAccounting(getD1(), body, { organizationId: context.organizationId, actorUserId: context.userId, key: idempotencyKey(request), today: businessClock(new Date(), context.organization.timezone)!.date, request, requestId });
    return jsonResponse({ event: { id: result.event.id, eventType: result.event.eventType, journalEntryId: result.event.journalEntryId }, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  });
}
