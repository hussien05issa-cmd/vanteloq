"use client";
import WorkspaceSkeleton from "./workspace-skeleton";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { InventoryLifecycleWorkspace } from "./inventory-lifecycle-workspace";
import { BusinessTrendChart } from "./dashboard-charts";
import {
  calculateReorderRecommendation,
  type ReorderInputs,
} from "../domain/reorder-engine";
import { humanizeIdentifier, providerDisplayName } from "../domain/display-labels";
import { FieldLabel } from "./form-primitives";
import { DOCUMENT_PROCESSING_NOTICE, DOCUMENT_PROCESSING_NOTICE_VERSION, type DocumentExtraction } from "../shared/document-processing";

type TaskSeed = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  expectedImpact?: string;
  sourceType?: "manual" | "insight" | "alert" | "decision";
  sourceRef?: string;
};
type SharedProps = {
  currency: string;
  showNotice: (message: string) => void;
  createTask: (seed: TaskSeed) => void;
};

const reportGroups: Record<string, string[]> = {
  "Sales & refunds": [
    "Sales totals",
    "Sales line items",
    "Sales over time",
    "Sales by hour",
    "Sales by day",
    "Sales by weekday",
    "Sales by location",
    "Sales by channel",
    "Sales by item",
    "Sales by category",
    "Sales by brand",
    "Sales by supplier",
    "Sales by employee",
    "Sales by customer",
    "Discounts",
    "Refunds",
    "Voids",
    "Taxes",
    "Units per transaction",
    "Average transaction value",
    "Gross-margin-per-line",
    "Payment-method performance",
  ],
  Inventory: [
    "Current inventory assets",
    "Inventory valuation",
    "Inventory received",
    "Inventory returned",
    "Reorder list",
    "Negative inventory",
    "Inventory movement history",
    "Inventory by location",
    "Inventory by category",
    "Inventory by brand",
    "Inventory by supplier",
    "Inventory age",
    "Inventory turnover",
    "Days of inventory remaining",
    "Stockout history",
    "Lost-sales estimate",
    "Shrinkage",
    "Expired inventory",
    "Dead stock",
    "Transfer history",
    "Count discrepancies",
    "Landed-cost analysis",
  ],
  "Payments & reconciliation": [
    "All payments received",
    "Partial payments",
    "Transactions and payouts",
    "Processor fees",
    "Chargebacks",
    "Deposits",
    "Withdrawals",
    "POS-to-bank reconciliation",
    "Bank-to-book reconciliation",
    "Sales-and-payments balance",
    "Cash-drawer reconciliation",
    "Closing counts",
  ],
  Customers: [
    "Customer sales",
    "Customer lifetime value",
    "Purchase frequency",
    "Average basket",
    "Retention",
    "Churn risk",
    "Customer cohorts",
    "Repeat-purchase rate",
    "Product affinities",
    "Customer credits",
    "Outstanding balances",
    "Special orders",
    "Reservations",
    "Layaways",
  ],
  "Suppliers & purchasing": [
    "Purchase-order history",
    "Purchase-order status",
    "Supplier purchases",
    "Supplier balances",
    "Supplier cost changes",
    "Supplier fill rate",
    "Supplier delivery performance",
    "Purchase-order discrepancies",
    "Received-versus-invoiced",
    "Supplier credits",
    "Supplier concentration",
    "Recommended orders",
    "Open commitments",
    "Inventory cash exposure",
  ],
  Employees: [
    "Total hours",
    "Clock entries",
    "Sales by employee",
    "Revenue per labour hour",
    "Gross profit per labour hour",
    "Average transaction value by employee",
    "Discount activity",
    "Refund activity",
    "Labour cost percentage",
    "Scheduling efficiency",
  ],
  "Accounting & BookLoQ": [
    "Profit and loss",
    "Balance sheet",
    "Cash-flow statement",
    "Trial balance",
    "General ledger",
    "Journal report",
    "Accounts receivable",
    "Accounts payable",
    "Tax audit trail",
    "GST/HST/PST/QST working reports",
    "Budget versus actual",
    "Fixed assets",
    "Loans",
    "Statement of changes in equity",
    "Bookkeeping health",
    "Month-end status",
  ],
};
const liveReports: Record<string, string> = {
  "Sales totals": "sales_totals",
  "Sales over time": "sales_over_time",
  "Average transaction value": "sales_totals",
  "Units per transaction": "sales_totals",
  "Payment-method performance": "sales_totals",
  Discounts: "discounts_refunds",
  Refunds: "discounts_refunds",
  "Labour cost percentage": "labour_summary",
};

function localIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function reportRange(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(0, days - 1));
  return { start: localIsoDate(start), end: localIsoDate(end) };
}

function monthRange(offset = 0, throughToday = false) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const end = throughToday
    ? today
    : new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
  return { start: localIsoDate(start), end: localIsoDate(end) };
}

function reportChange(value: unknown) {
  return typeof value === "number"
    ? new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(value)
    : "No matched baseline";
}

function readableReportDate(value: unknown) {
  if (typeof value !== "string" || !value) return "Unavailable";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function money(cents: number | null | undefined, currency: string) {
  return cents === null || cents === undefined
    ? "Not available"
    : new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(cents / 100);
}
function apiMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

type ReportCatalogItem = {
  id: string;
  label: string;
  description: string;
  status: "ready" | "needs_data";
  dataNeeded: string[];
  implementationStatus: "available" | "planned";
  queryReportId: "sales_totals" | null;
  presentation: "sales" | "payment_mix" | null;
};

type ProviderReportCatalog = {
  provider: string;
  connectionId: string;
  accountName: string | null;
  vocabulary: { sales: string; location: string; product: string; payment: string };
  canonicalReports: ReportCatalogItem[];
  providerReports: ReportCatalogItem[];
  boundary: string;
};

type ReportAuthority = {
  status: "ready" | "conflict" | "needs_data";
  conflicts: Array<{
    localLocationId: string;
    locationName?: string;
    channel: string;
    expectedVersion: number;
    candidates: Array<{
      provider: string;
      connectionId: string;
      lastSuccessfulSyncAt: string | null;
      accountName?: string | null;
      hasFacts?: boolean;
      availability?: "ready" | "syncing" | "staging" | "unavailable" | "needs_data";
    }>;
  }>;
};

function reportSourceAvailability(value: ReportAuthority["conflicts"][number]["candidates"][number]["availability"]) {
  if (value === "syncing") return "Sync in progress";
  if (value === "staging") return "Approval paused";
  if (value === "unavailable") return "Connection unavailable";
  if (value === "needs_data") return "No normalized facts";
  return "Ready";
}

export function ReportsWorkspace({
  currency,
  showNotice,
  createTask,
  activeLocationId,
  canExportFeature,
  onOpenRetail,
  initialPeriod,
}: SharedProps & { activeLocationId: string | null; canExportFeature: boolean; onOpenRetail?: () => void; initialPeriod?: { from: string; to: string } }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All reports");
  const [selected, setSelected] = useState("Sales totals");
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState(initialPeriod?.from ?? "");
  const [end, setEnd] = useState(initialPeriod?.to ?? "");
  const [preset, setPreset] = useState(initialPeriod ? "custom" : "all");
  const [sourceConnectionId, setSourceConnectionId] = useState("");
  const [sourceReportLabel, setSourceReportLabel] = useState("");
  const [savingAuthority, setSavingAuthority] = useState("");
  const reportRequestSequence = useRef(0);
  const visible = Object.entries(reportGroups)
    .flatMap(([category, reports]) =>
      reports.map((name) => ({ category, name })),
    )
    .filter(
      (item) =>
        (group === "All reports" || item.category === group) &&
        item.name.toLowerCase().includes(query.toLowerCase()),
    );
  const load = useCallback(async (name: string) => {
    const requestSequence = ++reportRequestSequence.current;
    setReport(null);
    const id = liveReports[name];
    if (!id) return;
    setLoading(true);
    const params = new URLSearchParams({ report: id });
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (activeLocationId) params.set("location", activeLocationId);
    if (sourceConnectionId) params.set("connection", sourceConnectionId);
    if (name === "Payment-method performance") params.set("view", "payment_mix");
    try {
      const response = await apiFetch(`/api/v1/reports?${params.toString()}`);
      const body: unknown = await response.json();
      if (requestSequence !== reportRequestSequence.current) return;
      if (response.ok) setReport(body as Record<string, unknown>);
      else {
        if (response.status === 403 && sourceConnectionId) {
          setSourceConnectionId("");
          setSourceReportLabel("");
        }
        showNotice(apiMessage(body, "Unable to load report."));
      }
    } catch {
      if (requestSequence === reportRequestSequence.current) showNotice("Unable to load this report. Check the connection and try again.");
    } finally {
      if (requestSequence === reportRequestSequence.current) setLoading(false);
    }
  }, [activeLocationId, end, showNotice, sourceConnectionId, start]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(selected), 0);
    return () => window.clearTimeout(timer);
  }, [load, selected]);
  const applyPreset = (days: number) => {
    const next = reportRange(days);
    setPreset(String(days));
    setStart(next.start);
    setEnd(next.end);
  };
  const totals = report?.totals as Record<string, number | null> | undefined;
  const comparison = report?.comparison as {
    periodStart: string;
    periodEnd: string;
    verifiedDays: number;
    totals: Record<string, number | null>;
    changes: Record<string, number | null>;
  } | null | undefined;
  const paymentMix = (report?.paymentMix as Array<{ category: string; paymentTypeName: string | null; amountCents: number; transactionCount: number }> | undefined) ?? [];
  const explain = report?.explainAndAct as Record<string, unknown> | undefined;
  const source = report?.source as Record<string, unknown> | undefined;
  const sourceLineage = source?.lineage as {
    sales?: Array<{ locationId: string; locationName: string; channel: string; provider: string; accountName: string | null; connectionId: string; mode: string }>;
    payments?: Array<{ locationId: string; locationName: string; channel: string; provider: string; accountName: string | null; connectionId: string; mode: string }>;
    manual?: { rowCount?: number; importIds?: string[]; locationRefs?: string[] };
  } | undefined;
  const manualLineage = sourceLineage?.manual;
  const providerCatalogs = (report?.providerReportCatalogs as ProviderReportCatalog[] | undefined) ?? [];
  const canonicalReports = (report?.canonicalReportCatalog as ReportCatalogItem[] | undefined) ?? [];
  const sourceAuthorities = report?.sourceAuthority as { sales: ReportAuthority; payments: ReportAuthority } | undefined;
  const authorityEntries: Array<{ factFamily: "sales" | "payments"; authority: ReportAuthority }> = [
    ...(sourceAuthorities?.sales ? [{ factFamily: "sales" as const, authority: sourceAuthorities.sales }] : []),
    ...(selected === "Payment-method performance" && sourceAuthorities?.payments ? [{ factFamily: "payments" as const, authority: sourceAuthorities.payments }] : []),
  ];
  const sourceSelectionRequired = authorityEntries.some(({ authority }) => authority.status === "conflict");
  const canResolveAuthority = report?.canResolveSourceAuthority === true;
  const chooseAuthority = async (locationId: string, connectionId: string, factFamily: "sales" | "payments", expectedVersion: number) => {
    setSavingAuthority(connectionId);
    try {
      const response = await apiFetch("/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_source_authority", locationId, connectionId, factFamily, expectedVersion }),
      });
      const body: unknown = await response.json();
      if (response.ok) {
        showNotice("Reporting source saved. Consolidated totals now exclude overlapping feeds.");
        await load(selected);
      } else showNotice(apiMessage(body, "Unable to save the reporting source."));
    } catch {
      showNotice("Unable to save the reporting source. Check the connection and try again.");
    } finally {
      setSavingAuthority("");
    }
  };
  const rows = useMemo(
    () => (report?.rows as Array<{ businessDate: string; netSalesCents: number; costOfGoodsCents: number; transactionCount: number }> | undefined) ?? [],
    [report],
  );
  const trendRows = useMemo(() => {
    const daily = new Map<string, { date: string; netSalesCents: number; grossProfitCents: number; transactionCount: number }>();
    for (const row of rows) {
      const current = daily.get(row.businessDate) ?? { date: row.businessDate, netSalesCents: 0, grossProfitCents: 0, transactionCount: 0 };
      current.netSalesCents += row.netSalesCents;
      current.grossProfitCents += row.netSalesCents - row.costOfGoodsCents;
      current.transactionCount += row.transactionCount;
      daily.set(row.businessDate, current);
    }
    return [...daily.values()].sort((left, right) => left.date.localeCompare(right.date));
  }, [rows]);
  const canExport = canExportFeature && report?.canExport === true;
  return (
    <div className="content control-page reports-centre">
      <section className="page-intro">
        <div>
          <p>REPORTS CENTRE</p>
          <h2>Find the answer, inspect its source, then act.</h2>
          <span>
            Review source totals here, or open Retail intelligence for products,
            baskets, revenue drivers and operating measures. Each view identifies
            the records and permissions it needs.
          </span>
        </div>
        <button className="secondary" disabled title="Scheduled delivery requires an approved email provider, queue, export permission checks and retry handling.">
          Schedule delivery · provider required
        </button>
      </section>
      {onOpenRetail && <section className="sales-evidence-notice" aria-label="Retail intelligence reports">
        <div><strong>Go deeper than the total.</strong><p>Explore category and SKU performance, basket patterns, stock and hourly demand. Add reviewed inputs where your source needs more context.</p></div>
        <button onClick={onOpenRetail}>Open Retail intelligence →</button>
      </section>}
      <section className="card report-source-control" aria-label="Reporting sources">
        <header>
          <div><p>REPORTING SOURCES</p><h3>Canonical totals or one provider account</h3></div>
          <span>{sourceConnectionId ? "Provider-specific" : sourceSelectionRequired ? "Selection required" : "Consolidated"}</span>
        </header>
        <div className="report-source-buttons">
          <button className={!sourceConnectionId ? "active" : ""} onClick={() => { setSourceConnectionId(""); setSourceReportLabel(""); }}><b>Vanteloq consolidated</b><small>Canonical definitions and owner-selected authorities</small></button>
          {providerCatalogs.map((catalog) => <button key={catalog.connectionId} className={sourceConnectionId === catalog.connectionId ? "active" : ""} onClick={() => { setSourceConnectionId(catalog.connectionId); setSourceReportLabel(""); }}><b>{catalog.accountName || providerDisplayName(catalog.provider)}</b><small>{providerDisplayName(catalog.provider)} · {catalog.vocabulary.sales} from this account only</small></button>)}
        </div>
        {sourceLineage && <div className="report-source-lineage" aria-label="Authoritative source coverage">
          {[...(sourceLineage.sales ?? []).map((item) => ({ ...item, family: "Sales" })), ...(selected === "Payment-method performance" ? (sourceLineage.payments ?? []).map((item) => ({ ...item, family: "Payments" })) : [])].map((item) => <span key={`${item.family}:${item.locationId}:${item.connectionId}`}><small>{item.family} · {item.locationName}</small><b>{item.accountName || providerDisplayName(item.provider)}</b><em>{humanizeIdentifier(item.channel)} · {humanizeIdentifier(item.mode)} · {String(source?.periodStart ?? source?.earliestBusinessDate ?? "no date")} to {String(source?.periodEnd ?? source?.latestBusinessDate ?? "no date")}</em></span>)}
          {Number(sourceLineage.manual?.rowCount ?? 0) > 0 && <span><small>Owner-reviewed summaries</small><b>{Number(sourceLineage.manual?.rowCount)} manual rows</b><em>{(sourceLineage.manual?.locationRefs ?? []).length} location scope{(sourceLineage.manual?.locationRefs ?? []).length === 1 ? "" : "s"} · {String(source?.periodStart ?? source?.earliestBusinessDate ?? "no date")} to {String(source?.periodEnd ?? source?.latestBusinessDate ?? "no date")}</em></span>}
        </div>}
        {authorityEntries.flatMap(({ factFamily, authority }) => authority.conflicts.map((conflict) => <article className="report-source-conflict" key={`${factFamily}:${conflict.localLocationId}:${conflict.channel}`}>
          <div><b>Choose the authoritative {conflict.channel} {factFamily} source for {conflict.locationName || conflict.localLocationId}</b><span>Overlapping feeds are excluded from consolidated totals until an owner or admin chooses one.</span></div>
          {canResolveAuthority ? <div>{conflict.candidates.map((candidate) => {
            const ready = candidate.availability === "ready";
            return <button key={candidate.connectionId} disabled={Boolean(savingAuthority) || !ready} onClick={() => void chooseAuthority(conflict.localLocationId, candidate.connectionId, factFamily, conflict.expectedVersion)}><b>{candidate.accountName || providerDisplayName(candidate.provider)}</b><small>{providerDisplayName(candidate.provider)} · {ready && candidate.lastSuccessfulSyncAt ? `Synced ${new Date(candidate.lastSuccessfulSyncAt).toLocaleDateString("en-CA")}` : reportSourceAvailability(candidate.availability)}</small><span>{savingAuthority === candidate.connectionId ? "Saving…" : ready ? `Use for ${factFamily}` : reportSourceAvailability(candidate.availability)}</span></button>;
          })}</div> : <p>An owner or admin must choose this source.</p>}
        </article>))}
        {canonicalReports.length > 0 && <details className="provider-report-list" open><summary>Vanteloq report definitions</summary><section><div><b>Canonical intelligence</b><small>Consistent definitions across approved provider accounts. A report remains unavailable until its exact query and required facts exist.</small></div>{canonicalReports.map((item) => <button key={item.id} disabled={item.status !== "ready" || item.queryReportId === null} onClick={() => { setSourceConnectionId(""); setSourceReportLabel(""); setSelected(item.presentation === "payment_mix" ? "Payment-method performance" : "Sales totals"); }}><span><b>{item.label}</b><small>{item.description}</small></span><em>{item.implementationStatus === "planned" ? "Not available" : item.status === "ready" ? "Open canonical report" : `Needs ${item.dataNeeded.join(", ")}`}</em></button>)}</section></details>}
        {providerCatalogs.length > 0 && <details className="provider-report-list"><summary>Provider-specific report catalogue</summary>{providerCatalogs.map((catalog) => <section key={catalog.connectionId}><div><b>{catalog.accountName || providerDisplayName(catalog.provider)}</b><small>{catalog.boundary}</small></div>{catalog.providerReports.map((item) => <button key={item.id} disabled={item.status !== "ready" || item.queryReportId === null} onClick={() => { setSourceConnectionId(catalog.connectionId); setSourceReportLabel(item.label); setSelected(item.presentation === "payment_mix" ? "Payment-method performance" : "Sales totals"); }}><span><b>{item.label}</b><small>{item.description}</small></span><em>{item.status === "ready" ? "Open source view" : item.implementationStatus === "planned" ? "Not available" : `Needs ${item.dataNeeded.join(", ")}`}</em></button>)}</section>)}</details>}
      </section>
      <section className="report-period-control" aria-label="Report time frame">
        <div className="report-period-presets" aria-label="Time frame presets">
          {[
            [0, "All data"],
            [1, "Today"],
            [7, "7 days"],
            [30, "30 days"],
            [365, "12 months"],
          ].map(([days, label]) => (
            <button
              type="button"
              className={preset === (Number(days) === 0 ? "all" : String(days)) ? "active" : ""}
              key={days}
              onClick={() => {
                if (Number(days) === 0) {
                  setPreset("all");
                  setStart("");
                  setEnd("");
                } else applyPreset(Number(days));
              }}
            >
              {label}
            </button>
          ))}
          <button type="button" className={preset === "mtd" ? "active" : ""} onClick={() => { const next = monthRange(0, true); setPreset("mtd"); setStart(next.start); setEnd(next.end); }}>Month to date</button>
          <button type="button" className={preset === "last-month" ? "active" : ""} onClick={() => { const next = monthRange(-1); setPreset("last-month"); setStart(next.start); setEnd(next.end); }}>Last month</button>
        </div>
        <div className="report-date-fields">
          <label>
            <span>From</span>
            <input
              type="date"
              value={start}
              max={end || localIsoDate(new Date())}
              onChange={(event) => {
                setPreset("custom");
                setStart(event.target.value);
              }}
            />
          </label>
          <span aria-hidden="true">to</span>
          <label>
            <span>To</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              max={localIsoDate(new Date())}
              onChange={(event) => {
                setPreset("custom");
                setEnd(event.target.value);
              }}
            />
          </label>
        </div>
        <p>
          {start || end ? <><b>{start || "Earliest"}</b> through <b>{end || "Today"}</b></> : <><b>{String(source?.earliestBusinessDate || "All")}</b> through <b>{String(source?.latestBusinessDate || "imported dates")}</b></>}
        </p>
      </section>
      <div className="report-toolbar">
        <label>
          ⌕
          <input
            placeholder="Search the complete report catalogue"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          value={group}
          onChange={(event) => setGroup(event.target.value)}
        >
          <option>All reports</option>
          {Object.keys(reportGroups).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="reports-layout">
        <section className="report-catalogue">
          {Object.keys(reportGroups)
            .filter((category) => group === "All reports" || category === group)
            .map((category) => {
              const rows = visible.filter((item) => item.category === category);
              return rows.length ? (
                <article className="card" key={category}>
                  <header>
                    <h3>{category}</h3>
                    <span>{rows.length} reports</span>
                  </header>
                  {rows.map((item) => (
                    <button
                      className={selected === item.name ? "selected" : ""}
                      key={item.name}
                      onClick={() => { setSelected(item.name); setSourceReportLabel(""); }}
                    >
                      <span>{item.name}</span>
                      <em className={liveReports[item.name] ? "live" : "gated"}>
                        {liveReports[item.name]
                          ? "Imported · live"
                          : "Source required"}
                      </em>
                    </button>
                  ))}
                </article>
              ) : null;
            })}
        </section>
        <aside className="card report-inspector">
          <header>
            <div>
              <p>REPORT DEFINITION</p>
              <h2>{sourceReportLabel || selected}</h2>
            </div>
            <span className={liveReports[selected] ? "live" : "gated"}>
              {liveReports[selected] ? "Available" : "Gated"}
            </span>
          </header>
          {loading ? (
            <div className="control-empty">Calculating verified records…</div>
          ) : report?.reportStatus === "source_conflict" ? (
            <div className="gated-report"><i>!</i><h3>Consolidated totals are withheld.</h3><p>Two or more approved feeds cover the same location. Choose each sales or payment authority shown above so Vanteloq cannot double count facts.</p><span>Provider-specific views remain available while the owner or admin resolves the overlap.</span></div>
          ) : report?.reportStatus === "needs_data" ? (
            <div className="gated-report"><i>!</i><h3>Verified report evidence is incomplete.</h3><p>At least one authoritative location has no approved facts for this report and selected period, so Vanteloq is withholding partial totals.</p><span>Sync the mapped source, add an owner-reviewed summary, or adjust the report period.</span></div>
          ) : liveReports[selected] && report ? (
            <>
              <div className="report-metrics">
                <article>
                  <small>NET SALES</small>
                  <b>{money(totals?.netSalesCents, currency)}</b>
                  <span>{reportChange(comparison?.changes.netSalesRate)} vs matched period</span>
                </article>
                <article>
                  <small>GROSS PROFIT</small>
                  <b>{money(totals?.grossProfitCents, currency)}</b>
                  <span>{reportChange(comparison?.changes.grossProfitRate)} vs matched period</span>
                </article>
                <article>
                  <small>AVERAGE TRANSACTION</small>
                  <b>{money(totals?.averageTransactionCents, currency)}</b>
                  <span>{reportChange(comparison?.changes.averageTransactionRate)} vs matched period</span>
                </article>
                <article>
                  <small>TRANSACTIONS</small>
                  <b>{totals?.transactionCount?.toLocaleString() || "0"}</b>
                  <span>{reportChange(comparison?.changes.transactionRate)} vs matched period</span>
                </article>
              </div>
              <section className="report-comparison-strip" aria-label="Matched period comparison">
                <div><small>SELECTED PERIOD</small><b>{readableReportDate(source?.periodStart || source?.earliestBusinessDate)} to {readableReportDate(source?.periodEnd || source?.latestBusinessDate)}</b><span>{String(source?.verifiedDays ?? 0)} verified days · {Math.round(Number(source?.completenessRate ?? 0) * 100)}% date × location coverage</span></div>
                <div><small>PREVIOUS MATCHED PERIOD</small><b>{comparison ? `${readableReportDate(comparison.periodStart)} to ${readableReportDate(comparison.periodEnd)}` : "Not available"}</b><span>{comparison ? `${comparison.verifiedDays} verified days` : "A complete baseline has not been imported"}</span></div>
              </section>
              <section className="report-period-chart" aria-label="Sales over the selected time frame">
                <header>
                  <div>
                    <p>SELECTED TIME FRAME</p>
                    <h3>Net sales and gross profit</h3>
                  </div>
                  <span>{String(source?.verifiedDays ?? trendRows.length)} verified days · {rows.length} source records</span>
                </header>
                {trendRows.length ? (
                  <BusinessTrendChart
                    currency={currency}
                    data={trendRows}
                  />
                ) : (
                  <div className="report-chart-empty">No verified sales records match this time frame.</div>
                )}
              </section>
              {selected === "Payment-method performance" && (
                <section className="report-payment-mix" aria-label="Payment method performance">
                  <header><div><p>VERIFIED TENDERS</p><h3>Payment method mix</h3></div><span>{paymentMix.length ? `${paymentMix.length} payment types` : "Backfill required"}</span></header>
                  {paymentMix.length ? paymentMix.map((row) => <div key={`${row.category}:${row.paymentTypeName ?? "unknown"}`}><span><i className={`payment-${row.category}`} /><b>{row.paymentTypeName || humanizeIdentifier(row.category)}</b><small>{Number(row.transactionCount).toLocaleString()} recorded payments</small></span><strong>{money(Number(row.amountCents), currency)}</strong></div>) : <p>No verified payment records match this period. Vanteloq will not infer cash or card mix from sales totals.</p>}
                </section>
              )}
              <section className="explain-act">
                <p>EXPLAIN & ACT</p>
                <h3>
                  {String(explain?.executiveSummary || "Verified report ready")}
                </h3>
                <dl>
                  <div>
                    <dt>Likely drivers</dt>
                    <dd>
                      {String(
                        explain?.likelyDrivers || "No driver model available.",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{String(explain?.confidence || "low")}</dd>
                  </div>
                  <div>
                    <dt>Source & freshness</dt>
                    <dd>
                      {source?.accountName ? `${String(source.accountName)} · ` : ""}{String(source?.type)}{Number(manualLineage?.rowCount ?? 0) > 0 ? ` · ${Number(manualLineage?.rowCount)} manual row${Number(manualLineage?.rowCount) === 1 ? "" : "s"} from ${(manualLineage?.importIds ?? []).length} import${(manualLineage?.importIds ?? []).length === 1 ? "" : "s"}` : ""} · Data through{" "}
                      {String(source?.latestBusinessDate || "no records")} ·
                      {" "}{start || end
                        ? `${start || "earliest"} to ${end || "today"}`
                        : `${String(source?.earliestBusinessDate || "earliest")} to ${String(source?.latestBusinessDate || "latest")}`} · generated {String(source?.generatedAt)}
                    </dd>
                  </div>
                </dl>
                <button
                  onClick={() =>
                    createTask({
                      title: `Review ${selected}`,
                      detail: String(
                        explain?.recommendedAction ||
                          "Review the report and its supporting records.",
                      ),
                      priority: "medium",
                      sourceType: "insight",
                      sourceRef: `report:${liveReports[selected]}:${sourceConnectionId || "consolidated"}:${selected === "Payment-method performance" ? "payment_mix" : "sales"}`,
                    })
                  }
                >
                  Create assigned action →
                </button>
              </section>
              <footer>
                {canExport ? (
                  <a
                    className="report-export"
                    href={`/api/v1/reports?report=${liveReports[selected]}${start ? `&start=${start}` : ""}${end ? `&end=${end}` : ""}${activeLocationId ? `&location=${encodeURIComponent(activeLocationId)}` : ""}${sourceConnectionId ? `&connection=${encodeURIComponent(sourceConnectionId)}` : ""}${selected === "Payment-method performance" ? "&view=payment_mix" : ""}&format=csv`}
                  >
                    Export CSV
                  </a>
                ) : (
                  <button disabled title={canExportFeature ? "This role cannot export reports" : "CSV export requires the Pro plan"}>
                    {canExportFeature ? "CSV · restricted" : "CSV · Pro required"}
                  </button>
                )}
                <button
                  disabled
                  title="XLSX generation provider is not configured"
                >
                  XLSX · gated
                </button>
                <button
                  disabled
                  title="PDF rendering provider is not configured"
                >
                  PDF · gated
                </button>
              </footer>
            </>
          ) : (
            <div className="gated-report">
              <i>○</i>
              <h3>This report needs a connected source.</h3>
              <p>{reportRequirement(selected)}</p>
              <span>
                Once connected, it will support filters, comparisons,
                transaction drill-down, annotations, generation timestamps and
                source freshness.
              </span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function reportRequirement(name: string) {
  const category = Object.entries(reportGroups).find(([, items]) =>
    items.includes(name),
  )?.[0];
  const requirements: Record<string, string> = {
    Inventory:
      "SKU-level on-hand balances, movements, costs, purchase orders, receipts, expiry and location facts are required.",
    Customers:
      "Customer-linked transactions, consent, loyalty and contact records are required.",
    "Payments & reconciliation":
      "Tender, payout, bank-transaction and reconciliation records from verified adapters are required.",
    "Suppliers & purchasing":
      "Supplier, purchase-order, receiving, invoice and credit records are required.",
    Employees:
      "Schedules, time clock, role and hourly transaction facts are required.",
    "Accounting & BookLoQ":
      "Open BookLoQ for its implemented ledger reports. Provider-dependent reports remain gated there.",
  };
  return (
    requirements[category || ""] ||
    "Line-item POS transactions with product, employee, location, payment and timestamp dimensions are required."
  );
}

type OrderLine = {
  id: string;
  description: string;
  sku: string;
  quantity: number;
  receivedQuantity: number;
  invoicedQuantity: number;
  unitCostCents: number | null;
  previousCostCents: number | null;
  currentInventory: number | null;
  reorderPoint: number | null;
  forecastDemand: number | null;
};
type Order = {
  id: string;
  orderNumber: string;
  supplierName: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  committedCashDate: string | null;
  currency: string;
  status: string;
  totalCents: number | null;
  subtotalCents: number | null;
  taxCents: number | null;
  discountCents: number | null;
  paymentTerms: string;
  lines: OrderLine[];
  receipts: { id: string; discrepancyStatus: string }[];
  matches: { id: string; status: string; differenceCents: number | null }[];
};
type ProcurementSupplier = {
  id: string;
  provider: string;
  externalSupplierId: string;
  name: string;
  accountNumber: string | null;
};
type ProcurementProduct = {
  id: string;
  provider: string;
  externalProductId: string;
  sku: string;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  defaultCostCents: number | null;
  onHandQuantity: number | null;
  reorderPoint: number;
  incomingUnits: number;
  soldUnits30d: number;
  soldUnitsPrevious30d: number;
  soldUnits90d: number;
  averageDailyDemand: number;
  recommendedQuantity: number | null;
  cashConstrainedQuantity?: number | null;
  cashAllocatedCents: number | null;
  cashDecision?: "within_capacity" | "cash_constrained" | "needs_verified_cash" | "needs_unit_cost" | "needs_inventory" | "no_order_needed" | "restricted";
  daysCover: number | null;
  demandTrendRate: number | null;
  recommendationFactors: string[];
  lastSoldDate: string | null;
  lastOrderedDate: string | null;
  health: {
    tone: "red" | "green" | "amber";
    label: string;
    detail: string;
  };
};
type ProcurementCatalog = {
  suppliers: ProcurementSupplier[];
  products: ProcurementProduct[];
  cashContext: {
    status: "available" | "needs_bank_connection" | "stale_bank_data" | "needs_healthy_cash_account" | "needs_currency_review";
    verifiedPurchasingCapacityCents: number | null;
    verifiedCashCents: number | null;
    cashSafetyReserveCents: number;
    outstandingBillsCents: number;
    openPurchaseCommitmentsCents: number;
    accountsUsed: number;
    baseCurrency: string;
    maximumAgeHours: number;
    excludedCurrencyObligations: number;
    explanation: string;
  } | null;
  locationScope: { id: string; name: string } | null;
  method: {
    periodStart: string;
    periodEnd: string;
    reviewHorizonDays: number;
    deadStockWindowDays: number;
    deadStockHistoryAvailable: boolean;
    description: string;
  };
};
type PurchasingData = {
  orders: Order[];
  summary: {
    openOrders: number;
    awaitingApproval: number;
    openCommitmentsCents: number | null;
    commitmentsByCurrency: Array<{ currency: string; amountCents: number | null }>;
    commitmentsLabel: string;
    discrepancies: number;
    redAlerts: number;
    healthyProducts: number;
    deadStockProducts: number;
  };
  commitmentBoard: {
    totalRemainingMerchandiseCents: number | null;
    plannedOrders: Array<{ id: string; orderNumber: string; supplierName: string; statusLabel: string; remainingUnits: number; lines: Array<{ sku: string; description: string; remainingQuantity: number; duplicateWarning: string }> }>;
    boundary: string;
    vendors: Array<{
      supplierName: string;
      currency: string;
      openOrderCount: number;
      remainingMerchandiseCents: number | null;
      remainingUnits: number;
      nextDeliveryDate: string | null;
      orders: Array<{
        id: string;
        orderNumber: string;
        statusLabel: string;
        expectedDeliveryDate: string | null;
        committedCashDate: string | null;
        remainingMerchandiseCents: number | null;
        remainingUnits: number;
        lines: Array<{
          sku: string;
          description: string;
          remainingQuantity: number;
          unitCostCents: number | null;
          priceChangeRate: number | null;
          duplicateWarning: string;
        }>;
      }>;
    }>;
  };
  catalog: ProcurementCatalog;
  calendar: Array<{
    id: string;
    kind: "purchase_ordered" | "purchase_expected" | "purchase_cash_due" | "supplier_bill_due" | "customer_invoice_due";
    date: string;
    title: string;
    detail: string;
    status: string;
    amountCents: number | null;
    currency: string;
  }>;
};

export function PurchaseOrdersWorkspace({
  currency,
  showNotice,
  createTask,
  activeLocationId,
}: SharedProps & { activeLocationId: string | null }) {
  const [data, setData] = useState<PurchasingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"orders" | "recommendations" | "calendar">("orders");
  const [creating, setCreating] = useState<{
    supplierId?: string;
    productId?: string;
  } | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setLoadError(""); setData(null);
    try {
      const response = await apiFetch(`/api/v1/purchasing${activeLocationId ? `?location=${encodeURIComponent(activeLocationId)}` : ""}`);
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Unable to load purchase orders."));
      setData(body as PurchasingData);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Unable to load purchase orders."); }
    finally { setLoading(false); }
  }, [activeLocationId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const action = async (body: Record<string, unknown>) => {
    const response = await apiFetch(`/api/v1/purchasing${activeLocationId ? `?location=${encodeURIComponent(activeLocationId)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw: unknown = await response.json();
    if (!response.ok)
      return showNotice(apiMessage(raw, "Purchase-order action failed."));
    const next = raw as PurchasingData;
    setData(next);
    setSelected(
      next.orders.find((order: Order) => order.id === selected?.id) || null,
    );
    showNotice("Purchase-order workflow updated and audited");
  };
  if (loadError) return <div className="content control-empty"><p role="alert">{loadError}</p><button type="button" onClick={() => void load()}>Retry purchase orders</button></div>;
  if (loading || !data)
    return (
      <WorkspaceSkeleton label="Loading purchase orders"/>
    );
  return (
    <div className="content control-page po-centre">
      <section className="page-intro">
        <div>
          <p>PURCHASE-ORDER CENTRE</p>
          <h2>
            Order, approve, receive and match without losing the cash picture.
          </h2>
          <span>
            Amounts are stored to the cent. Sending and payment never happen
            automatically; every commitment requires an authorized approval.
          </span>
          <small className="active-purchasing-scope">Recommendation scope: {data.catalog.locationScope?.name ?? "All locations"}</small>
        </div>
        <button className="primary" onClick={() => setCreating({})}>
          + New purchase order
        </button>
      </section>
      <div className="control-tabs">
        <button
          className={tab === "orders" ? "active" : ""}
          onClick={() => setTab("orders")}
        >
          Orders
        </button>
        <button
          className={tab === "recommendations" ? "active" : ""}
          onClick={() => setTab("recommendations")}
        >
          Smart reorder
        </button>
        <button
          className={tab === "calendar" ? "active" : ""}
          onClick={() => setTab("calendar")}
        >
          PO & invoice calendar
        </button>
      </div>
      {tab === "orders" ? (
        <>
          <div className="po-summary">
            <article>
              <small>OPEN ORDERS</small>
              <b>{data.summary.openOrders}</b>
            </article>
            <article>
              <small>AWAITING APPROVAL</small>
              <b>{data.summary.awaitingApproval}</b>
            </article>
            <article>
              <small>INCOMING MERCHANDISE</small>
              <b>{data.summary.commitmentsByCurrency.length ? data.summary.commitmentsByCurrency.map((item) => money(item.amountCents, item.currency)).join(" · ") : money(0, currency)}</b>
              <em>{data.summary.commitmentsLabel}</em>
            </article>
            <article>
              <small>DISCREPANCIES</small>
              <b>{data.summary.discrepancies}</b>
            </article>
          </div>
          <section className="purchasing-health-overview" aria-label="Product purchasing health">
            <article className="issue"><i /> <span><small>RED ISSUES</small><b>{data.summary.redAlerts}</b><em>Stockout risk or dead stock</em></span></article>
            <article className="healthy"><i /> <span><small>GREEN HEALTH</small><b>{data.summary.healthyProducts}</b><em>Demand and cover are aligned</em></span></article>
            <article className="dead"><i /> <span><small>DEAD STOCK</small><b>{data.summary.deadStockProducts}</b><em>No verified sale in 90 days</em></span></article>
          </section>
          <UpcomingPurchaseCommitments board={data.commitmentBoard} />
          <ProcurementSignals
            catalog={data.catalog}
            openDraft={(seed) => setCreating(seed)}
          />
          <section className="po-layout">
            <article className="card po-table">
              <header>
                <span>Order</span>
                <span>Supplier</span>
                <span>Expected</span>
                <span>Status</span>
                <span>Total</span>
              </header>
              {data.orders.map((order) => (
                <button
                  className={selected?.id === order.id ? "selected" : ""}
                  key={order.id}
                  onClick={() => setSelected(order)}
                >
                  <span>
                    <b>{order.orderNumber}</b>
                    <small>{order.orderDate}</small>
                  </span>
                  <span>{order.supplierName}</span>
                  <span>{order.expectedDeliveryDate || "Not set"}</span>
                  <span>
                    <em className={`po-status ${order.status}`}>
                      {humanizeIdentifier(order.status)}
                    </em>
                  </span>
                  <span>{money(order.totalCents, order.currency)}</span>
                </button>
              ))}
              {!data.orders.length && (
                <div className="control-empty">
                  <b>No purchase orders yet.</b>
                  <span>Create a draft or use the recommendation lab.</span>
                </div>
              )}
            </article>
            <OrderInspector order={selected} action={action} />
          </section>
        </>
      ) : tab === "recommendations" ? (
        <>
          <CatalogRecommendations
            catalog={data.catalog}
            currency={currency}
            openDraft={(seed) => setCreating(seed)}
          />
          <RecommendationLab currency={currency} createTask={createTask} />
        </>
      ) : (
        <PurchasingCalendar events={data.calendar} />
      )}{" "}
      {creating && (
        <PurchaseOrderModal
          currency={currency}
          catalog={data.catalog}
          seed={creating}
          activeLocationId={activeLocationId}
          close={() => setCreating(null)}
          created={(next) => {
            setData(next);
            setCreating(null);
            showNotice("Draft purchase order created");
          }}
        />
      )}
    </div>
  );
}

function UpcomingPurchaseCommitments({ board }: { board: PurchasingData["commitmentBoard"] }) {
  return (
    <section className="card upcoming-purchase-commitments" aria-label="Upcoming purchased inventory by vendor">
      <header>
        <div>
          <p>ALREADY PURCHASED</p>
          <h3>Incoming orders grouped by vendor</h3>
          <span>Use this before creating another order. Quantities below are already committed and count as incoming inventory.</span>
        </div>
        <strong>{board.vendors.length ? `${board.vendors.length} vendor${board.vendors.length === 1 ? "" : "s"}` : "No open purchases"}</strong>
      </header>
      {board.vendors.length ? <div className="commitment-vendor-grid">
        {board.vendors.map((vendor) => <article key={`${vendor.currency}:${vendor.supplierName}`}>
          <header>
            <span><b>{vendor.supplierName}</b><small>{vendor.openOrderCount} open purchase{vendor.openOrderCount === 1 ? "" : "s"}</small></span>
            <span><b>{money(vendor.remainingMerchandiseCents, vendor.currency)}</b><small>{vendor.remainingUnits} units still coming</small></span>
          </header>
          <p className="commitment-arrival">Next expected delivery <b>{vendor.nextDeliveryDate ?? "Not confirmed"}</b></p>
          {vendor.orders.map((order) => <details key={order.id}>
            <summary><span><b>{order.orderNumber}</b><small>{order.statusLabel}</small></span><span>{order.remainingUnits} units · {money(order.remainingMerchandiseCents, vendor.currency)}</span></summary>
            <div className="commitment-lines">
              {order.lines.filter((line) => line.remainingQuantity > 0).map((line) => <div key={`${order.id}:${line.sku}`}>
                <span><b>{line.description}</b><small>{line.sku || "No SKU"}{typeof line.unitCostCents === "number" ? ` · ${money(line.unitCostCents, vendor.currency)} each` : ""}</small></span>
                <span><b>{line.remainingQuantity} incoming</b><small>{typeof line.priceChangeRate === "number" ? `${new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(line.priceChangeRate)} cost change` : line.priceChangeRate === null ? "No prior cost baseline" : "Cost comparison restricted"}</small></span>
                <p>{line.duplicateWarning}</p>
              </div>)}
            </div>
          </details>)}
        </article>)}
      </div> : <div className="control-empty"><b>No purchased inventory is still outstanding.</b><span>Orders sent to a vendor will appear here until their quantities are received.</span></div>}
      {board.plannedOrders.length > 0 && <details className="planned-purchase-overlap"><summary>{board.plannedOrders.length} planned order{board.plannedOrders.length === 1 ? "" : "s"} to review before buying again</summary>{board.plannedOrders.map((order) => <section key={order.id}><b>{order.orderNumber} · {order.supplierName}</b><span>{order.statusLabel} · {order.remainingUnits} units planned</span>{order.lines.filter((line) => line.remainingQuantity > 0).map((line) => <small key={`${order.id}:${line.sku}`}>{line.duplicateWarning}</small>)}</section>)}</details>}
      <footer>{board.boundary}</footer>
    </section>
  );
}

function ProcurementSignals({
  catalog,
  openDraft,
}: {
  catalog: ProcurementCatalog;
  openDraft: (seed: { supplierId?: string; productId?: string }) => void;
}) {
  const signals = [...catalog.products]
    .sort((left, right) => {
      const rank = { red: 0, amber: 1, green: 2 };
      return rank[left.health.tone] - rank[right.health.tone];
    })
    .slice(0, 4);
  if (!signals.length)
    return (
      <section className="card procurement-source-empty">
        <b>Product and supplier database ready for import</b>
        <span>
          Connect or sync a supported POS to populate purchase-order choices and
          product-level ordering signals.
        </span>
      </section>
    );
  return (
    <section className="procurement-signal-strip" aria-label="Purchasing health signals">
      {signals.map((product) => (
        <article className={`procurement-signal ${product.health.tone}`} key={product.id}>
          <header>
            <span>{product.health.label}</span>
            <i aria-hidden="true" />
          </header>
          <b>{product.name}</b>
          <small>
            {product.onHandQuantity ?? "Unknown"} on hand · {product.incomingUnits} incoming
          </small>
          <p>{product.health.detail}</p>
          <footer>
            <span>
              {product.lastOrderedDate
                ? `Last ordered ${product.lastOrderedDate}`
                : "No purchase order history"}
            </span>
            <button
              onClick={() =>
                openDraft({
                  supplierId: product.supplierId ?? undefined,
                  productId: product.id,
                })
              }
            >
              Review order
            </button>
          </footer>
        </article>
      ))}
    </section>
  );
}

function PurchasingCalendar({ events }: { events: PurchasingData["calendar"] }) {
  const initialMonth = (events.find((event) => event.date >= new Date().toISOString().slice(0, 10))?.date ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
  const [month, setMonth] = useState(initialMonth);
  const first = new Date(`${month}-01T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const leading = first.getUTCDay();
  const cells = Array.from({ length: leading + daysInMonth }, (_, index) => index < leading ? null : index - leading + 1);
  const today = new Date().toISOString().slice(0, 10);
  const monthEvents = events.filter((event) => event.date.startsWith(month));
  return (
    <section className="purchasing-calendar card">
      <header>
        <div><p>COMMITMENT CALENDAR</p><h3>Orders, expected deliveries and invoice due dates</h3><span>Purchase events and open payables or receivables share one date view so commitments are visible before the next order.</span></div>
        <label>Month<input aria-label="Purchase calendar month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      </header>
      <div className="calendar-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="purchasing-month-grid">
        {cells.map((day, index) => {
          if (day === null) return <span className="calendar-blank" key={`blank-${index}`} />;
          const date = `${month}-${String(day).padStart(2, "0")}`;
          const dayEvents = monthEvents.filter((event) => event.date === date);
          return <article className={date === today ? "today" : ""} key={date}>
            <b>{day}</b>
            {dayEvents.map((event) => <span className={event.kind} key={event.id} title={`${event.title}: ${money(event.amountCents, event.currency)}`}><i />{event.title}<small>{event.detail}</small></span>)}
          </article>;
        })}
      </div>
      {!monthEvents.length && <p className="calendar-empty">No recorded purchase-order or invoice commitment falls in this month.</p>}
      <footer><span><i className="ordered" />Ordered</span><span><i className="expected" />Expected</span><span><i className="payable" />Bill or cash due</span><span><i className="receivable" />Customer invoice due</span></footer>
    </section>
  );
}

function CatalogRecommendations({
  catalog,
  currency,
  openDraft,
}: {
  catalog: ProcurementCatalog;
  currency: string;
  openDraft: (seed: { supplierId?: string; productId?: string }) => void;
}) {
  const products = [...catalog.products].sort(
    (left, right) => (right.recommendedQuantity ?? -1) - (left.recommendedQuantity ?? -1),
  );
  return (
    <section className="catalog-recommendations">
      <header className="card procurement-method">
        <div>
          <p>VERIFIED PRODUCT SIGNALS</p>
          <h3>Recommended quantities with the ordering history beside them</h3>
          <span>{catalog.method.description}</span>
        </div>
        <dl>
          <div>
            <dt>Sales evidence</dt>
            <dd>{catalog.method.periodStart} to {catalog.method.periodEnd}</dd>
          </div>
          <div>
            <dt>Review horizon</dt>
            <dd>{catalog.method.reviewHorizonDays} days</dd>
          </div>
        </dl>
      </header>
      {catalog.cashContext ? (
        <aside className={`card purchasing-cash-context ${catalog.cashContext.status}`}>
          <div>
            <p>CASH GUARDRAIL</p>
            <h3>
              {catalog.cashContext.status === "needs_currency_review"
                ? "Currency review is required before cash can constrain reorders"
                : catalog.cashContext.verifiedPurchasingCapacityCents === null
                ? "Cash-aware quantities need verified banking data"
                : `${money(catalog.cashContext.verifiedPurchasingCapacityCents, catalog.cashContext.baseCurrency)} available for reviewed reorders`}
            </h3>
            <span>{catalog.cashContext.explanation}</span>
          </div>
          <dl>
            <div><dt>Fresh cash</dt><dd>{money(catalog.cashContext.verifiedCashCents, catalog.cashContext.baseCurrency)}</dd></div>
            <div><dt>Safety reserve</dt><dd>{money(catalog.cashContext.cashSafetyReserveCents, catalog.cashContext.baseCurrency)}</dd></div>
            <div><dt>Open bills</dt><dd>{money(catalog.cashContext.outstandingBillsCents, catalog.cashContext.baseCurrency)}</dd></div>
            <div><dt>Open purchase commitments</dt><dd>{money(catalog.cashContext.openPurchaseCommitmentsCents, catalog.cashContext.baseCurrency)}</dd></div>
          </dl>
        </aside>
      ) : (
        <aside className="card purchasing-cash-context restricted">
          <div>
            <p>OWNER REVIEW</p>
            <h3>Cash capacity is restricted</h3>
            <span>An owner or finance teammate can review banking, bills, reserves, and the cash-aware order quantity before approval.</span>
          </div>
        </aside>
      )}
      {!products.length ? (
        <div className="card control-empty">
          <b>No imported products are available.</b>
          <span>Sync a supported POS before generating product recommendations.</span>
        </div>
      ) : (
        <div className="catalog-recommendation-grid">
          {products.map((product) => {
            const cashRestricted = !product.cashDecision || product.cashDecision === "restricted";
            return (
            <article className={`card catalog-recommendation ${product.health.tone}`} key={product.id}>
              <header>
                <div>
                  <small>{product.supplierName || "Supplier not assigned"}</small>
                  <h3>{product.name}</h3>
                  <span>{product.sku || "No SKU"}</span>
                </div>
                <em>{product.health.label}</em>
              </header>
              <div className="recommendation-metrics">
                <span><small>ON HAND</small><b>{product.onHandQuantity ?? "Unknown"}</b></span>
                <span><small>INCOMING</small><b>{product.incomingUnits}</b></span>
                <span><small>SOLD 30D</small><b>{product.soldUnits30d.toLocaleString()}</b></span>
                <span><small>DEMAND NEED</small><b>{product.recommendedQuantity ?? "Review"}</b></span>
                <span><small>{cashRestricted ? "OWNER REVIEW" : "CASH-AWARE"}</small><b>{product.cashConstrainedQuantity ?? "Review"}</b></span>
              </div>
              <p>{product.health.detail}</p>
              <p className={`cash-decision-copy ${product.cashDecision ?? "restricted"}`}>
                {cashRestricted
                  ? "An owner or finance teammate must review cash capacity before this demand quantity is approved."
                  : product.cashDecision === "needs_inventory"
                  ? "Verify inventory before calculating a reorder quantity or allocating cash."
                  : product.cashDecision === "within_capacity"
                  ? `${product.cashConstrainedQuantity} units fit within verified purchasing capacity.`
                  : product.cashDecision === "cash_constrained"
                    ? `Verified capacity reduces this reviewed quantity from ${product.recommendedQuantity ?? "Review"} to ${product.cashConstrainedQuantity}.`
                    : product.cashDecision === "needs_unit_cost"
                      ? "Add a verified unit cost before cash can constrain this quantity."
                      : product.cashDecision === "no_order_needed"
                        ? "No order is needed from the current demand and inventory evidence."
                        : "Connect and refresh BookLoQ banking before using this demand quantity as a cash-approved amount."}
              </p>
              <div className="recommendation-history">
                <span>Last ordered <b>{product.lastOrderedDate || "No history"}</b></span>
                <span>Last sold <b>{product.lastSoldDate || "No verified sale"}</b></span>
                <span>Default cost <b>{money(product.defaultCostCents, currency)}</b></span>
              </div>
              <ul className="recommendation-factors">
                {product.recommendationFactors.map((factor) => <li key={factor}>{factor}</li>)}
              </ul>
              <button
                className="primary"
                onClick={() => openDraft({ supplierId: product.supplierId ?? undefined, productId: product.id })}
              >
                Create review draft
              </button>
            </article>
          );})}
        </div>
      )}
    </section>
  );
}

function OrderInspector({
  order,
  action,
}: {
  order: Order | null;
  action: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [receiving, setReceiving] = useState(false);
  if (!order)
    return (
      <aside className="card order-inspector control-empty">
        <b>Select a purchase order.</b>
        <span>Review lines, approvals, receipts and invoice matching.</span>
      </aside>
    );
  return (
    <aside className="card order-inspector">
      <header>
        <div>
          <p>{order.orderNumber}</p>
          <h3>{order.supplierName}</h3>
        </div>
        <span className={`po-status ${order.status}`}>
          {humanizeIdentifier(order.status)}
        </span>
      </header>
      <div className="order-facts">
        <span>
          <small>ORDERED</small>
          <b>{order.orderDate}</b>
        </span>
        <span>
          <small>EXPECTED</small>
          <b>{order.expectedDeliveryDate || "Not set"}</b>
        </span>
        <span>
          <small>PAYMENT</small>
          <b>{order.paymentTerms || "Not set"}</b>
        </span>
      </div>
      <div className="order-lines">
        {order.lines.map((line) => (
          <article key={line.id}>
            <div>
              <b>{line.description}</b>
              <small>{line.sku || "No SKU"}</small>
            </div>
            <span>
              {line.quantity} ordered
              <br />
              {line.receivedQuantity} received
            </span>
            <strong>
              {money(line.unitCostCents === null ? null : line.quantity * line.unitCostCents, order.currency)}
            </strong>
          </article>
        ))}
      </div>
      <div className="order-total">
        <span>
          Subtotal<b>{money(order.subtotalCents, order.currency)}</b>
        </span>
        <span>
          Tax<b>{money(order.taxCents, order.currency)}</b>
        </span>
        <span>
          Total<b>{money(order.totalCents, order.currency)}</b>
        </span>
      </div>
      <div className="order-actions">
        {!['cancelled', 'closed'].includes(order.status) && (
          <CommitmentDateEditor key={order.id} order={order} action={action} />
        )}
        {order.status === "awaiting_approval" && (
          <button
            className="primary"
            onClick={() =>
              void action({ action: "approve", purchaseOrderId: order.id })
            }
          >
            Approve order
          </button>
        )}
        {order.status === "approved" && (
          <button
            onClick={() =>
              void action({
                action: "mark_sent",
                purchaseOrderId: order.id,
                confirmExternalSend: true,
              })
            }
          >
            Confirm sent externally
          </button>
        )}
        {["sent", "acknowledged", "partially_received"].includes(
          order.status,
        ) && <button onClick={() => setReceiving(true)}>Receive goods</button>}
      </div>
      <p className="workflow-boundary">
        Vanteloq does not email this order or initiate payment until verified
        provider adapters are connected.
      </p>
      {receiving && (
        <ReceiveModal
          order={order}
          close={() => setReceiving(false)}
          receive={async (lines) => {
            await action({
              action: "receive",
              purchaseOrderId: order.id,
              receivedDate: new Date().toISOString().slice(0, 10),
              lines,
            });
            setReceiving(false);
          }}
        />
      )}
    </aside>
  );
}

function CommitmentDateEditor({
  order,
  action,
}: {
  order: Order;
  action: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [committedCashDate, setCommittedCashDate] = useState(order.committedCashDate ?? "");
  return (
    <form
      className="commitment-date-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void action({ action: "set_commitment_date", purchaseOrderId: order.id, committedCashDate });
      }}
    >
      <label><FieldLabel>Expected Cash Date</FieldLabel><input
          type="date"
          value={committedCashDate}
          onChange={(event) => setCommittedCashDate(event.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={committedCashDate === (order.committedCashDate ?? "")}>Save date</button>
    </form>
  );
}

function PurchaseOrderModal({
  currency,
  catalog,
  seed,
  activeLocationId,
  close,
  created,
}: {
  currency: string;
  catalog: ProcurementCatalog;
  seed: { supplierId?: string; productId?: string };
  activeLocationId: string | null;
  close: () => void;
  created: (data: PurchasingData) => void;
}) {
  const initialProduct = catalog.products.find(
    (product) => product.id === seed.productId,
  );
  const blankLine = (product?: ProcurementProduct) => ({
      productId: product?.id ?? "",
      sku: product?.sku ?? "",
      description: product?.name ?? "",
      quantity: Math.max(1, product?.cashConstrainedQuantity ?? product?.recommendedQuantity ?? 1),
      unitCost: product?.defaultCostCents
        ? product.defaultCostCents / 100
        : 0,
      currentInventory: product?.onHandQuantity ?? null,
      reorderPoint: product?.reorderPoint ?? 0,
      forecastDemand: product?.recommendedQuantity ?? null,
    });
  const [supplierId, setSupplierId] = useState(
    seed.supplierId ?? initialProduct?.supplierId ?? "",
  );
  const [lines, setLines] = useState([blankLine(initialProduct)]);
  const [error, setError] = useState("");
  const update = (
    index: number,
    key: keyof (typeof lines)[number],
    value: string | number,
  ) =>
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, [key]: value } : line,
      ),
    );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await apiFetch(`/api/v1/purchasing${activeLocationId ? `?location=${encodeURIComponent(activeLocationId)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        orderNumber: form.get("orderNumber"),
        supplierId: form.get("supplierId"),
        supplierName: form.get("supplierName"),
        deliveryLocationId: activeLocationId,
        orderDate: form.get("orderDate"),
        expectedDeliveryDate: form.get("expectedDeliveryDate"),
        committedCashDate: form.get("committedCashDate"),
        currency,
        paymentTerms: form.get("paymentTerms"),
        taxCents: Math.round(Number(form.get("tax") || 0) * 100),
        discountCents: Math.round(Number(form.get("discount") || 0) * 100),
        submitForApproval: form.get("submitForApproval") === "on",
        lines: lines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          description: line.description,
          quantity: Number(line.quantity),
          unitCostCents: Math.round(Number(line.unitCost) * 100),
          currentInventory: line.currentInventory === null ? null : Number(line.currentInventory),
          reorderPoint: Number(line.reorderPoint),
          forecastDemand: line.forecastDemand === null ? null : Number(line.forecastDemand),
        })),
      }),
    });
    const body: unknown = await response.json();
    if (!response.ok)
      return setError(apiMessage(body, "Unable to create purchase order."));
    created(body as PurchasingData);
  };
  return (
    <div className="modal-backdrop">
      <form className="po-modal" onSubmit={submit}>
        <header>
          <div>
            <p>NEW PURCHASE ORDER</p>
            <h2>Build a deterministic commitment</h2>
          </div>
          <button type="button" onClick={close}>
            ×
          </button>
        </header>
        <div className="po-form-grid">
          <label><FieldLabel>Order Number</FieldLabel><input name="orderNumber" placeholder="PO-0001" required />
          </label>
          <label>
            Supplier
            <select
              name="supplierId"
              value={supplierId}
              onChange={(event) => {
                const nextSupplierId = event.target.value;
                setSupplierId(nextSupplierId);
                setLines((current) =>
                  current.map((line) => {
                    const product = catalog.products.find(
                      (candidate) => candidate.id === line.productId,
                    );
                    return product?.supplierId &&
                      nextSupplierId &&
                      product.supplierId !== nextSupplierId
                      ? blankLine()
                      : line;
                  }),
                );
              }}
            >
              <option value="">Enter a supplier manually</option>
              {catalog.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          {!supplierId && (
            <label><FieldLabel>Supplier Name</FieldLabel><input name="supplierName" required />
            </label>
          )}
          <label><FieldLabel>Order Date</FieldLabel><input
              name="orderDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </label>
          <label>
            Expected delivery
            <input name="expectedDeliveryDate" type="date" />
          </label>
          <label>
            Expected cash date
            <input name="committedCashDate" type="date" />
            <small>Required before the order can be confirmed as sent.</small>
          </label>
          <label>
            Payment terms
            <input name="paymentTerms" placeholder="Net 30" />
          </label>
          <label>
            Currency
            <input value={currency} readOnly />
          </label>
        </div>
        <div className="po-line-editor">
          <header>
            <b>Products</b>
            <button
              type="button"
              onClick={() =>
                setLines((current) => [
                  ...current,
                  blankLine(),
                ])
              }
            >
              + Add line
            </button>
          </header>
          {lines.map((line, index) => (
            <div className="po-product-line" key={index}>
              <select
                aria-label="Product from product database"
                value={line.productId}
                onChange={(event) => {
                  const product = catalog.products.find(
                    (candidate) => candidate.id === event.target.value,
                  );
                  if (!product) return update(index, "productId", "");
                  setLines((current) =>
                    current.map((candidate, position) =>
                      position === index ? blankLine(product) : candidate,
                    ),
                  );
                  if (!supplierId && product.supplierId)
                    setSupplierId(product.supplierId);
                }}
              >
                <option value="">Manual product</option>
                {catalog.products
                  .filter(
                    (product) =>
                      !supplierId ||
                      !product.supplierId ||
                      product.supplierId === supplierId,
                  )
                  .map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {product.sku || "No SKU"}
                    </option>
                  ))}
              </select>
              <input
                aria-label="SKU"
                placeholder="SKU"
                value={line.sku}
                onChange={(event) => update(index, "sku", event.target.value)}
              />
              <input
                aria-label="Product description"
                placeholder="Product description"
                value={line.description}
                onChange={(event) =>
                  update(index, "description", event.target.value)
                }
                required
              />
              <input
                aria-label="Quantity"
                type="number"
                min="1"
                value={line.quantity}
                onChange={(event) =>
                  update(index, "quantity", Number(event.target.value))
                }
              />
              <input
                aria-label="Unit cost"
                type="number"
                min="0"
                step="0.01"
                value={line.unitCost}
                onChange={(event) =>
                  update(index, "unitCost", Number(event.target.value))
                }
              />
              <button
                type="button"
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              >
                ×
              </button>
              {line.productId && (() => {
                const product = catalog.products.find(
                  (candidate) => candidate.id === line.productId,
                );
                return product ? (
                  <aside className={`po-product-context ${product.health.tone}`}>
                    <span><b>{product.onHandQuantity ?? "Unknown"}</b> on hand</span>
                    <span><b>{product.incomingUnits}</b> already incoming</span>
                    <span><b>{product.recommendedQuantity ?? "Review"}</b> demand need</span>
                    <span><b>{product.cashConstrainedQuantity ?? "Review"}</b> {!product.cashDecision || product.cashDecision === "restricted" ? "owner review" : "cash-aware"}</span>
                    <span>
                      Last ordered <b>{product.lastOrderedDate || "No history"}</b>
                    </span>
                    <em>{product.health.label}</em>
                  </aside>
                ) : null;
              })()}
            </div>
          ))}
        </div>
        <div className="po-form-grid">
          <label>
            Tax
            <input
              name="tax"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label>
            Discount
            <input
              name="discount"
              type="number"
              min="0"
              step="0.01"
              defaultValue="0"
            />
          </label>
          <label className="toggle full">
            <input name="submitForApproval" type="checkbox" />
            <span>Submit for approval after creating</span>
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary">Create purchase order</button>
        </footer>
      </form>
    </div>
  );
}

function ReceiveModal({
  order,
  close,
  receive,
}: {
  order: Order;
  close: () => void;
  receive: (lines: { lineId: string; quantity: number }[]) => Promise<void>;
}) {
  const [values, setValues] = useState(
    Object.fromEntries(
      order.lines.map((line) => [
        line.id,
        Math.max(0, line.quantity - line.receivedQuantity),
      ]),
    ),
  );
  return (
    <div className="modal-backdrop">
      <section className="receive-modal">
        <header>
          <div>
            <p>GOODS RECEIPT</p>
            <h2>Receive {order.orderNumber}</h2>
          </div>
          <button onClick={close}>×</button>
        </header>
        {order.lines.map((line) => (
          <label key={line.id}>
            <span>
              <b>{line.description}</b>
              <small>{line.quantity - line.receivedQuantity} remaining</small>
            </span>
            <input
              type="number"
              min="0"
              value={values[line.id]}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [line.id]: Number(event.target.value),
                }))
              }
            />
          </label>
        ))}
        <p>
          Short or over receipts are accepted as discrepancies and remain
          visible for review.
        </p>
        <footer>
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            onClick={() =>
              void receive(
                order.lines.map((line) => ({
                  lineId: line.id,
                  quantity: values[line.id] || 0,
                })),
              )
            }
          >
            Record receipt
          </button>
        </footer>
      </section>
    </div>
  );
}

export function InventoryWorkspace({
  currency,
  showNotice,
  createTask,
  sourceCashCents,
  sourceAccountsPayableCents,
  sourceDataAgeHours,
  sourceHistoryDays,
  activeLocationId,
}: SharedProps & {
  sourceCashCents: number | null;
  sourceAccountsPayableCents: number | null;
  sourceDataAgeHours: number;
  sourceHistoryDays: number;
  activeLocationId: string | null;
}) {
  return (
    <div className="content control-page inventory-brain-page">
      <section className="page-intro">
        <div>
          <p>INVENTORY REORDER BRAIN</p>
          <h2>Protect availability without spending past the cash line.</h2>
          <span>
            Demand, lead time, variability, incoming stock, case packs, supplier
            minimums, shelf life, capacity and committed cash are evaluated
            together. Every recommendation remains a human-reviewed decision.
          </span>
        </div>
        <div className="reorder-source-state">
          <small>OPERATING SOURCE</small>
          <b>{sourceCashCents === null ? "Scenario mode" : "Latest verified balance"}</b>
          <span>
            {sourceCashCents === null
              ? "Connect normalized inventory and cash sources to automate inputs."
              : `${sourceHistoryDays} days of history · ${sourceDataAgeHours}h old`}
          </span>
        </div>
      </section>
      <InventoryLifecycleWorkspace currency={currency} showNotice={showNotice} createTask={createTask} activeLocationId={activeLocationId} />
      <RecommendationLab
        currency={currency}
        createTask={createTask}
        sourceCashCents={sourceCashCents}
        sourceAccountsPayableCents={sourceAccountsPayableCents}
        sourceDataAgeHours={sourceDataAgeHours}
        sourceHistoryDays={sourceHistoryDays}
      />
    </div>
  );
}

function RecommendationLab({
  currency,
  createTask,
  sourceCashCents = null,
  sourceAccountsPayableCents = null,
  sourceDataAgeHours = 0,
  sourceHistoryDays = 0,
}: {
  currency: string;
  createTask: (seed: TaskSeed) => void;
  sourceCashCents?: number | null;
  sourceAccountsPayableCents?: number | null;
  sourceDataAgeHours?: number;
  sourceHistoryDays?: number;
}) {
  const [inputs, setInputs] = useState({
    onHand: 0,
    incoming: 0,
    dailyDemand: 0,
    demandStdDev: 0,
    leadTime: 0,
    reviewPeriod: 7,
    serviceLevelZ: 1.65,
    seasonality: 1,
    promotion: 1,
    casePack: 1,
    supplierMinimum: 0,
    supplierMinimumSpend: 0,
    unitCost: 0,
    grossMargin: 0,
    weather: 1,
    expiringUnits: 0,
    availableCash: (sourceCashCents ?? 0) / 100,
    cashThreshold: 0,
    accountsPayable: (sourceAccountsPayableCents ?? 0) / 100,
    payroll: 0,
    tax: 0,
    debt: 0,
    otherCommitments: 0,
    shelfLife: 0,
    storageCapacity: 0,
    demandHistoryDays: sourceHistoryDays,
    dataAgeHours: sourceDataAgeHours,
  });
  const set = (key: keyof typeof inputs, value: number) =>
    setInputs((current) => ({ ...current, [key]: value }));
  const calculation = useMemo(() => {
    if (inputs.dailyDemand <= 0 || inputs.leadTime <= 0 || inputs.unitCost <= 0 || sourceCashCents === null) return { result: null, error: "Verified cash plus SKU demand, lead time and unit cost are required before a recommendation is calculated." };
    const engineInputs: ReorderInputs = {
      onHandUnits: inputs.onHand,
      incomingUnits: inputs.incoming,
      averageDailyDemand: inputs.dailyDemand,
      demandStdDevDaily: inputs.demandStdDev || null,
      leadTimeDays: inputs.leadTime,
      reviewPeriodDays: inputs.reviewPeriod,
      serviceLevelZ: inputs.serviceLevelZ,
      seasonalityFactor: inputs.seasonality,
      promotionFactor: inputs.promotion,
      casePackUnits: inputs.casePack,
      minimumOrderUnits: inputs.supplierMinimum,
      supplierMinimumSpendCents: Math.round(inputs.supplierMinimumSpend * 100),
      unitCostCents: Math.round(inputs.unitCost * 100),
      grossMarginBasisPoints: inputs.grossMargin > 0 ? Math.round(inputs.grossMargin * 100) : null,
      weatherFactor: inputs.weather,
      expiringUnits: inputs.expiringUnits,
      availableCashCents: Math.round(inputs.availableCash * 100),
      cashSafetyThresholdCents: Math.round(inputs.cashThreshold * 100),
      accountsPayableCents: Math.round(inputs.accountsPayable * 100),
      payrollCommitmentsCents: Math.round(inputs.payroll * 100),
      taxCommitmentsCents: Math.round(inputs.tax * 100),
      debtCommitmentsCents: Math.round(inputs.debt * 100),
      otherCommitmentsCents: Math.round(inputs.otherCommitments * 100),
      shelfLifeDays: inputs.shelfLife || null,
      storageCapacityUnits: inputs.storageCapacity || null,
      demandHistoryDays: inputs.demandHistoryDays,
      dataAgeHours: inputs.dataAgeHours,
    };
    try {
      return { result: calculateReorderRecommendation(engineInputs), error: "" };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : "Check the scenario inputs.",
      };
    }
  }, [inputs, sourceCashCents]);
  const result = calculation.result;
  const scenarioMaximum = result
    ? Math.max(...result.scenarios.map((scenario) => scenario.orderUnits), 1)
    : 1;
  const fields: { key: keyof typeof inputs; label: string; suffix?: string }[] = [
    { key: "onHand", label: "On hand", suffix: "units" },
    { key: "incoming", label: "Incoming", suffix: "units" },
    { key: "dailyDemand", label: "Average daily demand", suffix: "units" },
    { key: "demandStdDev", label: "Daily demand variability", suffix: "σ" },
    { key: "leadTime", label: "Supplier lead time", suffix: "days" },
    { key: "reviewPeriod", label: "Review period", suffix: "days" },
    { key: "serviceLevelZ", label: "Service level factor", suffix: "z" },
    { key: "seasonality", label: "Seasonality factor", suffix: "×" },
    { key: "promotion", label: "Promotion factor", suffix: "×" },
    { key: "casePack", label: "Case pack", suffix: "units" },
    { key: "supplierMinimum", label: "Supplier minimum", suffix: "units" },
    { key: "supplierMinimumSpend", label: "Supplier minimum spend", suffix: currency },
    { key: "unitCost", label: "Unit cost", suffix: currency },
    { key: "grossMargin", label: "Gross margin", suffix: "%" },
    { key: "weather", label: "Weather demand factor", suffix: "×" },
    { key: "expiringUnits", label: "Expiring before horizon", suffix: "units" },
    { key: "availableCash", label: "Available cash", suffix: currency },
    { key: "cashThreshold", label: "Cash safety threshold", suffix: currency },
    { key: "accountsPayable", label: "Accounts payable", suffix: currency },
    { key: "payroll", label: "Payroll commitments", suffix: currency },
    { key: "tax", label: "Tax commitments", suffix: currency },
    { key: "debt", label: "Debt commitments", suffix: currency },
    { key: "otherCommitments", label: "Upcoming bills and rent", suffix: currency },
    { key: "shelfLife", label: "Shelf life", suffix: "days" },
    { key: "storageCapacity", label: "Storage capacity", suffix: "units" },
    { key: "demandHistoryDays", label: "Demand history", suffix: "days" },
    { key: "dataAgeHours", label: "Data age", suffix: "hours" },
  ];
  return (
    <section className="recommendation-lab">
      <article className="card rec-inputs">
        <p>TRACEABLE INPUTS</p>
        <h3>Demand and cash constraints</h3>
        <p className="reorder-lab-context">Explore an order using explicit assumptions. Changes here do not update stock, move money or approve a purchase. Review the source date and all cash commitments before using a result.</p>
        {[
          { title: "Stock and supplier timing", keys: ["onHand", "incoming", "dailyDemand", "leadTime", "unitCost", "casePack"] },
          { title: "Cash and commitments", keys: ["availableCash", "cashThreshold", "accountsPayable", "payroll", "tax", "debt", "otherCommitments"] },
          { title: "Demand assumptions and limits", keys: ["demandStdDev", "reviewPeriod", "serviceLevelZ", "seasonality", "promotion", "weather", "grossMargin", "supplierMinimum", "supplierMinimumSpend", "expiringUnits", "shelfLife", "storageCapacity", "demandHistoryDays", "dataAgeHours"] },
        ].map(group => <fieldset className="reorder-field-group" key={group.title}><legend>{group.title}</legend><div>
          {fields.filter(field => group.keys.includes(field.key)).map((field) => (
            <label key={field.key}>
              <span>{field.label}<small>{field.suffix}</small></span>
              <input
                type="number"
                min="0"
                step={field.suffix === currency ? "0.01" : ["seasonality", "promotion", "serviceLevelZ", "demandStdDev", "dailyDemand", "grossMargin", "weather"].includes(field.key) ? "0.01" : "1"}
                value={inputs[field.key]}
                onChange={(event) =>
                  set(field.key, Number(event.target.value))
                }
              />
            </label>
          ))}
        </div></fieldset>)}
      </article>
      <article className="card rec-output">
        {calculation.error || !result ? <p className="form-error">{calculation.error}</p> : <>
          <div className="reorder-verdict">
            <span className={result.status === "blocked" ? "breach" : "safe"}>
              {humanizeIdentifier(result.status)}
            </span>
            <small>{result.confidence} confidence</small>
          </div>
          <h2>{result.recommendedUnits} units</h2>
          <p><b>{result.urgency.toUpperCase()}</b>{result.marginBasisPoints === null ? " · Margin unavailable" : ` · ${(result.marginBasisPoints / 100).toFixed(1)}% margin`}</p>
          <p>{result.formula}</p>
          <div className="reorder-scenarios" aria-label="Recommended order scenarios">
            {result.scenarios.map((scenario) => <span key={scenario.label}>
              <small>{scenario.label.toUpperCase()}</small>
              <b>{scenario.orderUnits}</b>
              <em>{money(scenario.orderCostCents, currency)}</em>
              <i aria-hidden="true"><b style={{ width: `${Math.max(4, (scenario.orderUnits / scenarioMaximum) * 100)}%` }} /></i>
            </span>)}
          </div>
          <dl>
            <div><dt>Forecast demand</dt><dd>{result.forecastDemandUnits} units</dd></div>
            <div><dt>Safety stock</dt><dd>{result.safetyStockUnits} units</dd></div>
            <div><dt>Expected stockout</dt><dd>{result.expectedStockoutDays === null ? "No velocity" : `${result.expectedStockoutDays} days`}</dd></div>
            <div><dt>Expected cost</dt><dd>{money(result.orderCostCents, currency)}</dd></div>
            <div><dt>Committed cash</dt><dd>{money(result.committedCashCents, currency)}</dd></div>
            <div><dt>Cash after order</dt><dd>{money(result.cashAfterOrderCents, currency)}</dd></div>
            <div><dt>Cash safety threshold</dt><dd>{money(Math.round(inputs.cashThreshold * 100), currency)}</dd></div>
            <div><dt>Human approval</dt><dd>Always required</dd></div>
          </dl>
          {!!result.constrainedBy.length && <div className="reorder-explain"><b>Constraints applied</b>{result.constrainedBy.map(item => <span key={item}>{item}</span>)}</div>}
          {!!result.missingInputs.length && <div className="reorder-explain missing"><b>Confidence gaps</b>{result.missingInputs.map(item => <span key={item}>{item}</span>)}</div>}
          {!!result.assumptions.length && <p className="rec-boundary">{result.assumptions.join(" ")}</p>}
        </>}
        <button
          disabled={!result || result.status === "no_order"}
          title={!result || result.status === "no_order" ? "No reorder action is needed for this scenario." : "Create a review action; this does not place an order."}
          onClick={() =>
            result && createTask({
              title: "Review purchase-order scenario",
              detail: `Review ${result.recommendedUnits} units at an expected cost of ${money(result.orderCostCents, currency)}. Cash after order: ${money(result.cashAfterOrderCents, currency)}. Constraints: ${result.constrainedBy.join(", ") || "none"}.`,
              priority: result.status === "blocked" ? "high" : "medium",
              sourceType: "decision",
              sourceRef: "inventory-reorder-brain",
              expectedImpact: result.status === "blocked"
                ? "Resolve the limiting constraint before committing cash."
                : "Protect availability while preserving cash.",
            })
          }
        >
          Create review action →
        </button>
      </article>
    </section>
  );
}

type DocumentData = {
  documents: {
    id: string;
    documentType: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    securityState: string;
    scanStatus: string;
    status: string;
    extractionStatus: string;
    processingStage: string | null;
    processingError: string | null;
    processingAuthorized: boolean;
    extractionReady: boolean;
    createdAt: string;
  }[];
  pipeline: Record<string, string>;
};
export function DocumentsWorkspace({ showNotice, canUpload }: SharedProps & { canUpload: boolean }) {
  const [data, setData] = useState<DocumentData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [downloading, setDownloading] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [processing, setProcessing] = useState("");
  const [processingError, setProcessingError] = useState("");
  const [review, setReview] = useState<{ fileName: string; extraction: DocumentExtraction } | null>(null);
  const [reviewLoading, setReviewLoading] = useState("");
  const processFile = useCallback(async (id: string, retry = false) => {
    setProcessing(id); setProcessingError("");
    try {
      const response = await apiFetch("/api/v1/documents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, noticeVersion: DOCUMENT_PROCESSING_NOTICE_VERSION, retry }), signal: AbortSignal.timeout(60_000) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Processing could not start."));
      setData(body as DocumentData);
    } catch (error) { setProcessingError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Processing took longer than expected. Refresh documents to check its saved status before retrying."); }
    finally { setProcessing(""); }
  }, []);
  useEffect(() => {
    if (!canUpload || processing || processingError || !data) return;
    const next = data.documents.find(document => document.processingAuthorized && (document.processingStage === "queued" || document.processingStage === "scan_waiting" || document.processingStage === "reading" || (document.processingStage === "scanned" && data.pipeline.ocrExtraction === "configured")));
    if (!next) return;
    const timer = window.setTimeout(() => { if (window.document.visibilityState === "visible") void processFile(next.id); }, 4000);
    return () => window.clearTimeout(timer);
  }, [canUpload, data, processing, processingError, processFile]);
  const openReview = async (document: DocumentData["documents"][number]) => {
    setReviewLoading(document.id); setProcessingError("");
    try {
      const response = await apiFetch(`/api/v1/documents?id=${encodeURIComponent(document.id)}&view=extraction`);
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "The extraction could not load."));
      setReview(body as { fileName: string; extraction: DocumentExtraction });
    } catch (error) { setProcessingError(error instanceof Error ? error.message : "The extraction could not load."); }
    finally { setReviewLoading(""); }
  };
  const load = useCallback(async () => {
    setLoadError("");
    try {
      const response = await apiFetch("/api/v1/documents", { signal: AbortSignal.timeout(20_000) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Unable to load documents."));
      setData(body as DocumentData);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Documents could not load. Check your connection and try again.");
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const upload = async (file: File | null, documentType: string) => {
    if (!canUpload || !file) return;
    setUploadError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("documentType", documentType);
      const response = await apiFetch("/api/v1/documents", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Upload failed. Please try again."));
      setData(body as DocumentData);
      showNotice("Document added to the secure review queue");
    } catch (error) {
      setUploadError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "The upload did not finish. Check your connection and retry. Duplicate files are detected automatically.");
    } finally { setUploading(false); }
  };
  const download = async (file: DocumentData["documents"][number]) => {
    setDownloading(file.id); setDownloadError("");
    try {
      const response = await apiFetch(`/api/v1/documents?id=${encodeURIComponent(file.id)}`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(apiMessage(await response.json(), "This document could not be downloaded."));
      const blob = await response.blob();
      if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(blob.type)) throw new Error("The download returned an unsupported file type.");
      const url = URL.createObjectURL(blob), link = window.document.createElement("a");
      link.href = url; link.download = file.fileName.replace(/[^A-Za-z0-9._-]/g, "-"); link.rel = "noopener";
      window.document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "The download timed out. Please try again.");
    } finally { setDownloading(""); }
  };
  if (!data) return loadError ? <section className="card control-empty" role="alert"><h2>Documents could not load</h2><p>{loadError}</p><button onClick={() => void load()}>Try Again</button></section> : <WorkspaceSkeleton label="Loading documents"/>;
  return (
    <div className="content control-page documents-centre">
      <section className="page-intro">
        <div>
          <p>INVOICES & RECEIPTS</p>
          <h2>Capture the original. Trust only verified fields.</h2>
          <span>
            Secure originals, clear source pages and proposed figures in one place.
            Scanning checks file safety. Extracted figures need your review before you use them in your accounts.
          </span>
        </div>
      </section>
      <section className="document-pipeline">
        {Object.entries(data.pipeline).map(([key, state]) => (
          <article key={key}>
            <span className={state}>{humanizeIdentifier(state)}</span>
            <b>{humanizeIdentifier(key.replaceAll(/([A-Z])/g, " $1"))}</b>
          </article>
        ))}
      </section>
      {canUpload ? <section className="document-upload card">
        <div>
          <i>↑</i>
          <h3>
            {uploading
              ? "Uploading securely…"
              : "Add a document for review"}
          </h3>
          <p>
            PDF, JPEG, PNG or WEBP · up to 10 MB · text extraction up to 50 pages
          </p>
          <p className="document-processing-notice">{DOCUMENT_PROCESSING_NOTICE} <a href="/subprocessors" target="_blank" rel="noreferrer">Service provider details</a></p>
          {uploadError && <p className="document-upload-error" role="alert">{uploadError}</p>}
        </div>
        <div>
          {[{ type: "invoice", label: "Invoice" }, { type: "receipt", label: "Receipt" }, { type: "supplier_statement", label: "Supplier Statement" }, { type: "other", label: "Bank Statement" }, { type: "other", label: "Sales Report" }, { type: "packing_slip", label: "Packing Slip" }].map(
            ({ type, label }) => (
              <label key={label}>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  capture={type === "receipt" ? "environment" : undefined}
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    event.target.value = "";
                    void upload(file, type);
                  }}
                />
                {label}
              </label>
            ),
          )}
        </div>
      </section> : <section className="document-upload card" aria-label="Document upload access required">
        <div>
          <h3>Document review access</h3>
          <p>You can review existing documents. A workspace owner can grant upload access when you need to add files.</p>
        </div>
      </section>}
      {downloadError && <p className="document-upload-error" role="alert">{downloadError}</p>}
      {processingError && <div className="document-upload-error" role="alert"><p>{processingError}</p><button onClick={() => { setProcessingError(""); void load(); }}>Refresh Documents</button></div>}
      {processing && <p className="document-processing-status" role="status">Processing your document. You can leave this page and resume from its saved status.</p>}
      {review && <section className="card document-extraction-review" aria-label={`Extraction review for ${review.fileName}`}>
        <header><div><p>EXTRACTION REVIEW</p><h3>{review.fileName}</h3><span>{review.extraction.pages} pages · Proposed figures · No accounting entries posted</span></div><button onClick={() => setReview(null)}>Close Review</button></header>
        <div className="document-review-checks">{review.extraction.checks.map(check => <article key={check.label} className={check.state}><b>{check.label}</b><p>{check.detail}</p></article>)}</div>
        {Object.keys(review.extraction.fields).length > 0 && <div className="document-review-table" tabIndex={0} role="region" aria-label="Extracted document fields"><table><thead><tr><th>Field</th><th>Proposed Value</th><th>Confidence</th><th>Page</th></tr></thead><tbody>{Object.entries(review.extraction.fields).map(([name, field]) => <tr key={name}><th>{name.replace(/([a-z])([A-Z])/g, "$1 $2")}</th><td>{field.value ?? "Not identified"}{field.currency ? ` ${field.currency}` : ""}</td><td>{field.confidenceBasisPoints === null ? "Not supplied" : `${(field.confidenceBasisPoints / 100).toFixed(0)}%`}</td><td>{field.page ?? "Not supplied"}</td></tr>)}</tbody></table></div>}
        {review.extraction.tables.map((table, index) => <details key={index}><summary>Table {index + 1}{table.page ? ` · Page ${table.page}` : ""} · {table.rows.length} rows</summary><div className="document-review-table" tabIndex={0} role="region" aria-label={`Extracted table ${index + 1}`}><table><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div></details>)}
        {review.extraction.lines.length > 0 && <details><summary>Line Items · {review.extraction.lines.length}</summary>{review.extraction.lines.map((line, index) => <dl className="document-review-line" key={index}>{Object.entries(line).map(([name, field]) => <div key={name}><dt>{name.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd>{field.value ?? "Not identified"}{field.currency ? ` ${field.currency}` : ""}</dd></div>)}</dl>)}</details>}
        <details><summary>Extracted Text</summary><pre>{review.extraction.text || "No readable text was returned."}</pre></details>
      </section>}
      <article className="card document-table">
        <header>
          <span>Document</span>
          <span>Type</span>
          <span>Security state</span>
          <span>Extraction</span>
          <span>Actions</span>
        </header>
        {data.documents.map((document) => (
          <div key={document.id}>
            <span>
              <b>{document.fileName}</b>
              <small>
                {Math.ceil(document.sizeBytes / 1024)} KB ·{" "}
                {document.contentType}
              </small>
            </span>
            <span>{humanizeIdentifier(document.documentType)}</span>
            <span>
              <em>{document.securityState === "clean" && document.scanStatus !== "clean" ? "Verification pending" : humanizeIdentifier(document.securityState)}</em>
            </span>
            <span>
              <em className="gated">
                {document.processingStage === "reading" ? "Reading document" : document.processingStage === "scanning" || document.processingStage === "scan_waiting" ? "Scanning file" : humanizeIdentifier(document.extractionStatus)}
              </em>
              {document.processingError && <small className="document-processing-error">{document.processingError}</small>}
            </span>
            <span>
              {document.extractionReady && <button disabled={Boolean(reviewLoading)} onClick={() => void openReview(document)}>{reviewLoading === document.id ? "Loading…" : "Review Figures"}</button>}
              {canUpload && data.pipeline.malwareScanning === "configured" && document.securityState !== "rejected" && document.status !== "approved" && !document.extractionReady && <button disabled={Boolean(processing)} aria-label={`Scan and read ${document.fileName}`} onClick={() => void processFile(document.id, document.processingStage === "failed")}>{processing === document.id ? "Processing…" : document.processingStage === "failed" ? "Retry Processing" : document.processingAuthorized ? "Resume Processing" : "Scan and Read"}</button>}
              {document.securityState === "clean" && document.scanStatus === "clean"
                ? <button disabled={Boolean(downloading)} aria-label={`Download ${document.fileName}`} onClick={() => void download(document)}>{downloading === document.id ? "Downloading…" : "Download"}</button>
                : <em className="gated">{document.securityState === "clean" ? "Awaiting security verification" : "Quarantined, download unavailable"}</em>}
            </span>
          </div>
        ))}
        {!data.documents.length && (
          <div className="control-empty">
            <b>No documents uploaded.</b>
            <span>
              The document centre begins empty. No sample invoices are created.
            </span>
          </div>
        )}
      </article>
    </div>
  );
}

type QualityData = {
  locationScope: { id: string; name: string; boundary: string } | null;
  summary: {
    completeness: number;
    costCoverage: number;
    lastSuccessfulSynchronization: string | null;
    failedSynchronizationCount: number;
    missingPeriodCount: number;
    affectedMetricCount: number;
    status: string;
  };
  issues: {
    severity: string;
    type: string;
    title: string;
    affectedMetrics: string[];
    correction: string;
  }[];
  missingPeriods: string[];
  sources: {
    dailyRows: number;
    imports: number;
    documents: number;
    connections: {
      provider: string;
      status: string;
      lastSuccessfulSyncAt: string | null;
    }[];
  };
};
export function DataQualityWorkspace({ createTask, activeLocationId }: SharedProps & { activeLocationId: string | null }) {
  const [data, setData] = useState<QualityData | null>(null);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    setData(null); setLoadError("");
    try {
      const response = await apiFetch(`/api/v1/data-quality${activeLocationId ? `?location=${encodeURIComponent(activeLocationId)}` : ""}`);
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Unable to load data quality."));
      setData(body as QualityData);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Unable to load data quality."); }
  }, [activeLocationId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  if (loadError) return <div className="content control-empty"><p role="alert">{loadError}</p><button type="button" onClick={() => void load()}>Retry data quality</button></div>;
  if (!data)
    return (
      <div className="content control-empty">Checking source completeness…</div>
    );
  return (
    <div className="content control-page quality-centre">
      <section className="page-intro">
        <div>
          <p>DATA QUALITY CENTRE</p>
          <h2>Know when the numbers are safe to use.</h2>
          <span>
            Metrics lose authority when a required source is stale, missing,
            incomplete or unreconciled.
          </span>
        </div>
        <span className={`quality-state ${data.summary.status}`}>
          {data.summary.status}
        </span>
      </section>
      {data.locationScope && <p role="note">{data.locationScope.name}: {data.locationScope.boundary}</p>}
      <section className="quality-scoreboard">
        <article>
          <small>COMPLETENESS</small>
          <b>{data.summary.completeness}%</b>
          <i>
            <span style={{ width: `${data.summary.completeness}%` }} />
          </i>
        </article>
        <article>
          <small>COST COVERAGE</small>
          <b>{data.summary.costCoverage}%</b>
          <span>Gross-margin input coverage</span>
        </article>
        <article>
          <small>LAST VERIFIED DATE</small>
          <b>{data.summary.lastSuccessfulSynchronization || "No source"}</b>
          <span>{data.sources.dailyRows} daily records</span>
        </article>
        <article>
          <small>AFFECTED METRICS</small>
          <b>{data.summary.affectedMetricCount}</b>
          <span>
            {data.locationScope ? "Source/import status is outside this location view" : `${data.summary.failedSynchronizationCount} failed sources/imports`}
          </span>
        </article>
      </section>
      <div className="quality-layout">
        <article className="card quality-issues">
          <header>
            <h3>Issues and corrections</h3>
            <span>{data.issues.length}</span>
          </header>
          {data.issues.map((issue, index) => (
            <div key={`${issue.type}-${index}`}>
              <i className={issue.severity}>!</i>
              <span>
                <b>{issue.title}</b>
                <small>Affects: {issue.affectedMetrics.join(", ")}</small>
                <p>{issue.correction}</p>
              </span>
              <button
                onClick={() =>
                  createTask({
                    title: issue.title,
                    detail: issue.correction,
                    priority: issue.severity === "critical" ? "high" : "medium",
                    sourceType: "alert",
                    sourceRef: `quality:${issue.type}`,
                  })
                }
              >
                Create task
              </button>
            </div>
          ))}
          {!data.issues.length && (
            <div className="control-empty">
              <b>No material quality issue detected.</b>
              <span>Continue monitoring freshness and reconciliation.</span>
            </div>
          )}
        </article>
        <aside className="card source-health">
          <h3>Source health</h3>
          <div>
            <span>
              Daily operating rows<b>{data.sources.dailyRows}</b>
            </span>
            <span>
              Import runs<b>{data.locationScope ? "Outside scope" : data.sources.imports}</b>
            </span>
            <span>
              Stored documents<b>{data.locationScope ? "Outside scope" : data.sources.documents}</b>
            </span>
            <span>
              Missing date gaps<b>{data.summary.missingPeriodCount}</b>
            </span>
          </div>
          <h4>Provider connections</h4>
          {data.sources.connections.length ? (
            data.sources.connections.map((source) => (
              <p key={source.provider}>
                <b>{providerDisplayName(source.provider)}</b>
                <span>{humanizeIdentifier(source.status)}</span>
              </p>
            ))
          ) : (
            <p>
              <b>{data.locationScope ? "Outside location scope" : "No provider connection in this view"}</b>
              <span>{data.locationScope ? "Use the permitted organization view to review connection health." : "Review integrations for source availability."}</span>
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
