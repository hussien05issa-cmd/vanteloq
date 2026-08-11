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

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requireAddon(context, "bookloq");
    await requirePermission(context, "finance.statements");
    const permissions = await effectivePermissions(context);
    const access = bookloqAccessForPermissions(permissions);
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
        t.demo_record demoRecord, a.code accountCode, a.name accountName, c.name contactName
        FROM financial_transactions t
        LEFT JOIN financial_accounts a ON a.id = t.account_id AND a.organization_id = t.organization_id
        LEFT JOIN bookloq_contacts c ON c.id = t.contact_id AND c.organization_id = t.organization_id
        WHERE t.organization_id = ?
          AND (t.source_system <> 'plaid' OR EXISTS (
            SELECT 1 FROM integration_connections c
            WHERE c.organization_id = t.organization_id AND c.provider = 'plaid'
              AND c.status = 'connected' AND c.data_promotion_status = 'approved'
              AND (c.sync_lease_owner IS NULL OR c.sync_lease_expires_at IS NULL
                OR c.sync_lease_expires_at <= CAST(strftime('%s', 'now') AS INTEGER))
          ))${transactionLocationClause}
        ORDER BY t.posting_date DESC, t.created_at DESC LIMIT 200`).bind(organizationId, ...locationBindings).all(),
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
        i.paid_cents paidCents, i.currency, i.demo_record demoRecord, c.name customerName
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
      database.prepare(`SELECT b.id, b.period_start periodStart, b.period_end periodEnd,
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
      database.prepare(`SELECT document_type documentType, status, extraction_status extractionStatus,
        created_at createdAt FROM workspace_documents WHERE organization_id = ?
        ORDER BY created_at DESC LIMIT 200`).bind(organizationId).all(),
    ]);

    const settings = rows(settingsResult)[0] ?? null;
    const accountRows = rows(accountsResult);
    const statements = buildFinancialStatements(accountRows);
    const transactions = rows(transactionsResult);
    const banks = rows(banksResult) as BankRow[];
    const reconciliations = rows(reconciliationsResult);
    const bills = rows(billsResult) as Array<{ id: string; billNumber: string; supplierName: string; dueDate: string; totalCents: number; paidCents: number; status: string }>;
    const invoices = rows(invoicesResult) as Array<{ id: string; invoiceNumber: string; customerName: string; dueDate: string; totalCents: number; paidCents: number; status: string }>;
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
    const unbalancedJournalCount = Number(healthStats.unbalancedJournalCount);
    const uncategorizedCount = Number(healthStats.uncategorizedCount);
    const unreconciledCount = Number(healthStats.unreconciledCount);
    const openCriticalAlerts = Number(healthStats.openCriticalAlerts);
    const missingReceiptCount = healthStats.receiptEvidenceAvailable
      ? Number(healthStats.missingReceiptCount)
      : null;
    const healthScore = missingReceiptCount === null
      ? null
      : bookkeepingHealthScore({ unbalancedJournalCount, uncategorizedCount, unreconciledCount, openCriticalAlerts, missingReceiptCount, monthEndCompletionRate });
    const asOf = new Date().toISOString().slice(0, 10);
    const integrationRows = rows(integrationsResult) as Array<{ provider: string; status: string; dataPromotionStatus: string; lastSuccessfulSyncAt: number | null }>;
    const documentRows = rows(documentsResult) as Array<{ documentType: string; status: string; extractionStatus: string; createdAt: number }>;
    const journalRows = rows(journalsResult);
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
    const visibleBills = access.accountsPayableReceivable ? rows(billsResult) : [];
    const visibleInvoices = access.accountsPayableReceivable ? rows(invoicesResult) : [];
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
    const cashOpeningBalanceCents = verifiedBankCashCents ?? (ledgerAvailable ? statements.cashCents : null);
    const cashSource = verifiedBankCashCents !== null
      ? "plaid_available_balance" as const
      : ledgerAvailable
        ? "posted_ledger" as const
        : "unavailable" as const;
    const cashLastSyncMs = plaidBanks
      .map((bank) => bank.lastSyncAt)
      .filter((value): value is number => value !== null)
      .sort((left, right) => right - left)[0] ?? null;
    const cashLastSyncAt = cashLastSyncMs === null ? null : Math.floor(cashLastSyncMs / 1_000);
    const cashFlowItems: CashFlowRecord[] = [
      ...bills.filter((bill) => !["paid", "reconciled", "void"].includes(bill.status)).map((bill) => ({ dueDate: bill.dueDate, amountCents: bill.totalCents - bill.paidCents, direction: "out" as const, certainty: "confirmed" as const })),
      ...invoices.filter((invoice) => !["paid", "written_off", "void"].includes(invoice.status)).map((invoice) => ({ dueDate: invoice.dueDate, amountCents: invoice.totalCents - invoice.paidCents, direction: "in" as const, certainty: "probable" as const })),
    ];
    const forecasts = forecastCash(cashOpeningBalanceCents ?? 0, cashFlowItems, asOf);
    const intelligenceItems: CashFlowItem[] = [
      ...bills.filter((bill) => !["paid", "reconciled", "void"].includes(bill.status)).map((bill) => ({ id: bill.id, label: `${bill.supplierName} bill ${bill.billNumber}`, dueDate: bill.dueDate, amountCents: bill.totalCents - bill.paidCents, direction: "out" as const, certainty: "confirmed" as const, category: "supplier" as const })),
      ...invoices.filter((invoice) => !["paid", "written_off", "void"].includes(invoice.status)).map((invoice) => ({ id: invoice.id, label: `${invoice.customerName} invoice ${invoice.invoiceNumber}`, dueDate: invoice.dueDate, amountCents: invoice.totalCents - invoice.paidCents, direction: "in" as const, certainty: "probable" as const, category: "other" as const })),
    ];
    const cashIntelligence = calculateCashFlowIntelligence({ openingCashCents: cashOpeningBalanceCents, safetyThresholdCents: settings?.cashSafetyThresholdCents ?? 0, items: intelligenceItems, asOf });
    const dueNext30Cents = cashFlowItems.filter((item) => item.direction === "out" && item.dueDate <= forecasts[1].endDate).reduce((sum, item) => sum + item.amountCents, 0);
    const cashProjectionAllowed = ledgerAvailable && access.bankBalances && access.accountsPayableReceivable && cashOpeningBalanceCents !== null;
    const availableStatements = ledgerAvailable ? statements : {
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
        configured: ledgerAvailable,
        settings,
        role: context.role,
        permissions: uiPermissions,
        organization: { name: context.organization.businessName, currency: settings?.baseCurrency ?? context.organization.currency },
        summary: {
          currentCashCents: cashOpeningBalanceCents,
          availableCashCents: cashProjectionAllowed && cashOpeningBalanceCents !== null
            ? cashOpeningBalanceCents - dueNext30Cents
            : null,
          bankBalanceCents,
          bookBalanceCents: ledgerAvailable ? statements.cashCents : null,
          cashSource,
          cashLastSyncAt,
          bankCashStatus: verifiedBankCash.status,
          revenueCents: ledgerAvailable ? statements.profitAndLoss.revenueCents : null,
          grossProfitCents: ledgerAvailable ? statements.profitAndLoss.grossProfitCents : null,
          grossMarginBasisPoints: ledgerAvailable && statements.profitAndLoss.revenueCents ? Math.round(statements.profitAndLoss.grossProfitCents * 10_000 / statements.profitAndLoss.revenueCents) : null,
          operatingProfitCents: ledgerAvailable ? statements.profitAndLoss.operatingProfitCents : null,
          totalExpensesCents: ledgerAvailable ? statements.profitAndLoss.expenseCents : null,
          accountsReceivableCents: ledgerAvailable && access.accountsPayableReceivable ? statements.accountsReceivableCents : null,
          accountsPayableCents: ledgerAvailable && access.accountsPayableReceivable ? statements.accountsPayableCents : null,
          salesTaxPayableCents: ledgerAvailable ? statements.netSalesTaxCents : null,
          payrollObligationsCents: ledgerAvailable && access.payrollTotals
            ? statements.accounts.filter((account) => account.systemKey === "payroll_payable").reduce((sum, account) => sum + account.balanceCents, 0)
            : null,
          debtObligationsCents: ledgerAvailable ? statements.accounts.filter((account) => account.systemKey === "loan_payable").reduce((sum, account) => sum + account.balanceCents, 0) : null,
          upcomingBillsCount: ledgerAvailable && access.accountsPayableReceivable ? bills.filter((bill) => !["paid", "reconciled", "void"].includes(bill.status)).length : null,
          overdueInvoicesCount: ledgerAvailable && access.accountsPayableReceivable ? invoices.filter((invoice) => invoice.dueDate < asOf && !["paid", "written_off", "void"].includes(invoice.status)).length : null,
          unreconciledCount: ledgerAvailable && canReconcile ? unreconciledCount : null,
          uncategorizedCount: ledgerAvailable && access.bankTransactions ? uncategorizedCount : null,
          missingReceiptsCount: ledgerAvailable ? missingReceiptCount : null,
          monthEndCompletionRate: ledgerAvailable ? monthEndCompletionRate : null,
          healthScore: ledgerAvailable ? healthScore : null,
        },
        statements: availableStatements,
        locationScope: locationRefs !== null ? {
          id: locationAccess.selectedLocation?.id ?? "accessible",
          name: locationAccess.selectedLocation?.name ?? "Accessible locations",
          filteredRecords: ["transactions", "budgets"],
          organizationWideRecords: ["bank balances", "financial statements", "bills", "invoices", "tax", "reconciliations"],
          boundary: "Transactions and budgets are filtered to records tagged to the selected location. Shared bank balances, statements, bills, invoices, tax and reconciliations remain organization-wide until an approved allocation exists.",
        } : null,
        forecasts: cashProjectionAllowed ? forecasts : [],
        cashIntelligence: cashProjectionAllowed ? cashIntelligence : {
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
        transactions: access.bankTransactions ? transactions : [],
        banks: visibleBanks,
        reconciliations: canReconcile ? reconciliations : [],
        bills: visibleBills,
        invoices: visibleInvoices,
        contacts: visibleContacts,
        alerts: rows(alertsResult),
        journals: ledgerAvailable ? journalRows : [],
        periods: rows(periodsResult),
        closeItems,
        budgets: rows(budgetsResult),
        audit: access.audit ? rows(auditResult) : [],
        documentSummary: {
          total: documentRows.length,
          invoices: documentRows.filter((document) => document.documentType === "invoice").length,
          receipts: documentRows.filter((document) => document.documentType === "receipt").length,
          needsReview: documentRows.filter((document) => document.status === "review_required" || document.status === "uploaded").length,
          extractionConfigured: documentRows.some((document) => document.extractionStatus !== "not_configured"),
        },
        integrations: {
          banking: dataMode === "demonstration" && visibleBanks.length
            ? "demonstration"
            : plaidConnection?.status === "connected"
              ? (plaidConnection.dataPromotionStatus === "approved" && bankBalanceCents !== null ? "connected_and_synced" : "connected_needs_sync")
              : "not_connected",
          pos: integrationRows.some((item) => item.status === "connected" && ["lightspeed", "lightspeed-r", "shopify", "shopify-pos", "square", "clover"].includes(item.provider)) ? "connected" : "not_connected",
          payroll: "not_connected",
          receiptCapture: documentRows.length ? "review_queue_active" : "upload_available",
          taxFiling: "not_available",
        },
        disclaimer: "BookLoQ organizes source records and assists with bookkeeping, reconciliation and tax preparation. Imported descriptions, categories, balances and document fields require review. It does not file returns, provide legal or tax advice, or replace a qualified accountant or tax professional.",
      },
    });
  });
}
