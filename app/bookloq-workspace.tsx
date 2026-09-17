"use client";
import WorkspaceSkeleton from "./workspace-skeleton";
import FinanceChart from "./finance-chart";
import CashForecastChart from "./cash-forecast-chart";
import type { buildBusinessCashSummary } from "../domain/bookloq-cash-management";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModalFocus } from "./use-modal-focus";
import { csvCell } from "../domain/csv";
import ProductBrandLogo from "./product-brand-logo";
import FinancialReviewCard from "./financial-review-card";
import BookloqFinancialExplainer from "./bookloq-financial-explainer";
import WorkspaceIcon from "./workspace-icon";
import PlaidLinkButton from "./plaid-link-button";
import { apiFetch } from "./supabase-browser";
import { bookloqRequest, bookloqAccessDenied, BookloqRequestError } from "./bookloq-request";
import { createDocumentEmailRequests } from "./document-email-client";
import { bookloqHealthPresentation, bookloqMetricCount, formatBookloqMoney, bookloqPositionMessage } from "../domain/bookloq-presentation";
import type { ThirteenWeekCashFlow } from "../domain/thirteen-week-cash-flow";
import { FieldLabel } from "./form-primitives";
import { budgetControl, bookloqReportHeadings } from "../domain/bookloq-budget";
import BookloqStatementImport from "./bookloq-statement-import";
import BookloqDashboardVisuals from "./bookloq-dashboard-visuals";
import { startBookloqAutoRefresh, type BookloqRefreshState } from "./bookloq-auto-refresh";

type Permission = "view_revenue" | "view_profit" | "view_banking" | "view_payroll" | "create_transactions" | "edit_drafts" | "post_journals" | "approve_bills" | "initiate_payments" | "reconcile_accounts" | "change_tax_settings" | "lock_periods" | "unlock_periods" | "export_data" | "manage_integrations" | "view_audit_logs";
type Section = typeof sectionDefinitions[number]["name"];
type TaskSeed = { title: string; detail: string; priority: "high" | "medium" | "low"; expectedImpact?: string; sourceType?: "alert"; sourceRef?: string };

const sectionDefinitions = [
  { name: "Overview", group: "Command", permission: "view_profit" },
  { name: "Transactions", group: "Command", permission: "view_profit" },
  { name: "Banking", group: "Cash", permission: "view_banking" },
  { name: "Reconciliation", group: "Cash", permission: "reconcile_accounts" },
  { name: "Sales", group: "Money in", permission: "view_revenue" },
  { name: "Expenses", group: "Money out", permission: "view_profit" },
  { name: "Bills", group: "Money out", permission: "view_profit" },
  { name: "Invoicing", group: "Money in", permission: "view_revenue" },
  { name: "Customers", group: "Records", permission: "view_revenue" },
  { name: "Suppliers", group: "Records", permission: "view_profit" },
  { name: "Chart of Accounts", group: "Accounting", permission: "view_profit" },
  { name: "Journal Entries", group: "Accounting", permission: "post_journals" },
  { name: "Payroll", group: "Accounting", permission: "view_payroll" },
  { name: "Sales Tax", group: "Accounting", permission: "view_profit" },
  { name: "Inventory Accounting", group: "Accounting", permission: "view_profit" },
  { name: "Assets and Loans", group: "Planning", permission: "view_profit" },
  { name: "Budgets", group: "Planning", permission: "view_profit" },
  { name: "Cash Flow", group: "Planning", permission: "view_banking" },
  { name: "Reports", group: "Close and review", permission: "view_profit" },
  { name: "Month-End", group: "Close and review", permission: "reconcile_accounts" },
  { name: "Accountant Portal", group: "Close and review", permission: "view_audit_logs" },
  { name: "Audit Trail", group: "Close and review", permission: "view_audit_logs" },
  { name: "BookLoQ Assistant", group: "Tools", permission: "view_profit" },
  { name: "Settings", group: "Tools", permission: "manage_integrations" },
] as const satisfies readonly { name: string; group: string; permission: Permission }[];

type Account = { id: string; code: string; name: string; accountType: "asset" | "liability" | "equity" | "revenue" | "expense"; accountSubtype: string; normalBalance: "debit" | "credit"; systemKey: string | null; description: string; plainLanguage: string; debitCents: number; creditCents: number; balanceCents: number };
type Transaction = { id: string; transactionDate: string; postingDate: string; description: string; originalDescription: string; amountCents: number; currency: string; taxAmountCents: number; sourceSystem: string; externalSourceId: string; locationRef: string; reconciliationStatus: string; categorizationStatus: string; confidenceBasisPoints: number; approvalStatus: string; demoRecord: number; accountCode: string | null; accountName: string | null; categoryAccountType: string | null; categoryAccountSubtype: string | null; categorySystemKey: string | null; contactName: string | null };
type Bank = { id: string; name: string; accountType: string; institutionName: string; maskedNumber: string; currency: string; provider: string; liveBalanceCents: number | null; availableBalanceCents: number | null; bookBalanceCents: number; availableCreditCents: number | null; connectionStatus: string; balanceState: "current" | "stale" | "unavailable" | "demonstration"; lastSyncAt: number | null; lastReconciledAt: number | null; demoRecord: number; accountCode: string; accountName: string };
type Reconciliation = { id: string; reconciliationType: string; startDate: string; endDate: string; openingBalanceCents: number; closingBalanceCents: number; bookBalanceCents: number; differenceCents: number; status: string; accountCode: string; accountName: string };
type Bill = { id: string; billNumber: string; invoiceDate: string; dueDate: string; status: string; subtotalCents: number; taxCents: number; totalCents: number; paidCents: number; currency: string; purchaseOrderRef: string | null; approvalStatus: string; demoRecord: number; supplierName: string };
type Invoice = { id: string; invoiceNumber: string; invoiceDate: string; dueDate: string; status: string; subtotalCents: number; taxCents: number; totalCents: number; paidCents: number; currency: string; demoRecord: number; customerName: string; customerEmail: string; documentId: string | null; sentAt: number | null; emailedTo: string | null };
type Contact = { id: string; contactType: "customer" | "supplier" | "both"; name: string; email: string; phone: string; billingAddress: string; paymentTermsDays: number; creditLimitCents: number; notes: string; active: number };
type Alert = { id: string; severity: "critical" | "attention" | "opportunity" | "informational"; alertType: string; title: string; explanation: string; dollarImpactCents: number | null; confidence: "high" | "medium" | "low"; supportingRecordsJson: string; recommendedAction: string; dueDate: string | null; status: string; resolutionHistoryJson: string; demoRecord: number; createdAt: number };
type Journal = { id: string; entryNumber: string; entryDate: string; postingDate: string; status: string; sourceType: string; sourceRef: string | null; memo: string; currency: string; totalDebitCents: number; totalCreditCents: number; reversalOfEntryId: string | null; postedAt: number | null; lineCount: number };
type Period = { id: string; label: string; startDate: string; endDate: string; status: string; lockedAt: number | null };
type CloseItem = { id: string; periodId: string; itemKey: string; title: string; status: "not_started" | "in_progress" | "blocked" | "complete"; dueDate: string | null; blocker: string; completedAt: number | null };
type Budget = { id: string; accountId: string; periodStart: string; periodEnd: string; locationRef: string; departmentRef: string; budgetCents: number; committedCents: number; forecastCents: number; actualCents?: number | null; accountCode: string; accountName: string; accountType: string };
type Audit = { action: string; resourceType: string; resourceId: string | null; outcome: string; detailsJson: string; createdAt: number };
type Summary = { currentCashCents: number | null; availableCashCents: number | null; bankBalanceCents: number | null; bookBalanceCents: number | null; cashSource: "plaid_available_balance" | "demonstration" | "unavailable"; cashLastSyncAt: number | null; bankCashStatus: "available" | "needs_bank_connection" | "stale_bank_data" | "needs_healthy_cash_account"; revenueCents: number | null; grossProfitCents: number | null; grossMarginBasisPoints: number | null; operatingProfitCents: number | null; totalExpensesCents: number | null; accountsReceivableCents: number | null; accountsPayableCents: number | null; salesTaxPayableCents: number | null; payrollObligationsCents: number | null; debtObligationsCents: number | null; upcomingBillsCount: number | null; overdueInvoicesCount: number | null; unreconciledCount: number | null; uncategorizedCount: number | null; missingReceiptsCount: number | null; monthEndCompletionRate: number | null; healthScore: number | null };
type CashPeriod = ReturnType<typeof buildBusinessCashSummary>;
type TransactionMatch = { id: string; transactionId: string; status: string; method: string; confidenceBasisPoints: number; matchedAmountCents: number; reasonsJson: string; note: string; supplierBillId: string | null; customerInvoiceId: string | null; documentId: string | null; targetLabel: string };
type MatchCandidate = { transactionId: string; candidateId: string; kind: "supplier_bill" | "customer_invoice" | "receipt"; label: string; confidenceBasisPoints: number; reasons: string[]; requiresConfirmation: true };
type BookDocument = { id: string; documentType: string; fileName: string; status: string; securityState: string; extractionStatus: string; createdAt: number };
export type BookLoQData = { configured: boolean; accountCatalog?: Pick<Account, "id" | "code" | "name" | "accountType" | "accountSubtype" | "normalBalance" | "systemKey">[]; transactionAccess?: { available: boolean; reason: string | null }; ledgerAccess?: { available: boolean; reason: string | null }; settings: null | { baseCurrency: string; countryCode: string; provinceCode: string; accountingBasis: string; cashSafetyThresholdCents: number; status: string; dataMode: "live" | "demonstration" }; role: string; permissions: Permission[]; organization: { name: string; currency: string }; summary: Summary; statements: { accounts: Account[]; trialBalance: { totalDebitCents: number; totalCreditCents: number }; profitAndLoss: { revenueCents: number; expenseCents: number; cogsCents: number; grossProfitCents: number; operatingProfitCents: number }; balanceSheet: { assetCents: number; liabilityCents: number; equityCents: number }; cashCents: number; accountsReceivableCents: number; accountsPayableCents: number; netSalesTaxCents: number }; locationScope: null | { id: string; name: string; filteredRecords: string[]; organizationWideRecords: string[]; boundary: string }; forecasts: { days: number; endDate: string; confirmedNetCents: number; probableNetCents: number; estimatedNetCents: number; closingCashCents: number }[]; thirteenWeekCashFlow: ThirteenWeekCashFlow; cashIntelligence: { status: "available" | "unavailable"; liquidity30Cents: number | null; liquidity60Cents: number | null; purchasingCapacityCents: number | null; risk: "low" | "moderate" | "high" | "unavailable"; minimumCashCents: number | null; minimumCashDate: string | null; warning: string | null; evidence: string[] }; cashActivity: { sourceBoundary?: string; days30: CashPeriod; days90: CashPeriod; months12: CashPeriod }; transactions: Transaction[]; transactionMatches: TransactionMatch[]; matchCandidates: MatchCandidate[]; categoryRules: { id: string; name: string; matchText: string; direction: string; accountId: string; accountCode: string; accountName: string }[]; documents: BookDocument[]; banks: Bank[]; reconciliations: Reconciliation[]; bills: Bill[]; invoices: Invoice[]; contacts: Contact[]; alerts: Alert[]; journals: Journal[]; periods: Period[]; closeItems: CloseItem[]; budgets: Budget[]; audit: Audit[]; documentSummary: { total: number; invoices: number; receipts: number; needsReview: number; extractionConfigured: boolean }; integrations: Record<string, string>; disclaimer: string };
type PlaidAccess = {
  status: string;
  maskedAccountRef: string | null;
  externalAccountName: string | null;
  privacyDataDeletedAt: string | null;
  dataPromotionStatus: string;
  connections: Array<{ id: string; lastSuccessfulSyncAt: string | null }>;
  canManage?: boolean;
  customerAvailability?: { comingSoon: boolean; canStartConnection: boolean; previewAccess: boolean };
  providerReadiness: null | {
    credentialsConfigured: boolean;
    missingConfiguration: string[];
    mode: string;
    liveDataEligible?: boolean;
  };
};

const money = formatBookloqMoney;
const rate = (basisPoints: number | null | undefined) => basisPoints == null ? "Not available" : `${(basisPoints / 100).toFixed(1)}%`;
const shortDate = (value: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\bPos\b/g, "POS");
const parseJsonList = (value: string) => { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } };

async function downloadPrivateInvoice(documentId: string, invoiceNumber: string) {
  const response = await apiFetch(`/api/v1/documents?id=${encodeURIComponent(documentId)}`, {
    headers: { Accept: "application/pdf" },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "The invoice PDF could not be downloaded.");
  }
  const pdf = await response.blob();
  if (pdf.type !== "application/pdf") throw new Error("The invoice download did not return a PDF.");
  const objectUrl = URL.createObjectURL(pdf);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function BookLoQWorkspace({ initialSection = "Overview", createTask, showNotice, navigate, activeLocationId }: { initialSection?: Section; createTask: (seed: TaskSeed) => void; showNotice: (message: string) => void; navigate: (view: "Integrations" | "Documents" | "Advisor") => void; activeLocationId: string | null }) {
  const [snapshot, setSnapshot] = useState<{ location: string | null; data: BookLoQData } | null>(null);
  const data = snapshot?.location === activeLocationId ? snapshot.data : null;
  const dataRequests = useRef(createDocumentEmailRequests());
  const refreshState = useRef<BookloqRefreshState>({ inFlight: false, hasError: false, lastSuccessfulReadAt: null });
  const plaidRequests = useRef(createDocumentEmailRequests());
  const [section, setSection] = useState<Section>(initialSection);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [navSearch, setNavSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const displayButton = useRef<HTMLButtonElement>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [plaidAccess, setPlaidAccess] = useState<PlaidAccess | null>(null);
  const [plaidLoading, setPlaidLoading] = useState(true);
  const [plaidError, setPlaidError] = useState("");
  const [canManageBankConnections, setCanManageBankConnections] = useState(false);

  const refresh = useCallback(async () => {
    const request = dataRequests.current.begin();
    refreshState.current.inFlight = true;
    setLoading(true);
    try {
      const body = await bookloqRequest(apiFetch, `/api/v1/bookloq${activeLocationId ? `?location=${encodeURIComponent(activeLocationId)}` : ""}`, { headers: { Accept: "application/json" }, signal: request.signal });
      if (!body?.bookloq) throw new Error("BookLoQ returned an incomplete response. Try again.");
      if (request.current()) { refreshState.current.hasError = false; refreshState.current.lastSuccessfulReadAt = Date.now(); setSnapshot({ location: activeLocationId, data: body.bookloq }); setError(""); }
    } catch (caught) { if (request.current()) { refreshState.current.hasError = true; if (bookloqAccessDenied(caught)) { setSnapshot(null); setPlaidAccess(null); setCanManageBankConnections(false); } setError(caught instanceof Error ? caught.message : "BookLoQ could not be loaded."); } }
    finally { if (request.current()) { refreshState.current.inFlight = false; setLoading(false); } }
  }, [activeLocationId]);
  useEffect(() => {
    const requests = dataRequests.current;
    refreshState.current = { inFlight: false, hasError: false, lastSuccessfulReadAt: null };
    const timer = window.setTimeout(() => void refresh(), 0);
    const stopAutoRefresh = startBookloqAutoRefresh({
      refresh,
      getState: () => refreshState.current,
      runtime: {
        now: Date.now,
        isVisible: () => document.visibilityState === "visible",
        every: (callback, milliseconds) => { const interval = window.setInterval(callback, milliseconds); return () => window.clearInterval(interval); },
        onVisibilityChange: callback => { document.addEventListener("visibilitychange", callback); return () => document.removeEventListener("visibilitychange", callback); },
      },
    });
    return () => { stopAutoRefresh(); window.clearTimeout(timer); requests.cancel(); };
  }, [refresh]);

  const refreshPlaidAccess = useCallback(async () => {
    const request = plaidRequests.current.begin();
    setPlaidLoading(true);
    try {
      const body = await bookloqRequest(apiFetch, "/api/v1/integrations", { headers: { Accept: "application/json" }, signal: request.signal });
      if (!request.current()) return;
      const plaid = (body.integrations ?? []).find((item: { id?: string }) => item.id === "plaid") as PlaidAccess | undefined;
      setPlaidAccess(plaid ?? null);
      setCanManageBankConnections(body.canManageBankConnections === true);
      setPlaidError("");
    } catch (caught) {
      if (request.current()) { if (bookloqAccessDenied(caught)) { setPlaidAccess(null); setCanManageBankConnections(false); } setPlaidError(caught instanceof Error ? caught.message : "Bank connection status could not be loaded."); }
    } finally {
      if (request.current()) setPlaidLoading(false);
    }
  }, []);
  useEffect(() => { const requests = plaidRequests.current; const timer = window.setTimeout(() => void refreshPlaidAccess(), 0); return () => { window.clearTimeout(timer); requests.cancel(); }; }, [refreshPlaidAccess]);

  const refreshFinancialSources = useCallback(async () => {
    await Promise.all([refresh(), refreshPlaidAccess()]);
  }, [refresh, refreshPlaidAccess]);

  const authorizedSections = useMemo(() => sectionDefinitions.filter((item) => data?.permissions.includes(item.permission)), [data]);
  const visible = useMemo(() => authorizedSections.filter((item) => item.name.toLowerCase().includes(navSearch.toLowerCase())), [authorizedSections, navSearch]);
  const activeSection = authorizedSections.some((item) => item.name === section) ? section : (authorizedSections[0]?.name ?? "Overview");

  useEffect(() => {
    if (!fullScreen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.target instanceof HTMLSelectElement || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      setFullScreen(false);
      displayButton.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [fullScreen]);

  const displayControls = <div className="bookloq-display-controls">
    <button type="button" disabled={loading} onClick={() => void refresh()}><WorkspaceIcon name="Refresh"/><span>{loading ? "Updating" : "Refresh Records"}</span></button>
    <button ref={displayButton} type="button" aria-pressed={fullScreen} title={fullScreen ? "Restore the Vanteloq navigation. Escape also exits." : "Expand BookLoQ to fill the browser window"} onClick={() => setFullScreen(value => !value)}><WorkspaceIcon name={fullScreen ? "Minimize" : "Maximize"}/><span>{fullScreen ? "Exit Full Screen" : "Full Screen"}</span></button>
  </div>;
  const displayClass = `bookloq-display${fullScreen ? " bookloq-fullscreen" : ""}`;
  if (!data && (loading || error)) return <section className={displayClass} aria-label="BookLoQ" aria-busy={loading}><header className="bookloq-pending-controls">{displayControls}</header>{loading ? <WorkspaceSkeleton label="Loading BookLoQ"/> : <div className="bookloq-loading error" role="alert"><span>!</span><b>BookLoQ needs attention</b><small>{error}</small><button onClick={refresh}>Try again</button></div>}</section>;
  if (!data) return null;
  const health = bookloqHealthPresentation(data.summary.healthScore);

  return <section className={displayClass} aria-label="BookLoQ" aria-busy={loading}><div className={`bookloq-shell ${collapsed ? "bookloq-collapsed" : ""}`}>
    <aside className="bookloq-side">
      <div className="bookloq-brand"><ProductBrandLogo product="bookloq" variant="full" className="bookloq-brand-lockup"/><ProductBrandLogo product="bookloq" className="bookloq-brand-mark"/><button aria-label={collapsed ? "Expand BookLoQ navigation" : "Collapse BookLoQ navigation"} onClick={() => setCollapsed((value) => !value)}>‹</button></div>
      {!collapsed && <><label className="bookloq-search"><WorkspaceIcon name="Search"/><input aria-label="Search BookLoQ navigation" value={navSearch} onChange={(event) => setNavSearch(event.target.value)} placeholder="Find a finance workspace"/></label><nav aria-label="BookLoQ navigation">{[...new Set(visible.map((item) => item.group))].map((group) => <section key={group}><p>{group}</p>{visible.filter((item) => item.group === group).map((item) => <button key={item.name} className={activeSection === item.name ? "active" : ""} aria-current={activeSection === item.name ? "page" : undefined} onClick={() => { setSection(item.name); window.scrollTo({ top: 0, behavior: "instant" }); }}><WorkspaceIcon name={item.name}/>{item.name}</button>)}</section>)}</nav></>}
      <div className="bookloq-side-foot"><i className={data.settings?.dataMode === "demonstration" ? "demo" : "live"}/>{!collapsed && <span><b>{!data.configured ? "Ready for first records" : !data.settings ? "Financial sources connected" : data.settings.dataMode === "demonstration" ? "Demonstration data" : "Live ledger"}</b><small>{data.organization.currency}{data.settings ? ` · ${label(data.settings.accountingBasis)}` : " · review controls active"}</small></span>}</div>
    </aside>
    <main className="bookloq-main">
      {loading && <span className="sr-only" role="status">Updating your records…</span>}
      {error && <div className="bookloq-scope-banner" role="alert"><span>{error} The previous records are still shown.</span><button disabled={loading} onClick={() => void refresh()}>Try again</button></div>}
      <header className="bookloq-top"><div><p>VANTELOQ / BOOKLOQ</p><h2>{activeSection}</h2><label className="bookloq-mobile-nav"><span>BookLoQ workspace</span><select value={activeSection} onChange={(event) => setSection(event.target.value as Section)}>{[...new Set(authorizedSections.map((item) => item.group))].map((group) => <optgroup label={group} key={group}>{authorizedSections.filter((item) => item.group === group).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</optgroup>)}</select></label></div><div>{displayControls}<button type="button" className="bookloq-ai-link" onClick={() => navigate("Advisor")}>Ask Vanteloq AI</button>{health && <span className="bookloq-health"><i style={{ "--health": `${health.degrees}deg` } as React.CSSProperties}/><b>{health.score}</b><small>BOOKS HEALTH</small></span>}{data.permissions.includes("post_journals") && <button className="bookloq-primary" disabled={(data.accountCatalog ?? data.statements.accounts).length < 2} title={(data.accountCatalog ?? data.statements.accounts).length < 2 ? "Configure the chart of accounts and an open accounting period first." : undefined} onClick={() => setJournalOpen(true)}>+ Journal entry</button>}</div></header>
      {!data.configured && <BookLoQStart navigate={navigate} setSection={setSection}/>}
      {data.settings?.dataMode === "demonstration" && <div className="bookloq-demo-banner"><b>Demonstration workspace</b><span>Every figure below is clearly separated from live Vanteloq and exists only to evaluate BookLoQ workflows.</span></div>}
      {data.locationScope && <div className="bookloq-scope-banner"><b>{data.locationScope.name} scope</b><span>{data.locationScope.boundary}</span></div>}
      {data.ledgerAccess?.reason && <div className="bookloq-scope-banner" role="status"><b>Ledger availability</b><span>{data.ledgerAccess.reason}</span></div>}
      {data.transactionAccess?.reason && <div className="bookloq-scope-banner" role="status"><b>Bank transaction privacy</b><span>{data.transactionAccess.reason}</span></div>}
      {activeSection === "Banking" && (
        <BookLoQBankConnection plaid={plaidAccess} loading={plaidLoading} error={plaidError} canManage={canManageBankConnections} onChanged={refreshFinancialSources} retry={refreshPlaidAccess} showNotice={showNotice}/>
      )}
      <BookLoQSection section={activeSection} data={data} setSection={setSection} createTask={createTask} showNotice={showNotice} refresh={refresh} openJournal={() => setJournalOpen(true)} navigate={navigate}/>
    </main>
    {journalOpen && (data.accountCatalog ?? data.statements.accounts).length > 0 && <JournalComposer data={data} close={() => setJournalOpen(false)} saved={async () => { setJournalOpen(false); await refresh(); showNotice("Balanced journal posted and added to the audit trail"); }}/>}
  </div></section>;
}

function BookLoQStart({ navigate, setSection }: { navigate: (view: "Integrations" | "Documents") => void; setSection: (section: Section) => void }) {
  return <div className="bookloq-activation"><div><p>BOOKLOQ IS READY</p><h3>Start with the work you need to do now.</h3><span>You can create invoices, capture receipts and open the complete workspace before a bank feed or first journal exists. Financial totals remain unavailable until supporting records arrive.</span></div><div><button onClick={() => setSection("Invoicing")}>Create an invoice</button><button onClick={() => setSection("Expenses")}>Capture a receipt</button><button onClick={() => setSection("Banking")}>Review Banking</button><button onClick={() => navigate("Documents")}>Open files</button></div></div>;
}

function BookLoQBankConnection({ plaid, loading, error, canManage, onChanged, retry, showNotice }: { plaid: PlaidAccess | null; loading: boolean; error: string; canManage: boolean; onChanged: () => Promise<void>; retry: () => Promise<void>; showNotice: (message: string) => void }) {
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const connected = plaid?.status === "connected";
  const repairRequired = plaid?.status === "error" && Boolean(plaid.maskedAccountRef);
  const configured = plaid?.providerReadiness?.credentialsConfigured === true;
  const managementAllowed = canManage && plaid?.canManage !== false;
  const stagedConnection = connected && plaid?.dataPromotionStatus === "staging" && plaid.connections[0]?.lastSuccessfulSyncAt ? plaid.connections[0] : null;
  const mode = plaid?.providerReadiness?.mode;
  const canStartConnection = plaid?.customerAvailability?.canStartConnection ?? (configured && mode === "production");
  const comingSoon = plaid?.customerAvailability?.comingSoon ?? (!configured || mode !== "production");
  const status = connected ? "Connected" : repairRequired ? "Repair required" : comingSoon ? "Coming Soon" : "Ready to Connect";
  const approveStagedData = async () => {
    if (!stagedConnection) return;
    setApprovalBusy(true);
    try {
      const response = await apiFetch("/api/v1/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_data", connectionId: stagedConnection.id, confirmed: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The synchronized bank data could not be approved.");
      setApprovalOpen(false);
      await onChanged();
      showNotice(body.nextStep ?? "Approved bank data is now available to BookLoQ calculations.");
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "The synchronized bank data could not be approved.");
    } finally {
      setApprovalBusy(false);
    }
  };
  return <section className={`bookloq-bank-connection ${connected ? "connected" : repairRequired ? "repair" : ""}`} aria-labelledby="bookloq-bank-connection-title">
    <div className="bookloq-bank-connection-copy"><span className="bookloq-bank-connection-icon" aria-hidden="true">▤</span><div><p>SECURE BANK DATA FOR BOOKLOQ</p><h3 id="bookloq-bank-connection-title">{connected ? "Your Bank Connection" : comingSoon ? "Bank Connections Are Coming Soon" : "Connect Your Bank"}</h3><span>With your consent, read-only balances and transactions support current cash, 13-week cash flow, reconciliation, expense review, tax working papers, and cash-aware purchasing. Reorder demand still comes from approved POS, inventory, and supplier records.</span><div className="bookloq-bank-use-list"><small>Read only</small><small>No money movement</small><small>Review before posting</small><small>Disconnect and deletion controls</small></div></div></div>
    <div className="bookloq-bank-connection-action"><strong>{loading ? "Checking secure connection…" : status}</strong>{mode && (connected || repairRequired) && <small>{mode === "production" ? "Live bank connection" : "Test connection, excluded from live reports"}</small>}{loading ? null : error ? <><span role="alert">{error}</span><button type="button" onClick={() => void retry()}>Retry status check</button></> : plaid ? <><PlaidLinkButton connected={connected} repairRequired={repairRequired} configured={configured} canStartConnection={canStartConnection} canManage={managementAllowed} deletionAvailable={plaid.status === "revoked" && !plaid.privacyDataDeletedAt} onChanged={onChanged} showNotice={showNotice} returnView="BookLoQ"/>{stagedConnection && <button type="button" className="bookloq-approve-bank-data" disabled={!managementAllowed || approvalBusy} onClick={() => setApprovalOpen(true)}>Approve synchronized data</button>}</> : <span>Bank connection controls are unavailable for this workspace.</span>}</div>
    <small className="bookloq-bank-legal">The authorization checkbox, exact data categories, purposes, retention choices, Privacy Policy, and deletion controls are shown before Plaid Link opens. BookLoQ does not receive or store your online banking password.</small>
    {approvalOpen && stagedConnection && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !approvalBusy) setApprovalOpen(false); }}><section className="task-modal data-approval-dialog" role="dialog" aria-modal="true" aria-labelledby="bookloq-bank-approval-title" aria-describedby="bookloq-bank-approval-description"><div className="modal-head"><div><p className="card-kicker">BANK DATA REVIEW</p><h2 id="bookloq-bank-approval-title">Use the synchronized records in BookLoQ?</h2></div><button type="button" aria-label="Close bank data approval" onClick={() => setApprovalOpen(false)}>×</button></div><p id="bookloq-bank-approval-description" className="data-approval-copy">Confirm that the business accounts selected in Plaid Link are appropriate for this workspace. Approval makes their read-only balances and transactions available to cash, reconciliation, accounting, purchasing, and reorder-capacity calculations. Transactions remain unposted until an authorized person categorizes and reconciles them.</p><div className="modal-actions"><button type="button" onClick={() => setApprovalOpen(false)}>Cancel</button><button type="button" className="primary" disabled={approvalBusy} onClick={() => void approveStagedData()}>{approvalBusy ? "Approving…" : "Approve for BookLoQ"}</button></div></section></div>}
  </section>;
}

function BookLoQSection(props: { section: Section; data: BookLoQData; setSection: (section: Section) => void; createTask: (seed: TaskSeed) => void; showNotice: (message: string) => void; refresh: () => Promise<void>; openJournal: () => void; navigate: (view: "Integrations" | "Documents" | "Advisor") => void }) {
  const { section } = props;
  if (section === "Overview") return <OverviewPanel {...props}/>;
  if (section === "Transactions") return <TransactionCentre data={props.data} refresh={props.refresh} showNotice={props.showNotice}/>;
  if (section === "Banking" || section === "Reconciliation") return <><BankingPanel data={props.data} reconciliation={section === "Reconciliation"} setSection={props.setSection}/>{props.data.permissions.includes("reconcile_accounts") && <BookloqStatementImport currency={props.data.settings?.baseCurrency ?? props.data.organization.currency} onUploaded={() => props.navigate("Documents")} onComplete={props.refresh}/>}</>;
  if (section === "Sales" || section === "Invoicing") return <ReceivablesPanel data={props.data} refresh={props.refresh} showNotice={props.showNotice}/>;
  if (section === "Expenses") return <ExpensesPanel data={props.data} navigate={props.navigate} refresh={props.refresh} showNotice={props.showNotice}/>;
  if (section === "Bills") return <BillsPanel data={props.data}/>;
  if (section === "Customers" || section === "Suppliers") return <ContactsPanel data={props.data} type={section === "Customers" ? "customer" : "supplier"}/>;
  if (section === "Chart of Accounts") return <AccountsPanel data={props.data}/>;
  if (section === "Journal Entries") return <JournalsPanel data={props.data} openJournal={props.openJournal} refresh={props.refresh} showNotice={props.showNotice}/>;
  if (section === "Payroll") return <PayrollPanel data={props.data} openJournal={props.openJournal} setSection={props.setSection}/>;
  if (section === "Sales Tax") return <TaxPanel data={props.data}/>;
  if (section === "Inventory Accounting") return <InventoryPanel data={props.data}/>;
  if (section === "Assets and Loans") return <AssetsPanel data={props.data}/>;
  if (section === "Budgets") return <BudgetPanel data={props.data} refresh={props.refresh} showNotice={props.showNotice}/>;
  if (section === "Cash Flow") return <CashFlowPanel data={props.data}/>;
  if (section === "Reports") return <ReportsPanel data={props.data}/>;
  if (section === "Month-End") return <MonthEndPanel data={props.data} refresh={props.refresh} showNotice={props.showNotice}/>;
  if (section === "Accountant Portal") return <AccountantPanel data={props.data}/>;
  if (section === "Audit Trail") return <AuditPanel data={props.data}/>;
  if (section === "BookLoQ Assistant") return <AssistantPanel data={props.data} createTask={props.createTask} openAi={() => props.navigate("Advisor")}/>;
  return <SettingsPanel data={props.data}/>;
}

function OverviewPanel({ data, setSection, createTask, refresh, showNotice, navigate }: { data: BookLoQData; setSection: (section: Section) => void; createTask: (seed: TaskSeed) => void; refresh: () => Promise<void>; showNotice: (message: string) => void; navigate: (view: "Integrations" | "Documents") => void }) {
  const s = data.summary;
  const openAlerts = data.alerts.filter((alert) => alert.status === "open");
  const position = bookloqPositionMessage({ alert: openAlerts[0], currentCashCents: s.currentCashCents, revenueCents: s.revenueCents, dataMode: data.settings?.dataMode });
  const ledgerHasEntries = data.statements.accounts.some(account => account.debitCents !== 0 || account.creditCents !== 0);
  return <div className="bookloq-content">
    <section className="bookloq-promise"><div><p>YOUR FINANCIAL POSITION · {data.organization.currency}</p><h3>{position.title}</h3><span>{position.detail}</span></div>{openAlerts[0] && <button onClick={() => createTask(alertTask(openAlerts[0], data.organization.currency))}>Create a review task →</button>}</section>
    <section className="bookloq-kpis">
      <FinancialKpi
        label={s.cashSource === "plaid_available_balance" ? "Available bank cash" : "Current cash"}
        value={money(s.currentCashCents, data.organization.currency)}
        note={s.currentCashCents === null ? "Connect or repair a verified bank source" : s.cashSource === "plaid_available_balance" ? "Fresh owner-authorized bank balances" : s.cashSource === "demonstration" ? "Demonstration figures only" : "Posted ledger balance"}
        onClick={() => setSection("Banking")}
      />

      <FinancialKpi label="Revenue" value={money(s.revenueCents, data.organization.currency)} note="Posted revenue accounts" onClick={() => setSection("Sales")}/>
      <FinancialKpi label="Gross profit" value={money(s.grossProfitCents, data.organization.currency)} note={s.grossMarginBasisPoints == null ? "Gross margin requires verified costs" : `${rate(s.grossMarginBasisPoints)} gross margin`} onClick={() => setSection("Reports")}/>
      <FinancialKpi label="Operating profit" value={money(s.operatingProfitCents, data.organization.currency)} note="Revenue less posted expenses" onClick={() => setSection("Reports")}/>
    </section>
    <details className="bookloq-financial-details"><summary>More Financial Details</summary><section className="bookloq-kpis">
      <FinancialKpi label="Available cash" value={money(s.availableCashCents, data.organization.currency)} note="Cash less confirmed 30-day bills" onClick={() => setSection("Cash Flow")}/>
      <FinancialKpi label="Total expenses" value={money(s.totalExpensesCents, data.organization.currency)} note="Including cost of goods sold" onClick={() => setSection("Expenses")}/>
      <FinancialKpi label="Receivable" value={money(s.accountsReceivableCents, data.organization.currency)} note={s.overdueInvoicesCount == null ? "Invoice aging is not available" : `${s.overdueInvoicesCount} overdue invoices`} onClick={() => setSection("Invoicing")}/>
      <FinancialKpi label="Payable" value={money(s.accountsPayableCents, data.organization.currency)} note={s.upcomingBillsCount == null ? "Bill records are not available" : `${s.upcomingBillsCount} open bills`} onClick={() => setSection("Bills")}/>
      <FinancialKpi label="GST position" value={money(s.salesTaxPayableCents, data.organization.currency)} note="Collected less recoverable" onClick={() => setSection("Sales Tax")}/>
      <FinancialKpi label="Debt" value={money(s.debtObligationsCents, data.organization.currency)} note="Posted principal balance" onClick={() => setSection("Assets and Loans")}/>
      <FinancialKpi label="Unreconciled" value={bookloqMetricCount(s.unreconciledCount)} note={s.uncategorizedCount == null ? "Transaction records are not available" : `${s.uncategorizedCount} require category review`} onClick={() => setSection("Transactions")}/>
      <FinancialKpi label="Month-end" value={s.monthEndCompletionRate === null ? "Not available" : `${Math.round(s.monthEndCompletionRate * 100)}%`} note="Checklist completion" onClick={() => setSection("Month-End")}/>
    </section></details>
    <BookloqDashboardVisuals data={data} onReview={() => setSection("Transactions")}/>
    <section className="bookloq-two bookloq-overview-grid">
      <article className="bookloq-card bookloq-forecast-card"><CashForecastChart flow={data.thirteenWeekCashFlow} currency={data.organization.currency} allowExport={data.permissions.includes("export_data")}/><button type="button" className="secondary" onClick={() => setSection("Cash Flow")}>Review cash plan →</button></article>
      <article className="bookloq-card bookloq-attention"><Header kicker="FINANCIAL ATTENTION CENTRE" title="What requires action" action={<button onClick={() => setSection("Transactions")}>Open transaction centre</button>}/>{openAlerts.length ? openAlerts.slice(0, 4).map((alert) => <AlertRow key={alert.id} alert={alert} currency={data.organization.currency} createTask={createTask} refresh={refresh} showNotice={showNotice}/>) : <EmptyLine text="No open alerts were produced by the current records."/>}</article>
    </section>
    <section className="bookloq-readiness" aria-label="Financial source readiness">
      <button type="button" onClick={() => setSection("Banking")}><span>Bank cash</span><b>{s.currentCashCents === null ? "Needs a verified source" : s.cashSource === "demonstration" ? "Example figures" : "Available to review"}</b><small>Review connection and freshness →</small></button>
      <button type="button" onClick={() => setSection("Reports")}><span>Ledger records</span><b>{ledgerHasEntries ? "Recorded balances" : "Awaiting posted entries"}</b><small>Inspect accounts and statements →</small></button>
      <button type="button" onClick={() => setSection("Transactions")}><span>Transaction review</span><b>{s.uncategorizedCount === null ? "Awaiting source records" : `${s.uncategorizedCount} need categorization`}</b><small>Open supporting records →</small></button>
    </section>
    <BookloqFinancialExplainer profit={data.statements.profitAndLoss} available={data.ledgerAccess?.available === true && ledgerHasEntries} currency={data.organization.currency} currentCashCents={s.currentCashCents} canViewCash={data.permissions.includes("view_banking")} openReports={() => setSection("Reports")} openTransactions={() => setSection("Transactions")}/>
    <FinancialReviewCard statements={data.statements} available={data.ledgerAccess?.available === true} currency={data.organization.currency}/>
    <section className="bookloq-card bookloq-integrity"><Header kicker="CONTROL STATUS" title="What BookLoQ knows and what still needs review" action={<div className="bookloq-document-actions"><button onClick={() => navigate("Documents")}>Upload invoice or receipt</button><button onClick={() => setSection("Banking")}>Manage bank feed</button></div>}/><div><Integrity label="Double-entry ledger" status={!ledgerHasEntries ? "Awaiting entries" : data.statements.trialBalance.totalDebitCents === data.statements.trialBalance.totalCreditCents ? "Balanced" : "Issue"} detail={`${money(data.statements.trialBalance.totalDebitCents, data.organization.currency)} debits · ${money(data.statements.trialBalance.totalCreditCents, data.organization.currency)} credits`}/><Integrity label="Bank feed" status={data.integrations.banking.startsWith("connected") ? "Connected" : "Not connected"} detail={data.integrations.banking === "connected_and_synced" ? `${data.banks.length} owner-authorized accounts; ${bookloqMetricCount(data.summary.uncategorizedCount)} transactions require category review.` : "Upload a bank statement or check available bank connections in Banking. Imported transactions need category and reconciliation review."}/><Integrity label="Tax filing" status="Not connected" detail="Working-paper assistance only. No filing is represented as submitted."/><Integrity label="Document capture" status={data.documentSummary.total ? "Available" : "Ready"} detail={`${data.documentSummary.total} private documents stored; ${data.documentSummary.needsReview} require review. Open Documents for scan and extraction status. Review extracted figures before using them in your books.`}/></div></section>
  </div>;
}

export function FinancialKpi({ label: name, value, note, onClick }: { label: string; value: string; note: string; onClick?: () => void }) {
  const unavailable = value === "Not available";
  const content = <><span>{name}{onClick && <i aria-hidden="true">↗</i>}</span><b className={unavailable ? "bookloq-value-unavailable" : undefined}>{value}</b><small>{note}</small></>;
  return onClick
    ? <button type="button" className="bookloq-kpi" onClick={onClick}>{content}</button>
    : <article className="bookloq-kpi static">{content}</article>;
}
function Header({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) { return <div className="bookloq-card-head"><div><p>{kicker}</p><h3>{title}</h3></div>{action}</div>; }
function EmptyLine({ text }: { text: string }) { return <div className="bookloq-empty-line"><WorkspaceIcon name="Documents"/><span>{text}</span></div>; }
function Integrity({ label: name, status, detail }: { label: string; status: string; detail: string }) { return <article><span className={status === "Balanced" ? "ok" : status === "Issue" ? "issue" : "off"}>{status}</span><div><b>{name}</b><small>{detail}</small></div></article>; }

function alertTask(alert: Alert, currency: string): TaskSeed { return { title: alert.title, detail: `${alert.explanation} Recommended action: ${alert.recommendedAction}`, priority: alert.severity === "critical" ? "high" : alert.severity === "attention" ? "medium" : "low", expectedImpact: alert.dollarImpactCents == null ? "Impact requires review" : money(alert.dollarImpactCents, currency), sourceType: "alert", sourceRef: alert.id }; }

function AlertRow({ alert, currency, createTask, refresh, showNotice }: { alert: Alert; currency: string; createTask: (seed: TaskSeed) => void; refresh: () => Promise<void>; showNotice: (message: string) => void }) {
  const change = async (status: string) => { const response = await apiFetch("/api/v1/bookloq/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "alert_status", alertId: alert.id, status }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Alert could not be updated."); await refresh(); showNotice("Financial alert status updated"); };
  return <div className={`bookloq-alert ${alert.severity}`}><span className="bookloq-alert-mark">{alert.severity === "critical" ? "!" : alert.severity === "opportunity" ? "↗" : "•"}</span><div><small>{label(alert.severity)} · {alert.confidence} confidence</small><b>{alert.title}</b><p>{alert.explanation}</p><em>Recommended: {alert.recommendedAction}</em><span className="supporting">Supports: {parseJsonList(alert.supportingRecordsJson).join(" · ")}</span></div><aside><strong>{money(alert.dollarImpactCents, currency)}</strong><button onClick={() => createTask(alertTask(alert, currency))}>Create task</button><select aria-label={`Status for ${alert.title}`} value={alert.status} onChange={(event) => void change(event.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></aside></div>;
}

function TransactionCentre({ data, refresh, showNotice }: { data: BookLoQData; refresh: () => Promise<void>; showNotice: (message: string) => void }) {
  const [query, setQuery] = useState(""); const [review, setReview] = useState("all"); const [period, setPeriod] = useState<"30" | "90" | "365" | "all">("90"); const [selected, setSelected] = useState<Transaction | null>(null);
  const latestPostingDate = data.transactions.reduce((latest, transaction) => transaction.postingDate > latest ? transaction.postingDate : latest, "0000-00-00");
  const anchor = latestPostingDate === "0000-00-00" ? new Date("1970-01-01T00:00:00Z") : new Date(`${latestPostingDate}T00:00:00Z`);
  const startDate = new Date(anchor); startDate.setUTCDate(startDate.getUTCDate() - (Number(period) - 1));
  const start = period === "all" ? "0000-00-00" : startDate.toISOString().slice(0, 10);
  const filtered = data.transactions.filter((transaction) => transaction.postingDate >= start && `${transaction.description} ${transaction.originalDescription} ${transaction.contactName ?? ""} ${transaction.accountName ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (review === "all" || review === "matched" && ["matched", "reconciled"].includes(transaction.reconciliationStatus) || review === "needs_review" && transaction.categorizationStatus !== "confirmed" || transaction.categorizationStatus === review || transaction.reconciliationStatus === review));
  const matchedCount = data.transactions.filter((transaction) => ["matched", "reconciled"].includes(transaction.reconciliationStatus)).length;
  return <div className="bookloq-content"><PageIntro eyebrow="BUSINESS TRANSACTIONS" title="Review, categorize and match every cash movement" copy="Search bank and commerce records, assign your own ledger categories, and link evidence without changing the original source record."/>
    <section className="transaction-status-row"><button className={review === "all" ? "active" : ""} onClick={() => setReview("all")}><b>{data.transactions.length}</b><span>All transactions</span></button><button className={review === "needs_review" ? "active" : ""} onClick={() => setReview("needs_review")}><b>{data.transactions.filter((item) => item.categorizationStatus !== "confirmed").length}</b><span>Needs review</span></button><button className={review === "matched" ? "active" : ""} onClick={() => setReview("matched")}><b>{matchedCount}</b><span>Matched to evidence</span></button><button onClick={() => setReview("all")}><b>{data.documentSummary.receipts}</b><span>Receipts available</span></button></section>
    <div className="bookloq-toolbar"><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search merchant, customer, category or source"/></label><select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="all">All imported history</option></select><select value={review} onChange={(event) => setReview(event.target.value)}><option value="all">All review states</option><option value="needs_review">Needs category review</option><option value="matched">Matched to evidence</option><option value="confirmed">Category confirmed</option><option value="suggested">Rule suggestion</option><option value="unreconciled">Unreconciled</option></select>{data.permissions.includes("export_data") && <button onClick={() => downloadTransactions(filtered)}>Export CSV</button>}</div>
    <article className="bookloq-card bookloq-table-card"><div className="bookloq-table"><div className="bookloq-tr bookloq-th"><span>Date</span><span>Description</span><span>Source</span><span>Account</span><span>Review state</span><span>Amount</span></div>{filtered.map((transaction) => <button className="bookloq-tr" key={transaction.id} onClick={() => setSelected(transaction)}><span>{shortDate(transaction.postingDate)}</span><span><b>{transaction.description}</b><small>{transaction.contactName ?? transaction.originalDescription}</small></span><span>{label(transaction.sourceSystem)}</span><span>{transaction.accountCode ? `${transaction.accountCode} · ${transaction.accountName}` : "Uncategorized"}</span><span><i className={`state ${transaction.categorizationStatus}`}>{label(transaction.categorizationStatus)}</i><small>{Math.round(transaction.confidenceBasisPoints / 100)}% confidence</small></span><span className={transaction.amountCents < 0 ? "negative" : "positive"}>{money(transaction.amountCents, transaction.currency)}</span></button>)}</div>{!filtered.length && <EmptyLine text="No transaction matches this view."/>}</article>
    {selected && <TransactionDrawer
      transaction={selected}
      data={data}
      canEdit={data.permissions.includes("create_transactions")}
      close={() => setSelected(null)}
      saved={async (message) => { setSelected(null); await refresh(); showNotice(message); }}
    />}
  </div>;
}

function TransactionDrawer({ transaction, data, canEdit, close, saved }: { transaction: Transaction; data: BookLoQData; canEdit: boolean; close: () => void; saved: (message: string) => Promise<void> }) {
  const categories = (data.accountCatalog ?? data.statements.accounts).filter((account) => !["cash", "bank", "accounts_receivable", "accounts_payable"].includes(account.accountSubtype));
  const [createdCategory, setCreatedCategory] = useState<{ id: string; code: string; name: string } | null>(null);
  const [categoryUncertain, setCategoryUncertain] = useState(false);
  const categoryAttempt = useRef<{ categoryRequestId: string; categoryName: string; categoryType: string } | null>(null);
  const [accountId, setAccountId] = useState(categories.find((account) => account.code === transaction.accountCode)?.id ?? "");
  const [createRule, setCreateRule] = useState(false); const [customName, setCustomName] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const existingMatch = data.transactionMatches.find((match) => match.transactionId === transaction.id && match.status === "confirmed");
  const suggestedMatches = data.matchCandidates.filter((candidate) => candidate.transactionId === transaction.id).slice(0, 3);
  const receiptTargets = data.documents.filter((document) => document.documentType === "receipt" && document.securityState === "clean").slice(0, 10);
  const createCategory = async () => {
    if (customName.trim().length < 2 || saving) return;
    setSaving(true); setError("");
    try {
      const body = await bookloqRequest(apiFetch, "/api/v1/bookloq/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "create_category", ...(categoryAttempt.current ??= { categoryRequestId: crypto.randomUUID(), categoryName: customName, categoryType: transaction.amountCents >= 0 ? "revenue" : "expense" }) }) });
      setCreatedCategory(body.category); setAccountId(body.category.id); setCustomName(""); setCategoryUncertain(false); categoryAttempt.current = null;
    } catch (caught) { const uncertain = !(caught instanceof BookloqRequestError) || caught.status === null || caught.status >= 500 || caught.status < 400; setCategoryUncertain(uncertain); if (!uncertain) categoryAttempt.current = null; setError(caught instanceof Error ? caught.message : "The category could not be confirmed. Check saved categories before trying again."); }
    finally { setSaving(false); }
  };
  const submit = async () => {
    if (!accountId) { setError("Choose a ledger category."); return; }
    if (saving) return;
    setSaving(true); setError("");
    try {
      await bookloqRequest(apiFetch, "/api/v1/bookloq/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "categorize_transaction", transactionId: transaction.id, accountId, createRule, matchText: transaction.description, direction: transaction.amountCents >= 0 ? "inflow" : "outflow" }) });
      await saved(createRule ? "Category confirmed and reusable merchant rule saved" : "Transaction category confirmed and recorded in the audit trail");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The category could not be confirmed. Check the transaction before trying again."); }
    finally { setSaving(false); }
  };
  const match = async (targetType: MatchCandidate["kind"], targetId: string) => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      await bookloqRequest(apiFetch, "/api/v1/bookloq/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "match_transaction", transactionId: transaction.id, targetType, targetId }) });
      await saved("Transaction matched to supporting evidence and added to the audit trail");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The match could not be confirmed. Check the transaction before trying again."); }
    finally { setSaving(false); }
  };
  return <div className="bookloq-record-drawer transaction-review"><div><span><small>TRANSACTION REVIEW</small><h3>{transaction.description}</h3></span><button aria-label="Close transaction" onClick={close}>×</button></div><dl><span><dt>Original description</dt><dd>{transaction.originalDescription}</dd></span><span><dt>Posting date</dt><dd>{shortDate(transaction.postingDate)}</dd></span><span><dt>Source</dt><dd>{label(transaction.sourceSystem)}</dd></span><span><dt>Amount</dt><dd>{money(transaction.amountCents, transaction.currency)}</dd></span><span><dt>Evidence</dt><dd>{existingMatch ? `Matched · ${existingMatch.targetLabel}` : label(transaction.reconciliationStatus)}</dd></span></dl><label><span>Business category</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={!canEdit}><option value="">Select a category</option>{[...categories, ...(createdCategory && !categories.some(account => account.id === createdCategory.id) ? [createdCategory] : [])].map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select><small>This changes the accounting category, not the source bank account.</small></label><div className="custom-category-row"><input value={customName} disabled={saving || categoryUncertain} maxLength={120} onChange={(event) => setCustomName(event.target.value)} placeholder={transaction.amountCents >= 0 ? "New income category" : "New expense category"}/><button disabled={!canEdit || saving || categoryUncertain || customName.trim().length < 2} onClick={() => void createCategory()}>Create category</button></div>{categoryUncertain && <p role="status">Confirm the previous request before creating another category. <button type="button" disabled={saving} onClick={() => void createCategory()}>Check category status</button></p>}<label className="category-rule-check"><input type="checkbox" checked={createRule} onChange={(event) => setCreateRule(event.target.checked)}/><span>Suggest this category for future transactions containing “{transaction.description.slice(0, 48)}”</span></label>{!existingMatch && (suggestedMatches.length > 0 || receiptTargets.length > 0) && <section className="transaction-match-list"><small>MATCH SUPPORTING EVIDENCE</small>{suggestedMatches.map((candidate) => <button key={`${candidate.kind}:${candidate.candidateId}`} disabled={saving || !data.permissions.includes("reconcile_accounts")} onClick={() => void match(candidate.kind, candidate.candidateId)}><span><b>{candidate.label}</b><small>{candidate.reasons.join(" · ")}</small></span><strong>{Math.round(candidate.confidenceBasisPoints / 100)}%</strong></button>)}{receiptTargets.map((document) => <button key={document.id} disabled={saving || !data.permissions.includes("reconcile_accounts")} onClick={() => void match("receipt", document.id)}><span><b>{document.fileName}</b><small>Verified receipt · manual confirmation</small></span><strong>Review</strong></button>)}</section>}{error && <p className="bookloq-form-error" role="alert">{error}</p>}<button className="bookloq-primary" disabled={!canEdit || saving || !accountId} onClick={() => void submit()}>{saving ? "Saving…" : "Confirm category"}</button></div>;
}

function BankingPanel({ data, reconciliation, setSection }: { data: BookLoQData; reconciliation: boolean; setSection: (section: Section) => void }) {
  const bankingConnected = data.integrations.banking.startsWith("connected");
  return <div className="bookloq-content"><PageIntro eyebrow={reconciliation ? "RECONCILIATION CENTRE" : "BANKING"} title={reconciliation ? "Make every source agree before close" : "Bank position with book-level evidence"} copy="Balances are never treated as live unless a verified financial-data connection confirms them."/>
    {!reconciliation && <section className="bank-grid">{data.banks.map((bank) => {
      const comparable = bank.balanceState === "current" || bank.balanceState === "demonstration";
      const displayedBalance = comparable ? bank.availableBalanceCents ?? bank.liveBalanceCents : null;
      const difference = comparable && bank.liveBalanceCents !== null ? bank.liveBalanceCents - bank.bookBalanceCents : null;
      const stateLabel = bank.balanceState === "demonstration"
        ? "Demonstration balance"
        : bank.balanceState === "current"
          ? "Current verified balance"
          : bank.balanceState === "stale"
            ? "Stored balance is stale"
            : "Balance unavailable";
      const syncLabel = comparable && bank.lastSyncAt
        ? ` · Updated ${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(bank.lastSyncAt))}`
        : "";
      return <article className="bookloq-card" key={bank.id}><div className="bank-logo">▤</div><span><b>{bank.name}</b><small>{bank.institutionName} · {bank.maskedNumber}</small></span><strong>{money(displayedBalance, bank.currency)}</strong><div><small>Available balance <b>{money(comparable ? bank.availableBalanceCents : null, bank.currency)}</b></small><small>Book balance <b>{money(bank.bookBalanceCents, bank.currency)}</b></small><small>Difference <b className={difference !== null && difference !== 0 ? "negative" : ""}>{money(difference, bank.currency)}</b></small></div><em>{stateLabel}{syncLabel}</em></article>;
    })}</section>}
    <section className="bookloq-two"><article className="bookloq-card"><Header kicker="SETTLEMENT REVIEW" title="Match sales to bank deposits"/><p className="bookloq-muted">A payout comparison needs matched sales, refunds, fees and a processor settlement for the same period and currency. No verified settlement comparison is available yet.</p><p className="calculation-note">A provider name or an equal amount does not establish a match. Review the source records before reconciling a deposit.</p><button type="button" className="bookloq-primary" onClick={() => setSection("Transactions")}>Review transactions</button></article><article className="bookloq-card"><Header kicker="ACCOUNT RECONCILIATIONS" title="Opening, closing and book balance"/><div className="reconciliation-list">{data.reconciliations.length === 0 && <p className="bookloq-muted">No account reconciliations recorded yet.</p>}{data.reconciliations.map((item) => <div key={item.id}><span><b>{item.accountName}</b><small>{shortDate(item.startDate)} to {shortDate(item.endDate)} · {label(item.status)}</small></span><span><small>Statement</small><b>{money(item.closingBalanceCents, data.organization.currency)}</b></span><span><small>Books</small><b>{money(item.bookBalanceCents, data.organization.currency)}</b></span><strong className={item.differenceCents ? "negative" : "positive"}>{money(item.differenceCents, data.organization.currency)}</strong></div>)}</div></article></section>
    <ProviderGate
      title="Secure bank connection"
      status={data.integrations.banking === "connected_and_synced" ? "Connected" : data.integrations.banking === "connected_needs_sync" ? "Needs sync" : "Not connected"}
      detail={data.integrations.banking === "connected_and_synced"
        ? "Plaid supplies read-only account names, masked identifiers, current balances, and transactions. Vanteloq stores encrypted provider tokens, never online-banking credentials, and imported transactions stay in review until categorized and reconciled."
        : bankingConnected
          ? "The bank connection needs a fresh, healthy balance sync before BookLoQ can treat balances as current."
          : "Open Banking to authorize read-only balances and transactions through Plaid. BookLoQ never stores online banking credentials."}
    />
  </div>;
}

function ReceivablesPanel({ data, refresh, showNotice }: { data: BookLoQData; refresh: () => Promise<void>; showNotice: (message: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [downloadingDocumentId, setDownloadingDocumentId] = useState<string | null>(null);
  const canCreate = data.permissions.includes("edit_drafts");
  const downloadInvoice = async (invoice: Invoice) => {
    if (!invoice.documentId) return;
    setDownloadingDocumentId(invoice.documentId);
    try {
      await downloadPrivateInvoice(invoice.documentId, invoice.invoiceNumber);
      showNotice(`${invoice.invoiceNumber} downloaded securely.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The invoice PDF could not be downloaded.");
    } finally {
      setDownloadingDocumentId(null);
    }
  };
  return <div className="bookloq-content"><PageIntro eyebrow="SALES AND ACCOUNTS RECEIVABLE" title="Create, send and track professional invoices" copy="Build a branded invoice, save its PDF to Files and email the exact saved document to your customer." action={canCreate ? <button className="bookloq-primary" onClick={() => setCreating(true)}>+ New invoice</button> : undefined}/><section className="bookloq-kpis compact"><FinancialKpi label="Posted revenue" value={money(data.summary.revenueCents, data.organization.currency)} note="Revenue accounts"/><FinancialKpi label="Outstanding A/R" value={money(data.summary.accountsReceivableCents, data.organization.currency)} note="Posted receivable balance"/><FinancialKpi label="Overdue" value={bookloqMetricCount(data.summary.overdueInvoicesCount)} note="Issued invoices with an unpaid balance"/></section><DataTable headings={["Invoice", "Customer", "Issued", "Due", "State", "Outstanding", "File"]} rows={data.invoices.map((invoice) => [invoice.invoiceNumber, invoice.customerName, shortDate(invoice.invoiceDate), shortDate(invoice.dueDate), label(invoice.status), money(invoice.totalCents - invoice.paidCents, invoice.currency), invoice.documentId ? <button type="button" className="table-action invoice-download" disabled={downloadingDocumentId === invoice.documentId} onClick={() => void downloadInvoice(invoice)}>{downloadingDocumentId === invoice.documentId ? "Downloading…" : "Download PDF"}</button> : "Not generated"])}/>{!canCreate && <ProviderGate title="Invoice creation requires finance access" detail="An owner or manager can grant draft-editing permission. Existing invoices remain available according to your role."/>}{creating && <InvoiceComposer data={data} close={() => setCreating(false)} saved={async (message) => { setCreating(false); await refresh(); showNotice(message); }}/>}</div>;
}

type InvoiceLineDraft = { id: string; description: string; quantity: string; price: string; tax: string };
type InvoiceOrganization = BookLoQData["organization"] & { legalName?: string; email?: string; phone?: string; address?: string; city?: string; province?: string; postalCode?: string; country?: string; taxNumber?: string };

function invoiceNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `INV-${stamp}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

function InvoiceComposer({ data, close, saved }: { data: BookLoQData; close: () => void; saved: (message: string) => Promise<void> }) {
  const organization = data.organization as InvoiceOrganization;
  const [dates] = useState(() => {
    const issued = new Date();
    const dueDate = new Date(issued);
    dueDate.setUTCDate(dueDate.getUTCDate() + 30);
    return { today: issued.toISOString().slice(0, 10), due: dueDate.toISOString().slice(0, 10) };
  });
  const { today, due } = dates;
  const customerRecords = data.contacts.filter((contact) => contact.contactType === "customer" || contact.contactType === "both");
  const [logo, setLogo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delivery, setDelivery] = useState<"save" | "email">("save");
  const [fields, setFields] = useState({ invoiceNumber: invoiceNumber(), invoiceDate: today, dueDate: due, purchaseOrderRef: "", currency: data.organization.currency || "CAD", issuerName: organization.legalName || organization.name, issuerEmail: organization.email || "", issuerPhone: organization.phone || "", issuerAddress: [organization.address, organization.city, organization.province, organization.postalCode, organization.country].filter(Boolean).join(", "), issuerTaxNumber: organization.taxNumber || "", customerId: "", customerName: "", customerEmail: "", customerPhone: "", customerAddress: "", notes: "", paymentInstructions: "", emailMessage: "" });
  const [lines, setLines] = useState<InvoiceLineDraft[]>([{ id: crypto.randomUUID(), description: "", quantity: "1", price: "", tax: "5" }]);
  const update = (key: keyof typeof fields, value: string) => setFields((current) => ({ ...current, [key]: value }));
  const chooseCustomer = (id: string) => {
    const customer = customerRecords.find((item) => item.id === id);
    setFields((current) => ({ ...current, customerId: id, customerName: customer?.name ?? "", customerEmail: customer?.email ?? "", customerPhone: customer?.phone ?? "", customerAddress: customer?.billingAddress ?? "" }));
  };
  const totals = lines.reduce((sum, line) => {
    const subtotal = Math.round((Number(line.quantity || 0) * Number(line.price || 0)) * 100);
    const tax = Math.round(subtotal * Number(line.tax || 0) / 100);
    return { subtotal: sum.subtotal + subtotal, tax: sum.tax + tax, total: sum.total + subtotal + tax };
  }, { subtotal: 0, tax: 0, total: 0 });
  const displayCurrency = /^[A-Z]{3}$/.test(fields.currency) ? fields.currency : "CAD";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const requestedDelivery = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.classList.contains("bookloq-primary") ? "email" : "save";
      if (requestedDelivery === "email" && !fields.customerEmail.trim()) throw new Error("Enter a customer email before sending the invoice.");
      const invoice = { invoiceNumber: fields.invoiceNumber, invoiceDate: fields.invoiceDate, dueDate: fields.dueDate, currency: fields.currency.toUpperCase(), locationRef: "all", purchaseOrderRef: fields.purchaseOrderRef, issuer: { name: fields.issuerName, address: fields.issuerAddress, email: fields.issuerEmail, phone: fields.issuerPhone, taxNumber: fields.issuerTaxNumber }, customerId: fields.customerId || null, customer: { name: fields.customerName, address: fields.customerAddress, email: fields.customerEmail, phone: fields.customerPhone, taxNumber: "" }, notes: fields.notes, paymentInstructions: fields.paymentInstructions, lines: lines.map((line) => ({ description: line.description, quantityMilli: Math.round(Number(line.quantity) * 1_000), unitPriceCents: Math.round(Number(line.price) * 100), taxRateBasisPoints: Math.round(Number(line.tax || 0) * 100) })) };
      if (logo) throw new Error("Invoice logo uploads are temporarily unavailable while independent file scanning is being connected.");
      const form = new FormData(); form.set("invoice", JSON.stringify(invoice));
      const response = await apiFetch("/api/v1/bookloq/invoices", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The invoice could not be created.");
      if (requestedDelivery === "email") {
        const emailResponse = await apiFetch("/api/v1/bookloq/invoices/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: body.invoice.id, to: fields.customerEmail, message: fields.emailMessage }) });
        const emailBody = await emailResponse.json();
        if (!emailResponse.ok) { await saved(`Invoice ${fields.invoiceNumber} saved to Files. ${emailBody.error?.message ?? "Email delivery failed."}`); return; }
        await saved(`Invoice ${fields.invoiceNumber} saved to Files and emailed to ${fields.customerEmail}`);
      } else await saved(`Invoice ${fields.invoiceNumber} saved as a PDF in Files`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The invoice could not be created."); }
    finally { setBusy(false); }
  };
  return <div className="bookloq-drawer" role="dialog" aria-modal="true" aria-labelledby="invoice-composer-title"><form className="invoice-composer" onSubmit={submit}><header><div><small>BOOKLOQ INVOICE STUDIO</small><h3 id="invoice-composer-title">Create a customer invoice</h3><p>The PDF saved in Files is the same document attached to the email.</p></div><button type="button" aria-label="Close invoice creator" onClick={close}>×</button></header><div className="invoice-form-grid"><section><h4>Your business</h4><label><FieldLabel required={false}>Logo</FieldLabel><input type="file" accept="image/png,image/jpeg" onChange={(event) => setLogo(event.target.files?.[0] ?? null)}/><small>PNG or JPEG, up to 1 MB</small></label><label><FieldLabel>Business or Legal Name</FieldLabel><input required maxLength={180} value={fields.issuerName} onChange={(event) => update("issuerName", event.target.value)}/></label><label><FieldLabel>Address</FieldLabel><textarea required maxLength={500} value={fields.issuerAddress} onChange={(event) => update("issuerAddress", event.target.value)}/></label><div className="invoice-inline"><label><FieldLabel required={false}>Email</FieldLabel><input type="email" maxLength={254} value={fields.issuerEmail} onChange={(event) => update("issuerEmail", event.target.value)}/></label><label><FieldLabel required={false}>Phone</FieldLabel><input maxLength={60} value={fields.issuerPhone} onChange={(event) => update("issuerPhone", event.target.value)}/></label></div><label><FieldLabel required={false}>Tax or Registration Number</FieldLabel><input maxLength={80} value={fields.issuerTaxNumber} onChange={(event) => update("issuerTaxNumber", event.target.value)}/></label></section><section><h4>Invoice details</h4><div className="invoice-inline"><label><FieldLabel>Invoice Number</FieldLabel><input required maxLength={80} value={fields.invoiceNumber} onChange={(event) => update("invoiceNumber", event.target.value)}/></label><label><FieldLabel>Currency</FieldLabel><input required pattern="[A-Za-z]{3}" maxLength={3} value={fields.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())}/></label></div><div className="invoice-inline"><label><FieldLabel>Invoice Date</FieldLabel><input required type="date" value={fields.invoiceDate} onChange={(event) => update("invoiceDate", event.target.value)}/></label><label><FieldLabel>Due Date</FieldLabel><input required type="date" min={fields.invoiceDate} value={fields.dueDate} onChange={(event) => update("dueDate", event.target.value)}/></label></div><label><FieldLabel required={false}>Purchase Order or Reference</FieldLabel><input maxLength={120} value={fields.purchaseOrderRef} onChange={(event) => update("purchaseOrderRef", event.target.value)}/></label><h4>Bill to</h4>{customerRecords.length > 0 && <label>Use an existing customer <select value={fields.customerId} onChange={(event) => chooseCustomer(event.target.value)}><option value="">New customer</option>{customerRecords.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label>}<label><FieldLabel>Customer Name</FieldLabel><input required maxLength={180} value={fields.customerName} onChange={(event) => update("customerName", event.target.value)}/></label><label><FieldLabel>Billing Address</FieldLabel><textarea required maxLength={500} value={fields.customerAddress} onChange={(event) => update("customerAddress", event.target.value)}/></label><div className="invoice-inline"><label><FieldLabel required={delivery === "email"}>Customer Email</FieldLabel><input required={delivery === "email"} type="email" maxLength={254} value={fields.customerEmail} onChange={(event) => update("customerEmail", event.target.value)}/></label><label><FieldLabel required={false}>Phone</FieldLabel><input maxLength={60} value={fields.customerPhone} onChange={(event) => update("customerPhone", event.target.value)}/></label></div></section></div><section className="invoice-lines"><div><h4>Line items</h4><button type="button" onClick={() => setLines((current) => [...current, { id: crypto.randomUUID(), description: "", quantity: "1", price: "", tax: "5" }])}>+ Add line</button></div><div className="invoice-line-head"><span>Description</span><span>Quantity</span><span>Unit price</span><span>Tax %</span><span/></div>{lines.map((line, index) => <div className="invoice-line-row" key={line.id}><input aria-label={`Description for line ${index + 1}`} required maxLength={500} value={line.description} onChange={(event) => setLines((current) => current.map((item) => item.id === line.id ? { ...item, description: event.target.value } : item))}/><input aria-label={`Quantity for line ${index + 1}`} required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setLines((current) => current.map((item) => item.id === line.id ? { ...item, quantity: event.target.value } : item))}/><input aria-label={`Unit price for line ${index + 1}`} required type="number" min="0" step="0.01" value={line.price} onChange={(event) => setLines((current) => current.map((item) => item.id === line.id ? { ...item, price: event.target.value } : item))}/><input aria-label={`Tax rate for line ${index + 1}`} required type="number" min="0" max="100" step="0.01" value={line.tax} onChange={(event) => setLines((current) => current.map((item) => item.id === line.id ? { ...item, tax: event.target.value } : item))}/><button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>×</button></div>)}</section><div className="invoice-bottom"><section><label><FieldLabel required={false}>Payment Instructions</FieldLabel><textarea maxLength={2000} value={fields.paymentInstructions} onChange={(event) => update("paymentInstructions", event.target.value)} placeholder="How and where the customer should pay"/></label><label><FieldLabel required={false}>Notes</FieldLabel><textarea maxLength={2000} value={fields.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Terms, project details or a thank-you note"/></label>{delivery === "email" && <label><FieldLabel required={false}>Email Message</FieldLabel><textarea maxLength={500} value={fields.emailMessage} onChange={(event) => update("emailMessage", event.target.value)} placeholder="Optional note included above the invoice summary"/></label>}</section><aside><span>Subtotal <b>{money(totals.subtotal, displayCurrency)}</b></span><span>Tax <b>{money(totals.tax, displayCurrency)}</b></span><strong>Amount due <b>{money(totals.total, displayCurrency)}</b></strong></aside></div>{error && <p className="bookloq-form-error" role="alert">{error}</p>}<footer><button type="button" onClick={close}>Cancel</button><button type="submit" disabled={busy} onClick={() => setDelivery("save")}>{busy && delivery === "save" ? "Saving…" : "Save PDF to Files"}</button><button className="bookloq-primary" type="submit" disabled={busy} onClick={() => setDelivery("email")}>{busy && delivery === "email" ? "Sending…" : "Save and email"}</button></footer></form></div>;
}
function ExpensesPanel({ data, navigate, refresh, showNotice }: { data: BookLoQData; navigate: (view: "Integrations" | "Documents") => void; refresh: () => Promise<void>; showNotice: (message: string) => void }) {
  const expenses = data.statements.accounts.filter((account) => account.accountType === "expense").sort((a, b) => b.balanceCents - a.balanceCents);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const upload = async (file: File | null) => {
    if (!file || uploading) return;
    setUploading(true); setUploadError("");
    try {
      const form = new FormData(); form.set("file", file); form.set("documentType", "receipt");
      await bookloqRequest(apiFetch, "/api/v1/documents", { method: "POST", body: form }, 60_000);
      await refresh(); showNotice("Receipt captured in the secure expense review queue");
    } catch (caught) { setUploadError(caught instanceof Error ? caught.message : "The upload could not be confirmed. Check Documents before uploading again."); }
    finally { setUploading(false); }
  };
  return <div className="bookloq-content"><PageIntro eyebrow="EXPENSE MANAGEMENT" title="Capture evidence, categorize spend and protect the budget" copy="Posted ledger balances stay separate from receipts under review, committed spend and transactions awaiting categorization."/><section className="receipt-capture"><div><p>RECEIPT CAPTURE</p><h3>Photograph or upload the original receipt.</h3><span>BookLoQ verifies the file type, checks duplicates and stores the original in a private review queue. It does not invent an expense amount or tax treatment from an unreviewed image.</span></div><label><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" disabled={uploading} onChange={(event) => { const file = event.currentTarget.files?.[0] ?? null; event.currentTarget.value = ""; void upload(file); }}/>{uploading ? "Uploading…" : "Take a photo or choose a receipt"}</label><button onClick={() => navigate("Documents")}>Open receipt review</button>{uploadError && <p className="bookloq-form-error" role="alert">{uploadError}</p>}</section><DataTable headings={["Account", "Plain-language purpose", "Posted amount", "Share of expense"]} rows={expenses.map((account) => [`${account.code} · ${account.name}`, account.plainLanguage, money(account.balanceCents, data.organization.currency), data.summary.totalExpensesCents ? rate(Math.round(account.balanceCents * 10_000 / data.summary.totalExpensesCents)) : "Not available"])}/><ProviderGate title="Expense evidence is review-first" detail={`${data.documentSummary.receipts} receipts are stored; ${data.documentSummary.needsReview} documents require review. Categorize the matching bank transaction or post a balanced journal before a receipt changes the books.`}/></div>;
}
function BillsPanel({ data }: { data: BookLoQData }) { return <div className="bookloq-content"><PageIntro eyebrow="BILLS AND ACCOUNTS PAYABLE" title="Control what is owed before cash leaves" copy="No payment is initiated from this workspace. Approval state and supporting records must be complete first."/><DataTable headings={["Bill", "Supplier", "Due", "Workflow state", "Approval", "Outstanding"]} rows={data.bills.map((bill) => [bill.billNumber, bill.supplierName, shortDate(bill.dueDate), label(bill.status), label(bill.approvalStatus), money(bill.totalCents - bill.paidCents, bill.currency)])}/><ProviderGate title="Payments are approval-gated" detail="Real bill payment is intentionally unavailable until a regulated provider, recent reauthentication, dual approval, limits, callbacks and reconciliation are implemented."/></div>; }
function ContactsPanel({ data, type }: { data: BookLoQData; type: "customer" | "supplier" }) { const contacts = data.contacts.filter((contact) => contact.contactType === type || contact.contactType === "both"); return <div className="bookloq-content"><PageIntro eyebrow={type === "customer" ? "CUSTOMER RECORDS" : "SUPPLIER RECORDS"} title={type === "customer" ? "Receivables with customer context" : "Payables with supplier context"} copy="BookLoQ shares source-of-truth contacts with Vanteloq instead of duplicating operational records."/><div className="contact-grid">{contacts.map((contact) => <article className="bookloq-card" key={contact.id}><span className="contact-avatar">{contact.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span><div><b>{contact.name}</b><small>{contact.email}</small></div><dl><dt>Terms</dt><dd>{contact.paymentTermsDays} days</dd><dt>Credit limit</dt><dd>{money(contact.creditLimitCents, data.organization.currency)}</dd><dt>Context</dt><dd>{contact.notes}</dd></dl></article>)}</div>{!contacts.length && <EmptyLine text={`No ${type} records exist in this ledger.`}/>}</div>; }
function AccountsPanel({ data }: { data: BookLoQData }) { return <div className="bookloq-content"><PageIntro eyebrow="CHART OF ACCOUNTS" title="Accountant-grade structure, explained plainly" copy="Accounts with posted history can be archived but are never silently deleted."/><DataTable headings={["Code", "Account", "Type", "Normal balance", "Plain-language explanation", "Balance"]} rows={data.statements.accounts.map((account) => [account.code, account.name, label(account.accountType), label(account.normalBalance), account.plainLanguage, money(account.balanceCents, data.organization.currency)])}/></div>; }

function JournalsPanel({ data, openJournal, refresh, showNotice }: { data: BookLoQData; openJournal: () => void; refresh: () => Promise<void>; showNotice: (message: string) => void }) {
  const reverse = async (entry: Journal) => { const reason = window.prompt(`Reason for reversing ${entry.entryNumber}`); if (!reason) return; const response = await apiFetch("/api/v1/bookloq/journals", { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ entryId: entry.id, reason, reversalDate: new Date().toISOString().slice(0, 10) }) }); const body = await response.json(); if (!response.ok) { showNotice(body.error?.message ?? "Journal could not be reversed"); return; } await refresh(); showNotice("Reversal posted; the original entry remains in history"); };
  return <div className="bookloq-content"><PageIntro eyebrow="GENERAL JOURNAL" title="Balanced entries with an immutable correction path" copy="Posted entries are corrected by reversal or adjustment; they are never silently overwritten." action={<button className="bookloq-primary" onClick={openJournal}>+ New journal</button>}/><DataTable headings={["Entry", "Date", "Explanation", "Source", "Lines", "Debits / credits", "Status", "Correction"]} rows={data.journals.map((entry) => [entry.entryNumber, shortDate(entry.postingDate), entry.memo, label(entry.sourceType), String(entry.lineCount), `${money(entry.totalDebitCents, data.organization.currency)} / ${money(entry.totalCreditCents, data.organization.currency)}`, label(entry.status), entry.status === "posted" && entry.sourceType !== "reversal" ? <button className="table-action" onClick={() => void reverse(entry)}>Reverse</button> : "Not available"])}/></div>;
}

function PayrollPanel({ data, openJournal, setSection }: { data: BookLoQData; openJournal: () => void; setSection: (section: Section) => void }) {
  const hasLedger = data.ledgerAccess?.available === true;
  const wages = hasLedger ? data.statements.accounts.find((account) => account.systemKey === "wage_expense")?.balanceCents ?? null : null;
  const canPost = data.permissions.includes("post_journals") && (data.accountCatalog ?? data.statements.accounts).length > 1;
  return <div className="bookloq-content">
    <PageIntro eyebrow="PAYROLL ACCOUNTING" title="Keep approved payroll costs in your books." copy="Record totals from a finalized payroll report, review the liability, and reconcile the actual bank withdrawal. This workspace does not calculate deductions or pay employees."/>
    <section className="bookloq-kpis compact">
      <FinancialKpi label="Posted wage expense" value={money(wages, data.organization.currency)} note={hasLedger ? "From posted ledger entries" : "No verified ledger total available"}/>
      <FinancialKpi label="Payroll liabilities" value={money(data.summary.payrollObligationsCents, data.organization.currency)} note="Posted amounts still payable"/>
    </section>
    <section className="bookloq-card settings-list">
      <Header kicker="MANUAL REVIEW WORKFLOW" title="From a payroll report to a reconciled entry"/>
      <p>Have your payroll provider or qualified payroll professional finalize the pay period, gross wages, employer costs, deductions, and net pay. Keep the supporting report in your approved recordkeeping system.</p>
      <p>Use a balanced journal to record the approved accounting totals. An accrual is not proof of payment. Reconcile the bank withdrawal separately and retain the reference to the source report.</p>
      <div className="modal-actions">
        <button type="button" className="bookloq-primary" disabled={!canPost} onClick={openJournal}>Record an approved payroll journal</button>
        <button type="button" onClick={() => setSection("Journal Entries")}>Review posted journals</button>
        {data.permissions.includes("view_banking") && <button type="button" onClick={() => setSection("Reconciliation")}>Review bank reconciliation</button>}
      </div>
      {!canPost && <p role="status">Posting requires an initialized chart of accounts, an open accounting period, and journal posting permission. Ask your accounting administrator to complete that setup.</p>}
      <p>Do not put Social Insurance Numbers, employee bank details, passwords, or individual pay information in a journal memo. Use aggregate totals and a nonidentifying report reference.</p>
    </section>
    <ProviderGate title="Automated payroll is not enabled" detail="No payroll provider is connected. Pay runs, employee deductions, remittances, and tax filings cannot be initiated here. Your employer recordkeeping and payment responsibilities remain with you."/>
  </div>;
}
function TaxPanel({ data }: { data: BookLoQData }) { const collected = data.statements.accounts.find((account) => account.systemKey === "gst_collected")?.balanceCents ?? null; const recoverable = data.statements.accounts.find((account) => account.systemKey === "gst_recoverable")?.balanceCents ?? null; const taxPosition = data.summary.salesTaxPayableCents; return <div className="bookloq-content"><PageIntro eyebrow="CANADIAN SALES TAX" title="GST/HST working position with supporting balances" copy="This is preparation support, not a representation that a return was filed."/><section className="bookloq-kpis compact"><FinancialKpi label="Tax collected" value={money(collected, data.organization.currency)} note="Posted GST collected account"/><FinancialKpi label="Recoverable tax" value={money(recoverable, data.organization.currency)} note="Potential input tax credits"/><FinancialKpi label={taxPosition === null ? "Net tax position" : taxPosition >= 0 ? "Net payable" : "Net refundable"} value={money(taxPosition === null ? null : Math.abs(taxPosition), data.organization.currency)} note="Before filing adjustments"/></section><article className="bookloq-card tax-warning"><b>Professional review required</b><p>{data.disclaimer} Jurisdiction, eligibility, documentation, filing frequency and adjustments must be confirmed before relying on a filing position.</p></article><ProviderGate title="Tax filing is not connected" detail="BookLoQ will never claim a return was filed unless a verified filing integration returns an official successful confirmation."/></div>; }
function InventoryPanel({ data }: { data: BookLoQData }) { const inventory = data.statements.accounts.find((account) => account.systemKey === "inventory_asset")?.balanceCents ?? null; const cogs = data.statements.profitAndLoss.cogsCents; const close = data.closeItems.find((item) => item.itemKey === "inventory"); return <div className="bookloq-content"><PageIntro eyebrow="INVENTORY ACCOUNTING" title="Connect product movement to the general ledger" copy="Adjustments require an approved reconciliation between POS, subledger, physical count, purchases and the ledger."/><section className="bookloq-kpis compact"><FinancialKpi label="Ledger inventory" value={money(inventory, data.organization.currency)} note="Inventory asset account"/><FinancialKpi label="Cost of goods sold" value={money(cogs, data.organization.currency)} note="Posted cost of sales"/><FinancialKpi label="Reconciliation" value={close ? label(close.status) : "Not started"} note={close?.blocker || "No blocker recorded"}/></section><ProviderGate title="SKU subledger not connected" detail="FIFO, weighted average, landed cost, shrinkage and physical-count adjustment remain unavailable until normalized SKU and inventory-movement records exist."/></div>; }
function AssetsPanel({ data }: { data: BookLoQData }) { const items = data.statements.accounts.filter((account) => account.systemKey === "fixed_assets" || account.systemKey === "loan_payable" || account.systemKey === "interest_expense"); return <div className="bookloq-content"><PageIntro eyebrow="ASSETS AND LOANS" title="Separate owned assets, principal and financing cost" copy="Loan principal and interest remain distinct so profit and debt are not distorted."/><DataTable headings={["Account", "Classification", "Explanation", "Balance"]} rows={items.map((account) => [`${account.code} · ${account.name}`, label(account.accountSubtype), account.plainLanguage, money(account.balanceCents, data.organization.currency)])}/><ProviderGate title="Schedules require agreements" detail="Depreciation and amortization schedules are not invented. Add verified purchase and lender agreements before BookLoQ generates recurring allocations."/></div>; }
function BudgetPanel({ data, refresh, showNotice }: { data: BookLoQData; refresh: () => Promise<void>; showNotice: (message: string) => void }) {
  const accounts = data.statements.accounts.filter((account) => ["expense", "revenue"].includes(account.accountType));
  const [editing, setEditing] = useState(false);
  const controls = data.budgets.map((budget) => ({ budget, ...budgetControl(budget) }));
  const atRisk = controls.filter((item) => item.budget.accountType === "expense" && item.variance !== null && item.variance < 0);
  return <div className="bookloq-content"><PageIntro eyebrow="SPEND CONTROL AND BUDGETING" title="See the purchase pressure before approving the spend" copy="Actuals include posted activity within each budget’s dates and scope. Expense headroom reserves committed spend or the higher reviewed forecast. Revenue compares actual income with its target." action={data.permissions.includes("edit_drafts") && accounts.length ? <button className="bookloq-primary" onClick={() => setEditing(true)}>+ Budget control</button> : undefined}/><section className="budget-summary"><FinancialKpi label="Budget controls" value={String(controls.length)} note="Revenue and expense plans"/><FinancialKpi label="At-risk categories" value={String(atRisk.length)} note={atRisk.length ? "Projected above budget" : controls.some((item) => item.value === null) ? "Some actuals need review" : "No recorded overage"}/><FinancialKpi label="Potential overage" value={money(atRisk.reduce((sum, item) => sum + Math.abs(item.variance ?? 0), 0), data.organization.currency)} note="Actual + committed vs plan"/></section><div className="budget-bars">{controls.map(({ budget, value, projected, variance, utilization }) => <article key={budget.id}><header><span><b>{budget.accountName}</b><small>{shortDate(budget.periodStart)}–{shortDate(budget.periodEnd)}</small></span><strong className={variance === null ? "" : variance < 0 ? "negative" : "positive"}>{variance === null ? "Comparison unavailable" : budget.accountType === "revenue" ? `${money(Math.abs(variance), data.organization.currency)} ${variance < 0 ? "below" : "above"} target` : variance < 0 ? `${money(Math.abs(variance), data.organization.currency)} over` : `${money(variance, data.organization.currency)} headroom`}</strong></header><div><i style={{ width: `${Math.min(100, Math.max(0, (utilization ?? 0) / 100))}%` }} className={budget.accountType === "revenue" ? (variance !== null && variance >= 0 ? "safe" : "warning") : (utilization ?? 0) > 10000 ? "risk" : (utilization ?? 0) > 8500 ? "warning" : "safe"}/></div><footer><span>Actual {money(value, data.organization.currency)}</span><span>Committed {money(budget.committedCents, data.organization.currency)}</span><span>Projected {money(projected, data.organization.currency)}</span><b>{utilization === null ? "No comparable budget" : `${(utilization / 100).toFixed(0)}% of ${budget.accountType === "revenue" ? "target" : "budget"}`}</b></footer></article>)}</div>{!controls.length && <ProviderGate title="Create the first spend control" detail={accounts.length ? "Choose a revenue or expense account, a period, budget amount, committed spend and forecast. BookLoQ will calculate headroom and flag projected overages." : "Connect or initialize the ledger before creating a category budget."}/>} {editing && <BudgetComposer accounts={accounts} close={() => setEditing(false)} saved={async () => { setEditing(false); await refresh(); showNotice("Budget control saved and added to the audit trail"); }}/>}</div>;
}

function BudgetComposer({ accounts, close, saved }: { accounts: Account[]; close: () => void; saved: () => Promise<void> }) {
  const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10); const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const [form, setForm] = useState({ accountId: accounts[0]?.id ?? "", periodStart: start, periodEnd: end, budget: "", committed: "0", forecast: "0" }); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const cents = (value: string) => Math.round(Number(value) * 100);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const values = [form.budget, form.committed, form.forecast].map(cents);
    if (!form.accountId || values.some((value) => !Number.isSafeInteger(value) || value < 0)) { setError("Enter valid non-negative amounts."); return; }
    if (saving) return;
    setSaving(true); setError("");
    try {
      await bookloqRequest(apiFetch, "/api/v1/bookloq/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "upsert_budget", accountId: form.accountId, periodStart: form.periodStart, periodEnd: form.periodEnd, budgetCents: values[0], committedCents: values[1], forecastCents: values[2], locationRef: "all", departmentRef: "all" }) });
      await saved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The budget could not be confirmed. Check saved budgets before trying again."); }
    finally { setSaving(false); }
  };
  return <div className="bookloq-modal"><form className="bookloq-journal-form budget-composer" onSubmit={(event) => void submit(event)}><div><span><small>SPEND CONTROL</small><h3>Create or update a category budget</h3></span><button type="button" onClick={close}>×</button></div><label>Ledger category<select value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label><div className="budget-dates"><label><FieldLabel>Period Start</FieldLabel><input type="date" required value={form.periodStart} onChange={(event) => setForm({ ...form, periodStart: event.target.value })}/></label><label><FieldLabel>Period End</FieldLabel><input type="date" required value={form.periodEnd} onChange={(event) => setForm({ ...form, periodEnd: event.target.value })}/></label></div><div className="budget-dates"><label><FieldLabel>Budget</FieldLabel><input inputMode="decimal" required value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })}/></label><label><FieldLabel>Committed</FieldLabel><input inputMode="decimal" required value={form.committed} onChange={(event) => setForm({ ...form, committed: event.target.value })}/></label><label><FieldLabel>Forecast</FieldLabel><input inputMode="decimal" required value={form.forecast} onChange={(event) => setForm({ ...form, forecast: event.target.value })}/></label></div>{error && <p className="bookloq-form-error" role="alert">{error}</p>}<footer><button type="button" onClick={close}>Cancel</button><button className="bookloq-primary" disabled={saving}>{saving ? "Saving…" : "Save control"}</button></footer></form></div>;
}
function CashFlowPanel({ data }: { data: BookLoQData }) {
  const flow = data.thirteenWeekCashFlow;
  const confirmedClosings = flow.weeks.map((week) => week.conservativeClosingCashCents).filter((value): value is number => value !== null);
  const expectedClosings = flow.weeks.map((week) => week.planningClosingCashCents).filter((value): value is number => value !== null);
  const confirmedLow = confirmedClosings.length ? Math.min(...confirmedClosings) : null;
  const expectedLow = expectedClosings.length ? Math.min(...expectedClosings) : null;
  const liquidityRisk = confirmedLow === null
    ? "unavailable"
    : confirmedLow < 0
      ? "high"
      : confirmedLow < flow.safetyThresholdCents
        ? "moderate"
        : "low";
  const capacityWarnings = [
    flow.decisionBlocks.includes("foreign_currency_obligations") || flow.excludedCurrencyItemCount > 0
      ? `${flow.excludedCurrencyItemCount} foreign-currency obligation${flow.excludedCurrencyItemCount === 1 ? "" : "s"} need a reviewed conversion before supplier purchasing capacity is available.`
      : null,
    flow.decisionBlocks.includes("undated_purchase_commitments") || flow.undatedCommittedItemCount > 0
      ? `${flow.undatedCommittedItemCount} vendor commitment${flow.undatedCommittedItemCount === 1 ? " needs" : "s need"} a valid cash date before supplier purchasing capacity is available.`
      : null,
  ].filter((warning): warning is string => Boolean(warning));
  const capacityWarning = capacityWarnings.join(" ") || null;
  const openingSource = data.summary.cashSource === "plaid_available_balance"
    ? "fresh Plaid available balances"
    : data.summary.cashSource === "demonstration"
      ? "labelled demonstration balances"
      : "no verified source";
  const bankSyncNote = data.summary.cashLastSyncAt
    ? `Bank feed updated ${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.summary.cashLastSyncAt * 1000))}`
    : label(data.summary.bankCashStatus);
  return <div className="bookloq-content">
    <PageIntro eyebrow="13-WEEK CASH-FLOW INTELLIGENCE" title="See the cash point before it becomes urgent" copy="Actual movements, confirmed obligations and expected receipts remain visibly separate."/>
    <BusinessCashReport data={data}/>
    <article className="bookloq-card bookloq-forecast-card"><CashForecastChart flow={flow} currency={data.organization.currency} allowExport={data.permissions.includes("export_data")}/></article>
    <div className="bookloq-kpi-grid">
      <FinancialKpi label="Organization opening cash" value={money(flow.openingCashCents, data.organization.currency)} note={bankSyncNote}/>
      <FinancialKpi label="Confirmed low point" value={money(confirmedLow, data.organization.currency)} note="Approved bills and sent commitments"/>
      <FinancialKpi label="Expected low point" value={money(expectedLow, data.organization.currency)} note="Includes eligible expected receipts"/>
      <FinancialKpi label="Supplier purchasing capacity" value={money(flow.purchasingCapacityCents, data.organization.currency)} note={flow.capacityStatus === "available" ? "After confirmed obligations and safety reserve" : "Review required before use"}/>
      <FinancialKpi label="Liquidity risk" value={label(liquidityRisk)} note={flow.status === "available" ? "Forecast, not a guarantee" : flow.status === "needs_review" ? "Currency or commitment-date review required" : "Verified cash source required"}/>
    </div>
    {flow.status !== "available" && (flow.status === "needs_review" ? <ProviderGate title="Cash forecast needs commitment review" detail={capacityWarning ?? "Review dated commitments and currencies before using purchasing capacity."}/>
      : <ProviderGate title="Verified cash forecast unavailable" detail="Connect and synchronize a healthy owner-authorized bank source, then confirm access to bank transactions and payable records."/>)}
    {flow.status !== "unavailable" ? <article className="bookloq-card"><div className="cashflow-grid" role="region" aria-label="Weekly cash plan, scroll horizontally to inspect all columns" tabIndex={0}><div className="cashflow-head"><span>Week</span><span>Actual</span><span>Confirmed</span><span>Expected</span><span>Confirmed close</span></div>{flow.weeks.map((week) => <div key={week.index}><span><b>Week {week.index}</b><small>{shortDate(week.weekStart)} to {shortDate(week.weekEnd)}{week.overdueItemCount ? ` · ${week.overdueItemCount} overdue` : ""}</small></span><span>{money(week.actualNetCents, data.organization.currency)}</span><span>{money(week.confirmedNetCents, data.organization.currency)}</span><span>{money(week.expectedNetCents, data.organization.currency)}</span><strong className={week.conservativeClosingCashCents !== null && week.conservativeClosingCashCents < flow.safetyThresholdCents ? "negative" : ""}>{money(week.conservativeClosingCashCents, data.organization.currency)}</strong></div>)}</div></article>
      : null}
    <article className="bookloq-card tax-warning"><b>Calculation boundary</b><p>Opening cash {money(flow.openingCashCents, data.organization.currency)} comes from {openingSource}. {flow.boundary} Confirmed means an approved bill or a dated purchase order recorded as sent; it does not guarantee settlement or vendor performance.</p></article>
  </div>;
}

export function BusinessCashReport({ data }: { data: BookLoQData }) {
  const [days, setDays] = useState<30 | 90 | 365>(90);
  const summary = days === 30 ? data.cashActivity.days30 : days === 90 ? data.cashActivity.days90 : data.cashActivity.months12;
  const timeline = summary.timeline ?? [];
  const points = summary.transactionCount ? timeline.map(bucket => ({
    label: new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${bucket.startDate}T00:00:00Z`)),
    detail: `${bucket.startDate} to ${bucket.endDate}`,
    values: [bucket.inflowCents, -bucket.outflowCents, bucket.netCashFlowCents],
  })) : [];
  const coverage = summary.transactionCount
    ? `${rate(summary.categorizedBasisPoints)} categorized · ${rate(summary.matchedBasisPoints)} evidence matched`
    : "Waiting for owner-authorized activity";
  return <section className="business-cash-report" aria-label="Business cash activity report">
    <header>
      <div><p>BUSINESS CASH ACTIVITY</p><h3>Actual inflows and outflows</h3><span>Recorded bank movements in your base currency. Pending activity, card balances and forecasts are excluded. {data.cashActivity.sourceBoundary}</span></div>
      <div className="cash-period-switch" role="group" aria-label="Cash activity period"><button className={days === 30 ? "active" : ""} onClick={() => setDays(30)}>30 days</button><button className={days === 90 ? "active" : ""} onClick={() => setDays(90)}>90 days</button><button className={days === 365 ? "active" : ""} onClick={() => setDays(365)}>365 days</button></div>
    </header>
    <div className="business-cash-kpis"><article><span>Total inflows</span><b className="positive">{money(summary.inflowCents, data.organization.currency)}</b><small>{summary.transactionCount} recorded bank movements</small></article><article><span>Total outflows</span><b className="negative">{money(summary.outflowCents, data.organization.currency)}</b><small>{money(summary.averageDailyOutflowCents, data.organization.currency)} average per day</small></article><article><span>Net cash flow</span><b className={summary.netCashFlowCents < 0 ? "negative" : "positive"}>{money(summary.netCashFlowCents, data.organization.currency)}</b><small>{shortDate(summary.startDate)}–{shortDate(summary.endDate)}</small></article><article><span>Review coverage</span><b>{rate(summary.categorizedBasisPoints)}</b><small>{coverage}</small></article></div>
    <div className="business-cash-body">
      <FinanceChart key={days} title="Cash Movement" description={`${summary.startDate} to ${summary.endDate}. Outflows appear below zero.`} points={points} currency={data.organization.currency} series={[
        { label: "Inflows", kind: "bar", color: "mint" }, { label: "Outflows", kind: "bar", color: "coral" }, { label: "Net movement", kind: "line", color: "blue" },
      ]} allowExport={data.permissions.includes("export_data")}/>

      <article className="cash-category-breakdown"><header><span><small>OUTFLOW BREAKDOWN</small><b>By business category</b></span><strong>{money(summary.outflowCents, data.organization.currency)}</strong></header>{summary.categories.length ? <div>{summary.categories.slice(0, 7).map((category, index) => <section key={category.name}><p><span><i style={{ background: ["#1769e0", "#12a171", "#ef6b57", "#d99b2b", "#3f91a7", "#735ad9", "#6c7d8b"][index] }}/>{category.name}</span><b>{money(category.amountCents, data.organization.currency)} · {rate(category.shareBasisPoints)}</b></p><div><i style={{ width: `${Math.max(2, category.shareBasisPoints / 100)}%`, background: ["#1769e0", "#12a171", "#ef6b57", "#d99b2b", "#3f91a7", "#735ad9", "#6c7d8b"][index] }}/></div></section>)}</div> : <div className="cash-activity-empty">Confirm transaction categories to see an expense breakdown.</div>}</article>
    </div>
  </section>;
}

function ReportsPanel({ data }: { data: BookLoQData }) { const [report, setReport] = useState<"pnl" | "balance" | "trial">("pnl"); const accounts = data.statements.accounts; const rows = report === "pnl" ? accounts.filter((account) => ["revenue", "expense"].includes(account.accountType)).map((account) => [account.code, account.name, label(account.accountType), money(account.balanceCents, data.organization.currency)]) : report === "balance" ? accounts.filter((account) => ["asset", "liability", "equity"].includes(account.accountType)).map((account) => [account.code, account.name, label(account.accountType), money(account.balanceCents, data.organization.currency)]) : accounts.map((account) => [account.code, account.name, money(Math.max(0, account.debitCents - account.creditCents), data.organization.currency), money(Math.max(0, account.creditCents - account.debitCents), data.organization.currency)]); return <div className="bookloq-content"><PageIntro eyebrow="FINANCIAL REPORTS" title="Accountant detail with owner-readable explanations" copy="Cumulative posted account balances are shown below. These are not period-specific statutory statements. Local exports use the displayed rows and demonstration data remains labelled." action={data.permissions.includes("export_data") ? <button onClick={() => downloadReport(report, rows)}>Export CSV</button> : undefined}/><div className="report-switch"><button className={report === "pnl" ? "active" : ""} onClick={() => setReport("pnl")}>Profit and loss</button><button className={report === "balance" ? "active" : ""} onClick={() => setReport("balance")}>Balance sheet</button><button className={report === "trial" ? "active" : ""} onClick={() => setReport("trial")}>Trial balance</button></div>{report === "pnl" && <ReportSummary currency={data.organization.currency} items={[["Revenue", data.statements.profitAndLoss.revenueCents], ["Cost of goods sold", data.statements.profitAndLoss.cogsCents], ["Gross profit", data.statements.profitAndLoss.grossProfitCents], ["Total expenses", data.statements.profitAndLoss.expenseCents], ["Operating profit", data.statements.profitAndLoss.operatingProfitCents]]}/>} {report === "balance" && <ReportSummary currency={data.organization.currency} items={[["Assets", data.statements.balanceSheet.assetCents], ["Liabilities", data.statements.balanceSheet.liabilityCents], ["Equity including earnings", data.statements.balanceSheet.equityCents]]}/>} {report === "trial" && <ReportSummary currency={data.organization.currency} items={[["Total debits", data.statements.trialBalance.totalDebitCents], ["Total credits", data.statements.trialBalance.totalCreditCents], ["Difference", data.statements.trialBalance.totalDebitCents - data.statements.trialBalance.totalCreditCents]]}/>}<DataTable headings={bookloqReportHeadings(report)} rows={rows}/><div className="export-gates"><button disabled title="A verified server-side PDF renderer is not configured.">PDF export unavailable</button><button disabled title="A verified XLSX renderer is not configured.">XLSX export unavailable</button><span>Generated {new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}</span></div></div>; }
function ReportSummary({ items, currency }: { items: [string, number][]; currency: string }) { return <section className="report-summary">{items.map(([name, value]) => <div key={name}><span>{name}</span><b className={value < 0 ? "negative" : ""}>{money(value, currency)}</b></div>)}</section>; }

function MonthEndPanel({ data, refresh, showNotice }: { data: BookLoQData; refresh: () => Promise<void>; showNotice: (message: string) => void }) { const complete = data.closeItems.filter((item) => item.status === "complete").length; const progress = data.closeItems.length ? complete / data.closeItems.length : 0; const period = data.periods[0]; const update = async (item: CloseItem, status: string) => { const response = await apiFetch("/api/v1/bookloq/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "month_end_status", itemId: item.id, status }) }); const body = await response.json(); if (!response.ok) { showNotice(body.error?.message ?? "Month-end item could not be updated"); return; } await refresh(); showNotice("Month-end progress updated"); }; const lock = async () => { if (!period) return; const response = await apiFetch("/api/v1/bookloq/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "lock_period", periodId: period.id }) }); const body = await response.json(); if (!response.ok) { showNotice(body.error?.message ?? "Period could not be locked"); return; } await refresh(); showNotice("Accounting period locked and recorded in the audit log"); }; return <div className="bookloq-content"><PageIntro eyebrow="MONTH-END CLOSE" title={period ? `${period.label} close` : "No accounting period"} copy="Complete dependencies, review statements, approve the result, then lock the period." action={<button disabled={progress < 1 || period?.status === "locked"} title={progress < 1 ? "Complete every close item first." : "Lock this accounting period"} onClick={() => void lock()}>{period?.status === "locked" ? "Period locked" : "Lock period"}</button>}/><article className="bookloq-card close-progress"><div><span><b>{Math.round(progress * 100)}%</b><small>{complete} of {data.closeItems.length} controls complete</small></span><i><b style={{ width: `${progress * 100}%` }}/></i></div></article><article className="bookloq-card close-list">{data.closeItems.map((item) => <div key={item.id}><span className={`close-state ${item.status}`}>{label(item.status)}</span><span><b>{item.title}</b><small>{item.blocker || `Due ${item.dueDate ? shortDate(item.dueDate) : "before lock"}`}</small></span><select value={item.status} onChange={(event) => void update(item, event.target.value)}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option></select></div>)}</article></div>; }
function AccountantPanel({ data }: { data: BookLoQData }) { return <div className="bookloq-content"><PageIntro eyebrow="ACCOUNTANT PORTAL" title="Finance access without unrelated operational exposure" copy="The current account has the finance role and permissions shown below. Invitations remain unavailable until identity invitations and recent reauthentication are implemented."/><section className="bookloq-two"><article className="bookloq-card"><Header kicker="CURRENT ACCESS" title={label(data.role)}/><div className="permission-list">{data.permissions.map((permission) => <span key={permission}>Allowed: {label(permission)}</span>)}</div></article><ProviderGate title="Accountant invitations not yet available" detail="Vanteloq must verify recipient identity, role scope, expiry, acceptance and revocation before an invitation can be sent."/></section></div>; }
function AuditPanel({ data }: { data: BookLoQData }) { return <div className="bookloq-content"><PageIntro eyebrow="AUDIT TRAIL" title="Append-only history for sensitive finance events" copy="Posted journals, reversals, status changes and period locks are recorded with the trusted actor and organization scope. Local CSV downloads are not recorded here."/><DataTable headings={["Time", "Action", "Resource", "Outcome", "Recorded detail"]} rows={data.audit.map((event) => [new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt * 1000)), label(event.action), `${label(event.resourceType)}${event.resourceId ? ` · ${event.resourceId.slice(-10)}` : ""}`, label(event.outcome), summarizeAudit(event.detailsJson)])}/></div>; }

function AssistantPanel({ data, createTask, openAi }: { data: BookLoQData; createTask: (seed: TaskSeed) => void; openAi: () => void }) {
  const prompts = ["What requires my attention today?", "Compare bank and book balances", "Review recorded GST balances", "Review the supplier payment plan", "Explain my balance sheet", "Review the month-end checklist"];
  const [question, setQuestion] = useState(prompts[0]);
  const answer = bookloqGuidedAnswer(question, data);
  return <div className="bookloq-content">
    <PageIntro eyebrow="BOOKLOQ ASSISTANT" title="Financial context, with Vanteloq AI" copy="Ask about your permitted financial summaries or get help using BookLoQ. Select All locations for organization-wide analysis, then review the provider and data-use notice."/>
    <button type="button" className="bookloq-primary" onClick={openAi}>Open Vanteloq AI →</button>
    <section className="assistant-layout"><aside aria-label="Guided ledger checks"><h3>Guided ledger checks</h3>{prompts.map(prompt => <button key={prompt} aria-pressed={question === prompt} onClick={() => setQuestion(prompt)}>{prompt}</button>)}</aside>
      <article className="bookloq-card assistant-card"><p>Calculated from the available records. These guided checks do not call an AI provider.</p><div><span className={`confidence ${answer.confidence}`}>{answer.confidence} confidence</span><h3>{answer.title}</h3><p>{answer.answer}</p><dl><dt>Calculation</dt><dd>{answer.calculation}</dd><dt>Supporting records</dt><dd>{answer.supporting.join(" · ") || "No supporting record available"}</dd><dt>Missing information</dt><dd>{answer.missing}</dd></dl>{answer.action && <button className="bookloq-primary" onClick={() => createTask({ title: answer.action!, detail: `${answer.answer} Calculation: ${answer.calculation}`, priority: "medium", expectedImpact: "Review BookLoQ supporting records", sourceType: "alert", sourceRef: "bookloq-assistant" })}>Create review task</button>}</div></article>
    </section>
  </div>;
}

function SettingsPanel({ data }: { data: BookLoQData }) { return <div className="bookloq-content"><PageIntro eyebrow="BOOKLOQ SETTINGS" title="Accounting policy, permissions and provider controls" copy="Sensitive configuration is checked on the server and restricted to this organization."/><section className="bookloq-two"><article className="bookloq-card settings-list"><Header kicker="ACCOUNTING PROFILE" title={data.organization.name}/><LineText name="Base currency" value={data.settings?.baseCurrency ?? data.organization.currency}/><LineText name="Accounting basis" value={label(data.settings?.accountingBasis ?? "not configured")}/><LineText name="Jurisdiction" value={`${data.settings?.countryCode ?? "CA"}-${data.settings?.provinceCode ?? "AB"}`}/><LineText name="Cash safety threshold" value={money(data.settings?.cashSafetyThresholdCents ?? 0, data.organization.currency)}/><LineText name="Data mode" value={label(data.settings?.dataMode ?? "live")}/></article><article className="bookloq-card settings-list"><Header kicker="INTEGRATION STATUS" title="Financial providers"/>{Object.entries(data.integrations).map(([name, status]) => <LineText key={name} name={label(name)} value={label(status)}/>)}</article></section><ProviderGate title="Configuration changes are guarded" detail="Banking, tax, payroll, export and period permissions are separate. Secrets are never exposed to browser code, and real integrations require verified server-side token storage."/></div>; }

function JournalComposer({ data, close, saved }: { data: BookLoQData; close: () => void; saved: () => Promise<void> }) {
  const accounts = data.accountCatalog ?? data.statements.accounts;
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState([{ accountId: accounts[0]?.id ?? "", debit: "", credit: "" }, { accountId: accounts[1]?.id ?? "", debit: "", credit: "" }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const [pendingRequest, setPendingRequest] = useState<{ key: string; payload: string } | null>(null);
  useModalFocus(modalRef, true, () => { if (!busy) close(); });
  const amount = (value: string) => value.trim() === "" ? 0 : parseMoney(value);
  const debitTotal = lines.reduce((sum, line) => sum + (amount(line.debit) ?? 0), 0);
  const creditTotal = lines.reduce((sum, line) => sum + (amount(line.credit) ?? 0), 0);
  const update = (index: number, field: "accountId" | "debit" | "credit", value: string) => {
    if (pendingRequest) return;
    setLines((previous) => previous.map((line, i) => i === index ? { ...line, [field]: value } : line));
    setConfirmed(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || submitting.current) return;
    const normalized = lines.map((line) => ({ accountId: line.accountId, description: memo, debitCents: amount(line.debit), creditCents: amount(line.credit), locationRef: "all" }));
    if (!confirmed || !memo.trim() || normalized.some((line) => !line.accountId || line.debitCents === null || line.creditCents === null || (line.debitCents > 0) === (line.creditCents > 0)) || debitTotal !== creditTotal || debitTotal <= 0 || !Number.isSafeInteger(debitTotal)) {
      setError("Review the source report, enter a valid amount on one side of each line, and balance total debits and credits."); return;
    }
    const payload = JSON.stringify({ entryDate: date, memo, currency: data.settings?.baseCurrency ?? data.organization.currency, lines: normalized });
    const submission = pendingRequest ?? { key: crypto.randomUUID(), payload };
    submitting.current = true;
    setPendingRequest(submission);
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/v1/bookloq/journals", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": submission.key }, body: submission.payload });
      const body = await response.json();
      if (!response.ok) {
        if (response.status < 500) setPendingRequest(null);
        throw new Error(body.error?.message ?? "Journal could not be posted.");
      }
      await saved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Posting could not be confirmed. Retry this same entry before creating another.");
    } finally { submitting.current = false; setBusy(false); }
  };
  const frozen = busy || pendingRequest !== null;
  return <div className="modal-backdrop" ref={modalRef} role="dialog" aria-modal="true" aria-label="Create balanced journal" tabIndex={-1}>
    <form className="bookloq-journal-form" onSubmit={submit}>
      <div><span><small>BOOKLOQ GENERAL JOURNAL</small><h3>Review and post a balanced entry</h3></span><button type="button" aria-label="Close journal" disabled={busy} onClick={close}>×</button></div>
      <label><FieldLabel>Entry Date</FieldLabel><input type="date" value={date} disabled={frozen} onChange={(event) => { setDate(event.target.value); setConfirmed(false); }} required/></label>
      <label><FieldLabel>Source Report Reference and Explanation</FieldLabel><textarea value={memo} disabled={frozen} onChange={(event) => { setMemo(event.target.value); setConfirmed(false); }} maxLength={1000} required placeholder="Use aggregate totals and a nonidentifying source report reference."/></label>
      {lines.map((line, index) => <fieldset className="journal-entry-line" key={index}><legend>Line {index + 1}</legend>
        <label>Account<select value={line.accountId} disabled={frozen} onChange={(event) => update(index, "accountId", event.target.value)}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.code} · {account.name}</option>)}</select></label>
        <label>Debit<input inputMode="decimal" value={line.debit} disabled={frozen} onChange={(event) => update(index, "debit", event.target.value)} placeholder="0.00"/></label>
        <label>Credit<input inputMode="decimal" value={line.credit} disabled={frozen} onChange={(event) => update(index, "credit", event.target.value)} placeholder="0.00"/></label>
        {lines.length > 2 && <button type="button" disabled={frozen} onClick={() => { setLines((previous) => previous.filter((_, i) => i !== index)); setConfirmed(false); }}>Remove line {index + 1}</button>}
      </fieldset>)}
      <button type="button" disabled={frozen || lines.length >= 20} onClick={() => { setLines((previous) => [...previous, { accountId: accounts[0]?.id ?? "", debit: "", credit: "" }]); setConfirmed(false); }}>Add journal line</button>
      <p className="journal-balance" role="status">Debits {money(debitTotal, data.organization.currency)} · Credits {money(creditTotal, data.organization.currency)} · Difference {money(debitTotal - creditTotal, data.organization.currency)}</p>
      <label className="journal-approval"><input type="checkbox" checked={confirmed} disabled={frozen} onChange={(event) => setConfirmed(event.target.checked)}/>I have checked these totals and accounts against the approved source report. This entry does not send a payment or file a return.</label>
      {error && <p className="bookloq-form-error" role="alert">{error}{pendingRequest ? " Retry to confirm this same entry. Do not create a duplicate." : ""}</p>}
      <footer><button type="button" disabled={busy} onClick={close}>Close</button><button className="bookloq-primary" disabled={busy || !confirmed}>{busy ? "Posting…" : pendingRequest ? "Retry the same entry" : "Post balanced journal"}</button></footer>
    </form>
  </div>;
}

function PageIntro({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) { return <section className="bookloq-page-intro"><div><p>{eyebrow}</p><h3>{title}</h3><span>{copy}</span></div>{action}</section>; }
export function ProviderGate({ title, detail, status = "Not connected" }: { title: string; detail: string; status?: string }) { return <article className="bookloq-provider-gate"><WorkspaceIcon name="Data Quality"/><div><b>{title}</b><p>{detail}</p></div><strong className="provider-state">{status}</strong></article>; }
export function DataTable({ headings, rows }: { headings: string[]; rows: ReactNode[][] }) {
  const numericColumn = (index: number) => /amount|balance|revenue|profit|expense|debit|credit|outstanding|quantity|count|share|rate|budget|actual|variance|total/i.test(headings[index]);
  const columns = { gridTemplateColumns: `repeat(${headings.length}, minmax(110px, 1fr))` };
  return <article className="bookloq-card bookloq-generic-table">
    <div role="table" aria-label="Financial records">
      <div role="row" className="generic-row generic-head" style={columns}>{headings.map((heading, index) => <span role="columnheader" className={numericColumn(index) ? "numeric-cell" : undefined} key={heading}>{heading}</span>)}</div>
      {rows.map((row, index) => <div role="row" className="generic-row" key={index} style={columns}>{row.map((cell, cellIndex) => <span role="cell" className={numericColumn(cellIndex) ? "numeric-cell" : undefined} key={cellIndex}>{cell}</span>)}</div>)}
    </div>
    {!rows.length && <EmptyLine text="No verified records are available for this view."/>}
  </article>;
}
function LineText({ name, value }: { name: string; value: string }) { return <div className="line-text"><span>{name}</span><b>{value}</b></div>; }

function parseMoney(value: string): number | null { const normalized = value.trim().replaceAll(",", ""); const match = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(normalized); if (!match) return null; const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")); return Number.isSafeInteger(cents) && cents > 0 ? cents : null; }
function summarizeAudit(value: string): string { try { const parsed = JSON.parse(value) as Record<string, unknown>; return Object.entries(parsed).slice(0, 3).map(([key, item]) => `${label(key)}: ${String(item)}`).join(" · ") || "No additional detail"; } catch { return "Recorded event"; } }
function downloadCsv(file: string, headings: string[], rows: (string | number)[][]) { const escape = csvCell; const csv = [headings.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n"); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file; anchor.click(); URL.revokeObjectURL(url); }
function downloadTransactions(rows: Transaction[]) { downloadCsv("bookloq-transactions.csv", ["Posting date", "Description", "Original description", "Amount cents", "Currency", "Account", "Source", "External ID", "Categorization", "Reconciliation", "Confidence basis points"], rows.map((item) => [item.postingDate, item.description, item.originalDescription, item.amountCents, item.currency, item.accountName ?? "", item.sourceSystem, item.externalSourceId, item.categorizationStatus, item.reconciliationStatus, item.confidenceBasisPoints])); }
function downloadReport(report: string, rows: ReactNode[][]) { downloadCsv(`bookloq-${report}-${new Date().toISOString().slice(0, 10)}.csv`, bookloqReportHeadings(report), rows.map((row) => row.map((value) => typeof value === "string" || typeof value === "number" ? value : "Rendered value"))); }

export function bookloqGuidedAnswer(question: string, data: BookLoQData) {
  const q = question.toLowerCase();
  const unavailable = (missing: string) => ({ title: "More verified records are needed", answer: missing, calculation: "Unavailable", supporting: [] as string[], missing, confidence: "low" as const, action: null });
  if (data.settings?.dataMode !== "live") return unavailable("A configured live ledger is required. Demonstration records are not evidence of your business position.");
  const needsLedger = q.includes("bank") || q.includes("gst") || q.includes("hst") || q.includes("tax") || q.includes("balance sheet");
  if (needsLedger && data.ledgerAccess?.available !== true) return unavailable("Verified posted ledger records are unavailable or outside your permissions. Missing balances are not zero.");
  if (q.includes("bank") && (data.summary.bankBalanceCents === null || data.summary.bookBalanceCents === null)) return {
    title: "A current bank comparison is unavailable",
    answer: "Refresh or review the bank connection before comparing it with the books.",
    calculation: "No current verified bank balance",
    supporting: [],
    missing: "A current, healthy bank balance in the base currency.",
    confidence: "low" as const,
    action: "Refresh the bank connection",
  };
  const difference = (data.summary.bankBalanceCents ?? 0) - (data.summary.bookBalanceCents ?? 0);
  if (q.includes("bank")) return {
    title: difference === 0 ? "The recorded balances agree" : `The bank is ${difference < 0 ? "below" : "above"} the books by ${money(Math.abs(difference), data.organization.currency)}`,
    answer: difference === 0 ? "The recorded balances agree. This alone does not prove every transaction is reconciled." : `The recorded bank balance is ${money(Math.abs(difference), data.organization.currency)} ${difference < 0 ? "below" : "above"} the posted cash ledger. These totals do not establish the cause. Review the statement and unmatched entries.`,
    calculation: `${money(data.summary.bankBalanceCents, data.organization.currency)} bank − ${money(data.summary.bookBalanceCents, data.organization.currency)} books = ${money(difference, data.organization.currency)}`,
    supporting: data.reconciliations.map((item) => `${item.accountCode} reconciliation ${item.id.slice(-8)}`),
    missing: "Transaction-level reconciliation and evidence explaining any difference.", confidence: "medium" as const, action: difference === 0 ? null : "Review the bank-to-book difference",
  };
  if (q.includes("gst") || q.includes("hst") || q.includes("tax")) {
    const collected = data.statements.accounts.find((account) => account.systemKey === "gst_collected")?.balanceCents;
    const recoverable = data.statements.accounts.find((account) => account.systemKey === "gst_recoverable")?.balanceCents;
    if (collected == null || recoverable == null) return unavailable("Both posted GST accounts are required for this calculation. Missing tax records cannot establish a zero liability.");
    return {
      title: `${money(Math.abs(collected - recoverable), data.organization.currency)} recorded net GST ${collected < recoverable ? "credit" : "payable"}`,
      answer: `Posted GST collected is ${money(collected, data.organization.currency)} and posted recoverable GST is ${money(recoverable, data.organization.currency)}. This is a working position, not a filed return.`,
      calculation: `${money(collected, data.organization.currency)} collected − ${money(recoverable, data.organization.currency)} recoverable = ${money(collected - recoverable, data.organization.currency)}`,
      supporting: ["2100 GST collected", "1150 GST recoverable"],
      missing: "Filing adjustments, documentation eligibility and official confirmation.", confidence: "medium" as const, action: "Review GST working papers",
    };
  }
  if ((q.includes("afford") || q.includes("supplier")) && (data.summary.currentCashCents === null || data.summary.availableCashCents === null)) return unavailable("Current cash and known obligations must be available before assessing the recorded payment plan.");
  if (q.includes("afford") || q.includes("supplier")) return {
    title: data.summary.availableCashCents! >= 0 ? "Recorded cash covers the known 30-day bills" : "Recorded cash does not cover the known 30-day bills",
    answer: `Current recorded cash is ${money(data.summary.currentCashCents, data.organization.currency)}. After confirmed bills due within 30 days, available cash is ${money(data.summary.availableCashCents, data.organization.currency)} before probable collections and unmodeled obligations.`,
    calculation: `${money(data.summary.currentCashCents, data.organization.currency)} cash − confirmed 30-day bills = ${money(data.summary.availableCashCents, data.organization.currency)}`,
    supporting: data.bills.map((bill) => `${bill.billNumber} ${money(bill.totalCents - bill.paidCents, data.organization.currency)}`),
    missing: "Live bank availability, unentered bills, payroll, card due dates and tax payment schedules.", confidence: "medium" as const, action: "Review the 30-day payment plan",
  };
  if (q.includes("balance sheet") || q.includes("explain")) return {
    title: "Recorded balance-sheet totals",
    answer: `Assets are ${money(data.statements.balanceSheet.assetCents, data.organization.currency)}, liabilities are ${money(data.statements.balanceSheet.liabilityCents, data.organization.currency)}, and equity including current earnings is ${money(data.statements.balanceSheet.equityCents, data.organization.currency)}.`,
    calculation: `${money(data.statements.balanceSheet.assetCents, data.organization.currency)} assets − ${money(data.statements.balanceSheet.liabilityCents, data.organization.currency)} liabilities = ${money(data.statements.balanceSheet.assetCents - data.statements.balanceSheet.liabilityCents, data.organization.currency)} net assets. Recorded equity: ${money(data.statements.balanceSheet.equityCents, data.organization.currency)}.`,
    supporting: data.statements.accounts.filter((account) => ["asset", "liability", "equity"].includes(account.accountType)).map((account) => `${account.code} ${account.name}`),
    missing: "Unrecorded assets, liabilities or adjustments cannot be inferred.", confidence: "high" as const, action: null,
  };
  if (q.includes("month-end") || q.includes("checklist")) {
    if (!data.closeItems.length || data.summary.monthEndCompletionRate === null) return unavailable("No complete month-end checklist is available. An empty list does not mean the close is complete.");
    const incomplete = data.closeItems.filter((item) => item.status !== "complete");
    return {
      title: `${incomplete.length} month-end controls remain`,
      answer: incomplete.map((item) => `${item.title}: ${label(item.status)}`).join("; ") || "Every recorded close control is complete.",
      calculation: data.summary.monthEndCompletionRate === null ? "Month-end completion is unavailable" : `${data.closeItems.length - incomplete.length} complete ÷ ${data.closeItems.length} total = ${Math.round(data.summary.monthEndCompletionRate * 100)}%`,
      supporting: incomplete.map((item) => item.itemKey),
      missing: incomplete.find((item) => item.blocker)?.blocker ?? "No recorded blocker", confidence: "high" as const, action: incomplete.length ? "Complete the remaining month-end controls" : null,
    };
  }
  const open = data.alerts.filter((alert) => alert.status === "open");
  return {
    title: `${open.length} financial items require review`,
    answer: open.map((alert) => `${alert.title}: ${alert.recommendedAction}`).join(" ") || "No open alerts were produced by the available records. This does not establish that the books are complete or the business has no risk.",
    calculation: `${open.filter((alert) => alert.severity === "critical").length} critical + ${open.filter((alert) => alert.severity === "attention").length} attention + ${open.filter((alert) => alert.severity === "opportunity").length} opportunities`,
    supporting: open.flatMap((alert) => parseJsonList(alert.supportingRecordsJson)),
    missing: "Unrecorded issues and obligations are not covered by this check.", confidence: "medium" as const, action: open[0]?.recommendedAction ?? null,
  };
}
