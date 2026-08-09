"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import BookLoQWorkspace from "./bookloq-workspace";
import CommunicationsWorkspace from "./communications-workspace";
import GrowthWorkspace from "./growth-workspace";
import IntegrationBrandLogo from "./integration-brand-logo";
import {
  integrationCatalog,
  preSyncControls,
  salesChannelGroups,
  type IntegrationCatalogEntry,
} from "./integration-catalog";
import ProductBrandLogo from "./product-brand-logo";
import { apiFetch, signOut } from "./supabase-browser";
import {
  BusinessTrendChart,
  CashPositionRing,
  MetricSparkline,
  type Tone,
} from "./dashboard-charts";
import { SettingsWorkspace, TeamWorkspace } from "./governance-workspaces";
import {
  DataQualityWorkspace,
  DocumentsWorkspace,
  InventoryWorkspace,
  PurchaseOrdersWorkspace,
  ReportsWorkspace,
} from "./control-workspaces";

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
  | "Industry Modules"
  | "Integrations"
  | "Settings";

const nav: [string, View[]][] = [
  [
    "Overview",
    ["Dashboard", "Intelligence", "Action Centre", "Business Brief", "Advisor"],
  ],
  [
    "Commerce",
    [
      "Sales",
      "Inventory",
      "Customers",
      "Operations",
      "Suppliers",
      "Purchase Orders",
    ],
  ],
  [
    "Finance",
    [
      "Profit",
      "Cash",
      "BookLoQ",
      "Bookkeeping",
      "Reports",
    ],
  ],
  [
    "Growth",
    [
      "Marketing",
      "Communications",
    ],
  ],
  [
    "Organization",
    [
      "Team",
      "Documents",
      "Data Quality",
      "Locations",
      "Decision Journal",
      "Scenario Planner",
    ],
  ],
];

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
  "Industry Modules": "dashboard.view",
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
  trend: { date: string; netSalesCents: number; grossProfitCents: number }[];
  insights: Insight[];
  dataQuality: {
    status: string;
    verifiedFields: number;
    missingDimensions: string[];
  };
  operatingSystem: {
    status: "blocked" | "limited" | "operational";
    mode: string;
    preliminaryPurchasingCapacityCents: number | null;
    purchasingCapacityLabel: string;
    pillars: { id: string; label: string; state: string }[];
    decisions: {
      id: string;
      pillar: string;
      priority: "critical" | "high" | "medium" | "low";
      score: number;
      title: string;
      decision: string;
      evidence: string[];
      missing: string[];
      confidence: "high" | "medium" | "low";
      approval: string;
      sourceRef: string;
    }[];
    guardrails: string[];
  };
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
  const [view, setView] = useState<View>("Dashboard");
  const [workspaceName, setWorkspaceName] = useState(organizationName);
  const [logoVersion, setLogoVersion] = useState<number | null>(null);
  const [data, setData] = useState<CommandCentre | null>(null);
  const [currency, setCurrency] = useState("CAD");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [taskSeed, setTaskSeed] = useState<TaskSeed | null>(null);
  const [notice, setNotice] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [appRole, setAppRole] = useState("employee");
  const [appPermissions, setAppPermissions] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch("/api/v1/command-centre", {
        headers: { Accept: "application/json" },
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message ?? "Unable to load the command centre.",
        );
      setData({ ...body.commandCentre, operatingSystem: body.operatingSystem });
      setCurrency(body.organization.currency);
      setAppRole(body.organization.role ?? "employee");
      setAppPermissions(body.organization.permissions ?? []);
      setWorkspaceName(body.organization.name || organizationName);
      setLogoVersion(
        body.organization.logoAvailable ? body.organization.logoVersion : null,
      );
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load the command centre.",
      );
    } finally {
      setLoading(false);
    }
  }, [organizationName]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const integration = parameters.get("integration");
    if (integration !== "lightspeed" && integration !== "lightspeed-r") return;
    const timer = window.setTimeout(() => {
      setView("Integrations");
      const state = parameters.get("connection");
      setNotice(
        state === "connected"
          ? `${integration === "lightspeed-r" ? "Lightspeed R-Series" : "Lightspeed X-Series"} is verified in read-only staging mode`
          : state === "declined"
            ? `${integration === "lightspeed-r" ? "R-Series" : "X-Series"} authorization was declined`
            : `${integration === "lightspeed-r" ? "R-Series" : "X-Series"} authorization needs to be restarted`,
      );
      window.history.replaceState({}, "", window.location.pathname);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
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
              <img
                src={`/api/v1/organization-logo?v=${logoVersion}`}
                alt={`${workspaceName} logo`}
              />
            ) : (
              workspaceName.slice(0, 2).toUpperCase()
            )}
          </span>
          <span>
            <b>{workspaceName}</b>
            <small>
              {data?.source.latestBusinessDate
                ? `Data through ${data.source.latestBusinessDate}`
                : "Data source required"}
            </small>
          </span>
        </div>
        <nav aria-label="Primary navigation">
          {nav
            .map(
              ([group, items]) =>
                [
                  group,
                  items.filter(
                    (item) =>
                      !viewPermission[item] ||
                      appPermissions.includes(viewPermission[item]!),
                  ),
                ] as [string, View[]],
            )
            .filter(([, items]) => items.length)
            .map(([group, items]) => (
              <section className="nav-group" key={group}>
                <p>{group}</p>
                {items.map((item) => (
                  <button
                    key={item}
                    className={`${view === item ? "nav-item active" : "nav-item"}${item === "BookLoQ" ? " bookloq-main-nav" : ""}`}
                    onClick={() => navigate(item)}
                    aria-current={view === item ? "page" : undefined}
                  >
                    {item === "BookLoQ" ? (
                      <ProductBrandLogo
                        product="bookloq"
                        className="bookloq-nav-glyph"
                      />
                    ) : (
                      <span className="nav-dot" />
                    )}
                    {item}
                  </button>
                ))}
              </section>
            ))}
        </nav>
        <div className="side-bottom">
          <button
            className={
              view === "Industry Modules" ? "nav-item active" : "nav-item"
            }
            onClick={() => navigate("Industry Modules")}
            aria-current={view === "Industry Modules" ? "page" : undefined}
          >
            <span className="nav-dot" />
            Industry modules
          </button>
          {appPermissions.includes("integrations.view") && (
            <button
              className={
                view === "Integrations" ? "nav-item active" : "nav-item"
              }
              onClick={() => navigate("Integrations")}
              aria-current={view === "Integrations" ? "page" : undefined}
            >
              <span className="nav-dot" />
              Integrations & data
            </button>
          )}
          {appPermissions.includes("organization.settings") && (
            <button
              className={view === "Settings" ? "nav-item active" : "nav-item"}
              onClick={() => navigate("Settings")}
              aria-current={view === "Settings" ? "page" : undefined}
            >
              <span className="nav-dot" />
              Settings
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
              <small>{appRole.replaceAll("_", " ")}</small>
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
            ☰
          </button>
          <div>
            <p className="eyebrow">
              {view === "Dashboard"
                ? "OWNER COMMAND CENTRE"
                : "VANTELOQ WORKSPACE"}
            </p>
            <h1>{view === "Dashboard" ? "Unified Workspace" : view}</h1>
          </div>
          <div className="top-actions">
            <button className="command-trigger" onClick={() => setCommandOpen(true)} aria-label="Open workspace search"><span>Search workspace</span><kbd>⌘K</kbd></button>
            <span
              className={`source-pill ${data?.source.freshness ?? "missing"}`}
            >
              <i />
              {data?.source.latestBusinessDate
                ? `${data.source.freshness} data`
                : "no data"}
            </span>
            <button
              className="icon-button notification"
              aria-label="Open alerts"
              onClick={() => setNotificationsOpen((value) => !value)}
            >
              !
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
        {loading ? (
          <LoadingState />
        ) : error ? (
          <FailureState message={error} retry={refresh} />
        ) : (
          <Workspace
            view={view}
            data={data!}
            currency={currency}
            navigate={navigate}
            refresh={refresh}
            showNotice={showNotice}
            createTask={(seed) => setTaskSeed(seed)}
            organizationName={workspaceName}
            accountName={accountName}
            onBrandChange={(name, version) => {
              setWorkspaceName(name);
              setLogoVersion(version);
            }}
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
  const options = useMemo(() => ([...nav.flatMap(([, items]) => items), "Industry Modules", "Integrations", "Settings"] as View[])
    .filter((item, index, list) => list.indexOf(item) === index)
    .filter((item) => !viewPermission[item] || permissions.includes(viewPermission[item]!))
    .filter((item) => !query || item.toLowerCase().includes(query.toLowerCase())), [permissions, query]);
  return <div className="modal-backdrop command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="command-modal" role="dialog" aria-modal="true" aria-label="Workspace search"><div className="command-input"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Go to a workspace…"/><button onClick={close}>ESC</button></div><div className="command-results"><small>WORKSPACES</small>{options.map((option) => <button key={option} onClick={() => navigate(option)}><span>↳</span><span>{option}</span><b>→</b></button>)}{!options.length && <p>No matching workspace.</p>}</div></section></div>;
}

function Workspace({
  view,
  data,
  currency,
  navigate,
  refresh,
  showNotice,
  createTask,
  organizationName,
  accountName,
  onBrandChange,
}: {
  view: View;
  data: CommandCentre;
  currency: string;
  navigate: (view: View) => void;
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
  createTask: (seed: TaskSeed) => void;
  organizationName: string;
  accountName: string;
  onBrandChange: (name: string, logoVersion: number | null) => void;
}) {
  if (view === "Dashboard")
    return (
      <Overview
        data={data}
        currency={currency}
        navigate={navigate}
        createTask={createTask}
      />
    );
  if (view === "Intelligence")
    return (
      <Intelligence
        data={data}
        currency={currency}
        navigate={navigate}
        createTask={createTask}
      />
    );
  if (view === "Action Centre")
    return (
      <TaskCentre
        showNotice={showNotice}
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
  if (view === "BookLoQ")
    return <BookLoQWorkspace createTask={createTask} showNotice={showNotice} />;
  if (view === "Communications") return <CommunicationsWorkspace />;
  if (view === "Marketing")
    return <GrowthWorkspace currency={currency} navigate={navigate} />;
  if (view === "Integrations")
    return <DataHub refresh={refresh} showNotice={showNotice} />;
  if (view === "Decision Journal")
    return <DecisionJournal currency={currency} showNotice={showNotice} />;
  if (view === "Scenario Planner")
    return <ScenarioPlanner data={data} currency={currency} />;
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
    return <Advisor data={data} navigate={navigate} createTask={createTask} />;
  if (view === "Industry Modules") return <IndustryModules />;
  if (view === "Reports")
    return (
      <ReportsWorkspace
        currency={currency}
        showNotice={showNotice}
        createTask={createTask}
      />
    );
  if (view === "Purchase Orders")
    return (
      <PurchaseOrdersWorkspace
        currency={currency}
        showNotice={showNotice}
        createTask={createTask}
      />
    );
  if (view === "Inventory")
    return (
      <InventoryWorkspace
        currency={currency}
        showNotice={showNotice}
        createTask={createTask}
        sourceCashCents={data.balances?.cashBalanceCents ?? null}
        sourceAccountsPayableCents={data.balances?.accountsPayableCents ?? null}
        sourceDataAgeHours={(data.source.ageDays ?? 0) * 24}
        sourceHistoryDays={data.current?.days ?? 0}
      />
    );
  if (view === "Documents")
    return (
      <DocumentsWorkspace
        currency={currency}
        showNotice={showNotice}
        createTask={createTask}
      />
    );
  if (view === "Data Quality")
    return (
      <DataQualityWorkspace
        currency={currency}
        showNotice={showNotice}
        createTask={createTask}
      />
    );
  if (view === "Team")
    return (
      <TeamWorkspace
        showNotice={showNotice}
        organizationName={organizationName}
        accountName={accountName}
      />
    );
  if (view === "Settings")
    return (
      <SettingsWorkspace
        showNotice={showNotice}
        organizationName={organizationName}
        accountName={accountName}
        onBrandChange={onBrandChange}
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

function Overview({
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
    return <EmptyCommandCentre navigate={navigate} />;
  const current = data.current;
  const salesTrend = data.trend.map((point) => point.netSalesCents);
  const profitTrend = data.trend.map((point) => point.grossProfitCents);
  const marginTrend = data.trend.map((point) =>
    point.netSalesCents > 0 ? point.grossProfitCents / point.netSalesCents : 0,
  );
  return (
    <div className="content command-page">
      <section className="owner-brief">
        <div>
          <p>Today&apos;s priority</p>
          <h2>
            {data.insights[0]?.title ??
              "Your operating picture is up to date."}
          </h2>
          <span>
            {data.insights[0]?.recommendedAction ??
              "There are no material exceptions to review right now."}
          </span>
        </div>
        <button
          onClick={() =>
            data.insights[0] &&
            createTask({
              ...data.insights[0].suggestedTask,
              sourceType: "insight",
              sourceRef: data.insights[0].id,
            })
          }
        >
          Create an action <b>→</b>
        </button>
      </section>
      <section className="metric-grid">
        <Metric
          label="Net sales"
          value={money(current.netSalesCents, currency)}
          delta={percent(data.comparisons?.netSalesRate)}
          detail={`${current.days} verified days`}
          tone="indigo"
          sparkline={salesTrend}
          provenance={data.metrics.net_sales}
        />
        <Metric
          label="Gross profit"
          value={money(current.grossProfitCents, currency)}
          delta={percent(data.comparisons?.grossProfitRate)}
          detail="Net sales less product cost"
          tone="emerald"
          sparkline={profitTrend}
          provenance={data.metrics.gross_profit}
        />
        <Metric
          label="Gross margin"
          value={percent(current.grossMarginRate)}
          delta={
            data.comparisons?.marginPointChange == null
              ? "No baseline"
              : `${percent(data.comparisons.marginPointChange)} pts`
          }
          detail="Weighted for the period"
          tone="cyan"
          sparkline={marginTrend}
          provenance={data.metrics.gross_margin}
        />
        <Metric
          label="Avg. transaction"
          value={money(current.averageTransactionCents, currency, 2)}
          delta={percent(data.comparisons?.averageTransactionRate)}
          detail={`${current.transactionCount.toLocaleString()} transactions`}
          tone="amber"
          provenance={data.metrics.average_transaction}
        />
        <Metric
          label="Contribution"
          value={money(current.contributionCents, currency)}
          delta={percent(current.labourRate)}
          detail="After product and labour cost"
          tone="rose"
          provenance={data.metrics.contribution_after_labour}
        />
      </section>
      <section className="command-grid">
        <article className="card signal-chart">
          <div className="card-head">
            <div>
              <p className="card-kicker">Performance trend</p>
              <h3>Net sales and gross profit</h3>
            </div>
            <span className="verified-tag">14 verified days</span>
          </div>
          <BusinessTrendChart data={data.trend} currency={currency} />
          <div className="chart-foot">
            <span>
              <b>{current.unitsSold.toLocaleString()}</b> units
            </span>
            <span>
              <b>{current.unitsPerTransaction?.toFixed(2) ?? "—"}</b> per
              transaction
            </span>
            <span>
              <b>{money(current.discountsCents, currency)}</b> discounts
            </span>
            <span>
              <b>{money(current.refundsCents, currency)}</b> refunds
            </span>
          </div>
        </article>
        <OwnerStress data={data} currency={currency} navigate={navigate} />
      </section>
      <section className="insight-section">
        <div className="section-heading">
          <div>
            <p>Decision queue</p>
            <h2>What changed and what to do next</h2>
          </div>
          <button onClick={() => navigate("Intelligence")}>
            See full evidence →
          </button>
        </div>
        <div className="insight-grid">
          {data.insights.slice(0, 3).map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              createTask={createTask}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({
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
  return (
    <article className={`metric-card metric-${tone}`}>
      <p>{label}</p>
      <h3>{value}</h3>
      <span>{delta}</span>
      {sparkline?.length ? <MetricSparkline values={sparkline} tone={tone} /> : <i className="metric-accent" aria-hidden="true" />}
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

function OwnerStress({
  data,
  currency,
  navigate,
}: {
  data: CommandCentre;
  currency: string;
  navigate: (view: View) => void;
}) {
  const balances = data.balances;
  return (
    <article className="card stress-card">
      <div className="card-head">
        <div>
          <p className="card-kicker">Cash position</p>
          <h3>Cash after known payables</h3>
        </div>
        <span>
          {data.insights.filter((x) => x.severity !== "informational").length}{" "}
          items
        </span>
      </div>
      <CashPositionRing
        cashCents={balances?.cashBalanceCents}
        payableCents={balances?.accountsPayableCents}
        currency={currency}
      />
      <div className="stress-list compact-stress-list">
        <button onClick={() => navigate("Cash")}>
          <span>Inventory held</span>
          <b>{money(balances?.inventoryValueCents, currency)}</b>
        </button>
        <button onClick={() => navigate("Action Centre")}>
          <span>Assigned actions</span>
          <b>Open queue →</b>
        </button>
      </div>
      <p className="stress-note">
        This view uses verified balances only. Payroll, rent, tax and debt are
        excluded until those schedules are connected.
      </p>
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
            ["01", "What happened?", "Verified metrics and changes"],
            ["02", "Why did it happen?", "Supported causes and missing inputs"],
            [
              "03",
              "What needs attention?",
              "Ranked exceptions and opportunities",
            ],
            ["04", "What should I do next?", "Assigned actions with outcomes"],
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

function Intelligence({
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
  if (!data.ready) return <EmptyCommandCentre navigate={navigate} />;
  const operating = data.operatingSystem;
  return (
    <div className="content intelligence-page">
      <section className="intelligence-header">
        <div>
          <p>RETAIL OPERATING SYSTEM</p>
          <h2>One ranked queue for the decisions that matter.</h2>
          <span>
            Sales, cash, inventory and operations use the same evidence,
            permission and approval rules. Vanteloq never turns a partial fact
            into an automatic financial action.
          </span>
        </div>
        <div className={`quality-score ${data.dataQuality.status}`}>
          <small>DATA QUALITY</small>
          <b>{data.dataQuality.status}</b>
          <span>{data.source.rowCount} verified daily records</span>
        </div>
      </section>
      <section className="operating-system-strip">
        <article className="cash-capacity-card">
          <small>PRELIMINARY PURCHASING CAPACITY</small>
          <b>{money(operating.preliminaryPurchasingCapacityCents, currency)}</b>
          <span>{operating.purchasingCapacityLabel}</span>
          <button onClick={() => navigate("Cash")}>Open cash model →</button>
        </article>
        <div className="pillar-readiness">
          {operating.pillars.map((pillar) => (
            <article key={pillar.id}>
              <i className={pillar.state}/>
              <span><b>{pillar.label}</b><small>{pillar.state.replaceAll("_", " ")}</small></span>
            </article>
          ))}
        </div>
        <article className="approval-card">
          <small>EXECUTION POLICY</small>
          <b>Recommend first. Approve before acting.</b>
          {operating.guardrails.map((guardrail) => <span key={guardrail}>✓ {guardrail}</span>)}
        </article>
      </section>
      <section className="decision-queue">
        <div className="section-heading"><div><p>TODAY&apos;S DECISION QUEUE</p><h2>Ranked by urgency, confidence and freshness</h2></div><button onClick={() => navigate("Action Centre")}>Open assigned work →</button></div>
        {operating.decisions.map((decision, index) => (
          <article key={decision.id}>
            <b className={`decision-rank ${decision.priority}`}>{String(index + 1).padStart(2, "0")}</b>
            <div>
              <span className="decision-meta">{decision.pillar} · {decision.priority} · {decision.confidence} confidence</span>
              <h3>{decision.title}</h3>
              <p>{decision.decision}</p>
              <small>{decision.evidence[0]}</small>
            </div>
            <aside>
              <span>{decision.missing.length ? `${decision.missing.length} confidence gap${decision.missing.length === 1 ? "" : "s"}` : "Evidence complete"}</span>
              <button onClick={() => createTask({ title: decision.title, detail: `${decision.decision} Evidence: ${decision.evidence.join(" ")}`, priority: decision.priority === "critical" || decision.priority === "high" ? "high" : decision.priority === "medium" ? "medium" : "low", expectedImpact: "Review the evidence and record the approved outcome.", sourceType: "decision", sourceRef: decision.sourceRef })}>Create review action →</button>
            </aside>
          </article>
        ))}
      </section>
      <div className="intelligence-list">
        {data.insights.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            createTask={createTask}
            expanded
          />
        ))}
      </div>
      <section className="missing-panel">
        <p>MISSING DIMENSIONS</p>
        <h3>What would make the analysis stronger</h3>
        <div>
          {data.dataQuality.missingDimensions.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <button onClick={() => navigate("Integrations")}>
          Connect the next source →
        </button>
      </section>
    </div>
  );
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
          <b>Probable cause</b>
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
            {insight.evidence.map((item) => (
              <span key={item}>✓ {item}</span>
            ))}
          </div>
          <div>
            <b>Still missing</b>
            {insight.missingInformation.map((item) => (
              <span key={item}>— {item}</span>
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
}: {
  showNotice: (message: string) => void;
  openComposer: () => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
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
    const response = await apiFetch("/api/v1/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, status }),
    });
    if (response.ok) {
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id ? { ...item, status } : item,
        ),
      );
      showNotice(
        status === "done" ? "Action completed" : "Action status updated",
      );
    }
  };
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
      <article className="card task-board">
        {loading ? (
          <div className="empty-state">Loading actions…</div>
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
            {tasks.map((task) => (
              <div
                className={`task-item ${task.status === "done" ? "is-done" : ""}`}
                key={task.id}
              >
                <button
                  className="check-task"
                  aria-label={`Complete ${task.title}`}
                  onClick={() =>
                    void update(task, task.status === "done" ? "open" : "done")
                  }
                >
                  {task.status === "done" ? "✓" : ""}
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
                </div>
                <select
                  aria-label={`Status for ${task.title}`}
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
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await apiFetch("/api/v1/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        title: form.get("title"),
        detail: form.get("detail"),
        priority: form.get("priority"),
        assignee: form.get("assignee"),
        dueDate: form.get("dueDate") || null,
        sourceType: seed.sourceType ?? "manual",
        sourceRef: seed.sourceRef ?? null,
        expectedImpact: form.get("expectedImpact"),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Unable to save the action.");
      setSaving(false);
      return;
    }
    saved();
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.currentTarget === event.target && close()}
    >
      <form className="action-modal" onSubmit={submit}>
        <div className="modal-title">
          <div>
            <p>QUICK ACTION</p>
            <h2>Assign the next move</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </div>
        <label>
          Action title
          <input
            name="title"
            defaultValue={seed.title}
            required
            maxLength={120}
            autoFocus
          />
        </label>
        <label>
          What needs to happen
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
            Due date
            <input type="date" name="dueDate" />
          </label>
        </div>
        <label>
          Expected impact
          <input
            name="expectedImpact"
            defaultValue={seed.expectedImpact ?? ""}
            maxLength={500}
          />
        </label>
        {seed.sourceType && seed.sourceType !== "manual" && (
          <div className="linked-source">
            Linked to {seed.sourceType}: {seed.sourceRef}
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={close}>
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
  lastSuccessfulSyncAt: string | null;
  lastErrorCode: string | null;
  connectedAt: string | null;
  dataPromotionStatus: string;
  providerReadiness: null | {
    adapterBuilt: boolean;
    credentialsConfigured: boolean;
    missingConfiguration: string[];
    apiVersion: string;
    scopes: string[];
    mode: string;
    dataPromotionEnabled: boolean;
  };
};

function DataHub({
  refresh,
  showNotice,
}: {
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const [tab, setTab] = useState<"import" | "connections">("import");
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [connectionError, setConnectionError] = useState("");
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [providerAction, setProviderAction] = useState("");
  const [activeSampleProvider, setActiveSampleProvider] = useState<"lightspeed" | "lightspeed-r" | "stripe">("lightspeed");
  const [sampleResult, setSampleResult] = useState<null | {
    run: { recordsRead: number; recordsStaged: number; duplicatesSkipped: number; warningCount: number };
    reconciliation: {
      mappedOutlets?: number;
      discoveredOutlets?: number;
      unmappedOutlets?: number;
      balanceTransactions?: number;
      payouts?: number;
      grossCents?: number;
      feeCents?: number;
      netCents?: number;
    };
    nextStep: string;
  }>(null);
  const [outletData, setOutletData] = useState<null | {
    provider?: "lightspeed" | "lightspeed-r";
    locationLabel?: "outlet" | "shop";
    mappings: Array<{
      externalLocationRef: string;
      externalName: string;
      localLocationId: string | null;
      status: "mapped" | "unmapped" | "ignored";
    }>;
    localLocations: Array<{ id: string; name: string; status: string }>;
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
    } catch (error) {
      setConnectionError(
        error instanceof Error
          ? error.message
          : "Connection status could not be loaded.",
      );
    } finally {
      setConnectionsLoading(false);
    }
  }, []);
  useEffect(() => {
    if (tab !== "connections" || connections.length || connectionsLoading) return;
    const timer = window.setTimeout(() => void loadConnections(), 0);
    return () => window.clearTimeout(timer);
  }, [connections.length, connectionsLoading, loadConnections, tab]);
  const providerPost = async (path: string, action: string) => {
    setProviderAction(action);
    try {
      const response = await apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The provider action failed.");
      return body;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The provider action failed.");
      return null;
    } finally {
      setProviderAction("");
    }
  };
  const connectProvider = async (provider: "lightspeed" | "lightspeed-r" | "stripe") => {
    const body = await providerPost(
      `/api/v1/integrations/${provider}/authorize`,
      `authorize:${provider}`,
    );
    if (body?.authorizationUrl) window.location.assign(body.authorizationUrl);
  };
  const stageProviderSample = async (provider: "lightspeed" | "lightspeed-r" | "stripe") => {
    const body = await providerPost(
      `/api/v1/integrations/${provider}/sync`,
      `sample:${provider}`,
    );
    if (!body) return;
    setActiveSampleProvider(provider);
    setSampleResult(body);
    showNotice(`${provider === "stripe" ? "Stripe" : provider === "lightspeed-r" ? "R-Series" : "X-Series"} sample staged; dashboard metrics remain unchanged`);
    await loadConnections();
  };
  const disconnectProvider = async (provider: "lightspeed" | "lightspeed-r" | "stripe") => {
    if (!window.confirm(`Disconnect ${provider === "stripe" ? "Stripe" : provider === "lightspeed-r" ? "Lightspeed R-Series" : "Lightspeed X-Series"}? Staged audit history will be retained.`)) return;
    const body = await providerPost(
      `/api/v1/integrations/${provider}/disconnect`,
      `disconnect:${provider}`,
    );
    if (!body) return;
    if (activeSampleProvider === provider) {
      setSampleResult(null);
      if (provider !== "stripe") setOutletData(null);
    }
    showNotice(`${provider === "stripe" ? "Stripe authorization revoked" : provider === "lightspeed-r" ? "R-Series disconnected; encrypted tokens were deleted" : "X-Series disconnected; encrypted tokens were deleted"}`);
    await loadConnections();
  };
  const loadLightspeedLocations = async (provider: "lightspeed" | "lightspeed-r") => {
    setProviderAction(`locations:${provider}`);
    try {
      const response = await apiFetch(`/api/v1/integrations/${provider}/${provider === "lightspeed-r" ? "shops" : "outlets"}`, {
        headers: { Accept: "application/json" },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Lightspeed locations could not be loaded.");
      setActiveSampleProvider(provider);
      setOutletData({ ...body, provider, locationLabel: provider === "lightspeed-r" ? "shop" : "outlet" });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Lightspeed locations could not be loaded.");
    } finally {
      setProviderAction("");
    }
  };
  const saveOutletMapping = async (
    externalLocationRef: string,
    selection: string,
  ) => {
    setProviderAction(`mapping:${externalLocationRef}`);
    try {
      const status = selection === "__ignored__" ? "ignored" : selection ? "mapped" : "unmapped";
      const provider = outletData?.provider ?? (activeSampleProvider === "stripe" ? "lightspeed" : activeSampleProvider);
      const response = await apiFetch(`/api/v1/integrations/${provider}/${provider === "lightspeed-r" ? "shops" : "outlets"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalLocationRef,
          localLocationId: status === "mapped" ? selection : null,
          status,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The outlet mapping could not be saved.");
      setOutletData({ ...body, provider, locationLabel: provider === "lightspeed-r" ? "shop" : "outlet" });
      showNotice(`Lightspeed ${provider === "lightspeed-r" ? "shop" : "outlet"} mapping saved`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The outlet mapping could not be saved.");
    } finally {
      setProviderAction("");
    }
  };
  const providerRows: IntegrationConnection[] = connections.length
    ? connections
    : integrationCatalog.map((provider) => ({
        ...provider,
        status: "not_connected",
        lastSuccessfulSyncAt: null,
        lastErrorCode: null,
        connectedAt: null,
        dataPromotionStatus: "blocked",
        providerReadiness: null,
      }));
  const verifiedControls = preSyncControls.filter(
    (control) => control.status === "verified",
  ).length;
  return (
    <div className="content data-hub">
      <section className="page-intro">
        <div>
          <p>DATA CONTROL PLANE</p>
          <h2>Connect, validate, then calculate.</h2>
          <span>
            Every import is tenant-scoped, schema-validated, idempotent and
            audited before it changes the command centre.
          </span>
        </div>
        <div className="segmented">
          <button
            className={tab === "import" ? "active" : ""}
            onClick={() => setTab("import")}
          >
            Import data
          </button>
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
        </div>
      </section>
      {tab === "import" ? (
        <DailyImport refresh={refresh} showNotice={showNotice} />
      ) : (
        <>
          <section className="sales-channel-directory" aria-labelledby="sales-channels-title">
            <header>
              <p>SALES CHANNELS</p>
              <h3 id="sales-channels-title">Connect every place the business sells, gets paid and finds customers.</h3>
              <span>This directory is the connection plan. A provider only becomes live after its secure adapter and reconciliation tests pass.</span>
            </header>
            <div>
              {salesChannelGroups.map((group) => <article key={group.label}>
                <h4>{group.label}</h4>
                <div>
                  {group.providers.map((provider) => <span key={provider}><IntegrationBrandLogo name={provider} compact/>{provider}</span>)}
                </div>
              </article>)}
            </div>
          </section>
          <section className="connection-readiness" aria-labelledby="pre-sync-title">
            <header>
              <div>
                <p>PRE-SYNC SAFETY GATE</p>
                <h3 id="pre-sync-title">The platform stays locked until every provider control passes.</h3>
                <span>
                  {verifiedControls} of {preSyncControls.length} cross-platform controls are built and tested. Provider-specific authorization, webhook, normalization and reconciliation work remains gated.
                </span>
              </div>
              <strong>SYNC OFF</strong>
            </header>
            <div>
              {preSyncControls.map((control) => (
                <article key={control.id} className={control.status}>
                  <span>{control.status === "verified" ? "Verified" : "Required"}</span>
                  <b>{control.label}</b>
                  <small>{control.detail}</small>
                </article>
              ))}
            </div>
            <footer>
              No provider can be represented as live while any required control remains gated.
            </footer>
          </section>
          <div className="integration-notice">
            <div>
              <b>
                Connections remain disabled until their complete secure adapter
                exists.
              </b>
              <p>
                Vanteloq will not display a decorative “connected” state. Each
                live adapter requires provider authorization, least-privilege
                scopes, signed webhooks, idempotent synchronization,
                reconciliation and failure recovery.
              </p>
            </div>
          </div>
          {connectionError && (
            <div className="connection-error" role="alert">
              <span>{connectionError}</span>
              <button onClick={() => void loadConnections()}>Retry status check</button>
            </div>
          )}
          <section className="integration-grid">
            {providerRows.map((provider) => {
              const connected = provider.status === "connected";
              const isLightspeed = provider.id === "lightspeed" || provider.id === "lightspeed-r";
              const isStripe = provider.id === "stripe";
              const actionableProvider = provider.id as "lightspeed" | "lightspeed-r" | "stripe";
              const configured = provider.providerReadiness?.credentialsConfigured === true;
              const disabledReason = !canManage
                ? "Your role can view connection status but cannot manage integrations."
                : !configured
                  ? `Add the ${isStripe ? "Stripe Connect credentials and webhook secret" : provider.id === "lightspeed-r" ? "R-Series OAuth client ID and secret" : "X-Series OAuth client ID and secret"} to Vanteloq's hosted secrets first.`
                  : "";
              return (
              <article className="integration-card" key={provider.id}>
                <div className="integration-card-head">
                  <IntegrationBrandLogo name={provider.name} />
                  <span className="integration-type">{provider.category}</span>
                </div>
                <h3>{provider.name}</h3>
                <p>{provider.activationRequirement}</p>
                <div className="integration-card-footer">
                  <div>
                    <span className={`status ${connected ? "" : "planned"}`}>
                      {connected ? "Read-only connected" : availabilityLabel(provider.availability)}
                    </span>
                    <span className="connection-lock">
                      {connectionsLoading
                        ? "Checking…"
                        : connected
                          ? "Staging only · metrics locked"
                          : "Sync disabled"}
                    </span>
                  </div>
                  {(isLightspeed || isStripe) && <div className="provider-actions">
                    {!connected ? <button
                      onClick={() => void connectProvider(actionableProvider)}
                      disabled={Boolean(disabledReason) || Boolean(providerAction)}
                      title={disabledReason || (isStripe ? "Authorize Stripe financial data for read-only staging." : `Authorize a Lightspeed ${provider.id === "lightspeed-r" ? "R-Series account" : "X-Series store"} with read-only scopes.`)}
                    >{providerAction === `authorize:${provider.id}` ? "Opening…" : "Connect"}</button> : <>
                      <button
                        onClick={() => void stageProviderSample(actionableProvider)}
                        disabled={!canManage || Boolean(providerAction)}
                        title={!canManage ? "Your role cannot run provider synchronization." : "Read and review a limited sample without changing dashboard metrics."}
                      >{providerAction === `sample:${provider.id}` ? "Staging…" : "Stage sample"}</button>
                      {isLightspeed && <button
                        className="secondary-provider-action"
                        onClick={() => void loadLightspeedLocations(actionableProvider as "lightspeed" | "lightspeed-r")}
                        disabled={!canManage || Boolean(providerAction)}
                        title={!canManage ? "Your role cannot manage location mappings." : `Discover and map Lightspeed ${provider.id === "lightspeed-r" ? "shops" : "outlets"} before reconciliation.`}
                      >{providerAction === `locations:${provider.id}` ? "Loading…" : `Map ${provider.id === "lightspeed-r" ? "shops" : "outlets"}`}</button>}
                      <button
                        className="danger-text"
                        onClick={() => void disconnectProvider(actionableProvider)}
                        disabled={!canManage || Boolean(providerAction)}
                        title={!canManage ? "Your role cannot disconnect integrations." : isStripe ? "Revoke Stripe authorization while retaining staged audit history." : "Delete local encrypted tokens while retaining staged audit history."}
                      >Disconnect</button>
                    </>}
                  </div>}
                </div>
              </article>
            );})}
          </section>
          {outletData && <section className="outlet-mapping-panel" aria-labelledby="outlet-mapping-title">
            <header>
              <div><p>LOCATION CONTROL</p><h3 id="outlet-mapping-title">Map every Lightspeed {outletData.locationLabel ?? "outlet"} before promotion.</h3></div>
              <strong>{outletData.mappings.filter((mapping) => mapping.status === "mapped").length} / {outletData.mappings.length} mapped</strong>
            </header>
            {outletData.mappings.length ? <div className="outlet-mapping-list">
              {outletData.mappings.map((mapping) => <label key={mapping.externalLocationRef}>
                <span><b>{mapping.externalName}</b><small>{mapping.externalLocationRef}</small></span>
                <select
                  value={mapping.status === "ignored" ? "__ignored__" : mapping.localLocationId ?? ""}
                  onChange={(event) => void saveOutletMapping(mapping.externalLocationRef, event.target.value)}
                  disabled={Boolean(providerAction)}
                  aria-label={`Map ${mapping.externalName}`}
                >
                  <option value="">Unmapped — blocks promotion</option>
                  {outletData.localLocations.filter((location) => location.status === "active").map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  <option value="__ignored__">Ignore this outlet</option>
                </select>
              </label>)}
            </div> : <p className="outlet-empty">No {outletData.locationLabel === "shop" ? "shops" : "outlets"} were returned. Confirm the retailer has active locations, then retry discovery.</p>}
            <footer>Ignored locations remain excluded and visible in reconciliation. Mapping never merges tenants or changes provider records.</footer>
          </section>}
          {sampleResult && <section className="sample-sync-result" aria-live="polite">
            <header><div><p>{activeSampleProvider === "stripe" ? "STRIPE" : activeSampleProvider === "lightspeed-r" ? "R-SERIES" : "X-SERIES"} SAMPLE RECONCILIATION</p><h3>Staged safely. Nothing has entered live metrics.</h3></div><strong>DATA PROMOTION OFF</strong></header>
            <div>
              <span><small>RECORDS READ</small><b>{sampleResult.run.recordsRead}</b></span>
              <span><small>NEWLY STAGED</small><b>{sampleResult.run.recordsStaged}</b></span>
              <span><small>DUPLICATES SKIPPED</small><b>{sampleResult.run.duplicatesSkipped}</b></span>
              <span><small>{activeSampleProvider === "stripe" ? "PAYOUTS READ" : "UNMAPPED OUTLETS"}</small><b>{activeSampleProvider === "stripe" ? sampleResult.reconciliation.payouts ?? 0 : sampleResult.reconciliation.unmappedOutlets ?? 0}</b></span>
            </div>
            <p>{sampleResult.nextStep}</p>
          </section>}
        </>
      )}
    </div>
  );
}

function availabilityLabel(value: IntegrationCatalogEntry["availability"]) {
  return value === "provider_selection_required"
    ? "Provider selection required"
    : value === "credentials_required"
      ? "Credentials required"
      : "Provider build required";
}

const requiredHeaders = [
  "business_date",
  "gross_sales",
  "net_sales",
  "cogs",
  "transactions",
  "units",
];
function csvCells(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      cell += '"';
      index++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
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
function parseDailyCsv(text: string) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2)
    throw new Error("The CSV needs a header and at least one data row.");
  const headers = csvCells(lines[0]).map((value) =>
    value.toLowerCase().replace(/\s+/g, "_"),
  );
  for (const required of requiredHeaders)
    if (!headers.includes(required))
      throw new Error(`Missing required column: ${required}.`);
  if (lines.length - 1 > 366)
    throw new Error("Import a maximum of 366 daily rows at a time.");
  const get = (cells: string[], name: string) =>
    cells[headers.indexOf(name)] ?? "";
  return lines.slice(1).map((line, index) => {
    const cells = csvCells(line);
    const integer = (name: string) => {
      const value = Number(get(cells, name) || 0);
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`Row ${index + 2}: ${name} must be a whole number.`);
      return value;
    };
    return {
      businessDate: get(cells, "business_date"),
      locationRef: get(cells, "location") || "all",
      grossSalesCents: toCents(get(cells, "gross_sales")),
      netSalesCents: toCents(get(cells, "net_sales")),
      costOfGoodsCents: toCents(get(cells, "cogs")),
      transactionCount: integer("transactions"),
      unitsSold: integer("units"),
      refundsCents: toCents(get(cells, "refunds")),
      discountsCents: toCents(get(cells, "discounts")),
      labourCostCents: toCents(get(cells, "labour_cost")),
      inventoryValueCents: toCents(get(cells, "inventory_value"), true),
      cashBalanceCents: toCents(get(cells, "cash_balance"), true),
      accountsPayableCents: toCents(get(cells, "accounts_payable"), true),
    };
  });
}

function DailyImport({
  refresh,
  showNotice,
}: {
  refresh: () => Promise<void>;
  showNotice: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitRows = async (
    rows: unknown[],
    importType: string,
    fileName = "",
  ) => {
    const response = await apiFetch("/api/v1/daily-metrics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ importType, fileName, rows }),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        body.error?.message ?? "The import could not be completed.",
      );
    await refresh();
    showNotice(
      `${body.import.rowCount} verified daily record${body.import.rowCount === 1 ? "" : "s"} saved`,
    );
  };
  const importCsv = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await submitRows(
        parseDailyCsv(await file.text()),
        "daily_summary_csv",
        file.name,
      );
      setFile(null);
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
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      await submitRows(
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
            labourCostCents: toCents(form.get("labour")),
            inventoryValueCents: toCents(form.get("inventory"), true),
            cashBalanceCents: toCents(form.get("cash"), true),
            accountsPayableCents: toCents(form.get("payable"), true),
          },
        ],
        "manual_entry",
      );
      event.currentTarget.reset();
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
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <b>{file ? file.name : "Choose a CSV file"}</b>
          <span>Maximum 366 daily rows · no customer or payment-card data</span>
        </label>
        <button
          className="primary wide"
          disabled={!file || busy}
          onClick={() => void importCsv()}
        >
          {busy ? "Validating…" : "Validate and import"}
        </button>
      </article>
      <form className="card manual-entry" onSubmit={submitManual}>
        <div className="card-head">
          <div>
            <p className="card-kicker">MANUAL ENTRY</p>
            <h3>Add one verified day</h3>
          </div>
          <span>All amounts in dollars</span>
        </div>
        <div className="manual-grid">
          <label>
            Date
            <input required type="date" name="date" />
          </label>
          <label>
            Location
            <input name="location" defaultValue="Main" maxLength={80} />
          </label>
          <label>
            Gross sales
            <input required name="gross" inputMode="decimal" />
          </label>
          <label>
            Net sales
            <input required name="net" inputMode="decimal" />
          </label>
          <label>
            Product cost (COGS)
            <input required name="cogs" inputMode="decimal" />
          </label>
          <label>
            Labour cost
            <input name="labour" inputMode="decimal" defaultValue="0" />
          </label>
          <label>
            Transactions
            <input
              required
              name="transactions"
              type="number"
              min="0"
              step="1"
            />
          </label>
          <label>
            Units sold
            <input required name="units" type="number" min="0" step="1" />
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
        </div>
        <button className="primary wide" disabled={busy}>
          {busy ? "Saving…" : "Save verified day"}
        </button>
      </form>
      {error && <p className="import-error">{error}</p>}
      <section className="data-contract">
        <div>
          <b>What this unlocks now</b>
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
            correlation—not proof of causation.
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
            <label>
              Event date
              <input required type="date" name="eventDate" />
            </label>
            <label>
              Review date
              <input type="date" name="reviewDate" />
            </label>
          </div>
          <label>
            Title
            <input required name="title" maxLength={120} />
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
            <div className="empty-state">Loading business memory…</div>
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

function ScenarioPlanner({
  data,
  currency,
}: {
  data: CommandCentre;
  currency: string;
}) {
  const current = data.current;
  const [sales, setSales] = useState(() =>
    current ? Math.round(current.netSalesCents / 100) : 80000,
  );
  const [margin, setMargin] = useState(
    () => Math.round((current?.grossMarginRate ?? 0.46) * 1000) / 10,
  );
  const [fixed, setFixed] = useState(12000);
  const [labour, setLabour] = useState(() =>
    current ? Math.round(current.labourCostCents / 100) : 10000,
  );
  const [salesChange, setSalesChange] = useState(0);
  const [marginChange, setMarginChange] = useState(0);
  const [costChange, setCostChange] = useState(0);
  const [aov, setAov] = useState(() =>
    Math.round((current?.averageTransactionCents ?? 5000) / 100),
  );
  const result = useMemo(() => {
    const projectedSales = sales * (1 + salesChange / 100);
    const projectedMargin = Math.max(0, Math.min(100, margin + marginChange));
    const projectedFixed = fixed + labour + costChange;
    const profit = (projectedSales * projectedMargin) / 100 - projectedFixed;
    const breakEven = projectedMargin
      ? projectedFixed / (projectedMargin / 100)
      : 0;
    return {
      projectedSales,
      projectedMargin,
      projectedFixed,
      profit,
      breakEven,
      transactions: aov ? breakEven / aov : 0,
    };
  }, [
    sales,
    margin,
    fixed,
    labour,
    salesChange,
    marginChange,
    costChange,
    aov,
  ]);
  const display = (value: number) => money(Math.round(value * 100), currency);
  return (
    <div className="content scenario-page">
      <section className="page-intro">
        <div>
          <p>WHAT-IF MODEL</p>
          <h2>Test a decision before spending money.</h2>
          <span>
            This is a user-controlled scenario—not a forecast. Every output is a
            direct formula from the inputs below.
          </span>
        </div>
      </section>
      <div className="scenario-layout">
        <article className="card scenario-inputs">
          <h3>Current monthly baseline</h3>
          <div className="manual-grid">
            <label>
              Monthly sales
              <input
                type="number"
                value={sales}
                onChange={(event) => setSales(Number(event.target.value))}
              />
            </label>
            <label>
              Gross margin %
              <input
                type="number"
                step="0.1"
                value={margin}
                onChange={(event) => setMargin(Number(event.target.value))}
              />
            </label>
            <label>
              Fixed operating costs
              <input
                type="number"
                value={fixed}
                onChange={(event) => setFixed(Number(event.target.value))}
              />
            </label>
            <label>
              Monthly labour
              <input
                type="number"
                value={labour}
                onChange={(event) => setLabour(Number(event.target.value))}
              />
            </label>
            <label>
              Average transaction
              <input
                type="number"
                value={aov}
                onChange={(event) => setAov(Number(event.target.value))}
              />
            </label>
          </div>
          <h3>Scenario changes</h3>
          <div className="manual-grid">
            <label>
              Sales change %
              <input
                type="number"
                step="1"
                value={salesChange}
                onChange={(event) => setSalesChange(Number(event.target.value))}
              />
            </label>
            <label>
              Margin-point change
              <input
                type="number"
                step="0.1"
                value={marginChange}
                onChange={(event) =>
                  setMarginChange(Number(event.target.value))
                }
              />
            </label>
            <label>
              New monthly costs
              <input
                type="number"
                value={costChange}
                onChange={(event) => setCostChange(Number(event.target.value))}
              />
            </label>
          </div>
        </article>
        <article className="scenario-results">
          <div>
            <small>PROJECTED MONTHLY PROFIT</small>
            <b className={result.profit < 0 ? "negative" : ""}>
              {display(result.profit)}
            </b>
            <span>Sales × margin − fixed costs − labour − new costs</span>
          </div>
          <div>
            <small>BREAK-EVEN SALES</small>
            <b>{display(result.breakEven)}</b>
            <span>
              {Math.ceil(result.transactions).toLocaleString()} transactions at{" "}
              {display(aov)} average
            </span>
          </div>
          <div>
            <small>PROJECTED SALES</small>
            <b>{display(result.projectedSales)}</b>
            <span>At {result.projectedMargin.toFixed(1)}% gross margin</span>
          </div>
          <div>
            <small>TOTAL MONTHLY COST BASE</small>
            <b>{display(result.projectedFixed)}</b>
            <span>Fixed, labour and scenario additions</span>
          </div>
          <p>
            Not included unless entered: taxes, debt principal, working-capital
            timing, seasonality, financing costs or one-time launch expenses.
          </p>
        </article>
      </div>
    </div>
  );
}

function BusinessBrief({
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
    return <EmptyCommandCentre navigate={navigate} />;
  const current = data.current;
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
            value={money(current.netSalesCents, currency)}
            delta={percent(data.comparisons?.netSalesRate)}
            detail="Current 30-day window"
          />
          <Metric
            label="Gross profit"
            value={money(current.grossProfitCents, currency)}
            delta={percent(data.comparisons?.grossProfitRate)}
            detail="Before operating expenses"
          />
          <Metric
            label="Contribution"
            value={money(current.contributionCents, currency)}
            delta={percent(current.labourRate)}
            detail="After labour"
          />
        </div>
        <h3>Prioritized actions</h3>
        {data.insights.map((insight, index) => (
          <div className="brief-action" key={insight.id}>
            <b>{String(index + 1).padStart(2, "0")}</b>
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
}: {
  data: CommandCentre;
  navigate: (view: View) => void;
  createTask: (seed: TaskSeed) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{
    title: string;
    body: string;
    limitation: string;
    seed?: TaskSeed;
  } | null>(null);
  const ask = (event: FormEvent) => {
    event.preventDefault();
    const normalized = question.toLowerCase();
    if (!data.ready) {
      setAnswer({
        title: "Verified operating data is required",
        body: "I cannot answer from company performance yet because no daily source has been imported or connected.",
        limitation:
          "Add daily summaries or connect a provider before using financial figures.",
      });
      return;
    }
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
        limitation: `Confidence: ${insight.confidence}. Missing: ${insight.missingInformation.join(", ")}.`,
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
  return (
    <div className="content advisor-page">
      <section className="advisor-hero">
        <p>EVIDENCE-BOUND ADVISOR</p>
        <h2>Ask the business. See the limits.</h2>
        <span>
          Answers use the same verified calculation engine as the command
          centre. Unsupported questions return the missing source instead of a
          fabricated answer.
        </span>
        <form onSubmit={ask}>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Why were sales lower? Where is margin leaking?"
          />
          <button>Analyze →</button>
        </form>
        <div className="suggested-questions">
          {[
            "Why did sales change?",
            "Where is margin leaking?",
            "Is labour pressure rising?",
            "What can the current data not answer?",
          ].map((item) => (
            <button key={item} onClick={() => setQuestion(item)}>
              {item}
            </button>
          ))}
        </div>
      </section>
      {answer && (
        <article className="advisor-answer">
          <span>VANTELOQ ANALYSIS</span>
          <h3>{answer.title}</h3>
          <p>{answer.body}</p>
          <div>{answer.limitation}</div>
          {answer.seed ? (
            <button onClick={() => createTask(answer.seed!)}>
              Create action →
            </button>
          ) : (
            <button onClick={() => navigate("Integrations")}>
              Add the missing source →
            </button>
          )}
        </article>
      )}
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
  if (!definition) return <EmptyCommandCentre navigate={navigate} />;
  const immediate: Record<string, string> = {
    Sales: money(data.current?.netSalesCents, currency),
    Profit: money(data.current?.grossProfitCents, currency),
    Cash: money(data.balances?.cashBalanceCents, currency),
    Inventory: money(data.balances?.inventoryValueCents, currency),
    Team: percent(data.current?.labourRate),
  };
  const value = immediate[name];
  return (
    <div className="content module-page">
      <section className="module-hero">
        <div>
          <p>{name.toUpperCase()} INTELLIGENCE</p>
          <h2>{definition.promise}</h2>
          <span>
            Only supported figures appear. Everything else stays visibly blocked
            until its required source is verified.
          </span>
        </div>
        {value && (
          <div className="module-signal">
            <small>AVAILABLE NOW</small>
            <b>{value}</b>
            <span>From verified daily summaries</span>
          </div>
        )}
      </section>
      <div className="module-columns">
        <article className="card">
          <p className="card-kicker">METRICS</p>
          <h3>What this workspace will answer</h3>
          {definition.metrics.map((item) => (
            <div className="capability-row" key={item}>
              <span>○</span>
              {item}
            </div>
          ))}
        </article>
        <article className="card">
          <p className="card-kicker">SOURCE CONTRACT</p>
          <h3>What the answer depends on</h3>
          {definition.sources.map((item, index) => (
            <div className="capability-row" key={item}>
              <span>{index === 0 && data.ready ? "✓" : "○"}</span>
              {item}
            </div>
          ))}
          <button onClick={() => navigate("Integrations")}>
            Manage data sources →
          </button>
        </article>
        <article className="card">
          <p className="card-kicker">EXECUTION</p>
          <h3>Actions, not dashboard dead ends</h3>
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

function IndustryModules() {
  const industries = [
    [
      "Supplement retail",
      "Replenishment cycles, expiry, product stacks, samples and trainer referrals",
    ],
    [
      "Restaurants",
      "Food cost, waste, delivery fees, table turnover and menu profit",
    ],
    ["Salons", "Utilization, rebooking, stylist context and no-shows"],
    ["Gyms", "Membership churn, attendance, trainer use and recurring revenue"],
    ["Auto shops", "Technician productivity, parts margin and job profit"],
    [
      "Professional services",
      "Billable utilization, project margin and receivables",
    ],
    ["E-commerce", "Conversion, abandoned carts, returns and fulfilment cost"],
    [
      "Property management",
      "Rent, vacancy, maintenance and unit profitability",
    ],
    [
      "Medical clinics",
      "Utilization, cancellations and practitioner productivity",
    ],
    [
      "Construction",
      "Budgets, labour, materials, change orders and job profit",
    ],
  ];
  return (
    <div className="content industry-page">
      <section className="page-intro">
        <div>
          <p>OPTIONAL OPERATING MODELS</p>
          <h2>Universal core. Industry-specific intelligence.</h2>
          <span>
            Modules extend the shared metric and action engine; they do not fork
            tenant security or invent data the business does not collect.
          </span>
        </div>
      </section>
      <div className="industry-grid">
        {industries.map(([name, detail], index) => (
          <article key={name}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{name}</h3>
            <p>{detail}</p>
            <button disabled title="This module requires a tested industry source model, calculation registry, permissions and reconciliation path before activation.">Requires source adapter</button>
          </article>
        ))}
      </div>
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
