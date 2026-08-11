import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { integrationLocationMappings } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { clientSource, enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import {
  buildFinancialStatements,
  bookkeepingHealthScore,
  effectiveBookLoQPermissions,
  forecastCash,
  type LedgerAccountRow,
} from "../../../../server/bookloq";
import { requirePermission } from "../../../../server/permissions";
import { calculateCashFlowIntelligence, type CashFlowItem } from "../../../../domain/cash-flow-intelligence";
import { requireAccessibleLocation } from "../../../../server/location-access";

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

function rows<T>(result: D1Result<T>): T[] {
  return result.results ?? [];
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "finance.statements");
    await enforceRateLimit("bookloq:read", `${context.userId}:${clientSource(request)}`, 90, 60);
    const database = getD1();
    const organizationId = context.organizationId;
    const requestedLocationId = new URL(request.url).searchParams.get("location");
    const selectedLocation = requestedLocationId ? await requireAccessibleLocation(context, requestedLocationId) : null;
    const selectedMappings = selectedLocation ? await getDb().select({
      provider: integrationLocationMappings.provider,
      externalLocationRef: integrationLocationMappings.externalLocationRef,
    }).from(integrationLocationMappings).where(and(
      eq(integrationLocationMappings.organizationId, organizationId),
      eq(integrationLocationMappings.localLocationId, selectedLocation.id),
      eq(integrationLocationMappings.status, "mapped"),
    )) : [];
    const locationRefs = new Set<string>(selectedLocation ? [selectedLocation.id, selectedLocation.name] : []);
    for (const mapping of selectedMappings) locationRefs.add(`${mapping.provider}:${mapping.externalLocationRef}`);
    const locationPlaceholders = [...locationRefs].map(() => "?").join(", ");
    const transactionLocationClause = selectedLocation ? ` AND t.location_ref IN (${locationPlaceholders})` : "";
    const budgetLocationClause = selectedLocation ? ` AND b.location_ref IN (${locationPlaceholders})` : "";
    const locationBindings = selectedLocation ? [...locationRefs] : [];

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
        WHERE t.organization_id = ?${transactionLocationClause} ORDER BY t.posting_date DESC, t.created_at DESC LIMIT 200`).bind(organizationId, ...locationBindings).all(),
      database.prepare(`SELECT b.id, b.name, b.account_type accountType, b.institution_name institutionName,
        b.masked_number maskedNumber, b.live_balance_cents liveBalanceCents,
        b.available_balance_cents availableBalanceCents, b.book_balance_cents bookBalanceCents,
        b.available_credit_cents availableCreditCents, b.connection_status connectionStatus,
        b.last_sync_at lastSyncAt, b.last_reconciled_at lastReconciledAt, b.demo_record demoRecord,
        a.code accountCode, a.name accountName
        FROM bank_accounts b JOIN financial_accounts a ON a.id = b.financial_account_id AND a.organization_id = b.organization_id
        WHERE b.organization_id = ? ORDER BY b.name`).bind(organizationId).all(),
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
    const banks = rows(banksResult);
    const reconciliations = rows(reconciliationsResult);
    const bills = rows(billsResult) as Array<{ id: string; billNumber: string; supplierName: string; dueDate: string; totalCents: number; paidCents: number; status: string }>;
    const invoices = rows(invoicesResult) as Array<{ id: string; invoiceNumber: string; customerName: string; dueDate: string; totalCents: number; paidCents: number; status: string }>;
    const alerts = rows(alertsResult) as Array<{ severity: string; status: string }>;
    const closeItems = rows(closeResult) as Array<{ status: string }>;
    const completeItems = closeItems.filter((item) => item.status === "complete").length;
    const monthEndCompletionRate = closeItems.length ? completeItems / closeItems.length : 0;
    const uncategorizedCount = (transactions as Array<{ categorizationStatus: string }>).filter((transaction) => transaction.categorizationStatus !== "confirmed").length;
    const unreconciledCount = (transactions as Array<{ reconciliationStatus: string }>).filter((transaction) => transaction.reconciliationStatus !== "reconciled").length;
    const unbalancedJournalCount = (rows(journalsResult) as Array<{ totalDebitCents: number; totalCreditCents: number }>).filter((entry) => entry.totalDebitCents !== entry.totalCreditCents).length;
    const openCriticalAlerts = alerts.filter((alert) => alert.status === "open" && alert.severity === "critical").length;
    const healthScore = bookkeepingHealthScore({ unbalancedJournalCount, uncategorizedCount, unreconciledCount, openCriticalAlerts, missingReceiptCount: 0, monthEndCompletionRate });
    const asOf = new Date().toISOString().slice(0, 10);
    const cashFlowItems: CashFlowRecord[] = [
      ...bills.filter((bill) => !["paid", "reconciled", "void"].includes(bill.status)).map((bill) => ({ dueDate: bill.dueDate, amountCents: bill.totalCents - bill.paidCents, direction: "out" as const, certainty: "confirmed" as const })),
      ...invoices.filter((invoice) => !["paid", "written_off", "void"].includes(invoice.status)).map((invoice) => ({ dueDate: invoice.dueDate, amountCents: invoice.totalCents - invoice.paidCents, direction: "in" as const, certainty: "probable" as const })),
    ];
    const forecasts = forecastCash(statements.cashCents, cashFlowItems, asOf);
    const intelligenceItems: CashFlowItem[] = [
      ...bills.filter((bill) => !["paid", "reconciled", "void"].includes(bill.status)).map((bill) => ({ id: bill.id, label: `${bill.supplierName} bill ${bill.billNumber}`, dueDate: bill.dueDate, amountCents: bill.totalCents - bill.paidCents, direction: "out" as const, certainty: "confirmed" as const, category: "supplier" as const })),
      ...invoices.filter((invoice) => !["paid", "written_off", "void"].includes(invoice.status)).map((invoice) => ({ id: invoice.id, label: `${invoice.customerName} invoice ${invoice.invoiceNumber}`, dueDate: invoice.dueDate, amountCents: invoice.totalCents - invoice.paidCents, direction: "in" as const, certainty: "probable" as const, category: "other" as const })),
    ];
    const cashIntelligence = calculateCashFlowIntelligence({ openingCashCents: settings ? statements.cashCents : null, safetyThresholdCents: settings?.cashSafetyThresholdCents ?? 0, items: intelligenceItems, asOf });
    const dueNext30Cents = cashFlowItems.filter((item) => item.direction === "out" && item.dueDate <= forecasts[1].endDate).reduce((sum, item) => sum + item.amountCents, 0);
    const integrationRows = rows(integrationsResult) as Array<{ provider: string; status: string; dataPromotionStatus: string; lastSuccessfulSyncAt: number | null }>;
    const documentRows = rows(documentsResult) as Array<{ documentType: string; status: string; extractionStatus: string; createdAt: number }>;
    const plaidConnection = integrationRows.find((item) => item.provider === "plaid");

    return jsonResponse({
      bookloq: {
        configured: Boolean(settings || banks.length || documentRows.length),
        settings,
        role: context.role,
        permissions: effectiveBookLoQPermissions(context.role),
        organization: { name: context.organization.businessName, currency: settings?.baseCurrency ?? context.organization.currency },
        summary: {
          currentCashCents: statements.cashCents,
          availableCashCents: statements.cashCents - dueNext30Cents,
          bankBalanceCents: banks.some((bank) => (bank as { liveBalanceCents?: number | null }).liveBalanceCents !== null)
            ? banks.reduce((sum, bank) => sum + Number((bank as { liveBalanceCents?: number | null }).liveBalanceCents ?? 0), 0)
            : null,
          bookBalanceCents: statements.cashCents,
          revenueCents: statements.profitAndLoss.revenueCents,
          grossProfitCents: statements.profitAndLoss.grossProfitCents,
          grossMarginBasisPoints: statements.profitAndLoss.revenueCents ? Math.round(statements.profitAndLoss.grossProfitCents * 10_000 / statements.profitAndLoss.revenueCents) : null,
          operatingProfitCents: statements.profitAndLoss.operatingProfitCents,
          totalExpensesCents: statements.profitAndLoss.expenseCents,
          accountsReceivableCents: statements.accountsReceivableCents,
          accountsPayableCents: statements.accountsPayableCents,
          salesTaxPayableCents: statements.netSalesTaxCents,
          payrollObligationsCents: statements.accounts.filter((account) => account.systemKey === "payroll_payable").reduce((sum, account) => sum + account.balanceCents, 0),
          debtObligationsCents: statements.accounts.filter((account) => account.systemKey === "loan_payable").reduce((sum, account) => sum + account.balanceCents, 0),
          upcomingBillsCount: bills.filter((bill) => !["paid", "reconciled", "void"].includes(bill.status)).length,
          overdueInvoicesCount: invoices.filter((invoice) => invoice.dueDate < asOf && !["paid", "written_off", "void"].includes(invoice.status)).length,
          unreconciledCount,
          uncategorizedCount,
          missingReceiptsCount: 0,
          monthEndCompletionRate,
          healthScore,
        },
        statements,
        locationScope: selectedLocation ? {
          id: selectedLocation.id,
          name: selectedLocation.name,
          filteredRecords: ["transactions", "budgets"],
          organizationWideRecords: ["bank balances", "financial statements", "bills", "invoices", "tax", "reconciliations"],
          boundary: "Transactions and budgets are filtered to records tagged to the selected location. Shared bank balances, statements, bills, invoices, tax and reconciliations remain organization-wide until an approved allocation exists.",
        } : null,
        forecasts,
        cashIntelligence,
        transactions,
        banks,
        reconciliations,
        bills: rows(billsResult),
        invoices: rows(invoicesResult),
        contacts: rows(contactsResult),
        alerts: rows(alertsResult),
        journals: rows(journalsResult),
        periods: rows(periodsResult),
        closeItems,
        budgets: rows(budgetsResult),
        audit: rows(auditResult),
        documentSummary: {
          total: documentRows.length,
          invoices: documentRows.filter((document) => document.documentType === "invoice").length,
          receipts: documentRows.filter((document) => document.documentType === "receipt").length,
          needsReview: documentRows.filter((document) => document.status === "review_required" || document.status === "uploaded").length,
          extractionConfigured: documentRows.some((document) => document.extractionStatus !== "not_configured"),
        },
        integrations: {
          banking: plaidConnection?.status === "connected" ? (plaidConnection.dataPromotionStatus === "approved" ? "connected_and_synced" : "connected_needs_sync") : "not_connected",
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
