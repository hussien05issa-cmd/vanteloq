"use client";

import { parseDailyCsv } from "../domain/daily-summary-csv";
import DailyImportReviewPanel from "./daily-import-review";
import type { DailyImportReview } from "../server/daily-metric-import";
import WorkspaceSkeleton from "./workspace-skeleton";
import { isAwaitingSalesRecords } from "../domain/intraday-sales";

import Image from "next/image";
import { FormEvent, Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import BookLoQWorkspace from "./bookloq-workspace";
import CommunicationsWorkspace from "./communications-workspace";
import CommerceIntelligenceWorkspace from "./commerce-intelligence-workspace";
import type { RetailAdvisorSeed } from "./retail-intelligence-workspace";
import GrowthWorkspace from "./growth-workspace";
import ScenarioPlanner from "./scenario-planner";
import { connectorNextStep, filterConnectors } from "../domain/connector-guidance";
import IntegrationBrandLogo from "./integration-brand-logo";
import AutomaticSyncControl, { type AutomaticSyncStatus } from "./automatic-sync-control";
import AdvisorComposer, { canAskAdvisor } from "./advisor-composer";
import AdvisorThinking from "./advisor-thinking";
import AdvisorResponse from "./advisor-response";
import { readAdvisorAnswer } from "./advisor-client";
import { useAdvisorConsent } from "./advisor-consent";
import AdvisorPrivacy from "./advisor-privacy";
import { advisorProviders, type AdvisorMode } from "../domain/advisor-providers";
import {
  integrationCategoryGuide,
  integrationCategoryOrder,
  type IntegrationCatalogEntry,
} from "./integration-catalog";
import ProductBrandLogo from "./product-brand-logo";
import WorkspaceIcon from "./workspace-icon";
import DecisionWorkspace from "./decision-workspace";
import { useModalFocus } from "./use-modal-focus";
import { comparisonCopy, quantityLabel } from "../domain/workspace-presentation";
import PlaidLinkButton, { PLAID_REDIRECT_STORAGE_KEY, PLAID_RETURN_VIEW_STORAGE_KEY } from "./plaid-link-button";
import { apiFetch, signOut } from "./supabase-browser";
import { useOpportunityReviews } from "./use-opportunity-reviews";
import {
  BusinessTrendChart,
  IntradaySalesChart,
  MetricSparkline,
  type Tone,
} from "./dashboard-charts";
import { SettingsWorkspace, TeamWorkspace } from "./governance-workspaces";
import {
  DataQualityWorkspace,
  DocumentsWorkspace,
  PurchaseOrdersWorkspace,
  ReportsWorkspace,
} from "./control-workspaces";
import {
  NAVIGATION_VIEW_IDS,
  PROTECTED_NAVIGATION_VIEW_IDS,
  normalizeHiddenNavigation,
  setNavigationVisibility,
} from "../domain/navigation-preferences";
import { buildProviderFeatureCoverage, type CanonicalCommerceCoverage, type ProviderFeatureCoverage } from "../domain/provider-feature-coverage";
import { integrationActionKey, supportsMultipleProviderAccounts } from "../domain/integration-source";
import { humanizeIdentifier, providerDisplayName, workspaceViewLabel } from "../domain/display-labels";
import {
  PRIVACY_POLICY_VERSION,
  QUICKBOOKS_CONSENT_NOTICE_VERSION,
} from "../domain/privacy-controls";
import { navigationEntitlement } from "../domain/navigation-entitlements";
import { integrationProviderFeature } from "../domain/paid-feature-routing";
import { useBillingEntitlements } from "./billing-entitlements-context";
import { FieldLabel } from "./form-primitives";

type View =
  | "Dashboard"
  | "Intelligence"
  | "Action Centre"
  | "Business Brief"
  | "Advisor"
  | "BookLoQ"
  | "Sales"
  | "Profit"
  | "Cash"
  | "Bookkeeping"
  | "Inventory"
  | "Customers"
  | "Marketing"
  | "Communications"
  | "Team"
  | "Operations"
  | "Suppliers"
  | "Purchase Orders"
  | "Documents"
  | "Data Quality"
  | "Locations"
  | "Decision Journal"
  | "Scenario Planner"
  | "Reports"
  | "Integrations"
  | "Settings";

const nav: [string, View[]][] = [
  [
    "Command centre",
    ["Dashboard", "Intelligence", "Action Centre", "Business Brief", "Advisor"],
  ],
  [
    "Sales and customers",
    ["Sales", "Customers"],
  ],
  [
    "Inventory and purchasing",
    ["Inventory", "Suppliers", "Purchase Orders"],
  ],
  [
    "BookLoQ finance",
    ["BookLoQ", "Reports"],
  ],
  [
    "Growth and relationships",
    ["Marketing", "Communications"],
  ],
  [
    "Operations and governance",
    ["Operations", "Team", "Documents", "Data Quality", "Locations", "Decision Journal", "Scenario Planner"],
  ],
];

const protectedNavigation = [...PROTECTED_NAVIGATION_VIEW_IDS] as View[];
const allNavigationViews = [...NAVIGATION_VIEW_IDS] as View[];

const navigationGuide: Record<View, { outcome: string; data: string }> = {
  Dashboard: { outcome: "Prioritizes the owner’s current operating picture and exceptions.", data: "Verified sales, margin, cash, inventory and task records." },
  Intelligence: { outcome: "Explains supported changes, confidence and missing evidence.", data: "Metric history, comparisons, provenance and quality checks." },
  "Action Centre": { outcome: "Turns decisions and exceptions into assigned, measurable work.", data: "Owner actions, due dates, assignees and linked evidence." },
  "Business Brief": { outcome: "Creates a compact review of performance and next actions.", data: "Verified command-centre metrics and ranked insights." },
  Advisor: { outcome: "Answers supported operating questions and states its limits.", data: "The same verified metrics and source contracts used by the dashboard." },
  Sales: { outcome: "Shows revenue, transactions, average order value and payment mix.", data: "Completed sales, refunds, discounts, payments, dates and locations." },
  Customers: { outcome: "Supports repeat-rate and retention analysis when identity is authorized.", data: "Customer profiles, consent state and customer-linked transactions." },
  Inventory: { outcome: "Finds stockout, overstock, expiry and transfer decisions.", data: "SKU balances, sales history, incoming orders, lead time and location." },
  Suppliers: { outcome: "Connects vendor records to products and purchasing decisions.", data: "Suppliers, products, costs, purchase orders and receiving history." },
  "Purchase Orders": { outcome: "Builds reviewed orders without duplicating incoming stock.", data: "Demand, stock, suppliers, order history and verified buying capacity." },
  Operations: { outcome: "Organizes recurring duties, exceptions and accountable follow-up.", data: "Tasks, checklists, incidents, receiving and shift records." },
  Profit: { outcome: "Shows margin movement and where contribution may be leaking.", data: "Net sales, product cost, labour and supported operating expenses." },
  Cash: { outcome: "Shows liquidity pressure and protected purchasing capacity.", data: "Verified bank balances, obligations, receivables and due dates." },
  BookLoQ: { outcome: "Organizes financial records, reconciliation and month-end review.", data: "Bank activity, POS payouts, invoices, receipts and reviewed journal entries." },
  Bookkeeping: { outcome: "Explains the close workflow and unresolved accounting records.", data: "Transactions, source documents, tax coding and reconciliation status." },
  Reports: { outcome: "Produces traceable operating and accountant-ready exports.", data: "Verified metrics, periods, sources and role permissions." },
  Marketing: { outcome: "Recommends measurable growth work constrained by operations.", data: "Search, journeys, campaign cost, customers, margin, stock and location." },
  Communications: { outcome: "Keeps customer outreach gated by consent and evidence.", data: "Authorized contacts, consent, campaign purpose and delivery status." },
  Team: { outcome: "Manages roles, location scope and organization-paid access.", data: "Employee profiles, permissions, assigned locations and security state." },
  Documents: { outcome: "Captures invoices and receipts for controlled human review.", data: "Private uploads, file metadata, duplicate checks and review status." },
  "Data Quality": { outcome: "Shows freshness, completeness, reconciliation and blocked calculations.", data: "Import runs, source coverage, errors and metric provenance." },
  Locations: { outcome: "Compares each mapped store and switches the whole workspace scope.", data: "Organization locations, provider mappings and location-tagged metrics." },
  "Decision Journal": { outcome: "Records what was decided, why and what happened next.", data: "Decision evidence, owner, date, expected result and review outcome." },
  "Scenario Planner": { outcome: "Tests assumptions without changing live books or metrics.", data: "Owner-entered assumptions plus verified baseline figures." },
  Integrations: { outcome: "Connects and maps sources only after their safety gates pass.", data: "Authorization, scopes, locations, sync history and reconciliation." },
  Settings: { outcome: "Controls organization, security, locations and personal navigation.", data: "Account preferences, roles, billing and organization records." },
};

const emptyCommerceCoverage: CanonicalCommerceCoverage = {
  sales: false,
  payments: false,
  products: false,
  inventory: false,
  customers: false,
  suppliers: false,
  locations: false,
};
const universalPosContract = buildProviderFeatureCoverage("normalized-pos", emptyCommerceCoverage);
type DirectIntegrationProvider = "lightspeed" | "lightspeed-r" | "shopify" | "shopify-pos" | "square" | "clover" | "stripe" | "moneris" | "quickbooks" | "google" | "meta";
const providerSyncRoutes = {
  lightspeed: "/api/v1/integrations/lightspeed/sync",
  "lightspeed-r": "/api/v1/integrations/lightspeed-r/sync",
  shopify: "/api/v1/integrations/shopify/sync",
  "shopify-pos": "/api/v1/integrations/shopify-pos/sync",
  square: "/api/v1/integrations/square/sync",
  clover: "/api/v1/integrations/clover/sync",
  stripe: "/api/v1/integrations/stripe/sync",
  moneris: "/api/v1/integrations/moneris/sync",
  google: "/api/v1/integrations/google/sync",
  meta: "/api/v1/integrations/meta/sync",
} as const;

const viewPermission: Partial<Record<View, string>> = {
  Dashboard: "dashboard.view",
  Intelligence: "insights.view",
  "Action Centre": "operations.tasks",
  "Business Brief": "dashboard.view",
  Advisor: "insights.view",
  BookLoQ: "finance.statements",
  Sales: "sales.view",
  Profit: "metrics.profit",
  Cash: "metrics.cash",
  Bookkeeping: "finance.statements",
  Inventory: "inventory.view",
  Customers: "customers.totals",
  Marketing: "marketing.view",
  Communications: "customers.identity",
  Team: "team.directory",
  Operations: "operations.tasks",
  Suppliers: "purchasing.view",
  "Purchase Orders": "purchasing.view",
  Documents: "documents.view",
  "Data Quality": "integrations.view",
  Locations: "locations.manage",
  "Decision Journal": "insights.view",
  "Scenario Planner": "metrics.cash",
  Reports: "reports.operational",
  Integrations: "integrations.view",
  Settings: "organization.settings",
};

const moduleDefinitions: Record<
  string,
  { promise: string; metrics: string[]; sources: string[]; actions: string[] }
> = {
  Sales: {
    promise:
      "Explain revenue movement across time, channels, locations and baskets.",
    metrics: [
      "Net and gross sales",
      "Transactions and average transaction",
      "Units per transaction",
      "Refunds, discounts and voids",
    ],
    sources: [
      "Daily summaries now",
      "POS transactions for hourly and employee detail",
      "Commerce channels for consolidated sales",
    ],
    actions: [
      "Investigate a decline",
      "Protect a growth driver",
      "Set a sales target",
    ],
  },
  Profit: {
    promise: "Show what contributes to profit and where margin is leaking.",
    metrics: [
      "Gross profit and gross margin",
      "Contribution after labour",
      "Product, category and supplier margin",
      "Budget and prior-period variance",
    ],
    sources: [
      "Daily sales and cost summaries now",
      "Line-item product costs",
      "Operating expenses and supplier invoices",
    ],
    actions: [
      "Review margin compression",
      "Change pricing after cost validation",
      "Stop a loss-making promotion",
    ],
  },
  Cash: {
    promise: "Forecast cash pressure before it becomes urgent.",
    metrics: [
      "Latest operating cash",
      "Accounts payable",
      "Scheduled bills and payroll",
      "Projected closing balance",
    ],
    sources: [
      "Daily balance entry now",
      "Bank feeds",
      "Invoices, payroll and tax schedules",
    ],
    actions: [
      "Prepare for a low-cash date",
      "Prioritize a payment",
      "Model an inventory purchase",
    ],
  },
  Bookkeeping: {
    promise:
      "Turn operating records into an accountant-ready close without pretending to replace an accountant.",
    metrics: [
      "Uncategorized expenses",
      "Deposit reconciliation",
      "GST/HST position",
      "Month-end completion",
    ],
    sources: [
      "Bank and card transactions",
      "POS payouts",
      "Invoices and receipts",
      "Accounting platform",
    ],
    actions: [
      "Match a deposit",
      "Resolve a duplicate invoice",
      "Complete the close checklist",
    ],
  },
  Inventory: {
    promise: "Protect cash and availability with demand-aware purchasing.",
    metrics: [
      "On-hand and inventory value",
      "Days remaining and stockout date",
      "Turnover, overstock and dead stock",
      "Expiry and shrinkage",
    ],
    sources: [
      "Latest aggregate value now",
      "SKU-level stock and sales",
      "Purchase orders and supplier lead times",
    ],
    actions: ["Approve a reorder", "Transfer stock", "Clear excess inventory"],
  },
  Customers: {
    promise: "Find who is loyal, due to return, or at risk of leaving.",
    metrics: [
      "Repeat rate and purchase frequency",
      "Customer lifetime value",
      "Days between purchases",
      "Churn and replenishment risk",
    ],
    sources: [
      "Customer-linked transactions",
      "Loyalty records",
      "Consent and campaign history",
    ],
    actions: [
      "Create a replenishment audience",
      "Request a review",
      "Launch a retention offer",
    ],
  },
  Marketing: {
    promise: "Tie every campaign to gross profit and repeat behaviour.",
    metrics: [
      "Spend and attributed revenue",
      "Gross profit and ROAS",
      "Acquisition cost",
      "Repeat rate after campaign",
    ],
    sources: [
      "Ad platforms",
      "Discount codes and POS",
      "Email and SMS",
      "In-store campaign records",
    ],
    actions: [
      "Pause a margin-negative campaign",
      "Build a cross-sell audience",
      "Compare promotion structures",
    ],
  },
  Team: {
    promise:
      "Match coverage and development to demand without simplistic surveillance.",
    metrics: [
      "Sales per labour hour",
      "Labour percentage",
      "Schedule adherence",
      "Training and task completion",
    ],
    sources: [
      "Daily labour cost now",
      "Schedules and time clock",
      "Hourly transactions",
      "Training records",
    ],
    actions: [
      "Adjust coverage",
      "Assign training",
      "Review an exception in context",
    ],
  },
  Operations: {
    promise:
      "Run opening, closing, receiving and recurring work from one accountable queue.",
    metrics: [
      "Checklist completion",
      "Cash discrepancies",
      "Delivery exceptions",
      "Overdue duties and incidents",
    ],
    sources: [
      "Action Centre tasks",
      "Checklists and shift handovers",
      "Receiving and cash-count records",
    ],
    actions: ["Assign a duty", "Escalate a missed task", "Record an incident"],
  },
  Suppliers: {
    promise: "Compare supplier economics and reliability before purchasing.",
    metrics: [
      "Spend and margin by supplier",
      "Lead time and fill rate",
      "Invoice accuracy",
      "Price increases and credits",
    ],
    sources: [
      "Supplier invoices",
      "Purchase orders",
      "Receiving discrepancies",
      "Product costs",
    ],
    actions: [
      "Challenge a price increase",
      "Change order allocation",
      "Follow up on a credit",
    ],
  },
  Locations: {
    promise:
      "Diagnose whether each location has a traffic, margin, inventory, staffing or expense problem.",
    metrics: [
      "Location profit",
      "Targets and benchmarks",
      "Regional demand",
      "Transfers and centralized purchasing",
    ],
    sources: [
      "Location-tagged daily summaries",
      "POS and inventory by store",
      "Location expenses and staffing",
    ],
    actions: [
      "Transfer inventory",
      "Set a local target",
      "Investigate a weak store",
    ],
  },
  Reports: {
    promise: "Deliver a small set of owner reports that lead to decisions.",
    metrics: [
      "Daily owner briefing",
      "Weekly performance review",
      "Monthly P&L summary",
      "Accountant package",
    ],
    sources: ["Every verified Vanteloq data source"],
    actions: [
      "Export verified figures",
      "Assign follow-ups",
      "Share an accountant package",
    ],
  },
};

type Totals = {
  days: number;
  grossSalesCents: number;
  netSalesCents: number;
  costOfGoodsCents: number;
  transactionCount: number;
  unitsSold: number;
  refundsCents: number;
  discountsCents: number;
  labourCostCents: number;
  grossProfitCents: number;
  contributionCents: number;
  grossMarginRate: number | null;
  averageTransactionCents: number | null;
  unitsPerTransaction: number | null;
  labourRate: number | null;
  discountRate: number | null;
};
type Insight = {
  id: string;
  severity: "critical" | "attention" | "opportunity" | "informational";
  title: string;
  whatHappened: string;
  probableCause: string;
  financialImpact: string;
  recommendedAction: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  missingInformation: string[];
  suggestedTask: TaskSeed;
};
type MetricProvenance = {
  metricId: string;
  metricName: string;
  actuality: "actual" | "estimate" | "forecast" | "unavailable";
  periodStart: string | null;
  periodEnd: string | null;
  comparisonPeriodStart: string | null;
  comparisonPeriodEnd: string | null;
  sourceSystem: string;
  sourceAccount: string;
  sourceRecords: number;
  sourceTimestamp: string | null;
  calculationMethod: string;
  calculationVersion: string;
  freshnessStatus: "current" | "aging" | "stale" | "missing";
  confidenceLevel: "high" | "medium" | "low" | "unavailable";
  confidenceBasis: string[];
  limitations: string[];
  generatedAt: string;
};
type CommandCentre = {
  ready: boolean;
  source: {
    rowCount: number;
    verifiedDays: number;
    earliestBusinessDate: string | null;
    latestBusinessDate: string | null;
    freshness: string;
    ageDays?: number;
  };
  current: Totals | null;
  previous: Totals | null;
  comparisons: {
    netSalesRate: number | null;
    grossProfitRate: number | null;
    transactionRate: number | null;
    averageTransactionRate: number | null;
    marginPointChange: number | null;
  } | null;
  balances: {
    inventoryValueCents: number | null;
    cashBalanceCents: number | null;
    accountsPayableCents: number | null;
  } | null;
  metrics: Record<string, MetricProvenance>;
  trend: { date: string; netSalesCents: number; grossProfitCents: number | null; transactionCount?: number }[];
  periodComparisons: {
    sevenDays: PeriodComparison;
    thirtyDays: PeriodComparison;
  } | null;
  forecast?: {
    available: boolean;
    unavailableReason?: string;
    requiredDays: number;
    verifiedDays: number;
    totalNetSalesCents: number | null;
    lowCents: number | null;
    highCents: number | null;
    confidence: "medium" | "low" | "unavailable";
    method: string;
    points: Array<{ date: string; netSalesCents: number; grossProfitCents: number; observations: number }>;
  };
  insights: Insight[];
  dataQuality: {
    status: string;
    verifiedFields: number;
    missingDimensions: string[];
  };
  today: {
    businessDate: string;
    netSalesCents: number;
    grossProfitCents: number | null;
    averageTransactionCents: number | null;
    transactionCount: number;
    unitsSold: number;
    refundsCents: number;
    discountsCents: number;
    lastSaleAt: string | null;
    sourceGranularity: "intraday" | "daily";
    asOf?: string | null;
    timeZone?: string;
    hourlyUnavailableReason?: string | null;
    hourly: Array<{
      hour: number;
      label: string;
      netSalesCents: number;
      grossProfitCents: number | null;
      transactionCount: number;
    }>;
  };
  todayComparison: {
    basis?: "full_day" | "same_weekday_same_time";
    baselineDate: string;
    currentDate: string;
    baseline: { netSalesCents: number; grossProfitCents: number | null; transactionCount: number; hourly?: import("../domain/intraday-sales").SalesHour[] };
    changes: { netSalesRate: number | null; grossProfitRate: number | null; transactionRate: number | null };
  } | null;
  paymentMix: {
    period: string;
    sourceAvailable: boolean;
    rows: Array<{
      category: "cash" | "card" | "gift_card" | "store_credit" | "other";
      paymentTypeName: string;
      amountCents: number;
      transactionCount: number;
    }>;
  };
  liveSource: {
    provider: string | null;
    providers: string[];
    accountName: string | null;
    lastErrorCode: string | null;
    lastSuccessfulSyncAt: string | null;
    refreshIntervalSeconds: number | null;
  };
  operatingSystem: {
    status: "blocked" | "limited" | "operational";
    mode: string;
    preliminaryPurchasingCapacityCents: number | null;
    purchasingCapacityLabel: string;
    pillars: { id: string; label: string; state: string }[];
    decisions: {
      id: string;
      pillar: "sales" | "money" | "inventory" | "operations" | "data";
      priority: "critical" | "high" | "medium" | "low";
      score: number;
      title: string;
      decision: string;
      evidence: string[];
      missing: string[];
      confidence: "high" | "medium" | "low";
      approval: "owner_review" | "authorized_user";
      sourceRef: string;
    }[];
    guardrails: string[];
  };
};

type PaymentRange = 1 | 7 | 30;

type PeriodComparison = {
  days: number;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string;
  comparisonEnd: string;
  current: Totals;
  previous: Totals;
  changes: {
    netSalesRate: number | null;
    grossProfitRate: number | null;
    transactionRate: number | null;
    averageTransactionRate: number | null;
  };
  comparable: boolean;
  unavailableReason?: string | null;
};
type TaskSeed = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  expectedImpact?: string;
  sourceType?: "manual" | "insight" | "alert" | "decision";
  sourceRef?: string;
};

const money = (
  cents: number | null | undefined,
  currency = "CAD",
  digits = 0,
) =>
  cents === null || cents === undefined
    ? "Not connected"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency,
        maximumFractionDigits: digits,
      }).format(cents / 100);
const percent = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "No baseline"
    : new Intl.NumberFormat("en-CA", {
        style: "percent",
        maximumFractionDigits: 1,
        signDisplay: "exceptZero",
      }).format(value);

export default function VanteloqApp({
  organizationName,
  accountName,
}: {
  organizationName: string;
  accountName: string;
}) {
  const billingEntitlements = useBillingEntitlements();
  const subscriptionFeatures = billingEntitlements.features;
  const [view, setView] = useState<View>("Dashboard");
  const [workspaceName, setWorkspaceName] = useState(organizationName);
  const [logoVersion, setLogoVersion] = useState<number | null>(null);
  const [data, setData] = useState<CommandCentre | null>(null);
  const [currency, setCurrency] = useState("CAD");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [taskSeed, setTaskSeed] = useState<TaskSeed | null>(null);
  const [notice, setNotice] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [appRole, setAppRole] = useState("employee");
  const [appPermissions, setAppPermissions] = useState<string[]>([]);
  const [paymentRange, setPaymentRange] = useState<PaymentRange>(1);
  const [hiddenNavigation, setHiddenNavigation] = useState<View[]>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const preferenceStateRef = useRef<{ hiddenNavigation: View[]; activeLocationId: string | null }>({
    hiddenNavigation: [],
    activeLocationId: null,
  });
  const confirmedPreferenceRef = useRef<{ hiddenNavigation: View[]; activeLocationId: string | null }>({
    hiddenNavigation: [],
    activeLocationId: null,
  });
  const preferenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const preferenceWriteRef = useRef(0);
  const dashboardRequestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (silent && dashboardRequestRef.current) return;
    dashboardRequestRef.current?.abort();
    const request = new AbortController();
    dashboardRequestRef.current = request;
    if (!silent) { setLoading(true); setRefreshError(""); }
    try {
      const parameters = new URLSearchParams({ payment_days: String(paymentRange) });
      if (activeLocationId) parameters.set("location", activeLocationId);
      const response = await apiFetch(`/api/v1/command-centre?${parameters.toString()}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
      });
      const body = await response.json();
      if (request.signal.aborted || dashboardRequestRef.current !== request) return;
      if (!response.ok)
        throw new Error(
          body.error?.message ?? "Unable to load the command centre.",
        );
      setData({ ...body.commandCentre, operatingSystem: body.operatingSystem });
      setCurrency(body.organization.currency);
      setAppRole(body.organization.role ?? "employee");
      setAppPermissions(body.organization.permissions ?? []);
      setLocations(body.organization.locations ?? []);
      setWorkspaceName(body.organization.name || organizationName);
      setLogoVersion(
        body.organization.logoAvailable ? body.organization.logoVersion : null,
      );
      setError("");
      setRefreshError("");
    } catch (caught) {
      if (request.signal.aborted || dashboardRequestRef.current !== request) return;
      const reportError = silent ? setRefreshError : setError;
      reportError(
        caught instanceof Error
          ? caught.message
          : "Unable to load the command centre.",
      );
    } finally {
      if (dashboardRequestRef.current === request) {
        dashboardRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [activeLocationId, organizationName, paymentRange]);
  // A same-workspace mutation refresh must preserve the active form or sync
  // reconciliation panel. Scope changes still use the full loading boundary.
  const refreshWorkspace = useCallback(() => refresh(true), [refresh]);
  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/v1/preferences", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Workspace preferences could not be loaded.");
        if (cancelled) return;
        const nextHidden = normalizeHiddenNavigation(body.hiddenNavigation ?? [], allNavigationViews, protectedNavigation);
        const nextLocationId = body.preferredLocationId ?? null;
        if (Array.isArray(body.locations)) setLocations(body.locations);
        if (preferenceWriteRef.current > 0) return;
        const next = { hiddenNavigation: nextHidden, activeLocationId: nextLocationId };
        preferenceStateRef.current = next;
        confirmedPreferenceRef.current = next;
        setHiddenNavigation(nextHidden);
        setActiveLocationId(nextLocationId);
      })
      .catch(() => {
        if (!cancelled && preferenceWriteRef.current === 0) setHiddenNavigation([]);
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      dashboardRequestRef.current?.abort();
      dashboardRequestRef.current = null;
    };
  }, [refresh]);
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const timer = window.setInterval(refreshVisible, 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const integration = parameters.get("integration");
    if (integration !== "lightspeed" && integration !== "lightspeed-r" && integration !== "shopify" && integration !== "shopify-pos" && integration !== "square" && integration !== "clover" && integration !== "stripe" && integration !== "plaid" && integration !== "google" && integration !== "meta" && integration !== "quickbooks") return;
    const timer = window.setTimeout(() => {
      const destination: View = integration === "plaid"
        && parameters.has("oauth_state_id")
        && sessionStorage.getItem(PLAID_RETURN_VIEW_STORAGE_KEY) === "BookLoQ"
        ? "BookLoQ"
        : "Integrations";
      const destinationEntitlement = navigationEntitlement(destination, subscriptionFeatures);
      if (!destinationEntitlement.allowed) {
        setNotice(`${destinationEntitlement.upgradeLabel ?? "A paid plan"} is required to manage this connection.`);
        return;
      }
      setView(destination);
      const state = parameters.get("connection");
      if (integration === "clover" && !state && parameters.get("action") === "connect") {
        setNotice("Open the Clover card and select Connect to authorize your merchant account.");
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }
      if (integration === "quickbooks") {
        setNotice(state === "connected"
          ? "QuickBooks company verified. Accounting import is not available yet."
          : state === "declined"
            ? "QuickBooks authorization was declined."
            : parameters.get("action") === "disconnect"
              ? "Open the QuickBooks card and select Disconnect to revoke its access."
              : state
                ? "QuickBooks authorization needs to be restarted. Open its connection card to continue."
                : "Open the QuickBooks card to connect or reconnect your company.");
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }
      if (integration === "plaid") {
        if (parameters.has("oauth_state_id")) {
          sessionStorage.setItem(PLAID_REDIRECT_STORAGE_KEY, window.location.href);
          setNotice(destination === "BookLoQ" ? "Finish the secure bank connection in BookLoQ" : "Finish the secure bank connection in Plaid Link");
        } else {
          setNotice("Open the Plaid card to continue the bank connection");
        }
        return;
      }
      if (integration === "google" || integration === "meta") {
        const name = integration === "google" ? "Google" : "Meta";
        setNotice(state === "connected" ? `${name} is connected. Sync it to update Marketing.` : state === "declined" ? `${name} authorization was declined.` : `${name} authorization needs to be restarted.`);
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }
      setNotice(
        state === "connected"
          ? integration === "lightspeed-r"
            ? "Lightspeed R-Series is connected. Review its shops, then start a sync from Connections."
            : integration === "shopify"
              ? "Shopify e-commerce is connected. Review its Online Store mapping, then start a sync from Connections."
            : integration === "shopify-pos"
              ? "Shopify POS is connected. Review its retail locations, then start a sync from Connections."
            : integration === "clover"
              ? "Clover is connected. Review its merchant location, then start a sync from Connections."
            : integration === "square"
              ? "Square is connected. Review its locations, then start a sync from Connections."
            : integration === "stripe"
              ? "Stripe is connected."
            : "Lightspeed X-Series is connected."
        : state === "declined"
          ? `${integration === "stripe" ? "Stripe" : integration === "lightspeed-r" ? "R-Series" : integration === "shopify" ? "Shopify e-commerce" : integration === "shopify-pos" ? "Shopify POS" : integration === "clover" ? "Clover" : integration === "square" ? "Square" : "X-Series"} authorization was declined`
          : `${integration === "stripe" ? "Stripe" : integration === "lightspeed-r" ? "R-Series" : integration === "shopify" ? "Shopify e-commerce" : integration === "shopify-pos" ? "Shopify POS" : integration === "clover" ? "Clover" : integration === "square" ? "Square" : "X-Series"} authorization needs to be restarted`,
      );
      window.history.replaceState({}, "", window.location.pathname);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [subscriptionFeatures]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setMobileNavOpen(false);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  };
  const navigate = (next: View) => {
    const subscriptionAccess = navigationEntitlement(next, subscriptionFeatures);
    if (!subscriptionAccess.allowed) {
      showNotice(subscriptionAccess.upgradeLabel === "BookLoQ add-on"
        ? "Add BookLoQ to open this workspace."
        : `${subscriptionAccess.upgradeLabel ?? "A different plan"} is required to open this workspace.`);
      return;
    }
    const requiredPermission = viewPermission[next];
    if (
      requiredPermission &&
      !appPermissions.includes(requiredPermission)
    ) {
      showNotice("Your role does not have access to this workspace.");
      return;
    }
    setView(next);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    if (navigationEntitlement(view, subscriptionFeatures).allowed) return;
    const timer = window.setTimeout(() => {
      setView("Dashboard");
      setMobileNavOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [subscriptionFeatures, view]);
  const savePreferences = (patch: Partial<{ hiddenNavigation: View[]; activeLocationId: string | null }>) => {
    const current = preferenceStateRef.current;
    const next = {
      hiddenNavigation: normalizeHiddenNavigation(
        patch.hiddenNavigation ?? current.hiddenNavigation,
        allNavigationViews,
        protectedNavigation,
      ),
      activeLocationId: Object.prototype.hasOwnProperty.call(patch, "activeLocationId")
        ? patch.activeLocationId ?? null
        : current.activeLocationId,
    };
    const revision = ++preferenceWriteRef.current;
    preferenceStateRef.current = next;
    setHiddenNavigation(next.hiddenNavigation);
    setActiveLocationId(next.activeLocationId);
    const operation = preferenceQueueRef.current.then(async () => {
      const response = await apiFetch("/api/v1/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiddenNavigation: next.hiddenNavigation, preferredLocationId: next.activeLocationId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Workspace preferences could not be saved.");
      confirmedPreferenceRef.current = next;
      if (preferenceWriteRef.current === revision) {
        preferenceStateRef.current = next;
        setHiddenNavigation(next.hiddenNavigation);
        setActiveLocationId(next.activeLocationId);
      }
    }).catch((caught) => {
      if (preferenceWriteRef.current === revision) {
        const confirmed = confirmedPreferenceRef.current;
        preferenceStateRef.current = confirmed;
        setHiddenNavigation(confirmed.hiddenNavigation);
        setActiveLocationId(confirmed.activeLocationId);
      }
      throw caught;
    });
    preferenceQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  };
  return (
    <main className="app-shell operating-shell">
      <aside
        id="primary-sidebar"
        className={mobileNavOpen ? "sidebar mobile-open" : "sidebar"}
      >
        <button
          className="sidebar-close"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        >
          Close
        </button>
        <button className="brand" onClick={() => navigate("Dashboard")}>
          <ProductBrandLogo product="vanteloq" />
          <span className="brand-name">
            Vanteloq<small>OPERATING INTELLIGENCE</small>
          </span>
        </button>
        <div className="workspace-switcher">
          <span className="workspace-avatar">
            {logoVersion !== null ? (
              <Image
                src={`/api/v1/organization-logo?v=${logoVersion}`}
                alt={`${workspaceName} logo`}
                width={40}
                height={40}
                unoptimized
              />
            ) : (
              workspaceName.slice(0, 2).toUpperCase()
            )}
          </span>
          <span>
            <b>{workspaceName}</b>
            <small>
              {loading ? "Loading your records…" : error ? "Records unavailable" : data?.source.latestBusinessDate
                ? `Data through ${formatBusinessDate(data.source.latestBusinessDate)}`
                : "Data source required"}
            </small>
          </span>
          <label className="location-switcher">
            <span className="sr-only">Dashboard location</span>
            <select
              value={activeLocationId ?? ""}
              onChange={(event) => {
                const next = event.target.value || null;
                void savePreferences({ activeLocationId: next }).catch((caught) => showNotice(caught instanceof Error ? caught.message : "Location preference could not be saved."));
              }}
            >
              <option value="">{appRole === "owner" || appRole === "admin" ? "All locations" : "All accessible locations"}</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
        </div>
        <div className="subscription-summary" aria-label="Current subscription">
          <span>{billingEntitlements.accessType === "internal" ? "Internal access" : `${billingEntitlements.plan ? humanizeIdentifier(billingEntitlements.plan) : "Paid"} plan`}</span>
          {billingEntitlements.addons.includes("bookloq") && <small>BookLoQ active</small>}
        </div>
        <nav aria-label="Primary navigation">
          {nav
            .map(
              ([group, items]) =>
                [
                  group,
                  items.filter(
                    (item) =>
                      !hiddenNavigation.includes(item) &&
                      (!viewPermission[item] || appPermissions.includes(viewPermission[item]!)),
                  ),
                ] as [string, View[]],
            )
            .filter(([, items]) => items.length)
            .map(([group, items]) => (
              <section className="nav-group" key={group}>
                <p>{group}</p>
                {items.map((item) => {
                  const subscriptionAccess = navigationEntitlement(item, subscriptionFeatures);
                  return <button
                    key={item}
                    className={`${view === item || (item === "BookLoQ" && (view === "Profit" || view === "Cash" || view === "Bookkeeping")) ? "nav-item active" : "nav-item"}${item === "BookLoQ" ? " bookloq-main-nav" : ""}${subscriptionAccess.allowed ? "" : " subscription-locked"}`}
                    onClick={() => navigate(item)}
                    aria-current={view === item || (item === "BookLoQ" && (view === "Profit" || view === "Cash" || view === "Bookkeeping")) ? "page" : undefined}
                    title={subscriptionAccess.allowed ? undefined : `${subscriptionAccess.upgradeLabel} required`}
                  >
                    {item === "BookLoQ" ? (
                      <ProductBrandLogo
                        product="bookloq"
                        variant="full"
                        className="bookloq-nav-lockup"
                      />
                    ) : <><WorkspaceIcon name={item}/><span className="nav-label">{workspaceViewLabel(item)}</span></>}
                    {!subscriptionAccess.allowed && <small className="nav-plan-lock">{subscriptionAccess.upgradeLabel}</small>}
                  </button>
                })}
              </section>
            ))}
        </nav>
        <div className="side-bottom">
          {appPermissions.includes("integrations.view") && !hiddenNavigation.includes("Integrations") && (
            <button
              className={
                `${view === "Integrations" ? "nav-item active" : "nav-item"}${navigationEntitlement("Integrations", subscriptionFeatures).allowed ? "" : " subscription-locked"}`
              }
              onClick={() => navigate("Integrations")}
              aria-current={view === "Integrations" ? "page" : undefined}
            >
              <WorkspaceIcon name="Integrations" />
              Integrations & data
              {!navigationEntitlement("Integrations", subscriptionFeatures).allowed && <small className="nav-plan-lock">{navigationEntitlement("Integrations", subscriptionFeatures).upgradeLabel}</small>}
            </button>
          )}
          {appPermissions.includes("organization.settings") && (
            <button
              className={`${view === "Settings" ? "nav-item active" : "nav-item"}${navigationEntitlement("Settings", subscriptionFeatures).allowed ? "" : " subscription-locked"}`}
              onClick={() => navigate("Settings")}
              aria-current={view === "Settings" ? "page" : undefined}
            >
              <WorkspaceIcon name="Settings" />
              Settings
              {!navigationEntitlement("Settings", subscriptionFeatures).allowed && <small className="nav-plan-lock">{navigationEntitlement("Settings", subscriptionFeatures).upgradeLabel}</small>}
            </button>
          )}
          <div className="profile">
            <span className="avatar">
              {accountName
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span>
              <b>{accountName}</b>
              <small>{humanizeIdentifier(appRole)}</small>
            </span>
            <button className="profile-signout" aria-label="Sign out" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      {mobileNavOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <section className="main-panel">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileNavOpen}
            aria-controls="primary-sidebar"
            onClick={() => setMobileNavOpen((value) => !value)}
          >
            <WorkspaceIcon name="Menu" />
          </button>
          <div className="topbar-title">
            <p className="eyebrow">
              {view === "Dashboard" ? "OWNER COMMAND CENTRE" : view === "BookLoQ" || view === "Profit" || view === "Cash" || view === "Bookkeeping" ? "BOOKLOQ FINANCE" : "VANTELOQ WORKSPACE"}
            </p>
            <h1>{view === "Dashboard" ? "Dashboard" : view === "Profit" ? "BookLoQ · Reports" : view === "Cash" ? "BookLoQ · Cash Flow" : view === "Bookkeeping" ? "BookLoQ · Transactions" : workspaceViewLabel(view)}</h1>
          </div>
          <div className="top-actions">
            <button className="command-trigger" onClick={() => setCommandOpen(true)} aria-label="Open workspace search"><WorkspaceIcon name="Search"/><span>Search workspace</span><kbd>⌘K</kbd></button>
            <span
              className={`source-pill ${loading || error ? "pending" : data?.liveSource.lastSuccessfulSyncAt ? "current" : data?.source.freshness ?? "missing"}`}
              aria-busy={loading}
            >
              {loading ? "Loading records…" : error ? "Records unavailable" : data?.liveSource.lastSuccessfulSyncAt
                ? "Connected sales"
                : data?.source.latestBusinessDate
                ? `${humanizeIdentifier(data.source.freshness)} data`
                : "No data"}
            </span>
            <button
              className="icon-button notification"
              aria-label="Open alerts"
              onClick={() => setNotificationsOpen((value) => !value)}
            >
              <WorkspaceIcon name="Alerts"/><span aria-hidden="true">Alerts</span>
            </button>
            <button
              className="primary"
              onClick={() =>
                setTaskSeed({
                  title: "",
                  detail: "",
                  priority: "medium",
                  sourceType: "manual",
                })
              }
            >
              + Quick action
            </button>
          </div>
        </header>
        {refreshError && <div className="form-error" role="alert">
          <p>Updates could not be loaded. Your open work is still here.</p>
          <button className="secondary" onClick={() => void refresh(true)}>Retry refresh</button>
        </div>}
        {loading ? (
          <LoadingState />
        ) : error ? (
          <FailureState message={error} retry={refresh} />
        ) : (
          <Workspace
            view={view}
            data={data!}
            permissions={appPermissions}
            subscriptionFeatures={subscriptionFeatures}
            currency={currency}
            navigate={navigate}
            refresh={refreshWorkspace}
            showNotice={showNotice}
            createTask={(seed) => setTaskSeed(seed)}
            organizationName={workspaceName}
            accountName={accountName}
            onBrandChange={(name, version) => {
              setWorkspaceName(name);
              setLogoVersion(version);
            }}
            paymentRange={paymentRange}
            setPaymentRange={setPaymentRange}
            activeLocationId={activeLocationId}
            selectLocation={(locationId) => {
              void savePreferences({ activeLocationId: locationId }).catch((caught) => showNotice(caught instanceof Error ? caught.message : "Location preference could not be saved."));
            }}
            navigationSettings={
              <NavigationSettingsPanel
                hidden={hiddenNavigation}
                permissions={appPermissions}
                update={(item, visible) => {
                  const next = setNavigationVisibility(preferenceStateRef.current.hiddenNavigation, item, visible, allNavigationViews, protectedNavigation);
                  void savePreferences({ hiddenNavigation: next })
                    .then(() => showNotice(visible ? `${item} restored to the sidebar` : `${item} hidden from the sidebar`))
                    .catch((caught) => showNotice(caught instanceof Error ? caught.message : "Navigation preference could not be saved."));
                }}
                restoreAll={() => void savePreferences({ hiddenNavigation: [] })
                  .then(() => showNotice("All available workspaces restored"))
                  .catch((caught) => showNotice(caught instanceof Error ? caught.message : "Navigation preference could not be saved."))}
              />
            }
          />
        )}
      </section>
      {taskSeed && (
        <TaskComposer
          seed={taskSeed}
          close={() => setTaskSeed(null)}
          saved={() => {
            setTaskSeed(null);
            navigate("Action Centre");
            showNotice("Action assigned and linked to its source");
          }}
        />
      )}
      {notificationsOpen && (
        <AlertDrawer
          data={data}
          close={() => setNotificationsOpen(false)}
          open={(seed) => {
            setNotificationsOpen(false);
            setTaskSeed(seed);
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {commandOpen && <GlobalCommand permissions={appPermissions} navigate={(next) => { setCommandOpen(false); navigate(next); }} close={() => setCommandOpen(false)} />}
    </main>
  );
}

function GlobalCommand({ permissions, navigate, close }: { permissions: string[]; navigate: (view: View) => void; close: () => void }) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => ([...nav.flatMap(([, items]) => items), "Integrations", "Settings"] as View[])
    .filter((item, index, list) => list.indexOf(item) === index)
    .filter((item) => !viewPermission[item] || permissions.includes(viewPermission[item]!))
    .filter((item) => !query || `${item} ${workspaceViewLabel(item)}`.toLowerCase().includes(query.toLowerCase())), [permissions, query]);
  return <div className="modal-backdrop command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="command-modal" role="dialog" aria-modal="true" aria-label="Workspace search"><div className="command-input"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Go to a workspace…"/><button onClick={close}>ESC</button></div><div className="command-results"><small>WORKSPACES</small>{options.map((option) => <button key={option} onClick={() => navigate(option)}><span>↳</span><span>{workspaceViewLabel(option)}</span><b>→</b></button>)}{!options.length && <p>No matching workspace.</p>}</div></section></div>;
}

function NavigationSettingsPanel({
  hidden,
  permissions,
  update,
  restoreAll,
}: {
  hidden: View[];
  permissions: string[];
  update: (item: View, visible: boolean) => void;
  restoreAll: () => void;
}) {
  const sections: [string, View[]][] = [
    ...nav,
    ["Workspace controls", ["Integrations", "Settings"]],
  ];
  return (
    <section className="navigation-settings-panel" aria-labelledby="navigation-settings-title">
      <header>
        <div>
          <p>SIDEBAR</p>
          <h2 id="navigation-settings-title">Choose the workspaces shown in your sidebar.</h2>
          <span>Hiding a workspace changes only your sidebar. It never deletes records, changes access, or affects another account.</span>
        </div>
        <button onClick={restoreAll}>Restore all</button>
      </header>
      <div className="navigation-settings-list">
          {sections.map(([group, items]) => {
            const available = items.filter((item) => !viewPermission[item] || permissions.includes(viewPermission[item]!));
            if (!available.length) return null;
            return <section key={group}>
              <h3>{group}</h3>
              {available.map((item) => {
                const isHidden = hidden.includes(item);
                const protectedItem = protectedNavigation.includes(item);
                const guide = navigationGuide[item];
                return <article key={item} className={isHidden ? "is-hidden" : ""}>
                  <div>
                    <strong>{item}</strong>
                    <p>{guide.outcome}</p>
                    <small><b>Data used:</b> {guide.data}</small>
                  </div>
                  <button
                    onClick={() => update(item, isHidden)}
                    disabled={protectedItem}
                    title={protectedItem ? `${item} stays available so navigation can always be recovered.` : isHidden ? `Restore ${item} to the sidebar.` : `Hide ${item} from your sidebar.`}
                  >
                    {protectedItem ? "Always shown" : isHidden ? "Restore" : "Hide"}
                  </button>
                </article>;
              })}
            </section>;
          })}
      </div>
    </section>
  );
}

function Workspace({
  view,
  data,
  permissions,
  subscriptionFeatures,
  currency,
  navigate,
  refresh,
  showNotice,
  createTask,
  organizationName,
  accountName,
  onBrandChange,
  paymentRange,
  setPaymentRange,
  activeLocationId,
  selectLocation,
  navigationSettings,
}: {
  view: View;
  data: CommandCentre;
  permissions: string[];
  subscriptionFeatures: readonly string[];
  currency: string;
  navigate: (view: View) => void;
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
  createTask: (seed: TaskSeed) => void;
  organizationName: string;
  accountName: string;
  onBrandChange: (name: string, logoVersion: number | null) => void;
  paymentRange: PaymentRange;
  setPaymentRange: (range: PaymentRange) => void;
  activeLocationId: string | null;
  selectLocation: (locationId: string | null) => void;
  navigationSettings: React.ReactNode;
}) {
  const [reportSeed, setReportSeed] = useState<{ from: string; to: string; locationId: string | null } | null>(null);
  const [intelligenceTab, setIntelligenceTab] = useState<"opportunities" | "retail">("opportunities");
  const [retailAdvisorSeed, setRetailAdvisorSeed] = useState<RetailAdvisorSeed | null>(null);
  const askRetailAdvisor = (seed: RetailAdvisorSeed) => { setRetailAdvisorSeed(seed); navigate("Advisor"); };
  useEffect(() => { if (view === "Advisor" && retailAdvisorSeed) queueMicrotask(() => setRetailAdvisorSeed(null)); }, [view, retailAdvisorSeed]);
  if (view === "Dashboard")
    return (
      <Overview
        data={data}
        currency={currency}
        navigate={navigate}
        createTask={createTask}
        paymentRange={paymentRange}
        setPaymentRange={setPaymentRange}
      />
    );
  if (view === "Intelligence")
    return (
      <><nav className="intelligence-switch" aria-label="Intelligence views"><button type="button" aria-pressed={intelligenceTab === "opportunities"} onClick={() => setIntelligenceTab("opportunities")}>Opportunities</button><button type="button" aria-pressed={intelligenceTab === "retail"} onClick={() => setIntelligenceTab("retail")}>Retail analysis</button></nav>
        {intelligenceTab === "retail" ? <CommerceIntelligenceWorkspace key={activeLocationId ?? "all"} mode="Sales" currency={currency} timeZone={data.today.timeZone} activeLocationId={activeLocationId} navigate={navigate} createTask={createTask} onAsk={askRetailAdvisor}/> : <Intelligence
          data={data} navigate={navigate} createTask={createTask} activeLocationId={activeLocationId} onAsk={askRetailAdvisor}
          key={activeLocationId ?? "all"}
          onEvidence={savedPeriod => { const period = data.periodComparisons?.thirtyDays; setReportSeed(savedPeriod ? { ...savedPeriod, locationId: activeLocationId } : period ? { from: period.periodStart, to: period.periodEnd, locationId: activeLocationId } : null); navigate("Reports"); }}
          canCreate={permissions.includes("insights.create_task")} canAsk={subscriptionFeatures.includes("ai.basic") && permissions.includes("insights.view")}
        />}</>
    );
  if (view === "Action Centre")
    return (
      <TaskCentre
        showNotice={showNotice}
        navigate={navigate}
        openComposer={() =>
          createTask({
            title: "",
            detail: "",
            priority: "medium",
            sourceType: "manual",
          })
        }
      />
    );
  if (view === "BookLoQ" || view === "Profit" || view === "Cash" || view === "Bookkeeping") {
    const initialSection = view === "Profit" ? "Reports" : view === "Cash" ? "Cash Flow" : view === "Bookkeeping" ? "Transactions" : "Overview";
    return <BookLoQWorkspace key={initialSection} initialSection={initialSection} createTask={createTask} showNotice={showNotice} navigate={navigate} activeLocationId={activeLocationId} />;
  }
  if (view === "Communications") return <CommunicationsWorkspace activeLocationId={activeLocationId} />;
  if (view === "Marketing")
    return <GrowthWorkspace key={activeLocationId ?? "organization"} currency={currency} navigate={navigate} activeLocationId={activeLocationId} canOptimize={subscriptionFeatures.includes("marketing.optimization")} />;
  if (view === "Integrations")
    return <DataHub refresh={refresh} showNotice={showNotice} navigate={navigate} subscriptionFeatures={subscriptionFeatures} />;
  if (view === "Decision Journal")
    return <DecisionJournal currency={currency} showNotice={showNotice} />;
  if (view === "Scenario Planner")
    return <ScenarioPlanner source={data.current} currency={currency} />;
  if (view === "Business Brief")
    return (
      <BusinessBrief
        data={data}
        currency={currency}
        navigate={navigate}
        createTask={createTask}
      />
    );
  if (view === "Advisor")
    return <Advisor key={activeLocationId ?? "organization"} data={data} navigate={navigate} createTask={createTask} activeLocationId={activeLocationId} retailSeed={retailAdvisorSeed?.locationId === activeLocationId ? retailAdvisorSeed : null} />;
  if (view === "Reports")
    return (
      <ReportsWorkspace
        key={activeLocationId ?? "all"}
        initialPeriod={reportSeed?.locationId === activeLocationId ? reportSeed : undefined}
        currency={currency}
        showNotice={showNotice}
        createTask={createTask}
        activeLocationId={activeLocationId}
        canExportFeature={subscriptionFeatures.includes("reporting.exports")}
        onOpenRetail={() => { setIntelligenceTab("retail"); navigate("Intelligence"); }}
      />
    );
  if (view === "Sales" || view === "Inventory" || view === "Customers" || view === "Suppliers")
    return <CommerceIntelligenceWorkspace key={view + activeLocationId} mode={view} currency={currency} timeZone={data.today.timeZone} activeLocationId={activeLocationId} navigate={navigate} createTask={createTask} onAsk={askRetailAdvisor} />;
  if (view === "Purchase Orders")
    return (
      <PurchaseOrdersWorkspace
        currency={currency}
        showNotice={showNotice}
        createTask={createTask}
        activeLocationId={activeLocationId}
      />
    );
  if (view === "Locations")
    return <LocationsWorkspace currency={currency} activeLocationId={activeLocationId} selectLocation={selectLocation} navigate={navigate} />;
  if (view === "Documents")
    return (
      <DocumentsWorkspace
        currency={currency}
        showNotice={showNotice}
        createTask={createTask}
        canUpload={permissions.includes("documents.upload")}
        canDelete={permissions.includes("documents.retention")}
      />
    );
  if (view === "Data Quality")
    return (
      <DataQualityWorkspace
        currency={currency}
        showNotice={showNotice}
        createTask={createTask}
        activeLocationId={activeLocationId}
      />
    );
  if (view === "Team")
    return (
      <TeamWorkspace
        showNotice={showNotice}
        organizationName={organizationName}
        accountName={accountName}
        permissions={permissions}
      />
    );
  if (view === "Settings")
    return (
      <SettingsWorkspace
        showNotice={showNotice}
        organizationName={organizationName}
        accountName={accountName}
        onBrandChange={onBrandChange}
        navigationSettings={navigationSettings}
      />
    );
  return (
    <ModuleWorkspace
      name={view}
      definition={moduleDefinitions[view]}
      data={data}
      currency={currency}
      navigate={navigate}
      createTask={createTask}
    />
  );
}

function formatTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value.slice(11, 16)
    : new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(parsed);
}

function formatRelativeSync(value: string) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes === 1) return "1 minute ago";
  if (elapsedMinutes < 60) return `${elapsedMinutes} minutes ago`;
  if (elapsedMinutes >= 1440) return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  return new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatBusinessDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function PaymentMixCard({ data, currency, paymentRange, setPaymentRange }: { data: CommandCentre["paymentMix"]; currency: string; paymentRange: PaymentRange; setPaymentRange: (range: PaymentRange) => void }) {
  const categories = data.rows.reduce((map, row) => {
    const current = map.get(row.category) ?? { category: row.category, amountCents: 0, transactionCount: 0 };
    current.amountCents += Number(row.amountCents);
    current.transactionCount += Number(row.transactionCount);
    map.set(row.category, current);
    return map;
  }, new Map<string, { category: string; amountCents: number; transactionCount: number }>());
  const rows = [...categories.values()].sort((left, right) => right.amountCents - left.amountCents);
  const total = rows.reduce((sum, row) => sum + row.amountCents, 0);
  const labels: Record<string, string> = { card: "Card", cash: "Cash", gift_card: "Gift card", store_credit: "Store credit", other: "Other" };
  return (
    <article className="card commerce-intel-card payment-mix-card">
      <header><div><p className="card-kicker">PAYMENT MIX</p><h3>Cash vs card</h3></div><label className="payment-range"><span>Time frame</span><select aria-label="Payment mix time frame" value={paymentRange} onChange={(event) => setPaymentRange(Number(event.target.value) as PaymentRange)}><option value={1}>Latest verified day</option><option value={7}>7 days to latest</option><option value={30}>30 days to latest</option></select></label></header>
      <p className="payment-period">{data.period}</p>
      {data.sourceAvailable && total > 0 ? <>
        <div className="payment-stack" aria-label={`Payment mix totaling ${money(total, currency)}`}>
          {rows.map((row) => <i key={row.category} className={`payment-${row.category}`} style={{ width: `${Math.max(2, row.amountCents / total * 100)}%` }} />)}
        </div>
        <dl className="payment-breakdown">
          {rows.map((row) => <div key={row.category}><dt><i className={`payment-${row.category}`} />{labels[row.category] || row.category}</dt><dd><b>{money(row.amountCents, currency)}</b><span>{new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 }).format(row.amountCents / total)}</span></dd></div>)}
        </dl>
      </> : <div className="intel-empty"><b>Payment types are still backfilling</b><span>Cash, card and other tenders will appear only after R-Series returns verified SalePayment records.</span></div>}
    </article>
  );
}

function CommerceIntelligenceRail({ data, currency, paymentRange, setPaymentRange }: { data: CommandCentre; currency: string; paymentRange: PaymentRange; setPaymentRange: (range: PaymentRange) => void }) {
  const awaitingRecords = isAwaitingSalesRecords(data.today);
  const comparisons: Array<{ label: string; period: string; value: string; rate: number | null }> = [
    { label: "Latest day vs same weekday", period: data.todayComparison ? formatBusinessDate(data.todayComparison.baselineDate) : "Baseline unavailable", value: awaitingRecords ? "Awaiting records" : money(data.today.netSalesCents, currency), rate: awaitingRecords ? null : data.todayComparison?.changes.netSalesRate ?? null },
  ];
  if (data.periodComparisons) {
    comparisons.push(
      { label: "Last 7 days", period: `${formatBusinessDate(data.periodComparisons.sevenDays.periodStart)} to ${formatBusinessDate(data.periodComparisons.sevenDays.periodEnd)}`, value: money(data.periodComparisons.sevenDays.current.netSalesCents, currency), rate: data.periodComparisons.sevenDays.comparable ? data.periodComparisons.sevenDays.changes.netSalesRate : null },
      { label: "Last 30 days", period: `${formatBusinessDate(data.periodComparisons.thirtyDays.periodStart)} to ${formatBusinessDate(data.periodComparisons.thirtyDays.periodEnd)}`, value: money(data.periodComparisons.thirtyDays.current.netSalesCents, currency), rate: data.periodComparisons.thirtyDays.comparable ? data.periodComparisons.thirtyDays.changes.netSalesRate : null },
    );
  } else {
    comparisons.push(
      { label: "Last 7 days", period: "No verified period", value: "Not available", rate: null },
      { label: "Last 30 days", period: "No verified period", value: "Not available", rate: null },
    );
  }
  const forecast = data.forecast ?? {
    available: false,
    requiredDays: 28,
    verifiedDays: data.source.verifiedDays,
    totalNetSalesCents: null,
    lowCents: null,
    highCents: null,
    confidence: "unavailable" as const,
    method: "Same-weekday weighted average",
    points: [],
  };
  return (
    <>
      <section className="sales-comparison-grid" aria-label="Matched sales comparisons">
        {comparisons.map((item) => <article key={item.label}><p>{item.label}</p><strong>{item.value}</strong><span className={item.rate == null ? "neutral" : item.rate >= 0 ? "positive" : "negative"}>{comparisonCopy(item.rate, item.label === "Latest day vs same weekday" ? item.period : "prior matched period")}</span><small>{item.period}</small></article>)}
      </section>
      <section className="commerce-intel-grid">
        <PaymentMixCard data={data.paymentMix} currency={currency} paymentRange={paymentRange} setPaymentRange={setPaymentRange} />
        <article className="card commerce-intel-card forecast-card">
          <header><div><p className="card-kicker">7-DAY OUTLOOK</p><h3>Expected net sales</h3></div><span>{forecast.confidence === "unavailable" ? "Not ready" : `${forecast.confidence} confidence`}</span></header>
          {forecast.available ? <>
            <strong>{money(forecast.lowCents, currency)} to {money(forecast.highCents, currency)}</strong>
            <p>Central estimate {money(forecast.totalNetSalesCents, currency)}</p>
            <div className="forecast-bars" aria-label="Seven-day sales forecast">
              {forecast.points.map((point) => <i key={point.date} style={{ height: `${Math.max(12, point.netSalesCents / Math.max(...forecast.points.map((item) => item.netSalesCents), 1) * 100)}%` }} title={`${formatBusinessDate(point.date)}: ${money(point.netSalesCents, currency)}`} />)}
            </div>
            <small>{forecast.method}</small>
          </> : <div className="intel-empty"><b>{forecast.unavailableReason ? "Recent sales required" : `${Math.max(0, forecast.requiredDays - forecast.verifiedDays)} more verified days needed`}</b><span>{forecast.unavailableReason ?? `Vanteloq will not forecast until at least ${forecast.requiredDays} distinct sales days are available.`}</span></div>}
        </article>
      </section>
    </>
  );
}

function LiveSalesPanel({ data, currency, paymentRange, setPaymentRange, compact = false }: { data: CommandCentre; currency: string; paymentRange: PaymentRange; setPaymentRange: (range: PaymentRange) => void; compact?: boolean }) {
  const today = data.today;
  const intraday = today.sourceGranularity === "intraday";
  const awaitingRecords = isAwaitingSalesRecords(today);
  const matched = data.todayComparison?.basis === "same_weekday_same_time";
  const baselineLabel = data.todayComparison ? `${formatBusinessDate(data.todayComparison.baselineDate)}${matched ? " at the same time" : ""}` : "same weekday";
  const sourceName = data.liveSource.accountName || (data.liveSource.provider ? providerLabel(data.liveSource.provider) : "connected source");
  return (
    <>
      <section className="today-metric-grid">
        <Metric label={intraday ? "Net sales today" : "Latest daily net sales"} value={awaitingRecords ? "Awaiting records" : money(today.netSalesCents, currency)} delta={awaitingRecords ? "No current-day records received" : comparisonCopy(data.todayComparison?.changes.netSalesRate, baselineLabel)} detail={`${formatBusinessDate(today.businessDate)} · excludes sales tax`} tone="indigo" />
        <Metric label={intraday ? "Gross profit today" : "Latest daily gross profit"} value={awaitingRecords ? "Not available" : today.grossProfitCents == null ? "Not available" : money(today.grossProfitCents, currency)} delta={awaitingRecords ? "Sales records required" : comparisonCopy(data.todayComparison?.changes.grossProfitRate, baselineLabel)} detail={today.grossProfitCents == null ? "Verified product costs required" : "Net sales less product cost"} tone="emerald" />
        <Metric label="Gross margin" value={today.netSalesCents > 0 && today.grossProfitCents != null ? `${(today.grossProfitCents / today.netSalesCents * 100).toFixed(1)}%` : "Not available"} delta="Product economics" detail="Gross profit ÷ positive net sales" tone="emerald" />
        <Metric label="Discounts" value={awaitingRecords ? "Not available" : money(today.discountsCents, currency)} delta={awaitingRecords ? "Sales records required" : today.netSalesCents + today.discountsCents ? `${(today.discountsCents / (today.netSalesCents + today.discountsCents) * 100).toFixed(1)}% of pre-discount value` : "No discount activity"} detail="Verified line and sale discounts" tone="amber" />
        <Metric label="Average transaction" value={today.averageTransactionCents == null ? "Not available" : money(today.averageTransactionCents, currency, 2)} delta={intraday ? "Today's basket value" : "Latest daily basket value"} detail="Net sales ÷ completed transactions" tone="amber" />
        <Metric label="Number of sales" value={awaitingRecords ? "Awaiting records" : today.transactionCount == null ? "Not available" : today.transactionCount.toLocaleString()} delta={awaitingRecords ? "No completed sales received" : comparisonCopy(data.todayComparison?.changes.transactionRate, baselineLabel)} detail={today.unitsSold == null ? "Revenue permission required" : `${quantityLabel(today.unitsSold, "line item")} recorded`} tone="cyan" />
      </section>
      <section className={compact ? "live-sales-grid compact" : "live-sales-grid"}>
        <article className="card live-sales-chart-card">
          <div className="card-head">
            <div><p className="card-kicker">{intraday ? "TODAY'S SALES PULSE" : "LATEST VERIFIED DAY"}</p><h3>Sales by hour</h3></div>
            <span className="verified-tag">{sourceName} · approved records</span>
          </div>
          {awaitingRecords ? <div className="intel-empty"><b>Waiting for today’s records</b><span>No approved transactions have been received for this business day. This does not confirm that the business made no sales.</span></div> : today.sourceGranularity === "intraday"
            ? <IntradaySalesChart data={today.hourly} currency={currency} comparison={matched ? data.todayComparison?.baseline.hourly : undefined} comparisonDate={matched ? data.todayComparison?.baselineDate : undefined} asOf={today.asOf} timeZone={today.timeZone} />
            : <div className="intel-empty"><b>Hourly detail is not available</b><span>{today.hourlyUnavailableReason || "The totals above come from the latest verified daily summary. Connect a provider with transaction timestamps to unlock the intraday chart."}</span></div>}
          {!awaitingRecords && <div className="chart-foot">
            <span><b>{today.transactionCount == null ? "Not available" : today.transactionCount.toLocaleString()}</b> completed sales</span>
            <span><b>{today.unitsSold == null ? "Not available" : today.unitsSold.toLocaleString()}</b> line items</span>
            <span><b>{money(today.discountsCents, currency)}</b> discounts</span>
            <span><b>{money(today.refundsCents, currency)}</b> refunds</span>
          </div>}
        </article>
        {!compact && data.current && (
          <article className="card period-summary-card">
            <p className="card-kicker">LATEST 30-DAY WINDOW</p>
            <h3>Period context</h3>
            {data.source.latestBusinessDate && <small>Through {formatBusinessDate(data.source.latestBusinessDate)}</small>}
            <dl>
              <div><dt>Net sales</dt><dd>{money(data.current.netSalesCents, currency)}</dd></div>
              <div><dt>Gross profit</dt><dd>{money(data.current.grossProfitCents, currency)}</dd></div>
              <div><dt>Average transaction</dt><dd>{money(data.current.averageTransactionCents, currency, 2)}</dd></div>
              <div><dt>Transactions</dt><dd>{data.current.transactionCount == null ? "Not available" : data.current.transactionCount.toLocaleString()}</dd></div>
            </dl>
          </article>
        )}
      </section>
      <CommerceIntelligenceRail data={data} currency={currency} paymentRange={paymentRange} setPaymentRange={setPaymentRange} />
    </>
  );
}

function FirstInsightPath({ data, navigate }: { data: CommandCentre; navigate: (view: View) => void }) {
  const records = data.source.rowCount > 0;
  return <details className="first-insight-path" open={!records}><summary><span><strong>Your path to a useful insight</strong><small>{records ? data.source.verifiedDays + " days with verified records · Review coverage before comparing" : "Start with a source, then check its records"}</small></span><span>Setup & coverage</span></summary><div className="first-insight-steps">
    <article><span>{records ? "Records received" : "Start here"}</span><h3>1. Connect your source</h3><p>{data.liveSource.lastSuccessfulSyncAt ? "Last successful sync: " + new Date(data.liveSource.lastSuccessfulSyncAt).toLocaleDateString("en-CA") + ". A successful sync does not establish complete coverage." : "Authorize a supported account or import a structured CSV. Map each source to the correct location."}</p><button onClick={() => navigate("Integrations")}>Review connections →</button></article>
    <article><span>{data.ready ? "Review available" : "Evidence needed"}</span><h3>2. Check the coverage</h3><p>{records ? "Latest approved date: " + (data.source.latestBusinessDate ?? "unavailable") + ". " : ""}{data.dataQuality.missingDimensions.length ? "Missing inputs: " + data.dataQuality.missingDimensions.join(", ") + "." : "Check dates, source totals and product costs before relying on a comparison."} A missing day may be a closure or an incomplete import.</p><button onClick={() => navigate("Reports")}>Inspect reports →</button></article>
    <article><span>{data.insights.length ? "Findings available" : "After source review"}</span><h3>3. Investigate and act</h3><p>Inspect the evidence, ask Vanteloq AI and create a review task. Record the decision and check the outcome when new data arrives.</p><button onClick={() => navigate("Action Centre")}>Open the Action Centre →</button></article>
  </div></details>;
}

function Overview({ data, currency, navigate, createTask, paymentRange, setPaymentRange }: { data: CommandCentre; currency: string; navigate: (view: View) => void; createTask: (seed: TaskSeed) => void; paymentRange: PaymentRange; setPaymentRange: (range: PaymentRange) => void }) {
  const hasCurrentDayData = data.today.transactionCount > 0 || data.today.refundsCents > 0;
  if ((!data.ready || !data.current) && !hasCurrentDayData) return <><FirstInsightPath data={data} navigate={navigate}/><EmptyCommandCentre navigate={navigate} /></>;
  const sourceName = data.liveSource.accountName || (data.liveSource.provider ? providerLabel(data.liveSource.provider) : "the connected source");
  return (
    <div className="content command-page">
      <FirstInsightPath data={data} navigate={navigate}/>
      <section className="live-sales-heading">
        <div>
          <p>LATEST VERIFIED SALES</p>
          <h2>Your latest verified business performance.</h2>
          <span>{data.today.lastSaleAt ? `${data.today.sourceGranularity === "intraday" ? "Through" : "Daily summary updated"} ${formatBusinessDate(data.today.businessDate)} at ${formatTime(data.today.lastSaleAt)} · ${sourceName}` : `No verified sale has been received for ${data.today.businessDate} from ${sourceName}.`}</span>
        </div>
        <span className={`live-sync-state ${data.source.freshness}`}><i />{data.liveSource.lastSuccessfulSyncAt ? `Synced ${formatRelativeSync(data.liveSource.lastSuccessfulSyncAt)}` : "Waiting for first sync"}</span>
      </section>
      {(isAwaitingSalesRecords(data.today) || data.source.freshness === "stale") && <section className="sales-evidence-notice" aria-label="Sales data coverage"><div><strong>{isAwaitingSalesRecords(data.today) ? "Today’s sales are not yet verified" : "Your sales records need a refresh"}</strong><p>{data.source.latestBusinessDate ? `The latest approved daily record is ${formatBusinessDate(data.source.latestBusinessDate)}. ` : "No approved daily records are available. "}A successful connection sync does not confirm complete sales coverage. Review source status and approved imports before using these figures for a decision.</p></div><button type="button" onClick={() => navigate("Integrations")}>Review data connections →</button></section>}
      <LiveSalesPanel data={data} currency={currency} paymentRange={paymentRange} setPaymentRange={setPaymentRange} />
      <section className="card period-trend-card">
        <div className="card-head"><div><p className="card-kicker">PERIOD TREND</p><h3>Net sales and gross profit</h3></div><span className="verified-tag">{data.trend.length} verified days</span></div>
        <BusinessTrendChart data={data.trend} currency={currency} />
      </section>
      {data.insights[0] && (
        <section className="owner-priority-strip">
          <div><p>TODAY&apos;S PRIORITY</p><h3>{data.insights[0].title}</h3><span>{data.insights[0].recommendedAction}</span></div>
          <button onClick={() => createTask({ ...data.insights[0].suggestedTask, sourceType: "insight", sourceRef: data.insights[0].id })}>Create an action →</button>
        </section>
      )}
    </div>
  );
}

// Kept as a complete view for the next navigation slice.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SalesWorkspace({ data, currency, navigate, refresh, paymentRange, setPaymentRange }: { data: CommandCentre; currency: string; navigate: (view: View) => void; refresh: () => Promise<void>; paymentRange: PaymentRange; setPaymentRange: (range: PaymentRange) => void }) {
  const sourceName = data.liveSource.accountName || (data.liveSource.provider ? providerLabel(data.liveSource.provider) : "the connected commerce source");
  return (
    <div className="content sales-live-page">
      <section className="live-sales-heading">
        <div><p>SALES INTELLIGENCE</p><h2>Sales performance from each supported commerce source.</h2><span>Sales from {sourceName} use the finest verified detail that provider supplies. Refunds and product cost appear only when included in the normalized source records.</span>{data.liveSource.provider === "lightspeed-r" && <span>R-Series refreshes are started from Connections and remain hidden until the latest reconciliation is reviewed.</span>}</div>
        <div className="live-sales-actions"><span className="live-sync-state current"><i />{data.liveSource.lastSuccessfulSyncAt ? `Synced ${formatRelativeSync(data.liveSource.lastSuccessfulSyncAt)}` : "Awaiting sync"}</span><button onClick={() => void refresh()}>Refresh view</button></div>
      </section>
      <LiveSalesPanel data={data} currency={currency} paymentRange={paymentRange} setPaymentRange={setPaymentRange} compact />
      <section className="card period-trend-card">
        <div className="card-head"><div><p className="card-kicker">RECENT PERFORMANCE</p><h3>Daily net sales and gross profit</h3></div><button className="text-action" onClick={() => navigate("Reports")}>Choose another time frame →</button></div>
        <BusinessTrendChart data={data.trend} currency={currency} />
      </section>
    </div>
  );
}

export function Metric({
  label,
  value,
  delta,
  detail,
  tone = "indigo",
  sparkline,
  provenance,
}: {
  label: string;
  value: string;
  delta: string;
  detail: string;
  tone?: Tone;
  sparkline?: number[];
  provenance?: MetricProvenance;
}) {
  const unavailable = value === "Not connected" || value === "Not available";
  return (
    <article className={`metric-card metric-${tone}${unavailable ? " metric-unavailable" : ""}`}>
      <p>{label}</p>
      <h3 className={unavailable ? "metric-unavailable-value" : undefined}>{value}</h3>
      <span className={`metric-context${!unavailable && /^\+/.test(delta) ? " positive" : !unavailable && /^-/.test(delta) ? " negative" : ""}`}>{delta}</span>
      {!!sparkline?.length && <MetricSparkline values={sparkline} tone={tone} />}
      <small>{detail}</small>
      {provenance && (
        <details className="metric-evidence">
          <summary>
            <span>{provenance.actuality}</span>
            <b>{provenance.confidenceLevel} confidence</b>
          </summary>
          <div>
            <dl>
              <dt>Source</dt>
              <dd>{provenance.sourceSystem} · {provenance.sourceAccount}</dd>
              <dt>Records</dt>
              <dd>{provenance.sourceRecords.toLocaleString()}</dd>
              <dt>Period</dt>
              <dd>{provenance.periodStart} → {provenance.periodEnd}</dd>
              <dt>Comparison</dt>
              <dd>{provenance.comparisonPeriodStart} → {provenance.comparisonPeriodEnd}</dd>
              <dt>Calculation</dt>
              <dd>{provenance.calculationMethod}</dd>
              <dt>Version</dt>
              <dd>{provenance.calculationVersion}</dd>
              <dt>Freshness</dt>
              <dd>{provenance.freshnessStatus}</dd>
              <dt>Updated</dt>
              <dd>{provenance.sourceTimestamp ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(provenance.sourceTimestamp)) : "Source timestamp unavailable"}</dd>
            </dl>
            <p>{provenance.confidenceBasis.join(" · ")}</p>
          </div>
        </details>
      )}
    </article>
  );
}

function EmptyCommandCentre({ navigate }: { navigate: (view: View) => void }) {
  return (
    <div className="content empty-command">
      <section className="empty-command-hero">
        <div>
          <p>VANTELOQ IS READY</p>
          <h2>Your command centre starts with evidence.</h2>
          <span>
            Connect a provider or import daily summaries. Until then, financial
            values, customer records and inventory alerts remain unavailable.
          </span>
          <div>
            <button
              className="primary"
              onClick={() => navigate("Integrations")}
            >
              Add verified data →
            </button>
            <button
              className="secondary"
              onClick={() => navigate("Scenario Planner")}
            >
              Use scenario planner
            </button>
          </div>
        </div>
        <div className="question-stack">
          {[
            ["1", "What happened?", "Verified metrics and changes"],
            ["2", "Why did it happen?", "Supported causes and missing inputs"],
            [
              "3",
              "What needs attention?",
              "Ranked exceptions and opportunities",
            ],
            ["4", "What should I do next?", "Assigned actions with outcomes"],
          ].map(([n, t, d]) => (
            <article key={n}>
              <b>{n}</b>
              <span>
                <strong>{t}</strong>
                <small>{d}</small>
              </span>
            </article>
          ))}
        </div>
      </section>
      <section className="card empty-visual-preview" aria-label="Dashboard layout preview">
        <header>
          <div><p>Dashboard preview</p><h3>Your charts will fill from verified records.</h3></div>
          <span>Layout only · no business data</span>
        </header>
        <div className="empty-preview-grid">
          <article className="empty-preview-chart">
            <div className="chart-legend"><span><i className="legend-sales" />Net sales</span><span><i className="legend-profit" />Gross profit</span></div>
            <svg viewBox="0 0 640 180" role="img" aria-label="Example layout for sales and gross-profit charts">
              {[24, 64, 104, 144].map((y) => <line key={y} x1="20" x2="620" y1={y} y2={y} className="trend-gridline" />)}
              <polyline points="20,132 105,104 190,118 275,75 360,91 445,53 530,67 620,35" className="preview-sales-line" />
              <polyline points="20,151 105,134 190,141 275,111 360,124 445,95 530,103 620,83" className="preview-profit-line" />
            </svg>
          </article>
          <aside className="empty-preview-sources">
            {[['Sales history','Connect POS or CSV','indigo'],['Cash position','Connect banking or balances','emerald'],['Inventory risk','Connect SKU movement','amber']].map(([title,detail,tone]) => <div key={title}><i className={`preview-source-${tone}`} /><span><b>{title}</b><small>{detail}</small></span><em>Waiting</em></div>)}
          </aside>
        </div>
      </section>
      <section className="wiring-principles">
        <article>
          <b>Known fact</b>
          <span>Directly calculated from connected or imported records.</span>
        </article>
        <article>
          <b>Estimate</b>
          <span>Clearly labeled with its model and limitations.</span>
        </article>
        <article>
          <b>Recommendation</b>
          <span>Linked to evidence and an executable action.</span>
        </article>
        <article>
          <b>Missing</b>
          <span>Vanteloq says what it cannot yet know.</span>
        </article>
      </section>
    </div>
  );
}

function Intelligence({ data, navigate, createTask, activeLocationId, onAsk, onEvidence, canCreate, canAsk }: {
  data: CommandCentre; navigate: (view: View) => void; createTask: (seed: TaskSeed) => void;
  activeLocationId: string | null; onAsk: (seed: RetailAdvisorSeed) => void; onEvidence: (period?: { from: string; to: string }) => void; canCreate: boolean; canAsk: boolean;
}) {
  const comparison = data.periodComparisons?.thirtyDays;
  const period = comparison ? { from: comparison.periodStart, to: comparison.periodEnd } : null;
  const lifecycle = useOpportunityReviews(activeLocationId, period);
  return <div className="content intelligence-page"><DecisionWorkspace
    decisions={data.operatingSystem.decisions} period={period} freshness={data.source.freshness} verifiedDays={data.source.verifiedDays}
    reviews={lifecycle.reviews} canReview={lifecycle.canReview} reviewLoading={lifecycle.loading} reviewBusy={lifecycle.busy} reviewError={lifecycle.error}
    onRefresh={() => { void lifecycle.refresh(); }} onCapture={decision => { void lifecycle.capture(decision).catch(() => {}); }} onReview={lifecycle.update}
    comparisonNote={comparison?.unavailableReason ?? (!comparison?.comparable && data.ready ? "Comparison needs complete daily coverage in both periods. Check imports and closures." : null)}
    onConnections={() => navigate("Integrations")} onEvidence={onEvidence} onActions={() => navigate("Action Centre")}
    onAction={canCreate && lifecycle.canReview ? (decision, review) => { void (async () => {
      const saved = review ?? await lifecycle.capture(decision);
      const evidence = saved.snapshot;
      createTask({ title: evidence.title,
      detail: `Period: ${saved.period.from} to ${saved.period.to}. Scope: ${saved.scopeLabel}.\nFinding: ${evidence.evidence.join(" ")}\nNext step: ${evidence.decision}\nMissing inputs: ${evidence.missing.join(", ") || "Review source totals"}`.slice(0, 2000),
      priority: decision.priority === "critical" ? "high" : decision.priority,
      expectedImpact: "Review the evidence and record the outcome. No financial recovery is assumed.", sourceType: "decision", sourceRef: `opportunity:${saved.id}`,
    }); })().catch(() => {}); } : undefined}
    onAsk={canAsk ? (decision, savedPeriod) => { const scope = savedPeriod ?? period; if (scope) onAsk({ ...scope, locationId: activeLocationId,
      question: `Review the finding: ${decision.title}. Period: ${scope.from} to ${scope.to}. Scope: ${activeLocationId ?? "all accessible locations"}. Verify it against the permitted source data. Explain the measured drivers, evidence limitations and practical next steps. Do not infer causation or guaranteed savings.`,
    }); } : undefined}
  /></div>;
}

function InsightCard({
  insight,
  createTask,
  expanded = false,
}: {
  insight: Insight;
  createTask: (seed: TaskSeed) => void;
  expanded?: boolean;
}) {
  return (
    <article
      className={`insight-card ${insight.severity} ${expanded ? "expanded" : ""}`}
    >
      <div className="insight-top">
        <span>{insight.severity}</span>
        <small>{insight.confidence} confidence</small>
      </div>
      <h3>{insight.title}</h3>
      <div className="insight-four">
        <p>
          <b>What happened</b>
          {insight.whatHappened}
        </p>
        <p>
          <b>Interpretation to investigate</b>
          {insight.probableCause}
        </p>
        <p>
          <b>Financial impact</b>
          {insight.financialImpact}
        </p>
        <p>
          <b>Recommended action</b>
          {insight.recommendedAction}
        </p>
      </div>
      {expanded && (
        <div className="evidence-row">
          <div>
            <b>Evidence used</b>
            {insight.evidence.map((item) => <span key={item}>{item}</span>)}
          </div>
          <div>
            <b>Still missing</b>
            {insight.missingInformation.map((item) => (
              <span key={item}>• {item}</span>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={() =>
          createTask({
            ...insight.suggestedTask,
            sourceType: "insight",
            sourceRef: insight.id,
          })
        }
      >
        Create assigned action →
      </button>
    </article>
  );
}

type Task = {
  id: number;
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  status: "open" | "in_progress" | "done";
  assignee: string;
  dueDate: string | null;
  sourceType: string;
  sourceRef: string | null;
  expectedImpact: string;
};
function TaskCentre({
  showNotice,
  openComposer,
  navigate,
}: {
  navigate: (view: View) => void;
  showNotice: (message: string) => void;
  openComposer: () => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [updating, setUpdating] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/api/v1/tasks");
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "Unable to load actions.");
      setTasks(body.tasks);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to load actions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const update = async (task: Task, status: Task["status"]) => {
    if (updating !== null) return;
    setUpdating(task.id); setUpdateError("");
    try {
      const response = await apiFetch("/api/v1/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, status }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The action could not be updated. Please retry.");
      setTasks(current => current.map(item => item.id === task.id ? body.task : item));
      showNotice(status === "done" ? "Action completed" : "Action status updated");
    } catch { setUpdateError("The update was not confirmed. Refresh actions to check their status, then retry if needed."); }
    finally { setUpdating(null); }
  };
  const filteredTasks = tasks.filter(task => (statusFilter === "all" || statusFilter === "active" && task.status !== "done" || task.status === statusFilter)
    && `${task.title} ${task.detail} ${task.assignee}`.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => ({high:0,medium:1,low:2}[a.priority] - {high:0,medium:1,low:2}[b.priority]) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const active = tasks.filter((task) => task.status !== "done");
  return (
    <div className="content tasks-page">
      <section className="page-intro">
        <div>
          <p>EXECUTION LAYER</p>
          <h2>Every insight ends in accountable work.</h2>
          <span>
            Assign an owner, deadline and expected impact. Source links preserve
            why the action exists.
          </span>
        </div>
        <button className="primary" onClick={openComposer}>
          + Create action
        </button>
      </section>
      <section className="task-stats">
        <div>
          <strong>{active.length}</strong>
          <span>Active</span>
        </div>
        <div>
          <strong>
            {active.filter((task) => task.priority === "high").length}
          </strong>
          <span>High priority</span>
        </div>
        <div>
          <strong>
            {tasks.filter((task) => task.sourceType === "insight").length}
          </strong>
          <span>From intelligence</span>
        </div>
        <div>
          <strong>
            {tasks.filter((task) => task.status === "done").length}
          </strong>
          <span>Completed</span>
        </div>
      </section>
      <div className="action-tools"><label>Find an action<input type="search" value={query} placeholder="Search title, owner or evidence" onChange={event => setQuery(event.target.value)}/></label><label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="active">Active</option><option value="all">All actions</option><option value="open">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label><button className="secondary" type="button" disabled={updating !== null} onClick={() => void load()}>Refresh actions</button></div>
      {updateError && <p className="action-update-error" role="alert">{updateError}</p>}
      <article className="card task-board">
        {loading ? (
          <WorkspaceSkeleton compact label="Loading your actions"/>
        ) : error ? (
          <FailureState message={error} retry={load} />
        ) : !tasks.length ? (
          <div className="empty-state">
            <b>No assigned actions.</b>
            <span>
              Create one manually or convert a Vanteloq insight into work.
            </span>
            <button onClick={openComposer}>Create the first action</button>
          </div>
        ) : (
          <div className="task-list">
            {!filteredTasks.length && <div className="empty-state"><b>No actions match this view.</b><button onClick={() => { setStatusFilter("all"); setQuery(""); }}>Show all actions</button></div>}
            {filteredTasks.map((task) => (
              <div
                className={`task-item ${task.status === "done" ? "is-done" : ""}`}
                key={task.id}
              >
                <button
                  className="check-task"
                  disabled={updating !== null}
                  aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`}
                  onClick={() =>
                    void update(task, task.status === "done" ? "open" : "done")
                  }
                >
                  {task.status === "done" ? <span className="sr-only">Completed</span> : null}
                </button>
                <div className="task-copy">
                  <div>
                    <span className={`task-priority ${task.priority}`}>
                      {task.priority}
                    </span>
                    {task.sourceType !== "manual" && (
                      <span className="source-chip">{task.sourceType}</span>
                    )}
                    <b>{task.title}</b>
                  </div>
                  {task.detail && <p>{task.detail}</p>}
                  <small>
                    {task.assignee}
                    {task.dueDate ? ` · Due ${task.dueDate}` : " · No due date"}
                    {task.expectedImpact ? ` · ${task.expectedImpact}` : ""}
                  </small>
                  {(task.sourceType === "insight" || task.sourceType === "decision") && <button className="task-source-link" type="button" onClick={() => navigate("Intelligence")}>Review current opportunities →</button>}
                </div>
                <select
                  aria-label={`Status for ${task.title}`}
                  disabled={updating !== null}
                  value={task.status}
                  onChange={(event) =>
                    void update(task, event.target.value as Task["status"])
                  }
                >
                  <option value="open">To do</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

function TaskComposer({
  seed,
  close,
  saved,
}: {
  seed: TaskSeed;
  close: () => void;
  saved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const dialogId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  useModalFocus(formRef, true, () => { if (!saving) close(); });
  const [error, setError] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = JSON.stringify({ title: form.get("title"), detail: form.get("detail"), priority: form.get("priority"), assignee: form.get("assignee"), dueDate: form.get("dueDate") || null, sourceType: seed.sourceType ?? "manual", sourceRef: seed.sourceRef ?? null, expectedImpact: form.get("expectedImpact") });
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    try {
      const response = await apiFetch("/api/v1/tasks", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body: payload });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to save the action.");
      saved();
    } catch (caught) { setError(caught instanceof Error && caught.message !== "Failed to fetch" ? caught.message : "The save was not confirmed. Retry the unchanged form to avoid creating a duplicate."); }
    finally { setSaving(false); }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => !saving && event.currentTarget === event.target && close()}
    >
      <form ref={formRef} className="action-modal" role="dialog" aria-modal="true" aria-labelledby={dialogId} aria-busy={saving} onSubmit={submit}>
        <div className="modal-title">
          <div>
            <p>QUICK ACTION</p>
            <h2 id={dialogId}>Assign the next move</h2>
          </div>
          <button type="button" disabled={saving} aria-label="Close action form" onClick={close}>
            ×
          </button>
        </div>
        <label><FieldLabel>Action Title</FieldLabel><input
            name="title"
            defaultValue={seed.title}
            required
            maxLength={120}
            autoFocus
          />
        </label>
        <label>
          <FieldLabel required={false}>Action Details</FieldLabel>
          <textarea name="detail" defaultValue={seed.detail} maxLength={2000} />
        </label>
        <div className="form-row">
          <label>
            Priority
            <select name="priority" defaultValue={seed.priority}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            Owner
            <input name="assignee" defaultValue="Owner" maxLength={80} />
          </label>
          <label>
            <FieldLabel required={false}>Due Date</FieldLabel>
            <input type="date" name="dueDate" />
          </label>
        </div>
        <label>
          <FieldLabel required={false}>Expected Impact</FieldLabel>
          <input
            name="expectedImpact"
            defaultValue={seed.expectedImpact ?? ""}
            maxLength={500}
          />
        </label>
        {seed.sourceType && seed.sourceType !== "manual" && (
          <div className="linked-source">
            {seed.sourceRef?.startsWith("opportunity:") ? "Linked to the saved opportunity and its evidence." : `Linked to ${seed.sourceType}: ${seed.sourceRef}`}
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" disabled={saving} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : "Assign action"}
          </button>
        </div>
      </form>
    </div>
  );
}

type IntegrationConnection = IntegrationCatalogEntry & {
  status: string;
  maskedAccountRef: string | null;
  externalAccountName: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorCode: string | null;
  connectedAt: string | null;
  dataPromotionStatus: string;
  connectionCount?: number;
  connections?: Array<{
    id: string;
    status: string;
    maskedAccountRef: string | null;
    externalAccountName: string | null;
    lastSuccessfulSyncAt: string | null;
    lastErrorCode: string | null;
    connectedAt: string | null;
    dataPromotionStatus: string;
    reportingEnvironment?: "production" | "sandbox" | "unverified" | null;
    resourceSelectionVersion: number;
    resourceSelections: Array<{
      id: string;
      dataset: "google_analytics" | "google_search_console" | "meta_ads";
      externalResourceRef: string;
      name: string;
      scopeKind: "organization" | "location";
      localLocationId: string | null;
    }>;
    syncEligible: boolean;
    sampleReady: boolean;
    sampleRunId: string | null;
    sampleSummary: null | {
      runId: string;
      selectionVersion: number;
      completedAt: string | null;
      recordsRead: number;
      recordsStaged: number;
      warningCount: number;
      warnings: string[];
      resourceResults: Array<{ resourceSelectionId: string; recordsRead: number; warningCodes: string[] }>;
    };
    syncActive: boolean;
    automaticSync?: AutomaticSyncStatus | null;
    canonicalCoverage: CanonicalCommerceCoverage;
    featureCoverage: ProviderFeatureCoverage[];
    reportCatalog: {
      providerReports: Array<{ id: string; label: string; status: "ready" | "needs_data"; dataNeeded: string[] }>;
    };
  }>;
  privacyDataDeletedAt: string | null;
  canManage: boolean;
  providerReadiness: null | {
    adapterBuilt?: boolean;
    credentialsConfigured: boolean;
    missingConfiguration: string[];
    apiVersion?: string;
    scopes?: string[];
    mode: string;
    dataPromotionEnabled?: boolean;
    ledgerImportEnabled?: boolean;
    liveDataEligible?: boolean;
    resourceSelectionRequired?: boolean;
    syncEligible?: boolean;
  };
  canonicalCoverage: CanonicalCommerceCoverage;
  featureCoverage: ProviderFeatureCoverage[];
};

type MarketingResourcePanel = {
  provider: "google" | "meta";
  connectionId: string;
  selectionVersion: number;
  selectionBlocked: boolean;
  datasets: Array<{
    dataset: "google_analytics" | "google_search_console" | "google_business_profile" | "google_ads" | "meta_ads";
    status: "available" | "unavailable";
    message: string | null;
    resources: Array<{
      externalResourceRef: string;
      name: string;
      syncCapability: "metrics";
      selected: boolean;
      scopeKind: "organization" | "location";
      localLocationId: string | null;
    }>;
  }>;
  locations: Array<{ id: string; name: string }>;
};

type PendingDataApproval = {
  exclude?: boolean;
  provider: string;
  connectionId: string;
  marketingReview?: { sampleRunId: string; expectedSelectionVersion: number };
};

function DataHub({
  refresh,
  showNotice,
  navigate,
  subscriptionFeatures,
}: {
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
  navigate: (view: View) => void;
  subscriptionFeatures: readonly string[];
}) {
  const [tab, setTab] = useState<"import" | "connections">("connections");
  const [providerQuery, setProviderQuery] = useState("");
  const [providerCategory, setProviderCategory] = useState("All categories");
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [connectionError, setConnectionError] = useState("");
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canManageBankConnections, setCanManageBankConnections] = useState(false);
  const [providerActions, setProviderActions] = useState<Record<string, string>>({});
  const [marketingResourcePanel, setMarketingResourcePanel] = useState<MarketingResourcePanel | null>(null);
  const [marketingResourceErrors, setMarketingResourceErrors] = useState<Record<string, { message: string; reconnect: boolean }>>({});
  const marketingResourcePanelRef = useRef<HTMLElement | null>(null);
  const marketingResourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [pendingDataApproval, setPendingDataApproval] = useState<PendingDataApproval | null>(null);
  const dataApprovalDialogRef = useRef<HTMLElement | null>(null);
  const dataApprovalTriggerRef = useRef<HTMLElement | null>(null);
  const [marketingSampleResult, setMarketingSampleResult] = useState<null | {
    provider: "google" | "meta";
    connectionId: string;
    run: { id: string; selectionVersion: number; recordsRead: number; recordsImported: number; warningCount: number };
    warnings: string[];
    resourceResults: Array<{ resourceSelectionId: string; resourceName: string; dataset: string; scope: string; recordsRead: number; warningCodes: string[] }>;
    nextStep: string;
  }>(null);
  const [reviewedMarketingSamples, setReviewedMarketingSamples] = useState<Record<string, boolean>>({});
  const [activeSampleProvider, setActiveSampleProvider] = useState<"lightspeed" | "lightspeed-r" | "shopify" | "shopify-pos" | "square" | "clover" | "stripe" | "moneris">("lightspeed");
  const [shopifyConnectProvider, setShopifyConnectProvider] = useState<"shopify" | "shopify-pos" | null>(null);
  const [shopifyShop, setShopifyShop] = useState("");
  const [monerisFormOpen, setMonerisFormOpen] = useState(false);
  const [monerisDraft, setMonerisDraft] = useState({ accountName: "", environment: "sandbox", merchantId: "", clientId: "", clientSecret: "", scope: "payment.read", accepted: false });
  const [quickBooksConsentOpen, setQuickBooksConsentOpen] = useState(false);
  const [quickBooksConsentAccepted, setQuickBooksConsentAccepted] = useState(false);
  const [sampleResult, setSampleResult] = useState<null | {
    dataPromotionEnabled?: boolean;
    backfillComplete?: boolean;
    run: { recordsRead: number; recordsStaged: number; duplicatesSkipped: number; warningCount: number };
    reconciliation: {
      mappedOutlets?: number;
      discoveredOutlets?: number;
      unmappedOutlets?: number;
      balanceTransactions?: number;
      payouts?: number;
      payments?: number;
      grossCents?: number;
      feeCents?: number;
      netCents?: number;
      completedSales?: number;
      orders?: number;
      refunds?: number;
      openSales?: number;
      voidedSales?: number;
      salesCents?: number;
      taxCents?: number;
      costCents?: number;
      discountCents?: number;
      units?: number;
      dailyMetrics?: number;
      inventoryBalances?: number;
      products?: number;
      customers?: number;
      suppliers?: number;
      saleLines?: number;
      unmappedLocations?: number;
    };
    readyForReview?: boolean;
    nextStep: string;
  }>(null);
  const [outletData, setOutletData] = useState<null | {
    provider?: "lightspeed" | "lightspeed-r" | "shopify" | "shopify-pos" | "square" | "clover";
    connectionId?: string;
    accountName?: string | null;
    locationLabel?: "outlet" | "shop" | "location" | "merchant";
    mappings: Array<{
      externalLocationRef: string;
      externalName: string;
      localLocationId: string | null;
      status: "mapped" | "unmapped" | "ignored";
    }>;
    localLocations: Array<{ id: string; name: string; status: string }>;
    autoMapped?: number;
  }>(null);
  const loadConnections = useCallback(async () => {
    setConnectionsLoading(true);
    setConnectionError("");
    try {
      const response = await apiFetch("/api/v1/integrations", {
        headers: { Accept: "application/json" },
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Connection status could not be loaded.");
      }
      setConnections(body.integrations ?? []);
      setCanManage(body.canManage === true);
      setCanManageBankConnections(body.canManageBankConnections === true);
    } catch (error) {
      setConnectionError(
        error instanceof Error
          ? error.message
          : "Connection status could not be loaded.",
      );
    } finally {
      setConnectionsLoading(false);
      setConnectionsLoaded(true);
    }
  }, []);
  const waitForConnectionSync = useCallback(async (
    provider: "lightspeed-r",
    connectionId: string,
    startedFrom: string | null,
  ) => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      const response = await apiFetch("/api/v1/integrations", { headers: { Accept: "application/json" } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Connection status could not be refreshed.");
      const source = (body.integrations ?? []).find((item: IntegrationConnection) => item.id === provider);
      const connection = source?.connections?.find((item: NonNullable<IntegrationConnection["connections"]>[number]) => item.id === connectionId);
      if (!connection) throw new Error("The connected R-Series account is no longer available.");
      if (!connection.syncActive) {
        setConnections(body.integrations ?? []);
        setCanManage(body.canManage === true);
        setCanManageBankConnections(body.canManageBankConnections === true);
        if (connection.lastSuccessfulSyncAt && connection.lastSuccessfulSyncAt !== startedFrom) {
          showNotice("R-Series sync completed. Check the dates and coverage of the returned records before relying on the refreshed dashboard.");
        } else if (connection.lastErrorCode) {
          showNotice(`R Series needs attention: ${humanizeIdentifier(connection.lastErrorCode)}.`);
        } else {
          showNotice("R-Series finished checking for updates. No newer verified records were returned.");
        }
        await refresh();
        return;
      }
    }
    await loadConnections();
    showNotice("R-Series is still updating in the background. This page will show the new sync time when it finishes.");
  }, [loadConnections, refresh, showNotice]);
  useEffect(() => {
    if (tab !== "connections" || connectionsLoaded || connectionsLoading || connectionError) return;
    const timer = window.setTimeout(() => void loadConnections(), 0);
    return () => window.clearTimeout(timer);
  }, [connectionsLoaded, connectionsLoading, connectionError, loadConnections, tab]);
  const providerPost = async (
    provider: DirectIntegrationProvider,
    path: string,
    action: string,
    connectionId?: string,
    extraBody?: Record<string, unknown>,
  ) => {
    const actionKey = integrationActionKey(provider, connectionId);
    setProviderActions((current) => ({ ...current, [actionKey]: action }));
    try {
      const response = await apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: (provider === "lightspeed" || provider === "lightspeed-r" || provider === "shopify" || provider === "shopify-pos" || provider === "square" || provider === "clover") && action === "sync" ? "manual" : undefined,
          connectionId,
          ...extraBody,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The provider action failed.");
      return body;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The provider action failed.");
      return null;
    } finally {
      setProviderActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };
  const connectProvider = async (provider: DirectIntegrationProvider) => {
    const body = await providerPost(
      provider,
      `/api/v1/integrations/${provider}/authorize`,
      "authorize",
    );
    if (body?.authorizationUrl) window.location.assign(body.authorizationUrl);
  };
  const connectQuickBooks = async () => {
    const body = await providerPost(
      "quickbooks",
      "/api/v1/integrations/quickbooks/authorize",
      "authorize",
      undefined,
      {
        consentAcknowledged: quickBooksConsentAccepted,
        noticeVersion: QUICKBOOKS_CONSENT_NOTICE_VERSION,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      },
    );
    if (body?.authorizationUrl) window.location.assign(body.authorizationUrl);
  };
  const connectShopify = async (provider: "shopify" | "shopify-pos") => {
    const body = await providerPost(provider, `/api/v1/integrations/${provider}/authorize`, "authorize", undefined, { shop: shopifyShop });
    if (body?.authorizationUrl) window.location.assign(body.authorizationUrl);
  };
  const connectMoneris = async () => {
    const body = await providerPost("moneris", "/api/v1/integrations/moneris/connect", "connect", undefined, monerisDraft);
    if (!body) return;
    setMonerisFormOpen(false);
    setMonerisDraft({ accountName: "", environment: "sandbox", merchantId: "", clientId: "", clientSecret: "", scope: "payment.read", accepted: false });
    showNotice(body.nextStep ?? "Moneris connected securely.");
    await loadConnections();
  };
  const stageProviderSample = async (
    provider: "lightspeed" | "lightspeed-r" | "shopify" | "shopify-pos" | "square" | "clover" | "stripe" | "moneris",
    connectionId?: string,
    previousSyncAt: string | null = null,
  ) => {
    const body = await providerPost(
      provider,
      providerSyncRoutes[provider],
      provider === "lightspeed" || provider === "lightspeed-r" || provider === "shopify" || provider === "shopify-pos" || provider === "square" || provider === "clover" || provider === "moneris" ? "sync" : "sample",
      connectionId,
    );
    if (!body) return;
    if (body.coalesced) {
      showNotice(`${provider === "clover" ? "Clover" : provider === "square" ? "Square" : provider === "shopify" ? "Shopify e-commerce" : provider === "shopify-pos" ? "Shopify POS" : "R-Series"} is already updating. Refresh Connections when it finishes.`);
      if (provider === "lightspeed-r" && connectionId) {
        await waitForConnectionSync(provider, connectionId, previousSyncAt);
      } else {
        await loadConnections();
      }
      return;
    }
    setActiveSampleProvider(provider);
    setSampleResult(body);
    showNotice(body.nextStep ?? (provider === "lightspeed" || provider === "lightspeed-r" || provider === "shopify" || provider === "shopify-pos" || provider === "square" || provider === "clover" || provider === "moneris"
      ? `The ${provider === "clover" ? "Clover" : provider === "square" ? "Square" : provider === "shopify" ? "Shopify e-commerce" : provider === "shopify-pos" ? "Shopify POS" : "R-Series"} sync finished. Review its reconciliation before approval.`
      : `${provider === "stripe" ? "Stripe" : "X-Series"} sample staged; dashboard metrics remain unchanged`));
    await loadConnections();
    if (provider === "lightspeed" || provider === "lightspeed-r" || provider === "shopify" || provider === "shopify-pos" || provider === "square" || provider === "clover" || provider === "moneris") await refresh();
  };
  const syncMarketingProvider = async (
    provider: "google" | "meta",
    connection: NonNullable<IntegrationConnection["connections"]>[number],
  ) => {
    const mode = connection.dataPromotionStatus === "approved" ? "incremental" : "sample";
    const body = await providerPost(provider, providerSyncRoutes[provider], "sync", connection.id, {
      mode,
      expectedSelectionVersion: connection.resourceSelectionVersion,
    });
    if (!body) return;
    setMarketingSampleResult({
      provider,
      connectionId: connection.id,
      run: body.run,
      warnings: Array.isArray(body.warnings) ? body.warnings : [],
      resourceResults: (Array.isArray(body.resourceResults) ? body.resourceResults : []).map((result: { resourceSelectionId: string; recordsRead: number; warningCodes: string[] }) => {
        const selection = connection.resourceSelections.find((item) => item.id === result.resourceSelectionId);
        return {
          ...result,
          resourceName: selection?.name ?? "Selected provider resource",
          dataset: selection?.dataset ?? "measurement",
          scope: selection?.scopeKind === "location" ? "Owned location" : "Organization-wide",
        };
      }),
      nextStep: body.nextStep ?? `${provider === "google" ? "Google" : "Meta"} sample completed.`,
    });
    showNotice(body.nextStep ?? `${provider === "google" ? "Google" : "Meta"} measurements updated`);
    await loadConnections();
    await refresh();
  };
  const requestConnectionDataApproval = (
    provider: string,
    connectionId: string,
    marketingReview?: { sampleRunId: string; expectedSelectionVersion: number },
  ) => {
    dataApprovalTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingDataApproval({ provider, connectionId, marketingReview });
  };
  const closeDataApproval = useCallback(() => {
    setPendingDataApproval(null);
    window.requestAnimationFrame(() => dataApprovalTriggerRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!pendingDataApproval) return;
    const frame = window.requestAnimationFrame(() => dataApprovalDialogRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDataApproval();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeDataApproval, pendingDataApproval]);
  const approveConnectionData = async () => {
    if (!pendingDataApproval) return;
    const { provider, connectionId, marketingReview, exclude } = pendingDataApproval;
    setPendingDataApproval(null);
    const actionKey = integrationActionKey(provider, connectionId);
    setProviderActions((current) => ({ ...current, [actionKey]: exclude ? "exclude" : "approve" }));
    try {
      const response = await apiFetch("/api/v1/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: exclude ? "exclude_data" : "approve_data", connectionId, confirmed: true, ...marketingReview }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The reporting setting could not be changed.");
      if ((provider === "lightspeed" || provider === "lightspeed-r" || provider === "shopify" || provider === "shopify-pos" || provider === "square" || provider === "clover") && body.publicationPending === true) {
        const label = provider === "lightspeed" ? "X-Series" : provider === "clover" ? "Clover" : provider === "square" ? "Square" : provider === "shopify" ? "Shopify e-commerce" : provider === "shopify-pos" ? "Shopify POS" : "R-Series";
        showNotice(`Reviewed ${label} data approved. Publishing it to the workspace now.`);
        await stageProviderSample(provider as "lightspeed" | "lightspeed-r" | "shopify" | "shopify-pos" | "square" | "clover", connectionId);
        return;
      }
      showNotice(body.nextStep ?? "Reviewed provider data is now available to dashboard features.");
      await loadConnections();
      await refresh();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The reviewed data could not be approved.");
    } finally {
      setProviderActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
      window.requestAnimationFrame(() => dataApprovalTriggerRef.current?.focus());
    }
  };
  useEffect(() => {
    if (!marketingResourcePanel) return;
    const frame = window.requestAnimationFrame(() => marketingResourcePanelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [marketingResourcePanel]);
  const closeMarketingResourcePanel = () => {
    setMarketingResourcePanel(null);
    window.requestAnimationFrame(() => marketingResourceTriggerRef.current?.focus());
  };
  const loadMarketingResources = async (provider: "google" | "meta", connectionId: string, trigger?: HTMLButtonElement) => {
    marketingResourceTriggerRef.current = trigger ?? null;
    const actionKey = integrationActionKey(provider, connectionId);
    setProviderActions((current) => ({ ...current, [actionKey]: "resources" }));
    setMarketingResourceErrors((current) => {
      const next = { ...current };
      delete next[actionKey];
      return next;
    });
    let failureCode = "";
    try {
      const response = await apiFetch(`/api/v1/integrations/${provider}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discover", connectionId }),
      });
      const body = await response.json();
      if (!response.ok) {
        failureCode = typeof body.error?.code === "string" ? body.error.code : "";
        throw new Error(body.error?.message ?? "Provider resources could not be loaded. Try again.");
      }
      setMarketingResourcePanel({
        provider,
        connectionId,
        selectionVersion: Number(body.selectionVersion),
        selectionBlocked: body.selectionBlocked === true,
        locations: body.locations,
        datasets: body.datasets.map((dataset: MarketingResourcePanel["datasets"][number]) => ({
          ...dataset,
          resources: dataset.resources.map((resource) => ({
            ...resource,
            scopeKind: resource.scopeKind ?? "organization",
            localLocationId: resource.localLocationId ?? null,
          })),
        })),
      });
    } catch (error) {
      setMarketingResourceErrors((current) => ({
        ...current,
        [actionKey]: {
          message: error instanceof Error ? error.message : "Provider resources could not be loaded. Try again.",
          reconnect: [
            "GOOGLE_TOKEN_REFRESH_FAILED",
            "GOOGLE_REAUTHORIZATION_REQUIRED",
            "GOOGLE_OFFLINE_ACCESS_REQUIRED",
            "META_REAUTHORIZATION_REQUIRED",
            "MARKETING_REAUTHORIZATION_REQUIRED",
          ].includes(failureCode),
        },
      }));
    } finally {
      setProviderActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };
  const updateMarketingResource = (
    dataset: MarketingResourcePanel["datasets"][number]["dataset"],
    externalResourceRef: string,
    updates: Partial<MarketingResourcePanel["datasets"][number]["resources"][number]>,
  ) => {
    setMarketingResourcePanel((current) => current ? ({
      ...current,
      datasets: current.datasets.map((group) => group.dataset !== dataset ? group : ({
        ...group,
        resources: group.resources.map((resource) => resource.externalResourceRef !== externalResourceRef ? resource : ({ ...resource, ...updates })),
      })),
    }) : null);
  };
  const saveMarketingResources = async () => {
    if (!marketingResourcePanel) return;
    const selections = marketingResourcePanel.datasets.flatMap((group) => group.resources
      .filter((resource) => resource.selected)
      .map((resource) => ({
        dataset: group.dataset,
        externalResourceRef: resource.externalResourceRef,
        scopeKind: resource.scopeKind,
        localLocationId: resource.scopeKind === "location" ? resource.localLocationId : null,
      })));
    if (selections.some((selection) => selection.scopeKind === "location" && !selection.localLocationId)) {
      showNotice("Choose a Vanteloq location for every location-scoped resource.");
      return;
    }
    const { provider, connectionId, selectionVersion } = marketingResourcePanel;
    const actionKey = integrationActionKey(provider, connectionId);
    setProviderActions((current) => ({ ...current, [actionKey]: "save-resources" }));
    try {
      const response = await apiFetch(`/api/v1/integrations/${provider}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace",
          connectionId,
          expectedSelectionVersion: selectionVersion,
          selections,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The provider resource selection could not be saved.");
      showNotice(selections.length
        ? "Exact provider resources saved. Run a sample and review it before these measurements become available."
        : "Provider resources cleared. Marketing measurements remain unavailable.");
      closeMarketingResourcePanel();
      await loadConnections();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The provider resource selection could not be saved.");
    } finally {
      setProviderActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };
  const disconnectProvider = async (
    provider: DirectIntegrationProvider,
    connectionId?: string,
    accountLabel?: string | null,
  ) => {
    const providerLabel = provider === "shopify" ? "Shopify e-commerce" : providerDisplayName(provider);
    const targetLabel = accountLabel ? ` account “${accountLabel}”` : "";
    if (!window.confirm(`Disconnect ${providerLabel}${targetLabel}? Staged audit history will be retained.`)) return;
    const body = await providerPost(
      provider,
      `/api/v1/integrations/${provider}/disconnect`,
      "disconnect",
      connectionId,
    );
    if (!body) return;
    if ((provider === "lightspeed" || provider === "lightspeed-r" || provider === "shopify" || provider === "shopify-pos" || provider === "square" || provider === "clover" || provider === "stripe" || provider === "moneris") && activeSampleProvider === provider) {
      setSampleResult(null);
      if (provider !== "stripe") setOutletData(null);
    }
    showNotice(provider === "quickbooks" && typeof body.message === "string" ? body.message : `${providerLabel} disconnected`);
    await loadConnections();
  };
  const loadProviderLocations = async (provider: "lightspeed" | "lightspeed-r" | "shopify" | "shopify-pos" | "square" | "clover", connectionId?: string) => {
    const actionKey = integrationActionKey(provider, connectionId);
    setProviderActions((current) => ({ ...current, [actionKey]: "locations" }));
    try {
      const response = await apiFetch(`/api/v1/integrations/${provider}/${provider === "lightspeed-r" ? "shops" : provider === "clover" || provider === "square" || provider === "shopify" || provider === "shopify-pos" ? "locations" : "outlets"}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discover", connectionId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Provider locations could not be loaded.");
      setActiveSampleProvider(provider);
      setOutletData({ ...body, provider, locationLabel: provider === "lightspeed-r" ? "shop" : provider === "clover" ? "merchant" : provider === "square" || provider === "shopify" || provider === "shopify-pos" ? "location" : "outlet" });
      if (provider === "lightspeed-r" && Number(body.autoMapped ?? 0) > 0) {
        showNotice("The only R-Series shop was matched to your only active location. Starting its verified data sync now.");
        await stageProviderSample(provider, connectionId);
      }
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Provider locations could not be loaded.");
    } finally {
      setProviderActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };
  const saveOutletMapping = async (
    externalLocationRef: string,
    selection: string,
  ) => {
    const mappingProvider = outletData?.provider ?? (activeSampleProvider === "stripe" ? "lightspeed" : activeSampleProvider);
    const actionKey = integrationActionKey(mappingProvider, outletData?.connectionId);
    setProviderActions((current) => ({ ...current, [actionKey]: `mapping:${externalLocationRef}` }));
    try {
      const status = selection === "__ignored__" ? "ignored" : selection ? "mapped" : "unmapped";
      const provider = mappingProvider;
      const response = await apiFetch(`/api/v1/integrations/${provider}/${provider === "lightspeed-r" ? "shops" : provider === "clover" || provider === "square" || provider === "shopify" || provider === "shopify-pos" ? "locations" : "outlets"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: outletData?.connectionId,
          externalLocationRef,
          localLocationId: status === "mapped" ? selection : null,
          status,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The outlet mapping could not be saved.");
      setOutletData({ ...body, provider, locationLabel: provider === "lightspeed-r" ? "shop" : provider === "clover" ? "merchant" : provider === "square" || provider === "shopify" || provider === "shopify-pos" ? "location" : "outlet" });
      showNotice(`${provider === "clover" ? "Clover merchant" : provider === "shopify" ? "Shopify e-commerce channel" : provider === "shopify-pos" ? "Shopify POS location" : provider === "square" ? "Square location" : provider === "lightspeed-r" ? "R-Series shop" : "X-Series outlet"} mapping saved`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The outlet mapping could not be saved.");
    } finally {
      setProviderActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };
  const providerRows = connections;
  const filteredProviders = filterConnectors(providerRows, providerQuery, providerCategory);
  return (
    <div className="content data-hub">
      <section className="page-intro">
        <div>
          <p>CONNECTIONS AND DATA</p>
          <h2>Connect sources, review the data, then use the results.</h2>
          <span>
            Each connection keeps its own authorization, location mappings,
            sync history, and review status before data reaches the command centre.
          </span>
        </div>
        <div className="segmented">
          <button
            className={tab === "connections" ? "active" : ""}
            onClick={() => {
              setTab("connections");
              if (!connections.length && !connectionsLoading) {
                void loadConnections();
              }
            }}
          >
            Connections
          </button>
          <button
            className={tab === "import" ? "active" : ""}
            onClick={() => setTab("import")}
          >
            Import data
          </button>
        </div>
      </section>
      {tab === "import" ? (
        <DailyImport refresh={refresh} showNotice={showNotice} />
      ) : (
        <>
          {connectionError && (
            <div className="connection-error" role="alert">
              <span>{connectionError}</span>
              <button onClick={() => void loadConnections()}>Retry status check</button>
            </div>
          )}
          <section className="connector-pathway" aria-label="Connection workflow">
            <div><span>1</span><p><b>Choose your source</b><small>Check availability and plan access.</small></p></div>
            <div><span>2</span><p><b>Authorize securely</b><small>Select your business and grant consent.</small></p></div>
            <div><span>3</span><p><b>Review the import</b><small>Check mappings and totals before approval.</small></p></div>
          </section>
          <div className="connector-toolbar">
            <label htmlFor="connector-search"><span>Find a connection</span><input id="connector-search" type="search" value={providerQuery} onChange={event => setProviderQuery(event.target.value)} placeholder="Search provider or data type"/></label>
            <label htmlFor="connector-category"><span>Data category</span><select id="connector-category" value={providerCategory} onChange={event => setProviderCategory(event.target.value)}><option>All categories</option>{integrationCategoryOrder.map(category => <option key={category}>{category}</option>)}</select></label>
            <button type="button" disabled={connectionsLoading} onClick={() => void loadConnections()}>{connectionsLoading ? "Checking…" : "Refresh status"}</button>
          </div>
          <p className="connector-result-count" role="status">{connectionsLoading || !connectionsLoaded ? "Checking current connection status…" : connectionError ? "Connection status could not be verified." : `${filteredProviders.length} providers shown`}</p>
          {connectionsLoaded && !connectionError && !filteredProviders.length && <div className="connector-empty"><h3>No matching connections</h3><p>Try a different provider name or category.</p><button type="button" onClick={() => { setProviderQuery(""); setProviderCategory("All categories"); }}>Clear filters</button></div>}
          <details className="provider-parity-contract">
            <summary>What your connected records can unlock</summary>
            <header>
              <div><p>ONE COMMERCE INTELLIGENCE MODEL</p><h3 id="provider-parity-title">The same operating view across supported POS systems.</h3><span>Connect a supported point-of-sale account and Vanteloq organizes its available sales, payments, inventory, customer, supplier and location records into one consistent workspace.</span></div>
              <strong>{universalPosContract.length} commerce capabilities</strong>
            </header>
            <div className="provider-parity-body">
              <Image src="/brand/pos-commerce-intelligence.png" alt="Supported point-of-sale sources organized into sales, payment, inventory and customer intelligence" width={1774} height={887} unoptimized />
              <div className="provider-capability-list">{universalPosContract.map((feature) => <article key={feature.id}><span>{feature.label}</span><p>{feature.insight}</p></article>)}</div>
            </div>
          </details>
          <div className="integration-groups">
            {integrationCategoryOrder.filter((category) => filteredProviders.some((provider) => provider.category === category)).map((category) => <section className="integration-category" key={category}>
              <header><div><p>{category.toUpperCase()}</p><h3>{category}</h3></div><span>{filteredProviders.filter((provider) => provider.category === category).length} providers</span></header>
              <div className="integration-grid">
            {filteredProviders.filter((provider) => provider.category === category).map((provider) => {
              const providerFeature = integrationProviderFeature(provider.id);
              const providerEntitled = providerFeature !== null && subscriptionFeatures.includes(providerFeature);
              const providerPlanLabel = providerFeature?.startsWith("bookloq")
                ? "BookLoQ add-on"
                : providerFeature?.startsWith("marketing.")
                  ? "Growth plan"
                  : "Starter plan";
              const connected = provider.status === "connected";
              const hasLocationMapping = provider.id === "lightspeed" || provider.id === "lightspeed-r" || provider.id === "shopify" || provider.id === "shopify-pos" || provider.id === "square" || provider.id === "clover";
              const isStripe = provider.id === "stripe";
              const isMoneris = provider.id === "moneris";
              const isQuickBooks = provider.id === "quickbooks";
              const isPlaid = provider.id === "plaid";
              const isMarketingProvider = provider.id === "google" || provider.id === "meta";
              const supportsMultipleAccounts = supportsMultipleProviderAccounts(provider.id);
              const providerSetupRequired = provider.availability === "provider_selection_required";
              const providerUnavailable = provider.availability === "provider_build_required";
              const providerComingSoon = provider.availability === "coming_soon";
              const showPlanRequirement = !providerEntitled && providerFeature !== null && !providerSetupRequired && !providerUnavailable && !providerComingSoon;
              const repairRequired = isPlaid && provider.status === "error" && Boolean(provider.maskedAccountRef);
              const canManageProvider = providerEntitled && (provider.id === "plaid"
                ? provider.canManage ?? canManageBankConnections
                : provider.canManage ?? canManage);
              const actionableProvider = provider.id as DirectIntegrationProvider;
              const providerAction = providerActions[integrationActionKey(provider.id)] ?? "";
              const anyProviderAction = Object.keys(providerActions).some((key) => key.startsWith(`${provider.id}:`));
              const configured = provider.providerReadiness?.credentialsConfigured === true;
              const nextStep = connectorNextStep(provider, providerEntitled, canManageProvider);
              const disabledReason = !providerEntitled
                ? `${providerPlanLabel} required for this connection.`
                : !canManageProvider
                ? "Your role can view connection status but cannot manage integrations."
                : !configured
                  ? `Add the ${isPlaid ? "Plaid client ID, environment secret, approved redirect and webhook URLs, and encryption key" : isStripe ? "Stripe Connect credentials and webhook secret" : isMoneris ? "integration encryption key" : isQuickBooks ? "QuickBooks client ID, client secret, approved callback, environment, and encryption key" : provider.id === "google" ? "Google OAuth client, approved callback, and encryption key" : provider.id === "meta" ? "Meta app credentials, approved callback, and encryption key" : provider.id === "shopify" || provider.id === "shopify-pos" ? "Shopify client ID, client secret, approved callback, webhook URL, and encryption key" : provider.id === "lightspeed-r" ? "R-Series OAuth client ID and secret" : provider.id === "square" ? "Square application ID, application secret, approved redirect, webhook signature key, and encryption key" : provider.id === "clover" ? "Clover app ID, app secret, approved redirect, webhook authorization secret, and encryption key" : "X-Series OAuth client ID and secret"} to Vanteloq's hosted secrets first.`
                  : "";
              return (
              <article className={`integration-card${showPlanRequirement ? " subscription-locked" : ""}`} key={provider.id}>
                <div className="integration-card-head">
                  <IntegrationBrandLogo name={provider.name} />
                  <div className="integration-card-labels">
                    <span className="integration-type">{provider.category}</span>
                    {providerSetupRequired && <span className="integration-coming-soon">Provider required</span>}
                    {providerUnavailable && <span className="integration-coming-soon">Unavailable</span>}
                    {providerComingSoon && <span className="integration-coming-soon">Coming soon</span>}
                    {showPlanRequirement && <span className="integration-coming-soon">{providerPlanLabel} required</span>}
                  </div>
                </div>
                <h3>{provider.name}</h3>
                <div className="connector-next-step"><small>NEXT STEP</small><b>{connectionsLoading ? "Checking status" : nextStep.stage}</b><p>{connectionsLoading ? "Your existing access and records are unchanged." : nextStep.detail}</p></div>
                <p>{provider.activationRequirement}</p>
                <details className="integration-enablement"><summary>What this connection enables</summary><p><b>Features</b><span>{integrationCategoryGuide[provider.category].enables}</span></p><p><b>Data required</b><span>{integrationCategoryGuide[provider.category].data}</span></p></details>
                {(provider.category === "Point of sale" || provider.id === "shopify") && <details className="integration-feature-checklist"><summary>Feature and data checklist</summary>{provider.featureCoverage.map((feature) => <div key={feature.id}><span className={`feature-state ${feature.status === "ready" ? "available" : "needs-data"}`}>{feature.status === "ready" ? "Available" : "Needs data"}</span><p><b>{feature.label}</b><small>{feature.insight}</small><em>{feature.status === "ready" ? `Verified: ${feature.dataUsed.join(", ")}` : `Missing: ${feature.dataNeeded.join(", ")}`}</em></p></div>)}</details>}
                {(connected || repairRequired) && provider.maskedAccountRef && (
                  <div className="connected-source" role="status">
                    <span>{repairRequired ? "Connection needs attention" : "Connected source"}</span>
                    <b>{provider.externalAccountName || "Verified provider account"}</b>
                    <small>Protected reference {provider.maskedAccountRef}</small>
                    {provider.lastSuccessfulSyncAt && <small>Last synchronized {new Date(provider.lastSuccessfulSyncAt).toLocaleString("en-CA")}</small>}
                  </div>
                )}
                {hasLocationMapping && !configured && provider.providerReadiness && (
                  <div className="provider-setup-needed" role="note">
                    <b>Connection setup remaining</b>
                    <span>
                      {provider.providerReadiness.missingConfiguration
                        .map(lightspeedConfigurationLabel)
                        .join(" · ")}
                    </span>
                  </div>
                )}
                {isPlaid && !configured && provider.providerReadiness && (
                  <div className="provider-setup-needed" role="note"><b>Hosted Plaid setup remaining</b><span>{provider.providerReadiness.missingConfiguration.map(lightspeedConfigurationLabel).join(" · ")}</span></div>
                )}
                {isMarketingProvider && !configured && provider.providerReadiness && (
                  <div className="provider-setup-needed" role="note"><b>{provider.name} setup remaining</b><span>{provider.providerReadiness.missingConfiguration.map(lightspeedConfigurationLabel).join(" · ")}</span></div>
                )}
                {isQuickBooks && !configured && provider.providerReadiness && (
                  <div className="provider-setup-needed" role="note"><b>QuickBooks setup remaining</b><span>{provider.providerReadiness.missingConfiguration.map(lightspeedConfigurationLabel).join(" · ")}</span></div>
                )}
                {isQuickBooks && quickBooksConsentOpen && <form className="moneris-connect-form" onSubmit={(event) => { event.preventDefault(); void connectQuickBooks(); }}>
                  <header><b>Connect a QuickBooks Online company</b><span>Verify your company and save its authorization securely. Accounting import is not available yet, so this connection does not update your reports.</span></header>
                  <label className="moneris-consent"><input type="checkbox" checked={quickBooksConsentAccepted} required onChange={(event) => setQuickBooksConsentAccepted(event.target.checked)} /><span>I authorize Vanteloq to receive the selected QuickBooks company identifier, company name, authorization status, and future read only accounting records for mapping, reconciliation, and reporting. Vanteloq will not create or change QuickBooks transactions during this stage.</span></label>
                  <small>Intuit will show its own company selection and permission screen next. You can disconnect later to revoke the authorization and delete the stored token.</small>
                  <footer><button type="button" onClick={() => { setQuickBooksConsentOpen(false); setQuickBooksConsentAccepted(false); }}>Cancel</button><button type="submit" className="primary" disabled={!canManageProvider || providerAction === "authorize" || !quickBooksConsentAccepted}>{providerAction === "authorize" ? "Opening QuickBooks…" : "Continue to Intuit"}</button></footer>
                </form>}
                {isMoneris && monerisFormOpen && <form className="moneris-connect-form" onSubmit={(event) => { event.preventDefault(); void connectMoneris(); }}>
                  <header><b>Connect a Moneris merchant</b><span>Read-only payment history for reconciliation and cash timing.</span></header>
                  <label><span>Account label</span><input value={monerisDraft.accountName} maxLength={120} placeholder="Main merchant account" onChange={(event) => setMonerisDraft((current) => ({ ...current, accountName: event.target.value }))} /></label>
                  <label><span>Environment</span><select value={monerisDraft.environment} onChange={(event) => setMonerisDraft((current) => ({ ...current, environment: event.target.value }))}><option value="sandbox">Sandbox</option><option value="production">Production</option></select></label>
                  <label><span>Merchant ID</span><input value={monerisDraft.merchantId} minLength={13} maxLength={13} autoComplete="off" placeholder="13-character merchant ID" required onChange={(event) => setMonerisDraft((current) => ({ ...current, merchantId: event.target.value.trim() }))} /></label>
                  <label><span>Application ID</span><input value={monerisDraft.clientId} maxLength={256} autoComplete="off" required onChange={(event) => setMonerisDraft((current) => ({ ...current, clientId: event.target.value }))} /></label>
                  <label><span>Client secret</span><input type="password" value={monerisDraft.clientSecret} maxLength={512} autoComplete="new-password" required onChange={(event) => setMonerisDraft((current) => ({ ...current, clientSecret: event.target.value }))} /></label>
                  <label><span>Read scope</span><input value="payment.read" readOnly /><small>Vanteloq only requests permission to read payments.</small></label>
                  <label className="moneris-consent"><input type="checkbox" checked={monerisDraft.accepted} required onChange={(event) => setMonerisDraft((current) => ({ ...current, accepted: event.target.checked }))} /><span>I authorize Vanteloq to retrieve payment amounts, currency, status, timestamps and settlement references for reconciliation. No raw card data is requested or stored.</span></label>
                  <footer><button type="button" onClick={() => setMonerisFormOpen(false)}>Cancel</button><button type="submit" className="primary" disabled={!canManageProvider || providerAction === "connect" || !monerisDraft.accepted}>{providerAction === "connect" ? "Validating…" : "Validate and connect"}</button></footer>
                </form>}
                {(provider.id === "shopify" || provider.id === "shopify-pos") && shopifyConnectProvider === provider.id && <form className="moneris-connect-form" onSubmit={(event) => { event.preventDefault(); void connectShopify(provider.id as "shopify" | "shopify-pos"); }}>
                  <header><b>Connect {provider.id === "shopify" ? "Shopify e-commerce" : "a Shopify POS store"}</b><span>Use the permanent store domain shown in Shopify admin—not a storefront or custom domain.</span></header>
                  <label><span>Store domain</span><input value={shopifyShop} inputMode="url" autoComplete="url" maxLength={255} placeholder="your-store.myshopify.com" pattern="[A-Za-z0-9][A-Za-z0-9-]*\.myshopify\.com" required onChange={(event) => setShopifyShop(event.target.value.trim().toLowerCase())} /><small>Vanteloq requests read-only access to {provider.id === "shopify" ? "online orders, refunds, products, inventory, locations, and authorized customers" : "POS orders, products, inventory, locations, and authorized customers"}.</small></label>
                  <footer><button type="button" onClick={() => setShopifyConnectProvider(null)}>Cancel</button><button type="submit" className="primary" disabled={!canManageProvider || providerAction === "authorize"}>{providerAction === "authorize" ? "Opening Shopify…" : "Continue to Shopify"}</button></footer>
                </form>}
                {supportsMultipleAccounts && Boolean(provider.connections?.length) && (
                  <div className="provider-account-list" aria-label={`${provider.name} provider accounts`}>
                    {provider.connections!.map((connection, index) => {
                      const connectionKey = integrationActionKey(provider.id, connection.id);
                      const connectionAction = providerActions[connectionKey] ?? "";
                      const resourceError = marketingResourceErrors[connectionKey];
                      const resourceErrorId = `marketing-resource-error-${connection.id}`;
                      const accountLabel = connection.externalAccountName || connection.maskedAccountRef || `Account ${index + 1}`;
                      return <article key={connection.id}>
                        <div>
                          <span>Account {index + 1}</span>
                          <b>{connection.externalAccountName || `${provider.name} account`}</b>
                          <small>{connection.maskedAccountRef ? `Protected reference ${connection.maskedAccountRef}` : connection.status === "pending" ? "Authorization pending" : "Protected provider identity"}</small>
                          {connection.lastSuccessfulSyncAt && <small>Last synced {formatRelativeSync(connection.lastSuccessfulSyncAt)}</small>}
                          {connection.dataPromotionStatus !== "blocked" && <small>{connection.reportingEnvironment === "sandbox" ? "Sandbox · excluded from reports" : connection.reportingEnvironment === "unverified" ? "Environment verification required" : `Data ${humanizeIdentifier(connection.dataPromotionStatus)}`}</small>}
                          {isMarketingProvider && <small>{connection.resourceSelections.length
                            ? `${connection.resourceSelections.length} exact resource${connection.resourceSelections.length === 1 ? "" : "s"} selected`
                            : "No provider resources selected"}</small>}
                          {(provider.category === "Point of sale" || provider.id === "shopify") && <small>{connection.reportCatalog.providerReports.filter((report) => report.status === "ready").length} of {connection.reportCatalog.providerReports.length} source-specific reports ready</small>}
                          {connection.lastErrorCode && <small role="alert">Needs attention: {humanizeIdentifier(connection.lastErrorCode)}</small>}
                        </div>
                        <span className={`provider-account-state ${resourceError?.reconnect ? "error" : connection.status}`}>{resourceError?.reconnect ? "Authorization needed" : humanizeIdentifier(connection.status)}</span>
                        {isMarketingProvider && connection.sampleSummary && <section className="marketing-sample-review" aria-label={`Warning-free ${provider.name} sample review`}>
                          <header><div><b>Warning-free exact-resource sample</b><small>Completed {connection.sampleSummary.completedAt ? new Date(connection.sampleSummary.completedAt).toLocaleString("en-CA") : "recently"} · version {connection.sampleSummary.selectionVersion}</small></div><strong>{connection.sampleSummary.recordsStaged} measurements</strong></header>
                          <div>{connection.resourceSelections.map((selection) => {
                            const result = connection.sampleSummary?.resourceResults.find((item) => item.resourceSelectionId === selection.id);
                            return <span key={selection.id}><b>{selection.name}</b><small>{humanizeIdentifier(selection.dataset)} · {selection.scopeKind === "location" ? "Owned location scope" : "Organization-wide scope"}</small><em>{result?.recordsRead ?? 0} records · {result?.warningCodes.length ?? 0} warnings</em></span>;
                          })}</div>
                          <label><input type="checkbox" checked={reviewedMarketingSamples[connection.sampleSummary.runId] === true} onChange={(event) => setReviewedMarketingSamples((current) => ({ ...current, [connection.sampleSummary!.runId]: event.target.checked }))} />I reviewed every selected resource, scope, record count, and warning total above.</label>
                        </section>}
                        {connection.automaticSync && connection.status === "connected" && <AutomaticSyncControl
                          provider={provider.id} connectionId={connection.id} accountName={accountLabel}
                          status={connection.automaticSync} refresh={loadConnections} />}
                        {isMarketingProvider && resourceError && <section
                          id={resourceErrorId}
                          className="marketing-resource-error"
                          role="alert"
                          aria-atomic="true"
                        >
                          <b>{resourceError.reconnect ? `${provider.name} needs authorization` : "Resources could not be loaded"}</b>
                          <p>{resourceError.message}</p>
                          {resourceError.reconnect && <>
                            <p>Sign in with this account again, then choose the resources for this business.</p>
                            <button
                              type="button"
                              onClick={() => void connectProvider(provider.id as "google" | "meta")}
                              disabled={!canManageProvider || Boolean(connectionAction) || Boolean(providerAction)}
                            >{providerAction === "authorize" ? `Opening ${provider.name}…` : `Reconnect ${provider.name}`}</button>
                          </>}
                        </section>}
                        <div className="provider-account-actions">
                          {connection.status === "connected" && <>
                            {isQuickBooks ? <small>Company verified. Accounting import is not available yet. This connection does not update your reports.</small> : isMarketingProvider ? <>
                              <button
                                type="button"
                                onClick={(event) => void loadMarketingResources(provider.id as "google" | "meta", connection.id, event.currentTarget)}
                                aria-describedby={resourceError ? resourceErrorId : undefined}
                                aria-busy={connectionAction === "resources"}
                                disabled={!canManageProvider || Boolean(connectionAction) || Boolean(providerAction)}
                              >{connectionAction === "resources" ? "Loading…" : "Choose resources"}</button>
                              <button
                                type="button"
                                onClick={() => void syncMarketingProvider(provider.id as "google" | "meta", connection)}
                                disabled={!canManageProvider || Boolean(connectionAction) || !connection.syncEligible}
                                title={!connection.syncEligible ? "Choose at least one exact provider resource before synchronization." : undefined}
                              >{connectionAction === "sync" ? "Syncing…" : connection.dataPromotionStatus === "approved" ? "Sync now" : "Run sample"}</button>
                              {connection.dataPromotionStatus === "staging" && connection.sampleSummary && <button
                                type="button"
                                onClick={() => requestConnectionDataApproval(provider.id, connection.id, {
                                  sampleRunId: connection.sampleSummary!.runId,
                                  expectedSelectionVersion: connection.resourceSelectionVersion,
                                })}
                                disabled={!canManageProvider || Boolean(connectionAction) || reviewedMarketingSamples[connection.sampleSummary.runId] !== true}
                                title={reviewedMarketingSamples[connection.sampleSummary.runId] === true ? undefined : "Review the visible exact-resource sample and confirm it first."}
                              >{connectionAction === "approve" ? "Approving…" : "Approve reviewed sample"}</button>}
                            </> : <button
                              type="button"
                              onClick={() => void stageProviderSample(actionableProvider as "lightspeed" | "lightspeed-r" | "shopify" | "shopify-pos" | "square" | "clover" | "stripe" | "moneris", connection.id, connection.lastSuccessfulSyncAt)}
                              disabled={!canManageProvider || Boolean(connectionAction) || connection.syncActive}
                            >{connectionAction === "sync" || connection.syncActive ? "Syncing…" : connectionAction === "sample" ? "Working…" : provider.id === "moneris" ? "Sync payments" : provider.id === "lightspeed" || provider.id === "lightspeed-r" || provider.id === "shopify" || provider.id === "shopify-pos" || provider.id === "square" || provider.id === "clover" ? "Re-sync now" : "Stage sample"}</button>}
                            {hasLocationMapping && <button
                              type="button"
                              onClick={() => void loadProviderLocations(actionableProvider as "lightspeed" | "lightspeed-r" | "shopify" | "shopify-pos" | "square" | "clover", connection.id)}
                              disabled={!canManageProvider || Boolean(connectionAction)}
                            >{connectionAction === "locations" ? "Loading…" : `Map ${provider.id === "lightspeed-r" ? "shops" : provider.id === "clover" ? "merchant" : provider.id === "shopify" ? "channels" : provider.id === "square" || provider.id === "shopify-pos" ? "locations" : "outlets"}`}</button>}
                            {(provider.id === "lightspeed" || provider.id === "lightspeed-r" || provider.id === "shopify" || provider.id === "shopify-pos" || provider.id === "square" || provider.id === "clover") && connection.dataPromotionStatus === "staging" && connection.lastSuccessfulSyncAt && <button
                              type="button"
                              onClick={() => requestConnectionDataApproval(provider.id, connection.id)}
                              disabled={!canManageProvider || Boolean(connectionAction)}
                            >{connectionAction === "approve" ? "Approving…" : "Approve reviewed data"}</button>}
                            {provider.id === "moneris" && provider.providerReadiness?.dataPromotionEnabled === true && connection.reportingEnvironment === "production" && connection.dataPromotionStatus === "staging" && connection.lastSuccessfulSyncAt && <button
                              type="button"
                              onClick={() => requestConnectionDataApproval(provider.id, connection.id)}
                              disabled={!canManageProvider || Boolean(connectionAction)}
                            >{connectionAction === "approve" ? "Approving…" : "Approve reconciliation"}</button>}
                          </>}
                          {connection.dataPromotionStatus === "approved" && <button
                            type="button"
                            onClick={() => {
                              dataApprovalTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                              setPendingDataApproval({ provider: provider.id, connectionId: connection.id, exclude: true });
                            }}
                            disabled={!canManageProvider || Boolean(connectionAction) || connection.syncActive}
                          >{connectionAction === "exclude" ? "Excluding…" : "Exclude from reporting"}</button>}
                          <button
                            type="button"
                            className="danger-text"
                            onClick={() => void disconnectProvider(actionableProvider, connection.id, accountLabel)}
                            disabled={!canManageProvider || Boolean(connectionAction)}
                          >{connectionAction === "disconnect" ? "Disconnecting…" : "Disconnect"}</button>
                        </div>
                      </article>;
                    })}
                  </div>
                )}
                {isMoneris && provider.providerReadiness?.dataPromotionEnabled !== true && (
                  <div className="provider-setup-needed" role="note"><b>Payment import only</b><span>Imported payments stay separate from business reports while currency, refunds and settlement reconciliation are completed.</span></div>
                )}
                {isPlaid && configured && provider.providerReadiness?.mode !== "production" && (
                  <div className="provider-setup-needed" role="note"><b>Plaid sandbox</b><span>Test institutions only. Real bank authorization remains locked until Plaid approves Vanteloq for production access.</span></div>
                )}
                <div className="integration-card-footer">
                  <div>
                    <span className={`status ${connected ? "" : repairRequired ? "repair" : "planned"}`}>
                      {repairRequired
                        ? "Repair required"
                        : connected
                        ? "Connected"
                        : providerSetupRequired
                          ? "Provider required"
                        : providerUnavailable
                          ? "Unavailable"
                        : providerComingSoon
                          ? "Coming soon"
                        : provider.id === "shopify" || provider.id === "shopify-pos"
                          ? "App review pending"
                        : configured
                          ? "Ready to authorize"
                          : availabilityLabel(provider.availability)}
                    </span>
                    <span className="connection-lock">
                      {connectionsLoading
                        ? "Checking…"
                        : repairRequired
                        ? "Re-authentication required · sync paused"
                        : connected
                        ? provider.dataPromotionStatus === "approved"
                          ? provider.id === "lightspeed" || provider.id === "lightspeed-r" || provider.id === "shopify" || provider.id === "shopify-pos" || provider.id === "square" || provider.id === "clover"
                            ? "Approved sales, catalog, customers and suppliers are available"
                            : provider.id === "plaid"
                              ? "Reviewed bank data is available · fresh balances power cash analysis · transactions await review"
                              : isMarketingProvider
                                ? provider.providerReadiness?.liveDataEligible === true
                                  ? "Measurements are available in Marketing"
                                  : "Resource selection required · measurements unavailable"
                              : "Reviewed source data is available"
                          : "Staging only · metrics locked"
                          : providerSetupRequired
                            ? "Choose a supported provider before synchronization"
                            : providerUnavailable
                              ? "Connection not available"
                            : providerComingSoon
                              ? "Planned connector · no data access"
                          : configured
                            ? "Authorization required · metrics locked"
                            : "Synchronization unavailable"}
                    </span>
                  </div>
                  {isPlaid ? <div className="provider-actions">
                    {connected && provider.dataPromotionStatus === "staging" && provider.connections?.[0]?.lastSuccessfulSyncAt && <button
                      type="button"
                      onClick={() => requestConnectionDataApproval(provider.id, provider.connections![0].id)}
                      disabled={!canManageProvider || anyProviderAction}
                    >Approve reviewed data</button>}
                    <PlaidLinkButton
                      connected={connected}
                      repairRequired={repairRequired}
                      configured={configured}
                      canManage={canManageProvider && canManageBankConnections}
                      deletionAvailable={provider.status === "revoked" && !provider.privacyDataDeletedAt}
                      onChanged={loadConnections}
                      showNotice={showNotice}
                    />
                  </div> : supportsMultipleAccounts ? <div className="provider-actions">
                    <button
                      type="button"
                      onClick={() => isMoneris ? setMonerisFormOpen(true) : isQuickBooks ? setQuickBooksConsentOpen(true) : provider.id === "shopify" || provider.id === "shopify-pos" ? setShopifyConnectProvider(provider.id) : void connectProvider(actionableProvider)}
                      disabled={Boolean(disabledReason) || Boolean(providerAction)}
                      title={disabledReason || (isQuickBooks ? "Authorize a QuickBooks Online company for secure sandbox verification." : `Authorize another ${provider.name} account with its own credentials and import history.`)}
                    >{providerAction === "authorize" ? "Opening…" : connected ? "Connect another account" : "Connect"}</button>
                  </div> : provider.externalApplicationUrl && providerEntitled ? <div className="provider-actions">
                    <a href={provider.externalApplicationUrl} target="_blank" rel="noreferrer">{provider.externalApplicationLabel ?? "Request provider access"}</a>
                  </div> : showPlanRequirement ? <div className="provider-actions"><button type="button" disabled title={disabledReason}>{providerPlanLabel} required</button></div> : null}
                </div>
              </article>
            );})}
              </div>
            </section>)}
          </div>
          {marketingResourcePanel && <section ref={marketingResourcePanelRef} tabIndex={-1} className="outlet-mapping-panel marketing-resource-panel" aria-labelledby="marketing-resource-title">
            <header>
              <div>
                <p>EXACT RESOURCE CONTROL</p>
                <h3 id="marketing-resource-title">Choose only the {marketingResourcePanel.provider === "google" ? "Google" : "Meta"} resources Vanteloq may measure.</h3>
              </div>
              <strong>VERSION {marketingResourcePanel.selectionVersion}</strong>
            </header>
            <div className="outlet-mapping-list">
              {marketingResourcePanel.datasets.map((group) => <div key={group.dataset} className="marketing-resource-group">
                <h4>{humanizeIdentifier(group.dataset)}</h4>
                {group.status === "unavailable" ? <p className="outlet-empty" role="status">{group.message ?? "This service is temporarily unavailable. Retry discovery to check its access."}</p> : group.resources.length ? group.resources.map((resource) => <article key={`${group.dataset}:${resource.externalResourceRef}`} className="marketing-resource-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={resource.selected}
                      onChange={(event) => updateMarketingResource(group.dataset, resource.externalResourceRef, { selected: event.target.checked })}
                    />
                    <span><b>{resource.name}</b><small>{resource.externalResourceRef}</small></span>
                  </label>
                  {resource.selected && <div className="marketing-resource-scope">
                    <select
                      value={resource.scopeKind}
                      onChange={(event) => updateMarketingResource(group.dataset, resource.externalResourceRef, {
                        scopeKind: event.target.value as "organization" | "location",
                        localLocationId: event.target.value === "organization" ? null : resource.localLocationId,
                      })}
                      aria-label={`Scope for ${resource.name}`}
                    >
                      <option value="organization">Organization-wide source</option>
                      <option value="location">Map to one location</option>
                    </select>
                    {resource.scopeKind === "location" && <select
                      value={resource.localLocationId ?? ""}
                      onChange={(event) => updateMarketingResource(group.dataset, resource.externalResourceRef, { localLocationId: event.target.value || null })}
                      aria-label={`Location for ${resource.name}`}
                    >
                      <option value="">Choose a location</option>
                      {marketingResourcePanel.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                    </select>}
                  </div>}
                </article>) : <p className="outlet-empty">No accessible resources were returned for this dataset.</p>}
              </div>)}
            </div>
            <footer>
              <span>{marketingResourcePanel.selectionBlocked
                ? "An existing service could not be verified. Your selections and measurements are preserved. Close this panel and retry discovery before saving."
                : "Saving replaces this account’s selection, deletes its prior marketing measurements, and requires a new warning-free sample before dashboard use."}</span>
              <div className="provider-actions">
                <button type="button" onClick={closeMarketingResourcePanel}>Cancel</button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void saveMarketingResources()}
                  disabled={marketingResourcePanel.selectionBlocked || Boolean(providerActions[integrationActionKey(marketingResourcePanel.provider, marketingResourcePanel.connectionId)])}
                >Save exact resources</button>
              </div>
            </footer>
          </section>}
          {outletData && <section className="outlet-mapping-panel" aria-labelledby="outlet-mapping-title">
            <header>
              <div><p>LOCATION CONTROL</p><h3 id="outlet-mapping-title">{outletData.provider === "lightspeed-r" ? `Match ${outletData.accountName || "this R-Series account"}'s shops to Vanteloq locations.` : outletData.provider === "clover" ? `Match ${outletData.accountName || "this Clover merchant"} to a Vanteloq location.` : outletData.provider === "square" ? `Match ${outletData.accountName || "this Square seller"}'s locations to Vanteloq locations.` : `Match ${outletData.accountName || "this X-Series account"}'s outlets to Vanteloq locations.`}</h3></div>
              <strong>{outletData.mappings.filter((mapping) => mapping.status === "mapped").length} / {outletData.mappings.length} mapped</strong>
            </header>
            {outletData.mappings.length ? <div className="outlet-mapping-list">
              {outletData.mappings.map((mapping) => <label key={mapping.externalLocationRef}>
                <span><b>{mapping.externalName}</b><small>{mapping.externalLocationRef}</small></span>
                <select
                  value={mapping.status === "ignored" ? "__ignored__" : mapping.localLocationId ?? ""}
                  onChange={(event) => void saveOutletMapping(mapping.externalLocationRef, event.target.value)}
                  disabled={Boolean(providerActions[integrationActionKey(outletData.provider ?? "lightspeed", outletData.connectionId)])}
                  aria-label={`Map ${mapping.externalName}`}
                >
                  <option value="">{outletData.provider === "lightspeed-r" || outletData.provider === "square" || outletData.provider === "clover" ? "Not mapped — dashboard data stays locked" : "Unmapped: keeps dashboard data locked"}</option>
                  {outletData.localLocations.filter((location) => location.status === "active").map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  <option value="__ignored__">Ignore this outlet</option>
                </select>
              </label>)}
            </div> : <p className="outlet-empty">No {outletData.locationLabel === "shop" ? "shops" : outletData.locationLabel === "merchant" ? "merchant location" : outletData.locationLabel === "location" ? "Square locations" : "outlets"} were returned. Confirm the retailer has an active location, then retry discovery.</p>}
            <footer>
              <span>{outletData.provider === "lightspeed-r" ? "Each authorized R-Series account keeps its own credentials, shop mappings, last sync position, and import history. Ignored shops stay excluded from future imports." : outletData.provider === "clover" ? "Each authorized Clover merchant keeps separate encrypted credentials, a location mapping, rotating refresh state, and staged import history. Card data is never imported." : outletData.provider === "square" ? "Each authorized Square seller keeps separate encrypted credentials, location mappings, refresh state and staged import history. Vanteloq imports tender categories, never raw card data." : outletData.provider === "shopify" ? "Each authorized Shopify store keeps separate encrypted credentials, an online-store mapping, refresh state, and import history. Online orders remain distinct from Shopify POS activity." : outletData.provider === "shopify-pos" ? "Each authorized Shopify store keeps separate encrypted credentials, retail-location mappings, refresh state, and Shopify POS import history. Raw card data is never imported." : "Each authorized X-Series account keeps its own credentials, outlet mappings, last sync position, and staged import history. Ignored outlets stay excluded and visible during review."}</span>
              <button type="button" onClick={() => navigate("Settings")}>Add organization location</button>
            </footer>
          </section>}
          {marketingSampleResult && marketingSampleResult.run.warningCount > 0 && <section className="sample-sync-result marketing-sample-warning" aria-live="polite">
            <header><div><p>{marketingSampleResult.provider === "google" ? "GOOGLE" : "META"} EXACT-RESOURCE SAMPLE</p><h3>This sample remains staged and cannot be approved.</h3></div><strong>REVIEW WARNINGS</strong></header>
            <div><span><small>RECORDS READ</small><b>{marketingSampleResult.run.recordsRead}</b></span><span><small>RECORDS STAGED</small><b>{marketingSampleResult.run.recordsImported}</b></span><span><small>RESOURCES</small><b>{marketingSampleResult.resourceResults.length}</b></span><span><small>WARNINGS</small><b>{marketingSampleResult.run.warningCount}</b></span></div>
            <section className="marketing-sample-result-list">{marketingSampleResult.resourceResults.map((result) => <span key={result.resourceSelectionId}><b>{result.resourceName}</b><small>{humanizeIdentifier(result.dataset)} · {result.scope}</small><em>{result.recordsRead} records · {result.warningCodes.length ? result.warningCodes.map((code) => humanizeIdentifier(code)).join(", ") : "No resource warning"}</em></span>)}</section>
            <p>{marketingSampleResult.nextStep} {marketingSampleResult.warnings.length ? `Warnings: ${marketingSampleResult.warnings.map((warning) => humanizeIdentifier(warning)).join(", ")}.` : ""}</p>
          </section>}
          {sampleResult && <section className={`sample-sync-result ${sampleResult.readyForReview ? "review-ready" : ""}`} aria-live="polite">
            <header>
              <div>
                <p>{activeSampleProvider === "stripe" ? "STRIPE SAMPLE RECONCILIATION" : activeSampleProvider === "moneris" ? "MONERIS PAYMENT RECONCILIATION" : activeSampleProvider === "lightspeed-r" ? "R-SERIES DATA SYNC" : activeSampleProvider === "shopify" ? "SHOPIFY E-COMMERCE DATA SYNC" : activeSampleProvider === "shopify-pos" ? "SHOPIFY POS DATA SYNC" : activeSampleProvider === "square" ? "SQUARE DATA SYNC" : activeSampleProvider === "clover" ? "CLOVER DATA SYNC" : "X-SERIES SAMPLE RECONCILIATION"}</p>
                <h3>{sampleResult.dataPromotionEnabled === true
                  ? sampleResult.backfillComplete === false ? "Approved data refreshed. History is still importing." : "Approved data refreshed."
                  : activeSampleProvider === "lightspeed-r" || activeSampleProvider === "shopify" || activeSampleProvider === "shopify-pos" || activeSampleProvider === "square" || activeSampleProvider === "clover"
                  ? sampleResult.readyForReview
                    ? `The ${activeSampleProvider === "clover" ? "Clover" : activeSampleProvider === "square" ? "Square" : activeSampleProvider === "shopify" ? "Shopify e-commerce" : activeSampleProvider === "shopify-pos" ? "Shopify POS" : "R-Series"} import is ready for your review.`
                    : sampleResult.run.warningCount > 0
                      ? `The ${activeSampleProvider === "clover" ? "Clover" : activeSampleProvider === "square" ? "Square" : activeSampleProvider === "shopify" ? "Shopify e-commerce" : activeSampleProvider === "shopify-pos" ? "Shopify POS" : "R-Series"} import needs attention before review.`
                      : `The ${activeSampleProvider === "clover" ? "Clover" : activeSampleProvider === "square" ? "Square" : activeSampleProvider === "shopify" ? "Shopify e-commerce" : activeSampleProvider === "shopify-pos" ? "Shopify POS" : "R-Series"} backfill is still in progress.`
                  : "Staged safely. Nothing has entered live metrics."}</h3>
              </div>
              <strong>{sampleResult.dataPromotionEnabled === true ? "APPROVED RECORDS" : (activeSampleProvider === "lightspeed-r" || activeSampleProvider === "shopify" || activeSampleProvider === "shopify-pos" || activeSampleProvider === "square" || activeSampleProvider === "clover") && sampleResult.readyForReview ? "READY TO REVIEW" : sampleResult.readyForReview ? "READY TO VERIFY" : "DASHBOARD DATA LOCKED"}</strong>
            </header>
            <div>
              <span><small>RECORDS READ</small><b>{sampleResult.run.recordsRead}</b></span>
              <span><small>{activeSampleProvider === "lightspeed-r" || activeSampleProvider === "shopify" || activeSampleProvider === "shopify-pos" || activeSampleProvider === "square" || activeSampleProvider === "clover" ? "RECORDS IMPORTED" : "NEWLY STAGED"}</small><b>{sampleResult.run.recordsStaged}</b></span>
              <span><small>DUPLICATES SKIPPED</small><b>{sampleResult.run.duplicatesSkipped ?? 0}</b></span>
              <span><small>{activeSampleProvider === "stripe" ? "PAYOUTS READ" : activeSampleProvider === "moneris" ? "PAYMENTS READ" : activeSampleProvider === "lightspeed-r" || activeSampleProvider === "shopify" || activeSampleProvider === "shopify-pos" || activeSampleProvider === "square" || activeSampleProvider === "clover" ? "DAILY SUMMARIES" : "UNMAPPED LOCATIONS"}</small><b>{activeSampleProvider === "stripe" ? sampleResult.reconciliation.payouts ?? 0 : activeSampleProvider === "moneris" ? sampleResult.reconciliation.payments ?? 0 : activeSampleProvider === "lightspeed-r" || activeSampleProvider === "shopify" || activeSampleProvider === "shopify-pos" || activeSampleProvider === "square" || activeSampleProvider === "clover" ? sampleResult.reconciliation.dailyMetrics ?? 0 : sampleResult.reconciliation.unmappedOutlets ?? 0}</b></span>
              {(activeSampleProvider === "lightspeed-r" || activeSampleProvider === "shopify" || activeSampleProvider === "shopify-pos" || activeSampleProvider === "square" || activeSampleProvider === "clover") && <>
                <span><small>UNMAPPED SHOPS</small><b>{sampleResult.reconciliation.unmappedLocations ?? 0}</b></span>
                <span><small>{activeSampleProvider === "shopify" ? "ONLINE ORDERS" : "COMPLETED SALES"}</small><b>{sampleResult.reconciliation.completedSales ?? sampleResult.reconciliation.orders ?? 0}</b></span>
                <span><small>INVENTORY BALANCES</small><b>{sampleResult.reconciliation.inventoryBalances ?? 0}</b></span>
                <span><small>OPEN SALES SKIPPED</small><b>{sampleResult.reconciliation.openSales ?? 0}</b></span>
                <span><small>VOIDED SALES SKIPPED</small><b>{sampleResult.reconciliation.voidedSales ?? 0}</b></span>
              </>}
            </div>
            <p>{sampleResult.nextStep}</p>
            {activeSampleProvider === "lightspeed-r" && <small className="sample-contract-note">Vanteloq imports completed sales and per-shop inventory from the authorized R-Series account. Open, voided and ignored-shop records stay excluded and visible in this reconciliation.</small>}
            {activeSampleProvider === "shopify" && <small className="sample-contract-note">Vanteloq imports online-store orders, refunds, tender categories, products, stock and authorized customer records from this Shopify store. Shopify POS activity remains separate. Raw card data is never requested, and profit stays unavailable for products without a verified unit cost.</small>}
            {activeSampleProvider === "shopify-pos" && <small className="sample-contract-note">Vanteloq imports completed Shopify POS orders, tenders, retail locations, products, stock and authorized customer records from this store. Raw card data is never requested. Profit remains unavailable for products without a verified unit cost.</small>}
            {activeSampleProvider === "square" && <small className="sample-contract-note">Vanteloq imports completed Square orders, line items, tender categories, customers, catalog and inventory from the authorized seller. It never imports raw card data. Because Square does not provide a dependable product-cost field, profit remains unavailable until a verified cost source is connected.</small>}
            {activeSampleProvider === "clover" && <small className="sample-contract-note">Vanteloq imports completed Clover orders, line items, tender categories, customers, catalog and inventory from the authorized merchant. It never imports raw card data, and missing item cost keeps profit unavailable.</small>}
            {activeSampleProvider === "moneris" && <small className="sample-contract-note">Vanteloq imports successful Moneris payment amounts, status and timing for payment reconciliation and BookLoQ cash analysis. It does not request or store PAN, CVV or raw cardholder data, and it does not claim to provide inventory or customer identity.</small>}
          </section>}
        </>
      )}
      {pendingDataApproval && <div
        className="modal-backdrop"
        onMouseDown={(event) => { if (event.target === event.currentTarget) closeDataApproval(); }}
      >
        <section
          ref={dataApprovalDialogRef}
          tabIndex={-1}
          className="task-modal data-approval-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="data-approval-title"
          aria-describedby="data-approval-description"
        >
          <div className="modal-head">
            <div>
              <p className="card-kicker">REPORTING CONTROL</p>
              <h2 id="data-approval-title">{pendingDataApproval.exclude ? "Exclude this account from reporting?" : "Make these reviewed records available?"}</h2>
            </div>
            <button type="button" aria-label="Close approval dialog" onClick={closeDataApproval}>×</button>
          </div>
          <p id="data-approval-description" className="data-approval-copy">
            {pendingDataApproval.exclude
              ? "This account will no longer contribute to business reports, forecasts or AI evidence. Its connection and imported records stay available for review. You can review and approve its data again later."
              : "Vanteloq will allow dashboard and BookLoQ features to use the reviewed records from this provider account. The source, connection, and audit history remain traceable."}
          </p>
          <div className="modal-actions">
            <button type="button" onClick={closeDataApproval}>Cancel</button>
            <button type="button" className="primary" onClick={() => void approveConnectionData()}>{pendingDataApproval.exclude ? "Exclude from reporting" : "Approve reviewed data"}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}

function availabilityLabel(value: IntegrationCatalogEntry["availability"]) {
  return value === "provider_selection_required"
    ? "Provider selection required"
    : value === "coming_soon"
      ? "Coming soon"
    : value === "provider_access_required"
      ? "Provider approval required"
    : value === "credentials_required"
      ? "Credentials required"
      : "Provider build required";
}

function lightspeedConfigurationLabel(value: string) {
  const labels: Record<string, string> = {
    LIGHTSPEED_X_CLIENT_ID: "Developer app client ID",
    LIGHTSPEED_X_CLIENT_SECRET: "Developer app client secret",
    LIGHTSPEED_X_REDIRECT_URI: "Approved callback URL",
    LIGHTSPEED_X_TOKEN_ENCRYPTION_KEY: "Encrypted token storage key",
    LIGHTSPEED_R_CLIENT_ID: "R-Series client ID",
    LIGHTSPEED_R_CLIENT_SECRET: "R-Series client secret",
    LIGHTSPEED_R_REDIRECT_URI: "R-Series callback URL",
    QUICKBOOKS_CLIENT_ID: "QuickBooks client ID",
    QUICKBOOKS_CLIENT_SECRET: "QuickBooks client secret",
    QUICKBOOKS_REDIRECT_URI: "Approved QuickBooks callback URL",
    QUICKBOOKS_ENV: "QuickBooks environment",
    SHOPIFY_CLIENT_ID: "Shopify app client ID",
    SHOPIFY_CLIENT_SECRET: "Shopify app client secret",
    SHOPIFY_REDIRECT_URI: "Approved Shopify callback URL",
    SHOPIFY_WEBHOOK_URL: "Shopify webhook URL",
    SQUARE_APPLICATION_ID: "Square application ID",
    SQUARE_APPLICATION_SECRET: "Square application secret",
    SQUARE_REDIRECT_URI: "Approved Square callback URL",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "Square webhook signature key",
    SQUARE_WEBHOOK_URL: "Verified Square webhook URL",
    SQUARE_ENV: "Square environment",
    CLOVER_APP_ID: "Clover app ID",
    CLOVER_APP_SECRET: "Clover app secret",
    CLOVER_REDIRECT_URI: "Approved Clover callback URL",
    CLOVER_WEBHOOK_AUTH_SECRET: "Clover webhook authorization secret",
    INTEGRATION_ENCRYPTION_KEY: "Encrypted token storage key",
    PLAID_CLIENT_ID: "Plaid client ID",
    PLAID_SECRET: "Plaid secret",
    PLAID_ENV: "Plaid environment",
    PLAID_WEBHOOK_URL: "Verified Plaid webhook URL",
    PLAID_REDIRECT_URI: "Approved Plaid redirect URL",
    GOOGLE_MARKETING_CLIENT_ID: "Google OAuth client ID",
    GOOGLE_MARKETING_CLIENT_SECRET: "Google OAuth client secret",
    GOOGLE_MARKETING_REDIRECT_URI: "Approved Google callback URL",
    GOOGLE_ADS_DEVELOPER_TOKEN: "Google Ads developer token",
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: "Google Ads manager customer ID",
    GOOGLE_ADS_API_VERSION: "Google Ads API version",
    META_MARKETING_APP_ID: "Meta app ID",
    META_MARKETING_APP_SECRET: "Meta app secret",
    META_MARKETING_REDIRECT_URI: "Approved Meta callback URL",
  };
  return labels[value] ?? "Provider configuration";
}

const toCents = (
  value: string | FormDataEntryValue | null,
  optional = false,
) => {
  const text = String(value ?? "").replace(/[$,\s]/g, "");
  if (!text && optional) return null;
  const number = Number(text || 0);
  if (!Number.isFinite(number))
    throw new Error(`Invalid money value: ${String(value)}`);
  return Math.round(number * 100);
};
function DailyImport({
  refresh,
  showNotice,
}: {
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const manualForm = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    rows: unknown[]; importType: string; fileName: string; key: string; review: DailyImportReview;
  } | null>(null);
  const [reason, setReason] = useState("");
  const submitRows = async (
    rows: unknown[],
    importType: string,
    fileName = "",
    key = crypto.randomUUID(),
    replacement?: { snapshot: string; reason: string },
  ) => {
    const response = await apiFetch("/api/v1/daily-metrics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({ importType, fileName, rows, replacement }),
    });
    const body = await response.json();
    if (response.status === 409 && body.review) {
      setPending({ rows, importType, fileName, key, review: body.review });
      setReason("");
      setError(body.error?.message ?? "Review the existing records before replacing them.");
      return false;
    }
    if (!response.ok)
      throw new Error(
        body.error?.message ?? "The import could not be completed.",
      );
    setPending(null);
    setReason("");
    await refresh();
    showNotice(
      `${body.import.rowCount} verified daily record${body.import.rowCount === 1 ? "" : "s"} saved`,
    );
    return true;
  };
  const importCsv = async () => {
    if (!file || pending) return;
    setBusy(true);
    setError("");
    try {
      const saved = await submitRows(
        parseDailyCsv(await file.text()),
        "daily_summary_csv",
        file.name,
      );
      if (saved) setFile(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The CSV could not be read.",
      );
    } finally {
      setBusy(false);
    }
  };
  const submitManual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formElement = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      const form = new FormData(formElement);
      const saved = await submitRows(
        [
          {
            businessDate: form.get("date"),
            locationRef: form.get("location") || "all",
            grossSalesCents: toCents(form.get("gross")),
            netSalesCents: toCents(form.get("net")),
            costOfGoodsCents: toCents(form.get("cogs")),
            transactionCount: Number(form.get("transactions")),
            unitsSold: Number(form.get("units")),
            refundsCents: toCents(form.get("refunds")),
            discountsCents: toCents(form.get("discounts")),
            labourCostCents: toCents(form.get("labour"), true),
            inventoryValueCents: toCents(form.get("inventory"), true),
            cashBalanceCents: toCents(form.get("cash"), true),
            accountsPayableCents: toCents(form.get("payable"), true),
          },
        ],
        "manual_entry",
      );
      if (saved) formElement.reset();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The entry could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const confirmReplacement = async () => {
    if (!pending || reason.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      const saved = await submitRows(pending.rows, pending.importType, pending.fileName, pending.key, {
        snapshot: pending.review.snapshot, reason: reason.trim(),
      });
      if (saved && pending.importType === "daily_summary_csv") setFile(null);
      if (saved && pending.importType === "manual_entry") manualForm.current?.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The correction could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const downloadTemplate = () => {
    const csv =
      "business_date,gross_sales,net_sales,cogs,transactions,units,refunds,discounts,labour_cost,inventory_value,cash_balance,accounts_payable,location\n2026-08-01,0,0,0,0,0,0,0,0,,,,Main\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "vanteloq-daily-summary-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="import-layout">
      <article className="card csv-import">
        <div className="card-head">
          <div>
            <p className="card-kicker">FASTEST START</p>
            <h3>Daily summary CSV</h3>
          </div>
          <button onClick={downloadTemplate}>Download template</button>
        </div>
        <p>
          One row per business day. Required: date, gross and net sales, product
          cost, transactions and units. Optional balances improve cash and
          inventory visibility.
        </p>
        <label className="drop-zone">
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy || Boolean(pending)}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <b>{file ? file.name : "Choose a CSV file"}</b>
          <span>Maximum 366 daily rows · no customer or payment-card data</span>
        </label>
        <button
          className="primary wide"
          disabled={!file || busy || Boolean(pending)}
          onClick={() => void importCsv()}
        >
          {busy ? "Validating…" : "Validate and import"}
        </button>
      </article>
      <form ref={manualForm} className="card manual-entry" onSubmit={submitManual}>
        <div className="card-head">
          <div>
            <p className="card-kicker">MANUAL ENTRY</p>
            <h3>Add one verified day</h3>
          </div>
          <span>All amounts in dollars</span>
        </div>
        <fieldset className="manual-grid" disabled={busy || Boolean(pending)} aria-label="Daily record values">
          <label><FieldLabel>Date</FieldLabel><input required type="date" name="date" />
          </label>
          <label>
            Location
            <input name="location" defaultValue="Main" maxLength={80} />
          </label>
          <label><FieldLabel>Gross Sales</FieldLabel><input required name="gross" inputMode="decimal" />
          </label>
          <label><FieldLabel>Net Sales</FieldLabel><input required name="net" inputMode="decimal" />
          </label>
          <label><FieldLabel>Product Cost (COGS)</FieldLabel><input required name="cogs" inputMode="decimal" />
          </label>
          <label>
            Labour cost (Optional)
            <input name="labour" inputMode="decimal" placeholder="Enter a recorded amount" />
          </label>
          <label><FieldLabel>Transactions</FieldLabel><input
              required
              name="transactions"
              type="number"
              min="0"
              step="1"
            />
          </label>
          <label><FieldLabel>Units Sold</FieldLabel><input required name="units" type="number" min="0" step="1" />
          </label>
          <label>
            Refunds
            <input name="refunds" inputMode="decimal" defaultValue="0" />
          </label>
          <label>
            Discounts
            <input name="discounts" inputMode="decimal" defaultValue="0" />
          </label>
          <label>
            Inventory value
            <input name="inventory" inputMode="decimal" />
          </label>
          <label>
            Operating cash
            <input name="cash" inputMode="decimal" />
          </label>
          <label>
            Accounts payable
            <input name="payable" inputMode="decimal" />
          </label>
        </fieldset>
        <button className="primary wide" disabled={busy || Boolean(pending)}>
          {busy ? "Saving…" : "Save verified day"}
        </button>
      </form>
      {error && <p className="import-error" role="alert">{error}</p>}
      {pending && <DailyImportReviewPanel review={pending.review} reason={reason} onReasonChange={setReason}
        busy={busy} onConfirm={() => void confirmReplacement()}
        onCancel={() => { setPending(null); setReason(""); setError(""); }} />}
      <section className="data-contract">
        <div>
          <b>Analysis supported by this entry</b>
          <span>
            Sales, gross profit, margin, contribution, transactions, unit rate,
            refunds, discounts, labour pressure, period comparisons and balance
            visibility.
          </span>
        </div>
        <div>
          <b>What remains unavailable</b>
          <span>
            Product, category, customer, campaign, employee, hour and supplier
            causes require their matching source feeds.
          </span>
        </div>
      </section>
    </div>
  );
}

function DecisionJournal({
  currency,
  showNotice,
}: {
  currency: string;
  showNotice: (message: string) => void;
}) {
  type EventRow = {
    id: string;
    eventType: string;
    title: string;
    detail: string;
    eventDate: string;
    expectedOutcome: string;
    measuredImpact: {
      measurable: boolean;
      reason?: string;
      changeRate?: number;
      beforeAverageSalesCents?: number;
      afterAverageSalesCents?: number;
    };
  };
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await apiFetch("/api/v1/events");
    const body = await response.json();
    if (response.ok) setEvents(body.events);
    else setError(body.error?.message ?? "Unable to load business memory.");
    setLoading(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await apiFetch("/api/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: form.get("eventType"),
        title: form.get("title"),
        detail: form.get("detail"),
        eventDate: form.get("eventDate"),
        expectedOutcome: form.get("expectedOutcome"),
        reviewDate: form.get("reviewDate") || null,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Unable to save the event.");
      return;
    }
    event.currentTarget.reset();
    await load();
    showNotice("Business memory recorded");
  };
  return (
    <div className="content journal-page">
      <section className="page-intro">
        <div>
          <p>BUSINESS MEMORY</p>
          <h2>Record decisions. Measure what changed.</h2>
          <span>
            Vanteloq compares up to 14 days before and after each event when
            enough verified history exists. Correlation is shown as
            correlation, not proof of causation.
          </span>
        </div>
      </section>
      <div className="journal-layout">
        <form className="card event-form" onSubmit={submit}>
          <h3>Record an event or decision</h3>
          <div className="form-row">
            <label>
              Type
              <select name="eventType" defaultValue="decision">
                <option value="decision">Decision</option>
                <option value="promotion">Promotion</option>
                <option value="hours">Hours changed</option>
                <option value="staffing">Staffing change</option>
                <option value="supplier_price">Supplier price</option>
                <option value="stockout">Stockout</option>
                <option value="competitor">Competitor event</option>
                <option value="construction">Construction / traffic</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label><FieldLabel>Event Date</FieldLabel><input required type="date" name="eventDate" />
            </label>
            <label>
              Review date
              <input type="date" name="reviewDate" />
            </label>
          </div>
          <label><FieldLabel>Title</FieldLabel><input required name="title" maxLength={120} />
          </label>
          <label>
            Context
            <textarea name="detail" maxLength={2000} />
          </label>
          <label>
            Expected outcome
            <input name="expectedOutcome" maxLength={500} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary">Record in business memory</button>
        </form>
        <section className="event-list">
          {loading ? (
            <WorkspaceSkeleton compact label="Loading business memory"/>
          ) : !events.length ? (
            <div className="empty-state">
              <b>No events recorded.</b>
              <span>
                Record a promotion, schedule change, stockout or major decision.
              </span>
            </div>
          ) : (
            events
              .slice()
              .reverse()
              .map((item) => (
                <article className="card event-card" key={item.id}>
                  <div>
                    <span>{item.eventType.replace("_", " ")}</span>
                    <time>{item.eventDate}</time>
                  </div>
                  <h3>{item.title}</h3>
                  {item.detail && <p>{item.detail}</p>}
                  <div
                    className={
                      item.measuredImpact.measurable
                        ? "impact measurable"
                        : "impact"
                    }
                  >
                    {item.measuredImpact.measurable ? (
                      <>
                        <b>
                          {percent(item.measuredImpact.changeRate)} average
                          daily sales
                        </b>
                        <span>
                          {money(
                            item.measuredImpact.beforeAverageSalesCents,
                            currency,
                          )}{" "}
                          before →{" "}
                          {money(
                            item.measuredImpact.afterAverageSalesCents,
                            currency,
                          )}{" "}
                          after
                        </span>
                      </>
                    ) : (
                      <>
                        <b>Impact not measurable yet</b>
                        <span>{item.measuredImpact.reason}</span>
                      </>
                    )}
                  </div>
                </article>
              ))
          )}
        </section>
      </div>
    </div>
  );
}


export function BusinessBrief({
  data,
  currency,
  navigate,
  createTask,
}: {
  data: CommandCentre;
  currency: string;
  navigate: (view: View) => void;
  createTask: (seed: TaskSeed) => void;
}) {
  if (!data.ready || !data.current)
    return <><FirstInsightPath data={data} navigate={navigate}/><EmptyCommandCentre navigate={navigate} /></>;
  const current = data.current;
  const verified = (metricId: string) => data.metrics[metricId]?.actuality === "actual";
  const contributionAvailable = verified("contribution_after_labour");
  return (
    <div className="content brief-page">
      <section className="brief-document">
        <div className="brief-mast">
          <div>
            <p>OWNER BRIEF · DATA THROUGH {data.source.latestBusinessDate}</p>
            <h2>Your operating picture in one page.</h2>
          </div>
          <span>{data.dataQuality.status} data</span>
        </div>
        <section className="brief-summary">
          <b>{data.insights[0]?.title}</b>
          <p>
            {data.insights[0]?.whatHappened} {data.insights[0]?.probableCause}
          </p>
        </section>
        <div className="brief-numbers">
          <Metric
            label="Net sales"
            value={verified("net_sales") ? money(current.netSalesCents, currency) : "Not available"}
            delta={percent(data.comparisons?.netSalesRate)}
            detail="Current 30-day window"
          />
          <Metric
            label="Gross profit"
            value={verified("gross_profit") ? money(current.grossProfitCents, currency) : "Not available"}
            delta={percent(data.comparisons?.grossProfitRate)}
            detail="Before operating expenses"
          />
          <Metric
            label="Contribution"
            value={contributionAvailable ? money(current.contributionCents, currency) : "Not available"}
            delta={contributionAvailable && verified("labour_rate") ? `Labour: ${percent(current.labourRate)} of sales` : ""}
            detail={contributionAvailable ? "After recorded labour costs" : "Verified sales, cost and labour records required"}
          />
        </div>
        <h3>Prioritized actions</h3>
        {data.insights.map((insight, index) => (
          <div className="brief-action" key={insight.id}>
            <b>{index + 1}</b>
            <span>
              <strong>{insight.recommendedAction}</strong>
              <small>{insight.financialImpact}</small>
            </span>
            <button
              onClick={() =>
                createTask({
                  ...insight.suggestedTask,
                  sourceType: "insight",
                  sourceRef: insight.id,
                })
              }
            >
              Assign
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function Advisor({
  data,
  navigate,
  createTask,
  activeLocationId,
  retailSeed,
}: {
  data: CommandCentre;
  navigate: (view: View) => void;
  createTask: (seed: TaskSeed) => void;
  activeLocationId: string | null;
  retailSeed?: RetailAdvisorSeed | null;
}) {
  const [question, setQuestion] = useState(retailSeed?.question ?? "");
  const [analysisPeriod, setAnalysisPeriod] = useState<{ from: string; to: string } | null>(retailSeed ? { from: retailSeed.from, to: retailSeed.to } : null);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const provider: AdvisorMode = "openai";
  const [purpose, setPurpose] = useState<"analysis" | "help">("analysis");
  const [thinking, setThinking] = useState(false);
  const savedConsent = useAdvisorConsent(apiFetch, activeLocationId ?? "organization");
  const dataUseAccepted = savedConsent.consent[purpose];
  const activeRequest = useRef<AbortController | null>(null);
  const [responseError, setResponseError] = useState("");
  useEffect(() => () => { activeRequest.current?.abort(); activeRequest.current = null; }, []);
  const [providers, setProviders] = useState({ openai: { ready: false, reason: "Checking OpenAI availability." as string | null } });
  const [providersLoading, setProvidersLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void apiFetch("/api/v1/advisor/chat").then(async response => { if (!response.ok) throw new Error("unavailable"); return response.json(); }).then(payload => {
      if (active && payload.providers) {
        setProviders(payload.providers);
      }
    }).catch(() => { if (active) setProviders({ openai: { ready: false, reason: "Provider availability could not be checked. Reopen Vanteloq AI to retry." } }); }).finally(() => { if (active) setProvidersLoading(false); });
    return () => { active = false; };
  }, []);
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{
    title: string;
    body: string;
    limitation: string;
    seed?: TaskSeed;
    animate?: boolean;
  } | null>(null);
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  const [history, setHistory] = useState<Array<{ question: string; answer: NonNullable<typeof answer> }>>([]);
  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (activeRequest.current || savedConsent.busy || savedConsent.error || !advisorProviders(provider).every(item => providers[item].ready) || !canAskAdvisor(question, dataUseAccepted, loading)) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    if (answer) setHistory(previous => [...previous, { question: submittedQuestion, answer }].slice(-5));
    setAnswer(null);
    setResponseError("");
    setSubmittedQuestion(question);
    setLoading(true);
    setThinking(true);
    const normalized = question.toLowerCase();
    try {
      const { response, payload } = await readAdvisorAnswer(apiFetch, { question, provider, purpose, conversationId, dataUseAccepted, memoryEnabled, locationId: activeLocationId, ...(purpose === "analysis" && analysisPeriod ? analysisPeriod : {}) }, controller.signal);
      if (activeRequest.current !== controller) return;
      if (!response.ok) {
        if (payload.error?.code?.startsWith("ADVISOR_CONSENT")) void savedConsent.refresh();
        throw new Error(payload.error?.message ?? "The advisor could not answer right now.");
      }
      setConversationId(payload.conversationId ?? null);
      if (payload.status === "configuration_required") {
        setResponseError(payload.message ?? "OpenAI setup needs administrator attention.");
        return;
      }
      if (payload.answer) {
        setQuestion("");
        setAnswer({ title: "Vanteloq AI", body: payload.answer, limitation: purpose === "help" ? "Workspace data is off." : "Based on the permitted records available for this question.", animate: true });
        return;
      }
    } catch (error) {
      if (activeRequest.current !== controller) return;
      setResponseError(error instanceof Error ? error.message : "This reply could not be completed. Your question is ready to try again.");
      return;
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
        setThinking(false);
      }
    }
    /* Explicit local evidence is available when no external answer was returned. */
    if (purpose === "help") { setAnswer({ title: "Help is available", body: "Open the help centre for verified product instructions.", limitation: "No AI response was returned." }); return; }
    const insight =
      normalized.includes("margin") ||
      normalized.includes("profit") ||
      normalized.includes("losing")
        ? data.insights.find((item) => item.id === "margin-trend")
        : normalized.includes("labour") || normalized.includes("staff")
          ? data.insights.find((item) => item.id === "labour-pressure")
          : normalized.includes("sales") || normalized.includes("why")
            ? (data.insights.find((item) => item.id === "sales-trend") ??
              data.insights[0])
            : null;
    if (insight)
      setAnswer({
        title: insight.title,
        body: `${insight.whatHappened} ${insight.probableCause} Recommended: ${insight.recommendedAction}`,
        limitation: `Local evidence summary; no AI response was returned. Confidence: ${insight.confidence}. Missing: ${insight.missingInformation.join(", ")}.`,
        seed: {
          ...insight.suggestedTask,
          sourceType: "insight",
          sourceRef: insight.id,
        },
      });
    else
      setAnswer({
        title: "The current data cannot support that answer",
        body: "The available daily summaries cover sales, cost, labour and aggregate balances.",
        limitation:
          "Product, customer, campaign, supplier or hourly questions need their corresponding feeds.",
      });
  };
  const stopResponse = () => {
    const request = activeRequest.current;
    activeRequest.current = null;
    request?.abort();
    setLoading(false); setThinking(false);
    setResponseError("Response stopped. You can edit or resend your question.");
  };
  const resetVisibleChat = () => { setConversationId(null); setAnswer(null); setResponseError(""); setSubmittedQuestion(""); setHistory([]); setQuestion(""); };
  const changeMemory = (enabled: boolean) => { setMemoryEnabled(enabled); resetVisibleChat(); };
  const reply = (value: NonNullable<typeof answer>, latest = false) => <AdvisorResponse title={value.title} body={value.body} limitation={value.limitation} animate={latest && value.animate}>
    {purpose === "help" ? <a href="/help" target="_blank" rel="noreferrer">Open help centre →</a> : value.seed ? <button onClick={() => createTask(value.seed!)}>Create action →</button> : <button onClick={() => navigate("Integrations")}>Review connected sources →</button>}
  </AdvisorResponse>;
  return (
    <div className="content advisor-page">
      {analysisPeriod && purpose === "analysis" && <div className="retail-ai-period"><span>Retail evidence: {analysisPeriod.from} to {analysisPeriod.to}</span><button onClick={() => { setAnalysisPeriod(null); resetVisibleChat(); }}>Use recent workspace evidence</button></div>}
      <AdvisorComposer purpose={purpose} onPurpose={value => { if (value !== purpose) { setPurpose(value); resetVisibleChat(); } }} memoryEnabled={memoryEnabled} onMemory={changeMemory} privacyControls={<AdvisorPrivacy fetcher={apiFetch} disabled={loading} onDeleted={id => { if (id === null || id === conversationId) resetVisibleChat(); }}/>} provider={provider} providers={providers} providersLoading={providersLoading} question={question} onQuestion={setQuestion} dataUseAccepted={dataUseAccepted} onConsent={accepted => { if (!accepted) resetVisibleChat(); void savedConsent.refresh(accepted, purpose); }} consentLoading={savedConsent.busy} consentError={savedConsent.error} onConsentRetry={() => void savedConsent.refresh()} onStop={stopResponse} loading={loading} thinking={thinking} onSubmit={ask} hasConversation={Boolean(submittedQuestion || answer || history.length)} onNewChat={() => { setAnalysisPeriod(null); resetVisibleChat(); }}>
        {history.map((item, index) => <Fragment key={index}><div className="ai-user-message"><small>You</small>{item.question}</div>{reply(item.answer)}</Fragment>)}
        {submittedQuestion && <div className="ai-user-message"><small>You</small>{submittedQuestion}</div>}
        {thinking && <AdvisorThinking/>}
        {responseError && <div className="ai-response-error" role="status"><strong>Reply not completed</strong><p>{responseError}</p><span>Your question remains in the message box.</span></div>}
        {answer && reply(answer, true)}
      </AdvisorComposer>
    </div>
  );
}

type CommerceSnapshot = {
  counts: { products: number; customers: number; suppliers: number; saleLines: number };
  sources: Array<{ provider: string; products: number; customers: number; suppliers: number; saleLines: number }>;
  customerIdentityAvailable: boolean;
  customers: Array<{ provider: string; externalCustomerId: string; displayName: string; email: string | null; phone: string | null; sourceUpdatedAt: string | null }>;
  suppliers: Array<{ provider: string; externalSupplierId: string; name: string; accountNumber: string | null; contactName: string | null; email: string | null; phone: string | null; sourceUpdatedAt: string | null }>;
  locationScope: { id: string; name: string; mappedProviders: string[] } | null;
  scopeBoundary: string;
};

function providerLabel(provider: string) {
  return providerDisplayName(provider);
}

// Kept as a complete view for the next navigation slice.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CommerceRecordsWorkspace({ kind, navigate, activeLocationId }: { kind: "Customers" | "Suppliers"; navigate: (view: View) => void; activeLocationId: string | null }) {
  const [snapshot, setSnapshot] = useState<CommerceSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void apiFetch(`/api/v1/commerce${activeLocationId ? `?location=${encodeURIComponent(activeLocationId)}` : ""}`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Commerce records could not be loaded.");
        if (!cancelled) setSnapshot(body);
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Commerce records could not be loaded."); });
    return () => { cancelled = true; };
  }, [activeLocationId]);
  const records = kind === "Customers" ? snapshot?.customers ?? [] : snapshot?.suppliers ?? [];
  const filtered = records.filter((record) => JSON.stringify(record).toLowerCase().includes(query.trim().toLowerCase()));
  const total = kind === "Customers" ? snapshot?.counts.customers ?? 0 : snapshot?.counts.suppliers ?? 0;
  return (
    <div className="content commerce-records-page">
      <section className="workspace-titlebar">
        <div><p>CONNECTED COMMERCE DATA</p><h2>{kind === "Customers" ? "Customer directory" : "Supplier directory"}</h2><span>{snapshot?.scopeBoundary ?? (kind === "Customers" ? "Customer records from every normalized POS source, linked to sales only when the source provides a valid relationship." : "Vendor records from every normalized POS source, ready for purchasing and margin review.")}</span></div>
        <div className="sync-health"><i className={error ? "error" : ""}/><div className="sync-health-copy"><b>{error ? "Source unavailable" : `${total.toLocaleString()} imported`}</b><small>{snapshot ? `${snapshot.counts.saleLines.toLocaleString()} transaction lines available` : "Loading provider records…"}</small></div></div>
      </section>
      {snapshot?.sources.length ? <section className="commerce-source-strip" aria-label="Connected commerce sources">{snapshot.sources.map((source) => <span key={source.provider}><b>{providerLabel(source.provider)}</b><small>{source.saleLines.toLocaleString()} sale lines</small></span>)}</section> : null}
      <section className="commerce-summary-strip">
        <article><small>PRODUCTS</small><b>{snapshot?.counts.products.toLocaleString() ?? "Not available"}</b><span>Catalog records</span></article>
        <article><small>CUSTOMERS</small><b>{snapshot?.counts.customers.toLocaleString() ?? "Not available"}</b><span>Active profiles</span></article>
        <article><small>SUPPLIERS</small><b>{snapshot?.counts.suppliers.toLocaleString() ?? "Not available"}</b><span>Vendor records</span></article>
        <article><small>SALE LINES</small><b>{snapshot?.counts.saleLines.toLocaleString() ?? "Not available"}</b><span>Product-level facts</span></article>
      </section>
      <section className="dense-panel commerce-directory">
        <header><div><p>{kind.toUpperCase()}</p><h3>Imported from the authorized source account</h3></div><span>{filtered.length.toLocaleString()} shown</span></header>
        <div className="table-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${kind.toLowerCase()}…`} aria-label={`Search ${kind.toLowerCase()}`}/></div>
        {error ? <div className="commerce-source-error"><b>Could not load the connected records.</b><span>{error}</span><button onClick={() => navigate("Integrations")}>Check connection →</button></div> : !snapshot ? <div className="commerce-loading" aria-label="Loading commerce records"><i/><i/><i/></div> : filtered.length ? <div className="dense-table">
          <div className="dense-row dense-head"><span>Name</span><span>{kind === "Customers" ? "Email" : "Contact"}</span><span>{kind === "Customers" ? "Phone" : "Account"}</span><span>Source</span></div>
          {filtered.map((record) => {
            const customer = "displayName" in record;
            return <div className="dense-row" key={`${record.provider}:${customer ? record.externalCustomerId : record.externalSupplierId}`}>
              <span><b>{customer ? record.displayName : record.name}</b><small>{customer ? record.externalCustomerId : record.externalSupplierId}</small></span>
              <span>{customer ? record.email || "Not supplied" : record.contactName || record.email || "Not supplied"}</span>
              <span className="mono-cell">{customer ? record.phone || "Not recorded" : record.accountNumber || "Not recorded"}</span>
              <span className="mono-cell">{providerLabel(record.provider)}</span>
            </div>;
          })}
        </div> : <div className="commerce-source-error"><b>No {kind.toLowerCase()} have been imported from a connected account.</b><span>Run the provider sync and review its data coverage. Vanteloq will not create missing records.</span><button onClick={() => navigate("Integrations")}>Manage source →</button></div>}
      </section>
    </div>
  );
}

type LocationIntelligence = {
  scopeLabel: string;
  latestBusinessDate: string | null;
  unmappedSourceLocations: number;
  locations: Array<{
    id: string;
    name: string;
    address: string;
    timezone: string;
    validationStatus: string;
    sourceMappings: Array<{ provider: string; name: string }>;
    metrics: {
      period: string | null;
      days: number;
      netSalesCents: number | null;
      grossProfitCents: number | null;
      transactionCount: number | null;
      inventoryValueCents: number | null;
      lastUpdatedAt: string | null;
    };
  }>;
};

function LocationsWorkspace({
  currency,
  activeLocationId,
  selectLocation,
  navigate,
}: {
  currency: string;
  activeLocationId: string | null;
  selectLocation: (locationId: string | null) => void;
  navigate: (view: View) => void;
}) {
  const [data, setData] = useState<LocationIntelligence | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/api/v1/locations", { headers: { Accept: "application/json" } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Location intelligence could not be loaded.");
      setData(body);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Location intelligence could not be loaded.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  if (error) return <FailureState message={error} retry={load} />;
  if (!data) return <LoadingState />;
  return (
    <div className="content locations-intelligence-page">
      <section className="page-intro locations-intro">
        <div>
          <p>LOCATION INTELLIGENCE</p>
          <h2>See each store clearly, then scope every dashboard to it.</h2>
          <span>Sales and inventory appear only when provider locations are mapped to an organization location. Unmapped records remain separate and visible for review.</span>
        </div>
        <div className="location-scope-summary">
          <small>CURRENT DASHBOARD SCOPE</small>
          <b>{activeLocationId ? data.locations.find((location) => location.id === activeLocationId)?.name ?? "Selected location" : data.scopeLabel}</b>
          <button onClick={() => selectLocation(null)} disabled={!activeLocationId}>View {data.scopeLabel.toLowerCase()}</button>
        </div>
      </section>
      {data.unmappedSourceLocations > 0 && (
        <section className="location-mapping-warning">
          <div><b>{data.unmappedSourceLocations} provider {data.unmappedSourceLocations === 1 ? "location needs" : "locations need"} mapping</b><span>Map each POS shop or outlet before using location comparisons.</span></div>
          <button onClick={() => navigate("Integrations")}>Map provider locations</button>
        </section>
      )}
      {!data.locations.length ? (
        <section className="card location-empty-state">
          <h3>Add the first organization location.</h3>
          <p>A location name and address are required before a POS shop can be mapped or a store dashboard can be selected.</p>
          <button className="primary" onClick={() => navigate("Settings")}>Open location settings</button>
        </section>
      ) : (
        <section className="location-intelligence-grid">
          {data.locations.map((location) => (
            <article key={location.id} className={activeLocationId === location.id ? "active-location" : ""}>
              <header>
                <div><p>{location.validationStatus.toUpperCase()} ADDRESS</p><h3>{location.name}</h3><span>{location.address}</span></div>
                {activeLocationId === location.id && <strong>Current scope</strong>}
              </header>
              <div className="location-metric-grid">
                <span><small>NET SALES</small><b>{money(location.metrics.netSalesCents, currency)}</b><em>{location.metrics.period ?? "No verified period"}</em></span>
                <span><small>GROSS PROFIT</small><b>{money(location.metrics.grossProfitCents, currency)}</b><em>Permission and cost data required</em></span>
                <span><small>TRANSACTIONS</small><b>{location.metrics.transactionCount?.toLocaleString() ?? "Not available"}</b><em>{location.metrics.days} verified days</em></span>
                <span><small>INVENTORY VALUE</small><b>{money(location.metrics.inventoryValueCents, currency)}</b><em>Latest verified balance</em></span>
              </div>
              <div className="location-source-list">
                <b>Mapped data sources</b>
                {location.sourceMappings.length
                  ? location.sourceMappings.map((mapping) => <span key={`${mapping.provider}:${mapping.name}`}>{mapping.name}<small>{providerDisplayName(mapping.provider)}</small></span>)
                  : <p>No provider location is mapped yet. Organization records remain available, but store metrics stay blocked.</p>}
              </div>
              <footer>
                <button className="primary" onClick={() => selectLocation(location.id)} disabled={activeLocationId === location.id}>View this location</button>
                <button onClick={() => navigate("Integrations")}>Manage mapping</button>
              </footer>
            </article>
          ))}
        </section>
      )}
      <section className="location-data-contract card">
        <div><p>WHAT EACH LOCATION CAN FIX</p><h3>Traffic, margin, stock, staffing and cash stay separate until their own evidence exists.</h3></div>
        <div>
          <span><b>Demand</b><small>Completed sales and transactions by mapped store reveal local trend and basket changes.</small></span>
          <span><b>Margin</b><small>Product cost plus location sales reveals gross profit. Expenses are never inferred.</small></span>
          <span><b>Inventory</b><small>SKU balances, sell-through and incoming orders support transfer and reorder decisions.</small></span>
          <span><b>Operations</b><small>Staffing, expense and task records become available only when connected and location-tagged.</small></span>
        </div>
      </section>
    </div>
  );
}

function ModuleWorkspace({
  name,
  definition,
  data,
  currency,
  navigate,
  createTask,
}: {
  name: View;
  definition?: {
    promise: string;
    metrics: string[];
    sources: string[];
    actions: string[];
  };
  data: CommandCentre;
  currency: string;
  navigate: (view: View) => void;
  createTask: (seed: TaskSeed) => void;
}) {
  if (!definition) return <><FirstInsightPath data={data} navigate={navigate}/><EmptyCommandCentre navigate={navigate} /></>;
  const immediate: Partial<Record<View, string | null>> = {
    Sales: data.current?.netSalesCents == null ? null : money(data.current.netSalesCents, currency),
    Profit: data.current?.grossProfitCents == null ? null : money(data.current.grossProfitCents, currency),
    Cash: data.balances?.cashBalanceCents == null ? null : money(data.balances.cashBalanceCents, currency),
    Inventory: data.balances?.inventoryValueCents == null ? null : money(data.balances.inventoryValueCents, currency),
    Team: data.current?.labourRate == null ? null : percent(data.current.labourRate),
  };
  const value = immediate[name] ?? null;
  const actual = (metricId: string) => data.metrics[metricId]?.actuality === "actual";
  const featureRules: Partial<Record<View, Record<string, boolean>>> = {
    Sales: {
      "Net and gross sales": actual("net_sales") && actual("gross_sales"),
      "Transactions and average transaction": actual("transactions") && actual("average_transaction"),
      "Units per transaction": actual("units_per_transaction"),
      "Refunds, discounts and voids": false,
    },
    Profit: {
      "Gross profit and gross margin": actual("gross_profit") && actual("gross_margin"),
      "Contribution after labour": actual("contribution_after_labour"),
      "Product, category and supplier margin": false,
      "Budget and prior-period variance": false,
    },
    Cash: {
      "Latest operating cash": data.balances?.cashBalanceCents != null,
      "Accounts payable": data.balances?.accountsPayableCents != null,
      "Scheduled bills and payroll": false,
      "Projected closing balance": false,
    },
    Inventory: {
      "On-hand and inventory value": actual("inventory_value") || data.balances?.inventoryValueCents != null,
      "Days remaining and stockout date": false,
      "Turnover, overstock and dead stock": false,
      "Expiry and shrinkage": false,
    },
    Team: {
      "Sales per labour hour": false,
      "Labour percentage": actual("labour_rate"),
      "Schedule adherence": false,
      "Training and task completion": false,
    },
    Reports: {
      "Daily owner briefing": data.ready,
      "Weekly performance review": data.comparisons != null,
      "Monthly P&L summary": actual("gross_profit"),
      "Accountant package": false,
    },
  };
  const featureAvailable = (item: string) => {
    return featureRules[name]?.[item] ?? false;
  };
  const sourceRules: Partial<Record<string, boolean>> = {
    "Daily summaries now": data.ready,
    "POS transactions for hourly and employee detail": data.today.sourceGranularity === "intraday",
    "Commerce channels for consolidated sales": data.liveSource.providers.length > 0 && data.ready,
    "Daily sales and cost summaries now": data.ready && actual("cost_of_goods"),
    "Daily balance entry now": data.balances?.cashBalanceCents != null,
    "Bank feeds": data.metrics.operating_cash?.sourceSystem === "Plaid read-only bank feed",
    "Daily labour cost now": actual("labour_cost"),
    "Latest aggregate value now": data.balances?.inventoryValueCents != null,
    "Location-tagged daily summaries": data.ready,
    "Every verified Vanteloq data source": data.ready,
  };
  const sourceAvailable = (item: string) => {
    return sourceRules[item] ?? false;
  };
  return (
    <div className="content module-page">
      <section className="module-hero">
        <div>
          <p>{name.toUpperCase()} INTELLIGENCE</p>
          <h2>{definition.promise}</h2>
          <span>
            This workspace separates what is available, the records each feature
            uses, and the decision it supports. Missing evidence stays unavailable.
          </span>
        </div>
        {value && (
          <div className="module-signal">
            <small>AVAILABLE NOW</small>
            <b>{value}</b>
            <span>{name === "Cash" ? data.metrics.operating_cash?.sourceSystem ?? "Verified cash source" : "From verified daily summaries"}</span>
          </div>
        )}
      </section>
      <div className="module-columns">
        <article className="card">
          <p className="card-kicker">FEATURES AND INSIGHTS</p>
          <h3>What the owner can diagnose</h3>
          {definition.metrics.map((item) => {
            const available = featureAvailable(item);
            return <div className="feature-detail-row" key={item}>
              <span className={available ? "feature-state available" : "feature-state needs-data"}>{available ? "Available now" : "Needs data"}</span>
              <div><b>{item}</b><small>{available ? "This result is calculated from verified, permission-checked source records. Open Intelligence to inspect its formula, period and freshness." : "This result is withheld because at least one required field is missing, stale or outside your permission scope. No value is inferred from another metric."}</small></div>
            </div>;
          })}
        </article>
        <article className="card">
          <p className="card-kicker">DATA USED</p>
          <h3>Records required for reliable results</h3>
          {definition.sources.map((item) => {
            const available = sourceAvailable(item);
            return <div className="data-requirement-row" key={item}>
              <span>{available ? "Connected" : "Required input"}</span><b>{item}</b>
            </div>;
          })}
          <button onClick={() => navigate("Integrations")}>
            Manage data sources →
          </button>
          {name === "Bookkeeping" && <button onClick={() => navigate("BookLoQ")}>Open BookLoQ workspace →</button>}
        </article>
        <article className="card">
          <p className="card-kicker">EXECUTION</p>
          <h3>Decisions this workspace supports</h3>
          {definition.actions.map((item) => (
            <button
              className="module-action"
              key={item}
              onClick={() =>
                createTask({
                  title: item,
                  detail: `Action created from the ${name} workspace. Add the responsible person, deadline and measurable outcome.`,
                  priority: "medium",
                  sourceType: "manual",
                })
              }
            >
              {item}
              <b>→</b>
            </button>
          ))}
        </article>
      </div>
      {data.ready && data.insights.length > 0 && (
        <section className="related-signal">
          <p>RELATED VERIFIED SIGNAL</p>
          <InsightCard insight={data.insights[0]} createTask={createTask} />
        </section>
      )}
    </div>
  );
}

function AlertDrawer({
  data,
  close,
  open,
}: {
  data: CommandCentre | null;
  close: () => void;
  open: (seed: TaskSeed) => void;
}) {
  const actionable =
    data?.insights.filter((item) => item.severity !== "informational") ?? [];
  return (
    <aside className="alert-drawer">
      <div>
        <span>OWNER STRESS LIST</span>
        <button onClick={close}>×</button>
      </div>
      <h2>Needs attention</h2>
      {!actionable.length ? (
        <div className="empty-state">
          <b>No verified exception.</b>
          <span>Alerts appear only when a source supports them.</span>
        </div>
      ) : (
        actionable.map((item) => (
          <button
            className={`drawer-alert ${item.severity}`}
            key={item.id}
            onClick={() =>
              open({
                ...item.suggestedTask,
                sourceType: "alert",
                sourceRef: item.id,
              })
            }
          >
            <span>{item.severity}</span>
            <b>{item.title}</b>
            <small>{item.financialImpact}</small>
          </button>
        ))
      )}
    </aside>
  );
}
function LoadingState() {
  return (
    <div className="workspace-loading ledger-skeleton" role="status" aria-live="polite" aria-label="Loading workspace data">
      <span className="sr-only">Verifying the operating picture…</span>
      <div className="skeleton-heading" aria-hidden="true">
        <i />
        <i />
      </div>
      <div className="skeleton-summary" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((item) => <i key={item} />)}
      </div>
      <div className="skeleton-ledger" aria-hidden="true">
        <b />
        {[1, 2, 3, 4, 5, 6].map((item) => <span key={item}><i /><i /><i /><i /></span>)}
      </div>
    </div>
  );
}
function FailureState({
  message,
  retry,
}: {
  message: string;
  retry: () => void | Promise<void>;
}) {
  return (
    <div className="failure-state">
      <b>The workspace could not be loaded.</b>
      <span>{message}</span>
      <button onClick={() => void retry()}>Try again</button>
    </div>
  );
}
