import { getD1 } from "../../../../../db";
import { recordAudit } from "../../../../../server/audit";
import { requireAccess } from "../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { journalInput, requireBookLoQPermission } from "../../../../../server/bookloq";
import { idempotencyKey } from "../../../../../server/validation";

const writers = ["owner", "admin"] as const;

type ExistingEntry = { id: string; entryNumber: string; status: string };
type OriginalLine = {
  accountId: string;
  description: string;
  debitCents: number;
  creditCents: number;
  taxCode: string | null;
  taxAmountCents: number;
  contactId: string | null;
  locationRef: string;
  departmentRef: string | null;
  projectRef: string | null;
};

function validReason(value: unknown): string {
  if (typeof value !== "string") throw new Error("reason");
  const normalized = value.trim().normalize("NFC");
  if (!normalized || normalized.length > 1_000 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error("reason");
  return normalized;
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers);
    requireBookLoQPermission(context.role, "post_journals");
    await enforceRateLimit("bookloq:journals:create", context.userId, 30, 3_600);
    const key = idempotencyKey(request);
    const database = getD1();
    const existing = await database.prepare(`SELECT id, entry_number entryNumber, status FROM journal_entries
      WHERE organization_id = ? AND idempotency_key = ?`).bind(context.organizationId, key).first<ExistingEntry>();
    if (existing) return jsonResponse({ journal: existing, replayed: true });
    const input = journalInput(await readJsonObject(request, 64_000));
    const period = await database.prepare(`SELECT id, status FROM accounting_periods
      WHERE organization_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1`)
      .bind(context.organizationId, input.entryDate, input.entryDate).first<{ id: string; status: string }>();
    if (!period) return jsonResponse({ error: { code: "ACCOUNTING_PERIOD_REQUIRED", message: "Create an accounting period covering this journal date before posting." } }, { status: 409 });
    if (period.status === "locked") return jsonResponse({ error: { code: "ACCOUNTING_PERIOD_LOCKED", message: "This accounting period is locked. Post an adjustment in an open period." } }, { status: 409 });

    const requestedIds = [...new Set(input.lines.map((line) => line.accountId))];
    const placeholders = requestedIds.map(() => "?").join(",");
    const accountResult = await database.prepare(`SELECT id, active FROM financial_accounts WHERE organization_id = ? AND id IN (${placeholders})`)
      .bind(context.organizationId, ...requestedIds).all<{ id: string; active: number }>();
    const validIds = new Set((accountResult.results ?? []).filter((account) => account.active === 1).map((account) => account.id));
    if (requestedIds.some((accountId) => !validIds.has(accountId))) {
      return jsonResponse({ error: { code: "ACCOUNT_NOT_AVAILABLE", message: "Every journal line must use an active account from this organization." } }, { status: 400 });
    }

    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1_000);
    const entryId = crypto.randomUUID();
    const entryNumber = `JE-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${entryId.slice(0, 6).toUpperCase()}`;
    const statements = [database.prepare(`INSERT INTO journal_entries
      (id, organization_id, entry_number, entry_date, posting_date, period_id, status, source_type,
       memo, currency, exchange_rate_ppm, total_debit_cents, total_credit_cents, idempotency_key,
       prepared_by_user_id, approved_by_user_id, posted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'posted', 'manual', ?, ?, 1000000, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(entryId, context.organizationId, entryNumber, input.entryDate, input.entryDate, period.id, input.memo,
        input.currency, input.totalDebitCents, input.totalCreditCents, key, context.userId, context.userId,
        timestamp, timestamp, timestamp)];
    input.lines.forEach((line, index) => {
      statements.push(database.prepare(`INSERT INTO journal_lines
        (id, organization_id, journal_entry_id, line_number, account_id, description, debit_cents,
         credit_cents, tax_code, tax_amount_cents, contact_id, location_ref, department_ref, project_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), context.organizationId, entryId, index + 1, line.accountId, line.description,
          line.debitCents, line.creditCents, line.taxCode, line.taxAmountCents, line.contactId,
          line.locationRef, line.departmentRef, line.projectRef, timestamp));
    });
    await database.batch(statements);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "journal.posted", resourceType: "journal_entry", resourceId: entryId,
      details: { entryNumber, entryDate: input.entryDate, debitCents: input.totalDebitCents, creditCents: input.totalCreditCents } });
    return jsonResponse({ journal: { id: entryId, entryNumber, status: "posted", totalDebitCents: input.totalDebitCents, totalCreditCents: input.totalCreditCents }, replayed: false }, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers);
    requireBookLoQPermission(context.role, "post_journals");
    await enforceRateLimit("bookloq:journals:reverse", context.userId, 20, 3_600);
    const key = idempotencyKey(request);
    const body = await readJsonObject(request, 16_000);
    if (Object.keys(body).some((field) => !["entryId", "reason", "reversalDate"].includes(field))) {
      return jsonResponse({ error: { code: "UNKNOWN_FIELD", message: "The reversal request contains an unsupported field." } }, { status: 400 });
    }
    if (typeof body.entryId !== "string" || body.entryId.length > 80 || typeof body.reversalDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.reversalDate)) {
      return jsonResponse({ error: { code: "INVALID_REVERSAL", message: "Select a posted journal and a valid reversal date." } }, { status: 400 });
    }
    let reason: string;
    try { reason = validReason(body.reason); } catch { return jsonResponse({ error: { code: "INVALID_REVERSAL", message: "Explain why the journal is being reversed." } }, { status: 400 }); }
    const database = getD1();
    const replay = await database.prepare(`SELECT id, entry_number entryNumber, status FROM journal_entries WHERE organization_id = ? AND idempotency_key = ?`)
      .bind(context.organizationId, key).first<ExistingEntry>();
    if (replay) return jsonResponse({ journal: replay, replayed: true });
    const original = await database.prepare(`SELECT id, entry_number entryNumber, status, currency,
      total_debit_cents totalDebitCents, total_credit_cents totalCreditCents
      FROM journal_entries WHERE organization_id = ? AND id = ?`).bind(context.organizationId, body.entryId).first<{ id: string; entryNumber: string; status: string; currency: string; totalDebitCents: number; totalCreditCents: number }>();
    if (!original || original.status !== "posted") return jsonResponse({ error: { code: "JOURNAL_NOT_REVERSIBLE", message: "Only a posted, unreversed journal can be reversed." } }, { status: 409 });
    const existingReversal = await database.prepare(`SELECT id FROM journal_entries WHERE organization_id = ? AND reversal_of_entry_id = ?`).bind(context.organizationId, original.id).first();
    if (existingReversal) return jsonResponse({ error: { code: "JOURNAL_ALREADY_REVERSED", message: "This journal already has a reversal." } }, { status: 409 });
    const period = await database.prepare(`SELECT id, status FROM accounting_periods WHERE organization_id = ? AND start_date <= ? AND end_date >= ? LIMIT 1`)
      .bind(context.organizationId, body.reversalDate, body.reversalDate).first<{ id: string; status: string }>();
    if (!period || period.status === "locked") return jsonResponse({ error: { code: "REVERSAL_PERIOD_UNAVAILABLE", message: "Post the reversal in an open accounting period." } }, { status: 409 });
    const lineResult = await database.prepare(`SELECT account_id accountId, description, debit_cents debitCents,
      credit_cents creditCents, tax_code taxCode, tax_amount_cents taxAmountCents, contact_id contactId,
      location_ref locationRef, department_ref departmentRef, project_ref projectRef
      FROM journal_lines WHERE organization_id = ? AND journal_entry_id = ? ORDER BY line_number`)
      .bind(context.organizationId, original.id).all<OriginalLine>();
    const lines = lineResult.results ?? [];
    if (lines.length < 2) return jsonResponse({ error: { code: "JOURNAL_LINES_MISSING", message: "The source journal cannot be reversed because its lines are incomplete." } }, { status: 409 });
    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1_000);
    const reversalId = crypto.randomUUID();
    const entryNumber = `REV-${original.entryNumber}-${reversalId.slice(0, 4).toUpperCase()}`;
    const statements = [
      database.prepare(`INSERT INTO journal_entries
        (id, organization_id, entry_number, entry_date, posting_date, period_id, status, source_type,
         source_ref, memo, currency, exchange_rate_ppm, total_debit_cents, total_credit_cents,
         reversal_of_entry_id, idempotency_key, prepared_by_user_id, approved_by_user_id, posted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'posted', 'reversal', ?, ?, ?, 1000000, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(reversalId, context.organizationId, entryNumber, body.reversalDate, body.reversalDate, period.id,
          original.id, reason, original.currency, original.totalCreditCents, original.totalDebitCents,
          original.id, key, context.userId, context.userId, timestamp, timestamp, timestamp),
      database.prepare(`UPDATE journal_entries SET status = 'reversed', updated_at = ? WHERE organization_id = ? AND id = ? AND status = 'posted'`)
        .bind(timestamp, context.organizationId, original.id),
    ];
    lines.forEach((line, index) => statements.push(database.prepare(`INSERT INTO journal_lines
      (id, organization_id, journal_entry_id, line_number, account_id, description, debit_cents,
       credit_cents, tax_code, tax_amount_cents, contact_id, location_ref, department_ref, project_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), context.organizationId, reversalId, index + 1, line.accountId,
        `Reversal: ${line.description}`.slice(0, 300), line.creditCents, line.debitCents, line.taxCode,
        line.taxAmountCents, line.contactId, line.locationRef, line.departmentRef, line.projectRef, timestamp)));
    await database.batch(statements);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
      action: "journal.reversed", resourceType: "journal_entry", resourceId: original.id,
      details: { reversalId, originalEntryNumber: original.entryNumber, reason } });
    return jsonResponse({ journal: { id: reversalId, entryNumber, status: "posted", reversalOfEntryId: original.id }, replayed: false }, { status: 201 });
  });
}
