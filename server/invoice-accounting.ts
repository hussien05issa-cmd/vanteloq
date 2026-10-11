import { invoiceAccountingCommand, validateInvoiceForAccounting, type AccountingInvoice, type AccountingInvoiceLine, type InvoiceAccountingCommand } from "../domain/invoice-accounting.ts";
import { ApiError } from "./api.ts";
import { prepareAudit } from "./audit.ts";
import { journalInput, type JournalInputLine } from "./bookloq.ts";
import { BOOKLOQ_TRANSACTION_SOURCE_SQL } from "./bookloq-source.ts";

type InvoiceRow = AccountingInvoice & { contactActive: number };
export type InvoiceAccountingEvent = {
  id: string; invoiceId: string; eventType: InvoiceAccountingCommand["type"]; eventDate: string;
  amountCents: number; currency: string; invoiceJournalEntryId: string; journalEntryId: string;
  reversalOfEventId: string | null; cashAccountId: string | null; sourceTransactionId: string | null;
  reference: string; reason: string; createdAt: number; requestJson: string; reversedByEventId: string | null;
};
const eventColumns = `e.id, e.invoice_id invoiceId, e.event_type eventType, e.event_date eventDate,
  e.amount_cents amountCents, e.currency, e.invoice_journal_entry_id invoiceJournalEntryId,
  e.journal_entry_id journalEntryId, e.reversal_of_event_id reversalOfEventId,
  e.cash_account_id cashAccountId, e.source_transaction_id sourceTransactionId, e.reference, e.reason,
  e.created_at createdAt, e.request_json requestJson,
  (SELECT r.id FROM invoice_accounting_events r WHERE r.organization_id=e.organization_id AND r.reversal_of_event_id=e.id) reversedByEventId`;

async function loadInvoice(database: D1Database, organizationId: string, invoiceId: string): Promise<InvoiceRow> {
  const invoice = await database.prepare(`SELECT i.id,i.invoice_number invoiceNumber,i.invoice_date invoiceDate,
    i.customer_id customerId,i.currency,i.subtotal_cents subtotalCents,i.tax_cents taxCents,
    i.total_cents totalCents,i.paid_cents paidCents,i.status,i.journal_entry_id journalEntryId,
    i.location_ref locationRef,i.demo_record demoRecord,c.active contactActive
    FROM customer_invoices i JOIN bookloq_contacts c ON c.id=i.customer_id AND c.organization_id=i.organization_id
    WHERE i.organization_id=? AND i.id=?`).bind(organizationId, invoiceId).first<InvoiceRow>();
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "This invoice is unavailable in the current business.");
  try { validateInvoiceForAccounting(invoice); } catch (error) { throw new ApiError(409, "INVOICE_AMOUNTS_INVALID", (error as Error).message); }
  return invoice;
}

export async function invoiceAccountingHistory(database: D1Database, organizationId: string, invoiceId: string) {
  const invoice = await loadInvoice(database, organizationId, invoiceId);
  const result = await database.prepare(`SELECT ${eventColumns} FROM invoice_accounting_events e
    WHERE e.organization_id=? AND e.invoice_id=? ORDER BY e.event_date,e.created_at,e.rowid LIMIT 2001`).bind(organizationId, invoiceId).all<InvoiceAccountingEvent>();
  if ((result.results ?? []).length > 2000) throw new ApiError(409, "INVOICE_HISTORY_LIMIT", "This invoice exceeds the supported accounting history view. No partial payment history is shown.");
  const events = result.results ?? [];
  const paymentSum = events.filter(e => e.eventType === "payment" && !e.reversedByEventId).reduce((sum, e) => sum + BigInt(e.amountCents), BigInt(0));
  if (events.length && paymentSum !== BigInt(invoice.paidCents)) throw new ApiError(409, "INVOICE_HISTORY_MISMATCH", "The payment history and invoice balance do not agree. Review the entries before posting.");
  const latestDate = events.reduce((date, e) => e.eventDate > date ? e.eventDate : date, invoice.invoiceDate);
  return { invoice, events, latestDate };
}

async function replay(database: D1Database, organizationId: string, key: string, command: InvoiceAccountingCommand) {
  const event = await database.prepare(`SELECT ${eventColumns} FROM invoice_accounting_events e
    WHERE e.organization_id=? AND e.idempotency_key=?`).bind(organizationId, key).first<InvoiceAccountingEvent>();
  if (event && event.requestJson !== JSON.stringify(command)) throw new ApiError(409, "INVOICE_REQUEST_CONFLICT", "This posting key belongs to different invoice details. Refresh before starting a new entry.");
  return event;
}

type Account = { id: string; accountType: string; accountSubtype: string; normalBalance: string; systemKey: string | null; bankCurrency: string | null; demoRecord: number | null };
async function account(database: D1Database, organizationId: string, id: string | null, systemKey?: string) {
  const result = await database.prepare(`SELECT a.id,a.account_type accountType,a.account_subtype accountSubtype,
    a.normal_balance normalBalance,a.system_key systemKey,b.currency bankCurrency,b.demo_record demoRecord
    FROM financial_accounts a LEFT JOIN bank_accounts b ON b.financial_account_id=a.id AND b.organization_id=a.organization_id
    WHERE a.organization_id=? AND a.active=1 AND ${systemKey ? "a.system_key=?" : "a.id=?"}`)
    .bind(organizationId, systemKey ?? id).first<Account>();
  if (!result) throw new ApiError(409, "INVOICE_ACCOUNT_UNAVAILABLE", "Select active accounting accounts from this business. Review BookLoQ setup if an account is missing.");
  return result;
}

const line = (accountId: string, debitCents: number, creditCents: number, description: string, invoice: InvoiceRow): JournalInputLine => ({
  accountId, debitCents, creditCents, description, contactId: invoice.customerId,
  locationRef: invoice.locationRef, taxCode: null, taxAmountCents: 0, departmentRef: null, projectRef: null,
});

type PostingContext = { organizationId: string; actorUserId: string; key: string; today: string; request: Request; requestId: string; now?: Date };
export async function postInvoiceAccounting(database: D1Database, body: Record<string, unknown>, context: PostingContext) {
  let command: InvoiceAccountingCommand;
  try { command = invoiceAccountingCommand(body); } catch (error) { throw new ApiError(400, "INVOICE_ACCOUNTING_INPUT", (error as Error).message); }
  const existing = await replay(database, context.organizationId, context.key, command);
  if (existing) return { event: existing, replayed: true };
  if (await database.prepare("SELECT id FROM journal_entries WHERE organization_id=? AND idempotency_key=?").bind(context.organizationId, context.key).first()) throw new ApiError(409, "INVOICE_REQUEST_CONFLICT", "This posting key already belongs to another journal.");
  const settings = await database.prepare("SELECT status,data_mode dataMode,base_currency currency,accounting_basis basis FROM bookloq_settings WHERE organization_id=?").bind(context.organizationId).first<{ status: string; dataMode: string; currency: string; basis: string }>();
  if (!settings || settings.status !== "active" || settings.dataMode !== "live" || settings.basis !== "accrual") throw new ApiError(409, "INVOICE_ACCOUNTING_SETUP", "Configure live accrual books and an open accounting period before posting invoices.");
  const history = await invoiceAccountingHistory(database, context.organizationId, command.invoiceId);
  const invoice = history.invoice;
  if (invoice.demoRecord || invoice.currency !== settings.currency) throw new ApiError(409, "INVOICE_ACCOUNTING_CURRENCY", "Post live invoices in the BookLoQ base currency. Currency conversion requires a separate reviewed workflow.");
  if (command.date < history.latestDate || command.date > context.today) throw new ApiError(400, "INVOICE_ACCOUNTING_DATE", "Use a date from the latest invoice accounting event through today. Future receipts cannot be recorded as received cash.");
  if (["void", "written_off"].includes(invoice.status)) throw new ApiError(409, "INVOICE_ACCOUNTING_STATE", "This invoice is closed. Review its retained accounting history.");
  const period = await database.prepare("SELECT id FROM accounting_periods WHERE organization_id=? AND start_date<=? AND end_date>=? AND status IN ('open','review') ORDER BY start_date DESC LIMIT 1").bind(context.organizationId, command.date, command.date).first<{ id: string }>();
  if (!period) throw new ApiError(409, "ACCOUNTING_PERIOD_UNAVAILABLE", "Choose a date in an open accounting period. Create or review periods in BookLoQ Settings.");

  let amountCents = invoice.totalCents;
  let lines: JournalInputLine[] = [];
  let original: InvoiceAccountingEvent | null = null;
  let cashAccountId: string | null = null;
  let sourceTransactionId: string | null = null;
  let reference = "", reason = "";
  if (command.type === "issue") {
    if (invoice.journalEntryId || invoice.paidCents || !invoice.contactActive || !["draft", "approved", "sent", "viewed", "due", "overdue", "disputed"].includes(invoice.status)) throw new ApiError(409, "INVOICE_ALREADY_POSTED", "Only an unposted invoice without payments can be issued to the books.");
    const storedLines = await database.prepare("SELECT quantity_milli quantityMilli,unit_price_cents unitPriceCents,tax_rate_basis_points taxRateBasisPoints,subtotal_cents subtotalCents,tax_cents taxCents,total_cents totalCents FROM customer_invoice_lines WHERE organization_id=? AND invoice_id=? ORDER BY line_number LIMIT 101").bind(context.organizationId, invoice.id).all<AccountingInvoiceLine>();
    try { validateInvoiceForAccounting(invoice, storedLines.results ?? []); } catch (error) { throw new ApiError(409, "INVOICE_AMOUNTS_INVALID", (error as Error).message); }
    const receivable = await account(database, context.organizationId, null, "accounts_receivable");
    const revenue = await account(database, context.organizationId, command.revenueAccountId);
    if (receivable.accountType !== "asset" || receivable.normalBalance !== "debit" || revenue.accountType !== "revenue" || revenue.normalBalance !== "credit") throw new ApiError(409, "INVOICE_ACCOUNT_TYPE", "Review the receivable and revenue accounts before posting.");
    lines = [line(receivable.id, invoice.totalCents, 0, `Receivable: ${invoice.invoiceNumber}`, invoice)];
    if (invoice.subtotalCents) lines.push(line(revenue.id, 0, invoice.subtotalCents, `Invoice revenue: ${invoice.invoiceNumber}`, invoice));
    if (invoice.taxCents) {
      const tax = await account(database, context.organizationId, command.taxAccountId);
      if (tax.accountType !== "liability" || tax.accountSubtype !== "tax_payable" || tax.normalBalance !== "credit") throw new ApiError(409, "INVOICE_TAX_ACCOUNT", "Select the sales-tax liability account for the entered invoice tax.");
      lines.push(line(tax.id, 0, invoice.taxCents, `Entered invoice tax: ${invoice.invoiceNumber}`, invoice));
    }
  } else {
    const issue = history.events.find(e => e.eventType === "issue" && !e.reversedByEventId);
    if (!issue || invoice.journalEntryId !== issue.journalEntryId) throw new ApiError(409, "INVOICE_POSTING_REQUIRED", "Issue this invoice to the books before recording or correcting payments. Existing imported balances require a reviewed migration.");
    if (command.type === "payment") {
      amountCents = command.amountCents;
      if (amountCents > invoice.totalCents - invoice.paidCents) throw new ApiError(409, "INVOICE_OVERPAYMENT", "The payment exceeds the outstanding invoice balance. Customer credits require a separate allocation workflow.");
      const cash = await account(database, context.organizationId, command.cashAccountId);
      if (cash.accountType !== "asset" || cash.normalBalance !== "debit" || !["bank", "cash"].includes(cash.accountSubtype) || (cash.bankCurrency && cash.bankCurrency !== invoice.currency) || cash.demoRecord === 1) throw new ApiError(409, "INVOICE_CASH_ACCOUNT", "Select a live cash or bank asset account in the invoice currency.");
      const receivableLine = await database.prepare("SELECT l.account_id accountId FROM journal_lines l JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=? AND l.journal_entry_id=? AND a.system_key='accounts_receivable' AND l.debit_cents=? AND l.credit_cents=0").bind(context.organizationId, issue.journalEntryId, invoice.totalCents).first<{ accountId: string }>();
      if (!receivableLine || cash.id === receivableLine.accountId) throw new ApiError(409, "INVOICE_ACCOUNT_TYPE", "Review the original receivable entry before recording payment.");
      const receivable = await account(database, context.organizationId, receivableLine.accountId);
      if (receivable.accountType !== "asset" || receivable.normalBalance !== "debit") throw new ApiError(409, "INVOICE_ACCOUNT_TYPE", "The receivable account requires review.");
      cashAccountId = cash.id; sourceTransactionId = command.transactionId; reference = command.reference;
      if (sourceTransactionId) {
        const source = await database.prepare(`SELECT t.id FROM financial_transactions t WHERE t.organization_id=? AND t.id=?
          AND t.account_id=? AND t.amount_cents=? AND t.currency=? AND t.demo_record=0 AND t.source_state='posted'
          AND t.posting_date=? AND t.journal_entry_id IS NULL AND t.reconciliation_status<>'reconciled'
          AND ${BOOKLOQ_TRANSACTION_SOURCE_SQL}
          AND NOT EXISTS(SELECT 1 FROM bookloq_transaction_matches m WHERE m.organization_id=t.organization_id AND m.transaction_id=t.id AND m.status='confirmed' AND (m.supplier_bill_id IS NOT NULL OR (m.customer_invoice_id IS NOT NULL AND m.customer_invoice_id<>?)))`)
          .bind(context.organizationId, sourceTransactionId, cash.id, amountCents, invoice.currency, command.date, invoice.id).first();
        if (!source) throw new ApiError(409, "INVOICE_PAYMENT_SOURCE", "Select an unposted, unreconciled bank receipt with the same date, amount, account and currency. Resolve conflicting evidence before posting.");
      }
      lines = [line(cash.id, amountCents, 0, `Received payment: ${invoice.invoiceNumber}`, invoice), line(receivable.id, 0, amountCents, `Reduce receivable: ${invoice.invoiceNumber}`, invoice)];
    } else {
      original = command.type === "void" ? issue : history.events.find(e => e.id === command.paymentId && e.eventType === "payment") ?? null;
      if (!original || original.reversedByEventId) throw new ApiError(409, "INVOICE_CORRECTION_STATE", "Select an unreversed invoice payment from this invoice.");
      if (command.type === "void" && (invoice.paidCents !== 0 || history.events.some(e => e.eventType === "payment" && !e.reversedByEventId))) throw new ApiError(409, "INVOICE_VOID_PAYMENTS", "Correct recorded payments before voiding the invoice. A refund or credit note is a separate business event.");
      amountCents = original.amountCents; cashAccountId = original.cashAccountId; sourceTransactionId = original.sourceTransactionId; reason = command.reason;
      const sourceEntry = await database.prepare("SELECT status FROM journal_entries WHERE organization_id=? AND id=?").bind(context.organizationId, original.journalEntryId).first<{ status: string }>();
      if (sourceEntry?.status !== "posted") throw new ApiError(409, "INVOICE_CORRECTION_STATE", "The original journal is unavailable for correction.");
      const sourceLines = await database.prepare(`SELECT l.account_id accountId,l.description,l.debit_cents debitCents,l.credit_cents creditCents,
        l.tax_code taxCode,l.tax_amount_cents taxAmountCents,l.contact_id contactId,l.location_ref locationRef,
        l.department_ref departmentRef,l.project_ref projectRef FROM journal_lines l JOIN financial_accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
        WHERE l.organization_id=? AND l.journal_entry_id=? ORDER BY l.line_number`).bind(context.organizationId, original.journalEntryId).all<JournalInputLine>();
      lines = (sourceLines.results ?? []).map(l => ({ ...l, debitCents: l.creditCents, creditCents: l.debitCents, description: `Correction: ${l.description}`.slice(0, 300) }));
    }
  }
  let journal;
  try { journal = journalInput({ entryDate: command.date, currency: invoice.currency, memo: reason || `${command.type === "issue" ? "Issue invoice" : "Record received payment"} ${invoice.invoiceNumber}${reference ? `: ${reference}` : ""}`, lines }); }
  catch { throw new ApiError(409, "INVOICE_JOURNAL_INVALID", "The proposed invoice journal is not internally balanced. Review the source records."); }
  if (journal.totalDebitCents !== amountCents || journal.totalCreditCents !== amountCents) throw new ApiError(409, "INVOICE_JOURNAL_INVALID", "The original journal does not agree with the invoice accounting event.");
  const eventId = crypto.randomUUID(), entryId = crypto.randomUUID();
  const timestamp = Math.floor((context.now ?? new Date()).getTime() / 1000);
  const entryNumber = `INV-${command.date.replaceAll("-", "")}-${entryId.slice(0, 8).toUpperCase()}`;
  const statements: D1PreparedStatement[] = [database.prepare(`INSERT INTO journal_entries
    (id,organization_id,entry_number,entry_date,posting_date,period_id,status,source_type,source_ref,memo,currency,total_debit_cents,total_credit_cents,reversal_of_entry_id,idempotency_key,prepared_by_user_id,approved_by_user_id,posted_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'posted',?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(entryId, context.organizationId, entryNumber, command.date, command.date, period.id, original ? "reversal" : command.type === "issue" ? "customer_invoice" : "invoice_payment", original?.journalEntryId ?? invoice.id, journal.memo, invoice.currency, amountCents, amountCents, original?.journalEntryId ?? null, context.key, context.actorUserId, context.actorUserId, timestamp, timestamp, timestamp)];
  journal.lines.forEach((l, index) => statements.push(database.prepare(`INSERT INTO journal_lines
    (id,organization_id,journal_entry_id,line_number,account_id,description,debit_cents,credit_cents,tax_code,tax_amount_cents,contact_id,location_ref,department_ref,project_ref,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), context.organizationId, entryId, index + 1, l.accountId, l.description, l.debitCents, l.creditCents, l.taxCode, l.taxAmountCents, l.contactId, l.locationRef, l.departmentRef, l.projectRef, timestamp)));
  statements.push(database.prepare(`INSERT INTO invoice_accounting_events
    (id,organization_id,invoice_id,event_type,event_date,amount_cents,currency,invoice_total_cents,prior_paid_cents,invoice_journal_entry_id,journal_entry_id,reversal_of_event_id,cash_account_id,source_transaction_id,reference,reason,idempotency_key,request_json,actor_user_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(eventId, context.organizationId, invoice.id, command.type, command.date, amountCents, invoice.currency, invoice.totalCents, invoice.paidCents, command.type === "issue" ? entryId : invoice.journalEntryId, entryId, original?.id ?? null, cashAccountId, sourceTransactionId, reference, reason, context.key, JSON.stringify(command), context.actorUserId, timestamp));
  statements.push(await prepareAudit(database, { request: context.request, requestId: context.requestId, organizationId: context.organizationId, actorUserId: context.actorUserId, action: `customer_invoice.${command.type}`, resourceType: "customer_invoice", resourceId: invoice.id, details: { eventId, journalEntryId: entryId, amountCents, date: command.date, reversalOfEventId: original?.id ?? null } }));
  try { await database.batch(statements); }
  catch (error) {
    const concurrent = await replay(database, context.organizationId, context.key, command);
    if (concurrent) return { event: concurrent, replayed: true };
    if (error instanceof Error && /BANK_JOURNAL_RETAINED/.test(error.message)) throw new ApiError(409, "INVOICE_BANK_MATCH_REQUIRED", "Open Banking or Reconciliation, reopen the latest statement if it is complete, then release the ledger match for this payment before correcting it from invoice history.");
    if (error instanceof Error && /INVOICE_ACCOUNTING_|ACCOUNTING_PERIOD_UNAVAILABLE|UNIQUE constraint/.test(error.message)) throw new ApiError(409, "INVOICE_ACCOUNTING_CHANGED", "The invoice, payment source, accounts or period changed before posting. Refresh the invoice and review the new balance.");
    throw error;
  }
  return { event: (await replay(database, context.organizationId, context.key, command))!, replayed: false };
}
