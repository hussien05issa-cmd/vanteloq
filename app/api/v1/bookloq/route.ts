import { getD1 } from "../../../../db";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import {
  buildFinancialStatements,
  bookloqAccessForPermissions,
  bookkeepingHealthScore,
  effectiveBookLoQPermissions,
  forecastCash,
  normalizeBookLoQTimestamp,
  type LedgerAccountRow,
} from "../../../../server/bookloq";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { calculateCashFlowIntelligence, type CashFlowItem } from "../../../../domain/cash-flow-intelligence";
import { authorizedLocationDataScope } from "../../../../server/location-access";
import { requireAddon } from "../../../../server/entitlements/engine";
import { calculateVerifiedPurchasingCapacity } from "../../../../domain/purchasing-intelligence";
import {
  buildThirteenWeekCashFlow,
  type CashFlowDecisionBlock,
  type ThirteenWeekCashFlowItem,
} from "../../../../domain/thirteen-week-cash-flow";
import { buildBusinessCashSummary, rankTransactionMatches } from "../../../../domain/bookloq-cash-management";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

type SettingsRow = {
  baseCurrency: string;
  countryCode: string;
  provinceCode: string;
  accountingBasis: "accrual" | "cash";
  cashSafetyThresholdCents: number;
  status: "not_configured" | "active" | "suspended";
  dataMode: "live" | "demonstration";
};

type CashFlowRecord = {
  dueDate: string;
  amountCents: number;
  direction: "in" | "out";
  certainty: "confirmed" | "probable" | "estimated";
};

type HealthStatsRow = {
  ledgerAvailable: number;
  unbalancedJournalCount: number;
  uncategorizedCount: number;
  unreconciledCount: number;
  openCriticalAlerts: number;
  receiptEvidenceAvailable: number;
  missingReceiptCount: number;
};

type BankRow = {
  id: string;
  name: string;
  accountType: "chequing" | "savings" | "credit_card" | "line_of_credit" | "merchant" | "loan";
  institutionName: string;
  maskedNumber: string;
  currency: string;
  provider: string;
  liveBalanceCents: number | null;
  availableBalanceCents: number | null;
  bookBalanceCents: number;
  availableCreditCents: number | null;
  connectionStatus: "manual" | "healthy" | "delayed" | "error";
  lastSyncAt: number | null;
  lastReconciledAt: number | null;
  demoRecord: number;
  accountCode: string;
  accountName: string;
};

function rows<T>(result: D1Result<T>): T[] {
  return result.results ?? [];
}

function validIsoDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "bookloq.dashboard");
    await requireAddon(context, "bookloq");
    await requirePermission(context, "finance.statements");
    const permissions = await effectivePermissions(context);
    const access = bookloqAccessForPermissions(permissions);
    const canViewDocuments = permissions.includes("documents.view");
    await enforceRateLimit("bookloq:read", `${context.userId}:${clientSource(request)}`, 90, 60);
    const database = getD1();
    const organizationId = context.organizationId;
    const requestedLocationId = new URL(request.url).searchParams.get("location");
    const locationAccess = await authorizedLocationDataScope(context, requestedLocationId);
    if (!locationAccess.organizationWide) {
      throw new ApiError(403, "BOOKLOQ_ORGANIZATION_SCOPE_REQUIRED", "BookLoQ organization-wide records are unavailable to location-limited accounts.");
    }
    const locationRefs = locationAccess.locationRefs;
    const locationPlaceholders = locationRefs?.map(() => "?").join(", ") ?? "";
    const transactionLocationClause = locationRefs === null
      ? ""
      : locationRefs.length ? ` AND t.location_ref IN (${locationPlaceholders})` : " AND 1 = 0";
    const budgetLocationClause = locationRefs === null
      ? ""
      : locationRefs.length ? ` AND b.location_ref IN (${locationPlaceholders})` : " AND 1 = 0";
    const locationBindings = locationRefs ?? [];

    const [
      settingsResult,
      accountsResult,
      transactionsResult,
      banksResult,
      reconciliationsResult,
      billsResult,
      invoicesResult,
      contactsResult,
      alertsResult,
      healthStatsResult,
      journalsResult,
      periodsResult,
      closeResult,
      budgetsResult,
      auditResult,
      integrationsResult,
      documentsResult,
      transactionMatchesResult,
      categoryRulesResult,
    ] = await Promise.all([
      database.prepare(`SELECT base_currency baseCurrency, country_code countryCode, province_code provinceCode,
        accounting_basis accountingBasis, cash_safety_threshold_cents cashSafetyThresholdCents,
        status, data_mode dataMode FROM bookloq_settings WHERE organization_id = ?`).bind(organizationId).all<SettingsRow>(),
      database.prepare(`SELECT a.id, a.code, a.name, a.account_type accountType, a.account_subtype accountSubtype,
        a.normal_balance normalBalance, a.system_key systemKey, a.description, a.plain_language plainLanguage,
        COALESCE(SUM(CASE WHEN e.status IN ('posted', 'reversed') THEN l.debit_cents ELSE 0 END), 0) debitCents,
        COALESCE(SUM(CASE WHEN e.status IN ('posted', 'reversed') THEN l.credit_cents ELSE 0 END), 0) creditCents
        FROM financial_accounts a
        LEFT JOIN journal_lines l ON l.account_id = a.id AND l.organization_id = a.organization_id
        LEFT JOIN journal_entries e ON e.id = l.journal_entry_id AND e.organization_id = a.organization_id
        WHERE a.organization_id = ? AND a.active = 1
        GROUP BY a.id ORDER BY a.code`).bind(organizationId).all<LedgerAccountRow>(),
      database.prepare(`SELECT t.id, t.transaction_date transactionDate, t.posting_date postingDate,
        t.description, t.original_description originalDescription, t.amount_cents amountCents,
        t.currency, t.tax_amount_cents taxAmountCents, t.source_system sourceSystem,
        t.external_source_id externalSourceId, t.location_ref locationRef,
        t.reconciliation_status reconciliationStatus, t.categorization_status categorizationStatus,
        t.confidence_basis_points confidenceBasisPoints, t.approval_status approvalStatus,
        t.demo_record demoRecord, t.source_state sourceState, a.code accountCode, a.name accountName,
        a.account_type categoryAccountType, a.account_subtype categoryAccountSubtype, a.system_key categorySystemKey,
        c.name contactName
        FROM financial_transactions t
        LEFT JOIN financial_accounts a ON a.id = t.category_account_id AND a.organization_id = t.organization_id
        LEFT JOIN bookloq_contacts c ON c.id = t.contact_id AND c.organization_id = t.organization_id
        WHERE t.organization_id = ?
          AND (t.source_system <> 'plaid' OR EXISTS (
            SELECT 1 FROM integration_connections c
            WHERE c.organization_id = t.organization_id AND c.provider = 'plaid'
              AND c.status = 'connected' AND c.data_promotion_status = 'approved'
              AND (c.sync_lease_owner IS NULL OR c.sync_lease_expires_at IS NULL
                OR c.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
          ))${transactionLocationClause}
        ORDER BY t.posting_date DESC, t.created_at DESC LIMIT 1000`).bind(organizationId, ...locationBindings).all(),
      database.prepare(`SELECT b.id, b.name, b.account_type accountType, b.institution_name institutionName,
        b.masked_number maskedNumber, b.live_balance_cents liveBalanceCents,
        b.available_balance_cents availableBalanceCents, b.book_balance_cents bookBalanceCents,
        b.available_credit_cents availableCreditCents, b.connection_status connectionStatus,
        b.last_sync_at lastSyncAt, b.last_reconciled_at lastReconciledAt, b.demo_record demoRecord,
        b.currency, b.provider,
        a.code accountCode, a.name accountName
        FROM bank_accounts b JOIN financial_accounts a
          ON a.id = b.financial_account_id AND a.organization_id = b.organization_id
        WHERE b.organization_id = ?
          AND (b.provider <> 'plaid' OR EXISTS (
            SELECT 1 FROM integration_connections c
            WHERE c.organization_id = b.organization_id AND c.provider = 'plaid'
              AND c.external_account_ref = b.external_item_ref
              AND c.status = 'connected' AND c.data_promotion_status = 'approved'
              AND (c.sync_lease_owner IS NULL OR c.sync_lease_expires_at IS NULL
                OR c.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
          ))
        ORDER BY b.name`).bind(organizationId).all(),
      database.prepare(`SELECT r.id, r.reconciliation_type reconciliationType, r.start_date startDate,
        r.end_date endDate, r.opening_balance_cents openingBalanceCents,
        r.closing_balance_cents closingBalanceCents, r.book_balance_cents bookBalanceCents,
        r.difference_cents differenceCents, r.status, a.code accountCode, a.name accountName
        FROM reconciliations r JOIN financial_accounts a ON a.id = r.account_id AND a.organization_id = r.organization_id
        WHERE r.organization_id = ? ORDER BY r.end_date DESC LIMIT 60`).bind(organizationId).all(),
      database.prepare(`SELECT b.id, b.bill_number billNumber, b.invoice_date invoiceDate, b.due_date dueDate,
        b.status, b.subtotal_cents subtotalCents, b.tax_cents taxCents, b.total_cents totalCents,
        b.paid_cents paidCents, b.currency, b.purchase_order_ref purchaseOrderRef,
        b.approval_status approvalStatus, b.demo_record demoRecord, c.name supplierName
        FROM supplier_bills b JOIN bookloq_contacts c ON c.id = b.supplier_id AND c.organization_id = b.organization_id
        WHERE b.organization_id = ? ORDER BY b.due_date LIMIT 200`).bind(organizationId).all(),
      database.prepare(`SELECT i.id, i.invoice_number invoiceNumber, i.invoice_date invoiceDate, i.due_date dueDate,
        i.status, i.subtotal_cents subtotalCents, i.tax_cents taxCents, i.total_cents totalCents,
        i.paid_cents paidCents, i.currency, i.document_id documentId, i.sent_at sentAt,
        i.emailed_to emailedTo, i.demo_record demoRecord, c.name customerName, c.email customerEmail
        FROM customer_invoices i JOIN bookloq_contacts c ON c.id = i.customer_id AND c.organization_id = i.organization_id
        WHERE i.organization_id = ? ORDER BY i.due_date LIMIT 200`).bind(organizationId).all(),
      database.prepare(`SELECT id, contact_type contactType, name, email, phone, billing_address billingAddress,
        payment_terms_days paymentTermsDays, credit_limit_cents creditLimitCents, notes, active
        FROM bookloq_contacts WHERE organization_id = ? ORDER BY name LIMIT 300`).bind(organizationId).all(),
      database.prepare(`SELECT id, severity, alert_type alertType, title, explanation,
        dollar_impact_cents dollarImpactCents, confidence, supporting_records_json supportingRecordsJson,
        recommended_action recommendedAction, due_date dueDate, status,
        resolution_history_json resolutionHistoryJson, demo_record demoRecord, created_at createdAt
        FROM bookloq_alerts WHERE organization_id = ? ORDER BY
        CASE severity WHEN 'critical' THEN 1 WHEN 'attention' THEN 2 WHEN 'opportunity' THEN 3 ELSE 4 END,
        created_at DESC LIMIT 100`).bind(organizationId).all(),
      database.prepare(`WITH trusted_transactions AS (
          SELECT t.categorization_status, t.reconciliation_status
          FROM financial_transactions t
          WHERE t.organization_id = ?
            AND (t.source_system <> 'plaid' OR EXISTS (
              SELECT 1 FROM integration_connections c
              WHERE c.organization_id = t.organization_id AND c.provider = 'plaid'
                AND c.status = 'connected' AND c.data_promotion_status = 'approved'
                AND (c.sync_lease_owner IS NULL OR c.sync_lease_expires_at IS NULL
                  OR c.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
            ))
        )
        SELECT
          EXISTS(SELECT 1 FROM journal_entries
            WHERE organization_id = ? AND status IN ('posted', 'reversed')) ledgerAvailable,
          (SELECT COUNT(*) FROM journal_entries
            WHERE organization_id = ? AND status IN ('posted', 'reversed')
              AND total_debit_cents <> total_credit_cents) unbalancedJournalCount,
          (SELECT COUNT(*) FROM trusted_transactions
            WHERE categorization_status <> 'confirmed') uncategorizedCount,
          (SELECT COUNT(*) FROM trusted_transactions
            WHERE reconciliation_status <> 'reconciled') unreconciledCount,
          (SELECT COUNT(*) FROM bookloq_alerts
            WHERE organization_id = ? AND status = 'open' AND severity = 'critical') openCriticalAlerts,
          EXISTS(SELECT 1 FROM bookloq_alerts
            WHERE organization_id = ? AND alert_type = 'receipt_missing') receiptEvidenceAvailable,
          (SELECT COUNT(*) FROM bookloq_alerts
            WHERE organization_id = ? AND alert_type = 'receipt_missing' AND status = 'open') missingReceiptCount`
        ).bind(
          organizationId,
          organizationId,
          organizationId,
          organizationId,
          organizationId,
          organizationId,
        ).all<HealthStatsRow>(),
      database.prepare(`SELECT e.id, e.entry_number entryNumber, e.entry_date entryDate, e.posting_date postingDate,
        e.status, e.source_type sourceType, e.source_ref sourceRef, e.memo, e.currency,
        e.total_debit_cents totalDebitCents, e.total_credit_cents totalCreditCents,
        e.reversal_of_entry_id reversalOfEntryId, e.posted_at postedAt,
        (SELECT COUNT(*) FROM journal_lines l WHERE l.journal_entry_id = e.id) lineCount
        FROM journal_entries e WHERE e.organization_id = ? ORDER BY e.posting_date DESC, e.created_at DESC LIMIT 100`).bind(organizationId).all(),
      database.prepare(`SELECT id, label, start_date startDate, end_date endDate, status,
        locked_at lockedAt FROM accounting_periods WHERE organization_id = ? ORDER BY start_date DESC LIMIT 24`).bind(organizationId).all(),
      database.prepare(`SELECT m.id, m.period_id periodId, m.item_key itemKey, m.title, m.status,
        m.due_date dueDate, m.blocker, m.completed_at completedAt
        FROM month_end_items m WHERE m.organization_id = ? ORDER BY m.title`).bind(organizationId).all(),
      database.prepare(`SELECT b.id, b.account_id accountId, b.period_start periodStart, b.period_end periodEnd,
        b.location_ref locationRef, b.department_ref departmentRef, b.budget_cents budgetCents,
        b.committed_cents committedCents, b.forecast_cents forecastCents,
        a.code accountCode, a.name accountName, a.account_type accountType
        FROM bookloq_budgets b JOIN financial_accounts a ON a.id = b.account_id AND a.organization_id = b.organization_id
        WHERE b.organization_id = ?${budgetLocationClause} ORDER BY a.code`).bind(organizationId, ...locationBindings).all(),
      database.prepare(`SELECT action, resource_type resourceType, resource_id resourceId,
        outcome, details_json detailsJson, created_at createdAt
        FROM audit_events WHERE organization_id = ? AND
        (resource_type LIKE 'bookloq%' OR resource_type IN ('journal_entry','accounting_period','financial_transaction'))
        ORDER BY created_at DESC LIMIT 80`).bind(organizationId).all(),
      database.prepare(`SELECT provider, status, data_promotion_status dataPromotionStatus,
        last_successful_sync_at lastSuccessfulSyncAt
        FROM integration_connections WHERE organization_id = ?`).bind(organizationId).all(),
      database.prepare(`SELECT id, document_type documentType, file_name fileName, status,
        security_state securityState, extraction_status extractionStatus, extracted_json extractedJson,
        created_at createdAt FROM workspace_documents WHERE organization_id = ?
        ORDER BY created_at DESC LIMIT 200`).bind(organizationId).all(),
      database.prepare(`SELECT m.id, m.transaction_id transactionId, m.status, m.method,
        m.confidence_basis_points confidenceBasisPoints, m.matched_amount_cents matchedAmountCents,
        m.reasons_json reasonsJson, m.note, m.supplier_bill_id supplierBillId,
        m.customer_invoice_id customerInvoiceId, m.document_id documentId,
        COALESCE(sb.bill_number, ci.invoice_number, wd.file_name) targetLabel
        FROM bookloq_transaction_matches m
        LEFT JOIN supplier_bills sb ON sb.id = m.supplier_bill_id AND sb.organization_id = m.organization_id
        LEFT JOIN customer_invoices ci ON ci.id = m.customer_invoice_id AND ci.organization_id = m.organization_id
        LEFT JOIN workspace_documents wd ON wd.id = m.document_id AND wd.organization_id = m.organization_id
        WHERE m.organization_id = ? ORDER BY m.updated_at DESC LIMIT 500`).bind(organizationId).all(),
      database.prepare(`SELECT r.id, r.name, r.match_text matchText, r.direction, r.account_id accountId,
        a.code accountCode, a.name accountName
        FROM bookloq_category_rules r JOIN financial_accounts a
          ON a.id = r.account_id AND a.organization_id = r.organization_id
        WHERE r.organization_id = ? AND r.active = 1 ORDER BY r.name LIMIT 200`).bind(organizationId).all(),
    ]);

    const settings = rows(settingsResult)[0] ?? null;
    const accountRows = rows(accountsResult);
    const statements = buildFinancialStatements(accountRows);
    const transactions = rows(transactionsResult) as Array<{
      id: string; postingDate: string; description: string; originalDescription: string;
      amountCents: number; currency: string; categorizationStatus: string;
      reconciliationStatus: string; accountName: string | null;
    }>;
    const banks = rows(banksResult) as BankRow[];
    const reconciliations = rows(reconciliationsResult);
    const bills = rows(billsResult) as Array<{ id: string; billNumber: string; supplierName: string; dueDate: string; totalCents: number; paidCents: number; status: string; currency: string; approvalStatus: string; demoRecord: number; purchaseOrderRef: string | null }>;
    const invoices = rows(invoicesResult) as Array<{ id: string; invoiceNumber: string; customerName: string; dueDate: string; totalCents: number; paidCents: number; status: string; currency: string; demoRecord: number }>;
    const closeItems = rows(closeResult) as Array<{ status: string }>;
    const completeItems = closeItems.filter((item) => item.status === "complete").length;
    const monthEndCompletionRate = closeItems.length ? completeItems / closeItems.length : 0;
    const healthStats = rows(healthStatsResult)[0] ?? {
      ledgerAvailable: 0,
      unbalancedJournalCount: 0,
      uncategorizedCount: 0,
      unreconciledCount: 0,
      openCriticalAlerts: 0,
      receiptEvidenceAvailable: 0,
      missingReceiptCount: 0,
    };
    const ledgerAvailable = Boolean(healthStats.ledgerAvailable);
    // Complete ledger totals can reconstruct protected wage and bank balances.
    // Keep independent bank and invoice permissions, but do not publish a
    // partially redacted trial balance that still reveals the hidden accounts.
    const ledgerReadable = ledgerAvailable && access.payrollTotals && access.bankBalances;
    const fullLedgerPermission = access.payrollTotals && access.bankBalances;
    // Raw bank feeds may contain uncategorized payroll. An account label alone
    // cannot reliably establish that a transaction is safe for payroll-limited roles.
    const transactionReadable = access.bankTransactions && access.payrollTotals;
    const accountCatalog = accountRows.map((account) => ({
      id: account.id, code: account.code, name: account.name,
      accountType: account.accountType, accountSubtype: account.accountSubtype,
      normalBalance: account.normalBalance, systemKey: account.systemKey,
    }));
    const unbalancedJournalCount = Number(healthStats.unbalancedJournalCount);
    const uncategorizedCount = Number(healthStats.uncategorizedCount);
    const unreconciledCount = Number(healthStats.unreconciledCount);
    const openCriticalAlerts = Number(healthStats.openCriticalAlerts);
    const missingReceiptCount = healthStats.receiptEvidenceAvailable
      ? Number(healthStats.missingReceiptCount)
      : null;
    const journalRows = rows(journalsResult) as Array<{
      status: string;
      totalDebitCents: number;
      totalCreditCents: number;
    }>;
    const healthScore = missingReceiptCount === null
      ? null
      : bookkeepingHealthScore({ unbalancedJournalCount, uncategorizedCount, unreconciledCount, openCriticalAlerts, missingReceiptCount, monthEndCompletionRate });
    const asOf = new Date().toISOString().slice(0, 10);
    const integrationRows = rows(integrationsResult) as Array<{ provider: string; status: string; dataPromotionStatus: string; lastSuccessfulSyncAt: number | null }>;
    const documentRows = rows(documentsResult) as Array<{ id: string; documentType: string; fileName: string; status: string; securityState: string; extractionStatus: string; extractedJson: string; createdAt: number }>;
    const transactionMatches = (rows(transactionMatchesResult) as Array<{ id: string; transactionId: string; status: string; method: string; confidenceBasisPoints: number; matchedAmountCents: number; reasonsJson: string; note: string; supplierBillId: string | null; customerInvoiceId: string | null; documentId: string | null; targetLabel: string }>).map((match) => (
      !canViewDocuments && match.documentId ? { ...match, documentId: null, targetLabel: "Financial document" } : match
    ));
    const categoryRules = rows(categoryRulesResult);
    const plaidConnection = integrationRows.find((item) => item.provider === "plaid" && item.status === "connected")
      ?? integrationRows.find((item) => item.provider === "plaid");
    const canReconcile = permissions.includes("finance.reconcile");
    const uiPermissions = effectiveBookLoQPermissions(context.role).filter((permission) => {
      if (permission === "view_banking") return access.bankBalances;
      if (permission === "view_payroll") return access.payrollTotals;
      if (permission === "view_audit_logs") return access.audit;
      if (permission === "export_data") return access.export;
      if (permission === "reconcile_accounts") return canReconcile;
      if (permission === "post_journals") return permissions.includes("finance.journal_post");
      if (permission === "manage_integrations") return permissions.includes("finance.connections");
      return true;
    });
    const baseCurrency = (settings?.baseCurrency ?? context.organization.currency).toUpperCase();
    const dataMode = settings?.dataMode ?? "live";
    const nowMs = Date.now();
    const cashAccountTypes = new Set<BankRow["accountType"]>(["chequing", "savings", "merchant"]);
    const visibleBanks = access.bankBalances ? banks
      .filter((bank) => dataMode === "demonstration" ? Boolean(bank.demoRecord) : !Boolean(bank.demoRecord))
      .map((bank) => {
        const synchronizedAt = normalizeBookLoQTimestamp(bank.lastSyncAt);
        const reconciledAt = normalizeBookLoQTimestamp(bank.lastReconciledAt);
        const ageMs = synchronizedAt === null ? null : nowMs - synchronizedAt;
        const current = !Boolean(bank.demoRecord)
          && cashAccountTypes.has(bank.accountType)
          && bank.currency.toUpperCase() === baseCurrency.toUpperCase()
          && bank.connectionStatus === "healthy"
          && (bank.availableBalanceCents !== null || bank.liveBalanceCents !== null)
          && ageMs !== null
          && ageMs >= 0
          && ageMs <= 48 * 60 * 60 * 1_000;
        const balanceState = Boolean(bank.demoRecord)
          ? "demonstration"
          : current ? "current" : ageMs !== null && ageMs > 48 * 60 * 60 * 1_000 ? "stale" : "unavailable";
        return { ...bank, lastSyncAt: synchronizedAt, lastReconciledAt: reconciledAt, balanceState };
      }) : [];
    const matchesDataMode = (demoRecord: number) => dataMode === "demonstration" ? Boolean(demoRecord) : !Boolean(demoRecord);
    const visibleBills = access.accountsPayableReceivable ? bills.filter((bill) => matchesDataMode(bill.demoRecord)) : [];
    const visibleInvoices = access.accountsPayableReceivable ? invoices.filter((invoice) => matchesDataMode(invoice.demoRecord)) : [];
    const visibleContacts = access.contactIdentity ? rows(contactsResult) : [];
    const demonstrationCashBanks = visibleBanks.filter((bank) =>
      cashAccountTypes.has(bank.accountType)
      && bank.currency.toUpperCase() === baseCurrency.toUpperCase(),
    );
    const plaidBanks = visibleBanks.filter((bank) => bank.provider === "plaid" && !Boolean(bank.demoRecord));
    const verifiedBankCash = calculateVerifiedPurchasingCapacity({
      connectionVerified: access.bankBalances
        && dataMode === "live"
        && integrationRows.some((item) => item.provider === "plaid" && item.status === "connected" && item.dataPromotionStatus === "approved"),
      nowMs,
      maximumAgeMs: 48 * 60 * 60 * 1_000,
      baseCurrency,
      cashSafetyReserveCents: 0,
      outstandingBillsCents: 0,
      openPurchaseCommitmentsCents: 0,
      accounts: plaidBanks.map((bank) => ({
        accountType: bank.accountType,
        currency: bank.currency,
        connectionStatus: bank.connectionStatus,
        availableBalanceCents: bank.availableBalanceCents,
        liveBalanceCents: bank.liveBalanceCents,
        lastSyncAtMs: bank.lastSyncAt,
      })),
    });
    const verifiedBankCashCents = verifiedBankCash.status === "available" ? verifiedBankCash.verifiedCashCents : null;
    const bankBalanceCents = dataMode === "demonstration"
      ? demonstrationCashBanks.length
        ? demonstrationCashBanks.reduce((sum, bank) => sum + Number(bank.availableBalanceCents ?? bank.liveBalanceCents ?? 0), 0)
        : null
      : verifiedBankCashCents;
    const cashOpeningBalanceCents = dataMode === "demonstration" ? bankBalanceCents : verifiedBankCashCents;
    const cashSource = dataMode === "demonstration" && bankBalanceCents !== null
      ? "demonstration" as const
      : verifiedBankCashCents !== null
      ? "plaid_available_balance" as const
      : "unavailable" as const;
    const cashLastSyncMs = plaidBanks
      .map((bank) => bank.lastSyncAt)
      .filter((value): value is number => value !== null)
      .sort((left, right) => right - left)[0] ?? null;
    const cashLastSyncAt = cashLastSyncMs === null ? null : Math.floor(cashLastSyncMs / 1_000);
    const visibleBillsForCash = access.accountsPayableReceivable ? bills.filter((bill) => matchesDataMode(bill.demoRecord)) : [];
    const visibleInvoicesForCash = access.accountsPayableReceivable ? invoices.filter((invoice) => matchesDataMode(invoice.demoRecord)) : [];
    const confirmedTransactionIds = new Set(transactionMatches.filter((match) => match.status === "confirmed").map((match) => match.transactionId));
    const cashTransactions = (transactionReadable ? transactions : []).filter((transaction) => transaction.currency.toUpperCase() === baseCurrency).map((transaction) => ({
      postingDate: transaction.postingDate,
      amountCents: Number(transaction.amountCents),
      category: transaction.accountName ?? (transaction.amountCents >= 0 ? "Uncategorized income" : "Uncategorized spending"),
      categorized: transaction.categorizationStatus === "confirmed",
      matched: transaction.reconciliationStatus === "matched" || transaction.reconciliationStatus === "reconciled" || confirmedTransactionIds.has(transaction.id),
    }));
    const cashActivity = {
      days30: buildBusinessCashSummary(cashTransactions, asOf, 30),
      days90: buildBusinessCashSummary(cashTransactions, asOf, 90),
      months12: buildBusinessCashSummary(cashTransactions, asOf, 366),
    };
    const matchCandidates = transactions.flatMap((transaction) => rankTransactionMatches({
      id: transaction.id,
      postingDate: transaction.postingDate,
      amountCents: transaction.amountCents,
      description: `${transaction.description} ${transaction.originalDescription}`,
    }, [
      ...visibleBillsForCash.map((bill) => ({ id: bill.id, kind: "supplier_bill" as const, date: bill.dueDate, amountCents: bill.totalCents - bill.paidCents, label: `${bill.supplierName} · ${bill.billNumber}`, reference: bill.billNumber })),
      ...visibleInvoicesForCash.map((invoice) => ({ id: invoice.id, kind: "customer_invoice" as const, date: invoice.dueDate, amountCents: invoice.totalCents - invoice.paidCents, label: `${invoice.customerName} · ${invoice.invoiceNumber}`, reference: invoice.invoiceNumber })),
    ])).filter((candidate) => !confirmedTransactionIds.has(candidate.transactionId)).slice(0, 100);
    const cashProjectionAllowed = access.bankBalances && access.accountsPayableReceivable && cashOpeningBalanceCents !== null;
    const thirteenWeekAllowed = cashProjectionAllowed && transactionReadable;
    const asOfMilliseconds = Date.parse(`${asOf}T00:00:00Z`);
    const asOfWeekday = new Date(asOfMilliseconds).getUTCDay();
    const firstWeekStart = new Date(asOfMilliseconds - ((asOfWeekday + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    const thirteenWeekEnd = new Date(Date.parse(`${firstWeekStart}T00:00:00Z`) + 90 * 86_400_000).toISOString().slice(0, 10);
    type CalculationBill = { id: string; billNumber: string; supplierName: string; dueDate: string; totalCents: number; paidCents: number; status: string; currency: string; approvalStatus: string; demoRecord: number; purchaseOrderRef: string | null };
    type CalculationInvoice = { id: string; invoiceNumber: string; customerName: string; dueDate: string; totalCents: number; paidCents: number; status: string; currency: string; demoRecord: number };
    type CalculationPurchaseOrder = { id: string; orderNumber: string; supplierName: string; committedCashDate: string | null; expectedDeliveryDate: string | null; totalCents: number; currency: string; status: string };
    let calculationBills: CalculationBill[] = [];
    let calculationInvoices: CalculationInvoice[] = [];
    let calculationPurchaseOrders: CalculationPurchaseOrder[] = [];
    if (cashProjectionAllowed) {
      const [calculationBillsResult, calculationInvoicesResult, calculationPurchaseOrdersResult] = await Promise.all([
        database.prepare(`SELECT b.id, b.bill_number billNumber, b.due_date dueDate, b.status,
          b.total_cents totalCents, b.paid_cents paidCents, b.currency,
          b.approval_status approvalStatus, b.demo_record demoRecord,
          b.purchase_order_ref purchaseOrderRef, c.name supplierName
          FROM supplier_bills b JOIN bookloq_contacts c
            ON c.id = b.supplier_id AND c.organization_id = b.organization_id
          WHERE b.organization_id = ? AND b.status <> 'void'`)
          .bind(organizationId).all<CalculationBill>(),
        database.prepare(`SELECT i.id, i.invoice_number invoiceNumber, i.due_date dueDate, i.status,
          i.total_cents totalCents, i.paid_cents paidCents, i.currency,
          i.demo_record demoRecord, c.name customerName
          FROM customer_invoices i JOIN bookloq_contacts c
            ON c.id = i.customer_id AND c.organization_id = i.organization_id
          WHERE i.organization_id = ?`)
          .bind(organizationId).all<CalculationInvoice>(),
        database.prepare(`SELECT id, order_number orderNumber, supplier_name supplierName,
          committed_cash_date committedCashDate, expected_delivery_date expectedDeliveryDate,
          total_cents totalCents, currency, status
          FROM purchase_orders
          WHERE organization_id = ?
            AND ? = 'live'
            AND status IN ('sent', 'acknowledged', 'partially_received', 'received', 'partially_invoiced', 'invoiced', 'disputed')`)
          .bind(organizationId, dataMode).all<CalculationPurchaseOrder>(),
      ]);
      calculationBills = rows(calculationBillsResult);
      calculationInvoices = rows(calculationInvoicesResult);
      calculationPurchaseOrders = rows(calculationPurchaseOrdersResult);
    }
    const openBillStatuses = new Set(["draft", "received", "extracted", "under_review", "matched", "awaiting_approval", "approved", "scheduled", "partially_paid", "disputed"]);
    const isConfirmedBill = (bill: CalculationBill) =>
      ["approved", "scheduled", "partially_paid"].includes(bill.status)
      && ["approved", "not_required"].includes(bill.approvalStatus);
    const outstandingBillCents = (bill: CalculationBill) => Math.max(0, bill.totalCents - bill.paidCents);
    const linkedToOrder = (bill: CalculationBill, order: CalculationPurchaseOrder) =>
      bill.purchaseOrderRef === order.id || bill.purchaseOrderRef === order.orderNumber;
    const forecastBills = calculationBills.filter((bill) =>
      matchesDataMode(bill.demoRecord)
      && bill.currency.toUpperCase() === baseCurrency
      && openBillStatuses.has(bill.status)
      && outstandingBillCents(bill) > 0,
    );
    const forecastInvoices = calculationInvoices.filter((invoice) => matchesDataMode(invoice.demoRecord) && invoice.currency.toUpperCase() === baseCurrency && ["approved", "sent", "viewed", "due", "partially_paid", "overdue"].includes(invoice.status) && invoice.totalCents > invoice.paidCents);
    const orderGroups = calculationPurchaseOrders.map((order) => {
      const currency = order.currency.toUpperCase();
      const linkedBills = calculationBills.filter((bill) =>
        matchesDataMode(bill.demoRecord)
        && bill.currency.toUpperCase() === currency
        && linkedToOrder(bill, order),
      );
      const openLinkedBills = linkedBills.filter((bill) => openBillStatuses.has(bill.status) && outstandingBillCents(bill) > 0);
      const poRemainingCents = Math.max(0, order.totalCents - linkedBills.reduce((sum, bill) => sum + Math.max(0, bill.paidCents), 0));
      const openOutstandingCents = openLinkedBills.reduce((sum, bill) => sum + outstandingBillCents(bill), 0);
      const groupRemainingCents = Math.max(poRemainingCents, openOutstandingCents);
      const confirmedBillOutstandingCents = openLinkedBills.filter(isConfirmedBill).reduce((sum, bill) => sum + outstandingBillCents(bill), 0);
      const committedDateValid = validIsoDate(order.committedCashDate);
      const confirmedAmountCents = Math.min(
        groupRemainingCents,
        committedDateValid
          ? Math.max(poRemainingCents, confirmedBillOutstandingCents)
          : confirmedBillOutstandingCents,
      );
      return {
        order,
        currency,
        linkedBills,
        openLinkedBills,
        openOutstandingCents,
        groupRemainingCents,
        confirmedAmountCents,
        confirmedBillOutstandingCents,
        expectedAmountCents: Math.max(0, groupRemainingCents - confirmedAmountCents),
        committedDateValid,
      };
    });
    const baseOrderGroups = orderGroups.filter((group) => group.currency === baseCurrency);
    const baseLinkedBillIds = new Set(baseOrderGroups.flatMap((group) => group.linkedBills.map((bill) => bill.id)));
    const unlinkedForecastBills = forecastBills.filter((bill) => !baseLinkedBillIds.has(bill.id));
    const purchaseCommitmentItems: ThirteenWeekCashFlowItem[] = baseOrderGroups.flatMap((group) => {
      const confirmedBillItems = group.openLinkedBills.filter(isConfirmedBill).map((bill) => ({
        id: bill.id,
        label: `${bill.supplierName} bill ${bill.billNumber}`,
        dueDate: bill.dueDate,
        amountCents: outstandingBillCents(bill),
        direction: "out" as const,
        certainty: "confirmed" as const,
      }));
      let expectedBillCentsRemaining = group.expectedAmountCents;
      const expectedBillItems = group.openLinkedBills
        .filter((bill) => !isConfirmedBill(bill))
        .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id))
        .flatMap((bill) => {
          const amountCents = Math.min(outstandingBillCents(bill), expectedBillCentsRemaining);
          expectedBillCentsRemaining -= amountCents;
          return amountCents > 0 ? [{
            id: bill.id,
            label: `${bill.supplierName} bill ${bill.billNumber}`,
            dueDate: bill.dueDate,
            amountCents,
            direction: "out" as const,
            certainty: "expected" as const,
          }] : [];
        });
      const confirmedOrderRemainderCents = Math.max(0, group.confirmedAmountCents - group.confirmedBillOutstandingCents);
      const orderItems: ThirteenWeekCashFlowItem[] = [];
      if (confirmedOrderRemainderCents > 0) {
        orderItems.push({
          id: `purchase-order:${group.order.id}:confirmed`,
          label: `${group.order.supplierName} purchase order ${group.order.orderNumber}`,
          dueDate: group.order.committedCashDate!,
          amountCents: confirmedOrderRemainderCents,
          direction: "out",
          certainty: "confirmed",
        });
      }
      if (expectedBillCentsRemaining > 0) {
        orderItems.push({
          id: `purchase-order:${group.order.id}:expected`,
          label: `${group.order.supplierName} purchase order ${group.order.orderNumber}`,
          dueDate: validIsoDate(group.order.expectedDeliveryDate) ? group.order.expectedDeliveryDate! : asOf,
          amountCents: expectedBillCentsRemaining,
          direction: "out",
          certainty: "expected",
        });
      }
      return [...confirmedBillItems, ...expectedBillItems, ...orderItems];
    });
    const undatedCommittedItemCount = baseOrderGroups.filter((group) => group.groupRemainingCents > 0 && !group.committedDateValid).length;
    const confirmedPurchasingObligationsCents = baseOrderGroups.reduce((sum, group) => sum + group.confirmedAmountCents, 0)
      + unlinkedForecastBills.filter(isConfirmedBill).reduce((sum, bill) => sum + outstandingBillCents(bill), 0);
    const foreignOrderGroups = orderGroups.filter((group) => group.currency !== baseCurrency && group.groupRemainingCents > 0);
    const foreignLinkedBillIds = new Set(foreignOrderGroups.flatMap((group) => group.linkedBills.map((bill) => bill.id)));
    const foreignUnlinkedOpenBills = calculationBills.filter((bill) =>
      matchesDataMode(bill.demoRecord)
      && bill.currency.toUpperCase() !== baseCurrency
      && openBillStatuses.has(bill.status)
      && outstandingBillCents(bill) > 0
      && !foreignLinkedBillIds.has(bill.id),
    );
    const excludedCurrencyItemCount = foreignOrderGroups.length + foreignUnlinkedOpenBills.length;
    const decisionBlocks: CashFlowDecisionBlock[] = [];
    if (dataMode === "demonstration") decisionBlocks.push("demonstration_data");
    if (settings?.status !== "active") decisionBlocks.push("bookloq_inactive");
    if (!access.bankBalances || !access.accountsPayableReceivable || !transactionReadable) {
      decisionBlocks.push("finance_permissions_required");
    }
    if (dataMode === "live" && verifiedBankCashCents === null) decisionBlocks.push("bank_data_unavailable");
    if (excludedCurrencyItemCount > 0) decisionBlocks.push("foreign_currency_obligations");
    if (undatedCommittedItemCount > 0) decisionBlocks.push("undated_purchase_commitments");
    const cashFactsAllowed = !decisionBlocks.some((block) => [
      "demonstration_data",
      "bookloq_inactive",
      "finance_permissions_required",
      "bank_data_unavailable",
    ].includes(block));
    const decisionCashAllowed = decisionBlocks.length === 0;
    const cashFlowItems: CashFlowRecord[] = [
      ...unlinkedForecastBills.map((bill) => ({ dueDate: bill.dueDate, amountCents: bill.totalCents - bill.paidCents, direction: "out" as const, certainty: isConfirmedBill(bill) ? "confirmed" as const : "estimated" as const })),
      ...forecastInvoices.map((invoice) => ({ dueDate: invoice.dueDate, amountCents: invoice.totalCents - invoice.paidCents, direction: "in" as const, certainty: "probable" as const })),
      ...purchaseCommitmentItems.map((item) => ({ dueDate: item.dueDate, amountCents: item.amountCents, direction: "out" as const, certainty: item.certainty === "confirmed" ? "confirmed" as const : "estimated" as const })),
    ];
    const forecasts = forecastCash(cashOpeningBalanceCents ?? 0, cashFlowItems, asOf);
    const intelligenceItems: CashFlowItem[] = [
      ...unlinkedForecastBills.map((bill) => ({ id: bill.id, label: `${bill.supplierName} bill ${bill.billNumber}`, dueDate: bill.dueDate, amountCents: bill.totalCents - bill.paidCents, direction: "out" as const, certainty: isConfirmedBill(bill) ? "confirmed" as const : "estimated" as const, category: "supplier" as const })),
      ...forecastInvoices.map((invoice) => ({ id: invoice.id, label: `${invoice.customerName} invoice ${invoice.invoiceNumber}`, dueDate: invoice.dueDate, amountCents: invoice.totalCents - invoice.paidCents, direction: "in" as const, certainty: "probable" as const, category: "other" as const })),
      ...purchaseCommitmentItems.map((item) => ({ ...item, certainty: item.certainty === "confirmed" ? "confirmed" as const : "estimated" as const, category: "supplier" as const })),
    ];
    const calculatedCashIntelligence = calculateCashFlowIntelligence({ openingCashCents: cashFactsAllowed ? cashOpeningBalanceCents : null, safetyThresholdCents: settings?.cashSafetyThresholdCents ?? 0, items: intelligenceItems, asOf });
    const cashIntelligence = cashFactsAllowed && !decisionCashAllowed
      ? {
          ...calculatedCashIntelligence,
          purchasingCapacityCents: null,
          warning: "Foreign-currency or undated vendor commitments require review before purchasing capacity can be used.",
          evidence: [...calculatedCashIntelligence.evidence, "Purchasing capacity is withheld until commitment review is complete."],
        }
      : calculatedCashIntelligence;
    const dueNext30Cents = cashFlowItems.filter((item) => item.direction === "out" && item.certainty === "confirmed" && item.dueDate <= forecasts[1].endDate).reduce((sum, item) => sum + item.amountCents, 0);
    const actualTransactionResult = thirteenWeekAllowed
      ? await database.prepare(`SELECT t.posting_date postingDate, SUM(t.amount_cents) amountCents
          FROM financial_transactions t
          INNER JOIN bank_accounts b ON b.organization_id = t.organization_id AND b.financial_account_id = t.account_id
          WHERE t.organization_id = ? AND UPPER(t.currency) = ? AND t.demo_record = ?
            AND UPPER(b.currency) = ? AND b.demo_record = ?
            AND b.account_type IN ('chequing', 'savings', 'merchant')
            AND t.source_state IN ('posted', 'modified')
            AND t.posting_date BETWEEN ? AND ?
            AND ((? = 'live'
              AND t.source_system = 'plaid' AND b.provider = 'plaid' AND b.connection_status = 'healthy'
              AND b.external_item_ref IS NOT NULL
              AND (b.available_balance_cents IS NOT NULL OR b.live_balance_cents IS NOT NULL)
              AND b.last_sync_at >= CAST(strftime('%s', 'now') AS INTEGER) - 172800
              AND EXISTS (
                SELECT 1 FROM integration_connections c
                WHERE c.organization_id = t.organization_id AND c.provider = 'plaid'
                  AND c.external_account_ref = b.external_item_ref
                  AND c.status = 'connected' AND c.data_promotion_status = 'approved'
                  AND (c.sync_lease_owner IS NULL OR c.sync_lease_expires_at IS NULL
                    OR c.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))))
              OR (? = 'demonstration' AND b.demo_record = 1))
          GROUP BY t.posting_date ORDER BY t.posting_date`)
          .bind(
            organizationId, baseCurrency, dataMode === "demonstration" ? 1 : 0,
            baseCurrency, dataMode === "demonstration" ? 1 : 0,
            firstWeekStart, asOf, dataMode, dataMode,
          )
          .all<{ postingDate: string; amountCents: number }>()
      : null;
    const actualTransactions = actualTransactionResult ? rows(actualTransactionResult).map((transaction) => ({ postingDate: transaction.postingDate, amountCents: Number(transaction.amountCents) })) : [];
    const thirteenWeekItems: ThirteenWeekCashFlowItem[] = [
      ...unlinkedForecastBills.map((bill) => ({ id: bill.id, label: `${bill.supplierName} bill ${bill.billNumber}`, dueDate: bill.dueDate, amountCents: bill.totalCents - bill.paidCents, direction: "out" as const, certainty: isConfirmedBill(bill) ? "confirmed" as const : "expected" as const })),
      ...forecastInvoices.map((invoice) => ({ id: invoice.id, label: `${invoice.customerName} invoice ${invoice.invoiceNumber}`, dueDate: invoice.dueDate, amountCents: invoice.totalCents - invoice.paidCents, direction: "in" as const, certainty: "expected" as const })),
      ...purchaseCommitmentItems,
    ];
    const thirteenWeekCashFlow = buildThirteenWeekCashFlow({
      asOf,
      openingCashCents: thirteenWeekAllowed ? cashOpeningBalanceCents : null,
      safetyThresholdCents: settings?.cashSafetyThresholdCents ?? 0,
      actualTransactions: thirteenWeekAllowed ? actualTransactions : [],
      forecastItems: thirteenWeekAllowed ? thirteenWeekItems.filter((item) => item.dueDate <= thirteenWeekEnd || item.dueDate < asOf) : [],
      excludedCurrencyItemCount: thirteenWeekAllowed ? excludedCurrencyItemCount : 0,
      undatedCommittedItemCount: thirteenWeekAllowed ? undatedCommittedItemCount : 0,
      confirmedPurchasingObligationsCents: thirteenWeekAllowed ? confirmedPurchasingObligationsCents : null,
      decisionBlocks,
    });
    const availableStatements = ledgerReadable ? statements : {
      accounts: [],
      trialBalance: { totalDebitCents: null, totalCreditCents: null },
      profitAndLoss: { revenueCents: null, expenseCents: null, cogsCents: null, grossProfitCents: null, operatingProfitCents: null },
      balanceSheet: { assetCents: null, liabilityCents: null, equityCents: null },
      cashCents: null,
      accountsReceivableCents: null,
      accountsPayableCents: null,
      netSalesTaxCents: null,
    };
    return jsonResponse({
      bookloq: {
        configured: Boolean(settings) || ledgerAvailable || visibleBanks.length > 0 || documentRows.length > 0 || invoices.length > 0,
        settings,
        role: context.role,
        permissions: uiPermissions,
        accountCatalog,
        transactionAccess: {
          available: transactionReadable,
          reason: transactionReadable ? null : "Complete bank transaction views require bank transaction and payroll total permissions because an uncategorized bank feed can contain payroll information.",
        },
        ledgerAccess: {
          available: ledgerReadable,
          reason: !fullLedgerPermission
            ? "Complete ledger views require payroll totals and bank balance permissions. Other permitted sections remain available."
            : !ledgerAvailable ? "Post verified journals before reviewing ledger totals." : null,
        },
        organization: {
          name: context.organization.businessName,
          legalName: context.organization.legalName,
          email: context.organization.businessEmail,
          phone: context.organization.phone,
          address: context.organization.address,
          city: context.organization.city,
          province: context.organization.province,
          postalCode: context.organization.postalCode,
          country: context.organization.country,
          taxNumber: context.organization.taxNumber,
          currency: settings?.baseCurrency ?? context.organization.currency,
        },
        summary: {
          currentCashCents: cashFactsAllowed ? cashOpeningBalanceCents : null,
          availableCashCents: decisionCashAllowed && cashOpeningBalanceCents !== null
            ? cashOpeningBalanceCents - dueNext30Cents
            : null,
          bankBalanceCents,
          bookBalanceCents: ledgerReadable ? statements.cashCents : null,
          cashSource,
          cashLastSyncAt,
          bankCashStatus: verifiedBankCash.status,
          revenueCents: ledgerReadable ? statements.profitAndLoss.revenueCents : null,
          grossProfitCents: ledgerReadable ? statements.profitAndLoss.grossProfitCents : null,
          grossMarginBasisPoints: ledgerReadable && statements.profitAndLoss.revenueCents ? Math.round(statements.profitAndLoss.grossProfitCents * 10_000 / statements.profitAndLoss.revenueCents) : null,
          operatingProfitCents: ledgerReadable ? statements.profitAndLoss.operatingProfitCents : null,
          totalExpensesCents: ledgerReadable ? statements.profitAndLoss.expenseCents : null,
          accountsReceivableCents: ledgerReadable && access.accountsPayableReceivable ? statements.accountsReceivableCents : null,
          accountsPayableCents: ledgerReadable && access.accountsPayableReceivable ? statements.accountsPayableCents : null,
          salesTaxPayableCents: ledgerReadable ? statements.netSalesTaxCents : null,
          payrollObligationsCents: ledgerReadable && access.payrollTotals
            ? statements.accounts.filter((account) => account.systemKey === "payroll_payable").reduce((sum, account) => sum + account.balanceCents, 0)
            : null,
          debtObligationsCents: ledgerReadable ? statements.accounts.filter((account) => account.systemKey === "loan_payable").reduce((sum, account) => sum + account.balanceCents, 0) : null,
          upcomingBillsCount: ledgerReadable && access.accountsPayableReceivable ? bills.filter((bill) => !["paid", "reconciled", "void"].includes(bill.status)).length : null,
          overdueInvoicesCount: ledgerReadable && access.accountsPayableReceivable ? invoices.filter((invoice) => invoice.dueDate < asOf && !["paid", "written_off", "void"].includes(invoice.status)).length : null,
          unreconciledCount: ledgerReadable && canReconcile ? unreconciledCount : null,
          uncategorizedCount: ledgerReadable && transactionReadable ? uncategorizedCount : null,
          missingReceiptsCount: ledgerReadable ? missingReceiptCount : null,
          monthEndCompletionRate: ledgerReadable ? monthEndCompletionRate : null,
          healthScore: ledgerReadable ? healthScore : null,
        },
        statements: availableStatements,
        locationScope: locationRefs !== null ? {
          id: locationAccess.selectedLocation?.id ?? "accessible",
          name: locationAccess.selectedLocation?.name ?? "Accessible locations",
          filteredRecords: ["transactions", "budgets"],
          organizationWideRecords: ["bank balances", "financial statements", "bills", "invoices", "tax", "reconciliations"],
          boundary: "Transactions and budgets are filtered to records tagged to the selected location. Shared bank balances, statements, bills, invoices, tax and reconciliations remain organization-wide until an approved allocation exists.",
        } : null,
        forecasts: cashFactsAllowed ? forecasts : [],
        thirteenWeekCashFlow,
        cashIntelligence: cashFactsAllowed ? cashIntelligence : {
          status: "unavailable",
          liquidity30Cents: null,
          liquidity60Cents: null,
          purchasingCapacityCents: null,
          risk: "unavailable",
          minimumCashCents: null,
          minimumCashDate: null,
          warning: "Bank balance and accounts payable or receivable permissions are required for cash intelligence.",
          evidence: [],
        },
        cashActivity,
        transactions: transactionReadable ? transactions : [],
        transactionMatches: transactionReadable ? transactionMatches : [],
        matchCandidates: transactionReadable && access.accountsPayableReceivable ? matchCandidates : [],
        categoryRules: transactionReadable ? categoryRules : [],
        banks: visibleBanks,
        reconciliations: canReconcile && access.bankBalances ? reconciliations : [],
        bills: visibleBills,
        invoices: visibleInvoices.map((invoice) => canViewDocuments ? invoice : { ...invoice, documentId: null }),
        contacts: visibleContacts,
        alerts: fullLedgerPermission ? rows(alertsResult) : [],
        journals: ledgerReadable ? journalRows : [],
        periods: rows(periodsResult),
        closeItems,
        budgets: fullLedgerPermission ? rows(budgetsResult) : [],
        audit: access.audit ? rows(auditResult).map((event) => fullLedgerPermission ? event : { ...event, detailsJson: "{}" }) : [],
        documentSummary: {
          total: canViewDocuments ? documentRows.length : 0,
          invoices: canViewDocuments ? documentRows.filter((document) => document.documentType === "invoice").length : 0,
          receipts: canViewDocuments ? documentRows.filter((document) => document.documentType === "receipt").length : 0,
          needsReview: canViewDocuments ? documentRows.filter((document) => document.status === "review_required" || document.status === "uploaded").length : 0,
          extractionConfigured: canViewDocuments && documentRows.some((document) => document.extractionStatus !== "not_configured"),
        },
        documents: canViewDocuments ? documentRows.map((document) => ({
          id: document.id,
          documentType: document.documentType,
          fileName: document.fileName,
          status: document.status,
          securityState: document.securityState,
          extractionStatus: document.extractionStatus,
          createdAt: document.createdAt,
        })) : [],
        integrations: {
          banking: dataMode === "demonstration" && visibleBanks.length
            ? "demonstration"
            : plaidConnection?.status === "connected"
              ? (plaidConnection.dataPromotionStatus === "approved" && bankBalanceCents !== null ? "connected_and_synced" : "connected_needs_sync")
              : "not_connected",
          pos: integrationRows.some((item) => item.status === "connected" && ["lightspeed", "lightspeed-r", "shopify", "shopify-pos", "square", "clover"].includes(item.provider)) ? "connected" : "not_connected",
          payroll: "manual_journals_only",
          receiptCapture: canViewDocuments ? (documentRows.length ? "review_queue_active" : "upload_available") : "permission_required",
          taxFiling: "not_available",
        },
        disclaimer: "BookLoQ organizes source records and assists with bookkeeping, reconciliation and tax preparation. Imported descriptions, categories, balances and document fields require review. It does not file returns, provide legal or tax advice, or replace a qualified accountant or tax professional.",
      },
    });
  });
}
