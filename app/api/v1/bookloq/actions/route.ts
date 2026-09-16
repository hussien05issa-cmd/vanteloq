import { getD1 } from "../../../../../db";
import { recordAudit } from "../../../../../server/audit";
import { requireAccess } from "../../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { requireBookLoQPermission } from "../../../../../server/bookloq";
import { requirePermission } from "../../../../../server/permissions";
import { requireAddon, requireFeature } from "../../../../../server/entitlements/engine";
import { requireOrganizationWideLocationAccess } from "../../../../../server/location-access";
import { normalizeCategoryRuleText } from "../../../../../domain/bookloq-cash-management";
import { bookloqActionFeature } from "../../../../../domain/paid-feature-routing";

const writers = ["owner", "admin", "manager", "employee", "read_only"] as const;

function identifier(value: unknown): string | null {
  return typeof value === "string" && value.length >= 3 && value.length <= 180 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function nonNegativeCents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 9_000_000_000_000 ? value : null;
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers, "bookloq");
    await requireAddon(context, "bookloq");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("bookloq:actions", context.userId, 60, 60);
    const body = await readJsonObject(request, 16_000);
    const actionFeature = typeof body.type === "string" ? bookloqActionFeature(body.type) : null;
    if (!actionFeature) return jsonResponse({ error: { code: "UNKNOWN_ACTION", message: "Select a supported BookLoQ action." } }, { status: 400 });
    await requireFeature(context, actionFeature);
    const allowed = ["type", "itemId", "status", "alertId", "periodId", "reason", "transactionId", "accountId", "periodStart", "periodEnd", "budgetCents", "committedCents", "forecastCents", "locationRef", "departmentRef", "categoryName", "categoryType", "matchText", "direction", "createRule", "targetType", "targetId", "note"];
    const unknown = Object.keys(body).find((field) => !allowed.includes(field));
    if (unknown) return jsonResponse({ error: { code: "UNKNOWN_FIELD", message: `Unexpected field: ${unknown}.` } }, { status: 400 });
    const database = getD1();
    const timestamp = Math.floor(Date.now() / 1_000);

    if (body.type === "categorize_transaction") {
      await requirePermission(context, "finance.statements");
      requireBookLoQPermission(context.role, "create_transactions");
      const transactionId = identifier(body.transactionId);
      const accountId = identifier(body.accountId);
      if (!transactionId || !accountId) return jsonResponse({ error: { code: "INVALID_CATEGORY", message: "Select a transaction and an active ledger category." } }, { status: 400 });
      const [transaction, account] = await Promise.all([
        database.prepare(`SELECT category_account_id categoryAccountId, categorization_status categorizationStatus,
          description, original_description originalDescription, amount_cents amountCents
          FROM financial_transactions WHERE organization_id = ? AND id = ?`).bind(context.organizationId, transactionId).first<{ categoryAccountId: string | null; categorizationStatus: string; description: string; originalDescription: string; amountCents: number }>(),
        database.prepare(`SELECT id, code, name, account_type accountType FROM financial_accounts WHERE organization_id = ? AND id = ? AND active = 1`).bind(context.organizationId, accountId).first<{ id: string; code: string; name: string; accountType: string }>(),
      ]);
      if (!transaction) return jsonResponse({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found." } }, { status: 404 });
      if (!account) return jsonResponse({ error: { code: "CATEGORY_NOT_FOUND", message: "The ledger category is unavailable." } }, { status: 404 });
      const mutations = [database.prepare(`UPDATE financial_transactions SET category_account_id = ?, categorization_status = 'confirmed', confidence_basis_points = 10000, updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(account.id, timestamp, context.organizationId, transactionId)];
      if (body.createRule === true) {
        const requestedMatch = typeof body.matchText === "string" ? body.matchText : transaction.description || transaction.originalDescription;
        const matchText = normalizeCategoryRuleText(requestedMatch).slice(0, 120);
        const direction = body.direction === "inflow" || body.direction === "outflow" ? body.direction : transaction.amountCents >= 0 ? "inflow" : "outflow";
        if (matchText.length < 3) return jsonResponse({ error: { code: "INVALID_CATEGORY_RULE", message: "A reusable category rule needs at least three recognizable characters." } }, { status: 400 });
        const ruleId = crypto.randomUUID();
        mutations.push(database.prepare(`INSERT INTO bookloq_category_rules
          (id, organization_id, name, match_text, direction, account_id, active, created_by_user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(organization_id, name) DO UPDATE SET match_text = excluded.match_text,
            direction = excluded.direction, account_id = excluded.account_id, active = 1,
            updated_at = excluded.updated_at`)
          .bind(ruleId, context.organizationId, `${matchText} → ${account.name}`.slice(0, 180), matchText, direction, account.id, context.userId, timestamp, timestamp));
      }
      await database.batch(mutations);
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "financial_transaction.categorized", resourceType: "financial_transaction", resourceId: transactionId,
        details: { previousAccountId: transaction.categoryAccountId, previousStatus: transaction.categorizationStatus, accountId: account.id, accountCode: account.code, accountName: account.name, accountType: account.accountType, status: "confirmed" } });
      return jsonResponse({ updated: true, type: body.type, id: transactionId, category: account });
    }

    if (body.type === "create_category") {
      await requirePermission(context, "finance.journal_post");
      requireBookLoQPermission(context.role, "edit_drafts");
      const categoryName = typeof body.categoryName === "string" ? body.categoryName.trim().normalize("NFC") : "";
      const categoryType = body.categoryType === "revenue" || body.categoryType === "expense" ? body.categoryType : null;
      if (categoryName.length < 2 || categoryName.length > 120 || !categoryType) return jsonResponse({ error: { code: "INVALID_CATEGORY", message: "Enter a category name and choose income or expense." } }, { status: 400 });
      const prefix = categoryType === "revenue" ? "49" : "69";
      const used = await database.prepare(`SELECT code FROM financial_accounts WHERE organization_id = ? AND code LIKE ? ORDER BY code`).bind(context.organizationId, `${prefix}%`).all<{ code: string }>();
      const codes = new Set((used.results ?? []).map((row) => Number(row.code)));
      let numericCode = Number(`${prefix}00`);
      while (codes.has(numericCode) && numericCode < Number(`${prefix}99`)) numericCode += 1;
      if (codes.has(numericCode)) return jsonResponse({ error: { code: "CATEGORY_LIMIT", message: "No custom category codes remain in this category group." } }, { status: 409 });
      const accountId = crypto.randomUUID();
      await database.prepare(`INSERT INTO financial_accounts
        (id, organization_id, code, name, account_type, account_subtype, normal_balance,
         system_key, description, plain_language, tax_treatment, restricted, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'custom', ?, NULL, ?, ?, 'review_required', 0, 1, ?, ?)`)
        .bind(accountId, context.organizationId, String(numericCode), categoryName, categoryType,
          categoryType === "revenue" ? "credit" : "debit", `Custom ${categoryType} category`,
          `${categoryName} is a workspace-defined category. Confirm tax treatment with the appropriate reviewer.`, timestamp, timestamp).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "financial_account.custom_category_created", resourceType: "bookloq_category", resourceId: accountId,
        details: { code: String(numericCode), name: categoryName, accountType: categoryType, taxTreatment: "review_required" } });
      return jsonResponse({ created: true, type: body.type, category: { id: accountId, code: String(numericCode), name: categoryName, accountType: categoryType } }, { status: 201 });
    }

    if (body.type === "match_transaction") {
      await requirePermission(context, "finance.reconcile");
      requireBookLoQPermission(context.role, "reconcile_accounts");
      const transactionId = identifier(body.transactionId);
      const targetId = identifier(body.targetId);
      const targetType = body.targetType === "supplier_bill" || body.targetType === "customer_invoice" || body.targetType === "receipt" ? body.targetType : null;
      const note = typeof body.note === "string" ? body.note.trim().normalize("NFC") : "";
      if (!transactionId || !targetId || !targetType || note.length > 1_000) return jsonResponse({ error: { code: "INVALID_MATCH", message: "Choose a transaction and supported invoice, bill, or receipt." } }, { status: 400 });
      const transaction = await database.prepare(`SELECT amount_cents amountCents, currency, source_state sourceState, demo_record demoRecord, reconciliation_status reconciliationStatus FROM financial_transactions WHERE organization_id = ? AND id = ? AND source_state <> 'removed'`).bind(context.organizationId, transactionId).first<{ amountCents: number; currency: string; sourceState: string; demoRecord: number; reconciliationStatus: string }>();
      if (!transaction) return jsonResponse({ error: { code: "TRANSACTION_NOT_FOUND", message: "Transaction not found." } }, { status: 404 });
      if (!["posted", "modified"].includes(transaction.sourceState)) return jsonResponse({ error: { code: "MATCH_POSTED_TRANSACTION_REQUIRED", message: "Wait for the transaction to post before confirming a match." } }, { status: 409 });
      if (targetType === "supplier_bill" && transaction.amountCents >= 0) return jsonResponse({ error: { code: "MATCH_DIRECTION_INVALID", message: "A supplier bill must be matched to a cash outflow." } }, { status: 409 });
      if (targetType === "customer_invoice" && transaction.amountCents <= 0) return jsonResponse({ error: { code: "MATCH_DIRECTION_INVALID", message: "A customer invoice must be matched to a cash inflow." } }, { status: 409 });
      const targetQuery = targetType === "supplier_bill"
        ? `SELECT id, currency, demo_record demoRecord FROM supplier_bills WHERE organization_id = ? AND id = ? AND status <> 'void'`
        : targetType === "customer_invoice"
          ? `SELECT id, currency, demo_record demoRecord FROM customer_invoices WHERE organization_id = ? AND id = ? AND status NOT IN ('draft', 'void', 'written_off')`
          : `SELECT id FROM workspace_documents WHERE organization_id = ? AND id = ? AND document_type = 'receipt' AND security_state = 'clean' AND status <> 'deleted'`;
      const target = await database.prepare(targetQuery).bind(context.organizationId, targetId).first<{ id: string; currency?: string; demoRecord?: number }>();
      if (!target) return jsonResponse({ error: { code: "MATCH_TARGET_NOT_FOUND", message: "The selected supporting record is unavailable." } }, { status: 404 });
      if (targetType !== "receipt" && (target.currency?.toUpperCase() !== transaction.currency.toUpperCase() || Boolean(target.demoRecord) !== Boolean(transaction.demoRecord))) {
        return jsonResponse({ error: { code: "MATCH_SOURCE_MISMATCH", message: "Match records in the same currency and data mode. Currency conversion requires a separately reviewed accounting entry." } }, { status: 409 });
      }
      const targetColumn = targetType === "supplier_bill" ? "supplier_bill_id" : targetType === "customer_invoice" ? "customer_invoice_id" : "document_id";
      const confirmedMatch = await database.prepare(`SELECT id, supplier_bill_id supplierBillId,
        customer_invoice_id customerInvoiceId, document_id documentId
        FROM bookloq_transaction_matches WHERE organization_id = ? AND transaction_id = ? AND status = 'confirmed'
        ORDER BY updated_at DESC LIMIT 1`).bind(context.organizationId, transactionId).first<{ id: string; supplierBillId: string | null; customerInvoiceId: string | null; documentId: string | null }>();
      const confirmedTargetId = confirmedMatch?.supplierBillId ?? confirmedMatch?.customerInvoiceId ?? confirmedMatch?.documentId ?? null;
      if (confirmedMatch && confirmedTargetId !== targetId) return jsonResponse({ error: { code: "TRANSACTION_ALREADY_MATCHED", message: "Remove the existing confirmed match before linking this transaction to a different record." } }, { status: 409 });
      const existing = await database.prepare(`SELECT id FROM bookloq_transaction_matches WHERE organization_id = ? AND transaction_id = ? AND ${targetColumn} = ?`)
        .bind(context.organizationId, transactionId, targetId).first<{ id: string }>();
      const matchId = existing?.id ?? crypto.randomUUID();
      if (existing) {
        await database.prepare(`UPDATE bookloq_transaction_matches SET status = 'confirmed', method = 'manual',
          confidence_basis_points = 10000, matched_amount_cents = ?, reasons_json = '["Manual confirmation"]',
          note = ?, matched_by_user_id = ?, updated_at = ? WHERE organization_id = ? AND id = ?`)
          .bind(Math.abs(transaction.amountCents), note, context.userId, timestamp, context.organizationId, matchId).run();
      } else {
        await database.prepare(`INSERT INTO bookloq_transaction_matches
          (id, organization_id, transaction_id, supplier_bill_id, customer_invoice_id, document_id,
           status, method, confidence_basis_points, matched_amount_cents, reasons_json, note,
           matched_by_user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'confirmed', 'manual', 10000, ?, '["Manual confirmation"]', ?, ?, ?, ?)`)
          .bind(matchId, context.organizationId, transactionId,
            targetType === "supplier_bill" ? targetId : null,
            targetType === "customer_invoice" ? targetId : null,
            targetType === "receipt" ? targetId : null,
            Math.abs(transaction.amountCents), note, context.userId, timestamp, timestamp).run();
      }
      await database.prepare(`UPDATE financial_transactions SET reconciliation_status = 'matched', updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(timestamp, context.organizationId, transactionId).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "financial_transaction.supporting_record_matched", resourceType: "financial_transaction", resourceId: transactionId,
        details: { targetType, targetId, amountCents: Math.abs(transaction.amountCents), previousStatus: transaction.reconciliationStatus } });
      return jsonResponse({ updated: true, type: body.type, id: transactionId, matchId, targetType, targetId });
    }

    if (body.type === "upsert_budget") {
      await requirePermission(context, "finance.journal_post");
      requireBookLoQPermission(context.role, "edit_drafts");
      const accountId = identifier(body.accountId);
      const periodStart = isoDate(body.periodStart);
      const periodEnd = isoDate(body.periodEnd);
      const budgetCents = nonNegativeCents(body.budgetCents);
      const committedCents = nonNegativeCents(body.committedCents);
      const forecastCents = nonNegativeCents(body.forecastCents);
      const locationRef = identifier(body.locationRef) ?? "all";
      const departmentRef = identifier(body.departmentRef) ?? "all";
      if (!accountId || !periodStart || !periodEnd || periodEnd < periodStart || budgetCents === null || committedCents === null || forecastCents === null) {
        return jsonResponse({ error: { code: "INVALID_BUDGET", message: "Account, valid dates and non-negative budget amounts are required." } }, { status: 400 });
      }
      const account = await database.prepare(`SELECT id, code, name FROM financial_accounts WHERE organization_id = ? AND id = ? AND active = 1 AND account_type IN ('revenue', 'expense')`).bind(context.organizationId, accountId).first<{ id: string; code: string; name: string }>();
      if (!account) return jsonResponse({ error: { code: "BUDGET_ACCOUNT_NOT_FOUND", message: "Choose an active revenue or expense account." } }, { status: 404 });
      const budgetId = crypto.randomUUID();
      await database.prepare(`INSERT INTO bookloq_budgets (id, organization_id, account_id, period_start, period_end, location_ref, department_ref, budget_cents, committed_cents, forecast_cents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, account_id, period_start, period_end, location_ref, department_ref)
        DO UPDATE SET budget_cents = excluded.budget_cents, committed_cents = excluded.committed_cents, forecast_cents = excluded.forecast_cents, updated_at = excluded.updated_at`)
        .bind(budgetId, context.organizationId, accountId, periodStart, periodEnd, locationRef, departmentRef, budgetCents, committedCents, forecastCents, timestamp, timestamp).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "bookloq_budget.saved", resourceType: "bookloq_budget", resourceId: budgetId,
        details: { accountId, accountCode: account.code, accountName: account.name, periodStart, periodEnd, budgetCents, committedCents, forecastCents, locationRef, departmentRef } });
      return jsonResponse({ updated: true, type: body.type, id: budgetId });
    }

    if (body.type === "month_end_status") {
      await requirePermission(context, "finance.reconcile");
      requireBookLoQPermission(context.role, "reconcile_accounts");
      const itemId = identifier(body.itemId);
      const status = typeof body.status === "string" && ["not_started", "in_progress", "blocked", "complete"].includes(body.status) ? body.status : null;
      if (!itemId || !status) return jsonResponse({ error: { code: "INVALID_CLOSE_ITEM", message: "Select a valid month-end item and status." } }, { status: 400 });
      const before = await database.prepare(`SELECT status FROM month_end_items WHERE organization_id = ? AND id = ?`).bind(context.organizationId, itemId).first<{ status: string }>();
      if (!before) return jsonResponse({ error: { code: "CLOSE_ITEM_NOT_FOUND", message: "Month-end item not found." } }, { status: 404 });
      await database.prepare(`UPDATE month_end_items SET status = ?, completed_at = ?, updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(status, status === "complete" ? timestamp : null, timestamp, context.organizationId, itemId).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "month_end.status_changed", resourceType: "bookloq_close_item", resourceId: itemId,
        details: { before: before.status, after: status } });
      return jsonResponse({ updated: true, type: body.type, id: itemId, status });
    }

    if (body.type === "alert_status") {
      await requirePermission(context, "finance.statements");
      requireBookLoQPermission(context.role, "create_transactions");
      const alertId = identifier(body.alertId);
      const status = typeof body.status === "string" && ["open", "in_progress", "resolved", "dismissed"].includes(body.status) ? body.status : null;
      if (!alertId || !status) return jsonResponse({ error: { code: "INVALID_ALERT", message: "Select a valid financial alert and status." } }, { status: 400 });
      const before = await database.prepare(`SELECT status, resolution_history_json history FROM bookloq_alerts WHERE organization_id = ? AND id = ?`).bind(context.organizationId, alertId).first<{ status: string; history: string }>();
      if (!before) return jsonResponse({ error: { code: "ALERT_NOT_FOUND", message: "Financial alert not found." } }, { status: 404 });
      let history: unknown[] = [];
      try { const parsed = JSON.parse(before.history); if (Array.isArray(parsed)) history = parsed.slice(-49); } catch { history = []; }
      history.push({ at: new Date().toISOString(), by: context.userId, from: before.status, to: status });
      await database.prepare(`UPDATE bookloq_alerts SET status = ?, resolution_history_json = ?, updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(status, JSON.stringify(history), timestamp, context.organizationId, alertId).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "bookloq_alert.status_changed", resourceType: "bookloq_alert", resourceId: alertId,
        details: { before: before.status, after: status } });
      return jsonResponse({ updated: true, type: body.type, id: alertId, status });
    }

    if (body.type === "lock_period") {
      await requirePermission(context, "finance.periods");
      requireBookLoQPermission(context.role, "lock_periods");
      const periodId = identifier(body.periodId);
      if (!periodId) return jsonResponse({ error: { code: "INVALID_PERIOD", message: "Select a valid accounting period." } }, { status: 400 });
      const period = await database.prepare(`SELECT status FROM accounting_periods WHERE organization_id = ? AND id = ?`).bind(context.organizationId, periodId).first<{ status: string }>();
      if (!period) return jsonResponse({ error: { code: "PERIOD_NOT_FOUND", message: "Accounting period not found." } }, { status: 404 });
      const incomplete = await database.prepare(`SELECT COUNT(*) count FROM month_end_items WHERE organization_id = ? AND period_id = ? AND status != 'complete'`)
        .bind(context.organizationId, periodId).first<{ count: number }>();
      if ((incomplete?.count ?? 0) > 0) return jsonResponse({ error: { code: "CLOSE_INCOMPLETE", message: "Complete every month-end item before locking this period." } }, { status: 409 });
      await database.prepare(`UPDATE accounting_periods SET status = 'locked', locked_at = ?, locked_by_user_id = ?, updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(timestamp, context.userId, timestamp, context.organizationId, periodId).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "accounting_period.locked", resourceType: "accounting_period", resourceId: periodId,
        details: { before: period.status, after: "locked" } });
      return jsonResponse({ updated: true, type: body.type, id: periodId, status: "locked" });
    }

    if (body.type === "unlock_period") {
      await requirePermission(context, "finance.periods");
      requireBookLoQPermission(context.role, "unlock_periods");
      const periodId = identifier(body.periodId);
      const reason = typeof body.reason === "string" ? body.reason.trim().normalize("NFC") : "";
      if (!periodId || !reason || reason.length > 1_000) return jsonResponse({ error: { code: "INVALID_UNLOCK", message: "A valid period and reason are required to unlock." } }, { status: 400 });
      const period = await database.prepare(`SELECT status FROM accounting_periods WHERE organization_id = ? AND id = ?`).bind(context.organizationId, periodId).first<{ status: string }>();
      if (!period || period.status !== "locked") return jsonResponse({ error: { code: "PERIOD_NOT_LOCKED", message: "Only a locked period can be unlocked." } }, { status: 409 });
      await database.prepare(`UPDATE accounting_periods SET status = 'review', locked_at = NULL, locked_by_user_id = NULL, updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(timestamp, context.organizationId, periodId).run();
      await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId,
        action: "accounting_period.unlocked", resourceType: "accounting_period", resourceId: periodId,
        details: { before: "locked", after: "review", reason } });
      return jsonResponse({ updated: true, type: body.type, id: periodId, status: "review" });
    }

    return jsonResponse({ error: { code: "INVALID_ACTION", message: "Select a supported BookLoQ action." } }, { status: 400 });
  });
}
