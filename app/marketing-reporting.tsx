"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";
import type { MarketingPlanDraft } from "../domain/marketing-workbench";
import { signedBarGeometry } from "../domain/chart-geometry";
import { metricChange, REPORT_NAMES, REPORT_VIEWS, reportSuggestions, type MarketingReport, type ReportColumn, type ReportSource, type ReportView } from "../domain/marketing-reporting";

const viewLabels: Record<ReportView, string> = { daily: "Daily trend", channels: "Acquisition channels", pages: "Top pages", devices: "Devices", queries: "Search queries", realtime: "Realtime activity", keywords: "Local search terms", campaigns: "Campaigns", platforms: "Facebook and Instagram ads" };
export function formatMarketingValue(value: number | null | undefined, column: ReportColumn, currency: string | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  if (column.unit === "currency") return currency ? new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value) : "Currency unavailable";
  return `${value.toLocaleString("en-CA", { maximumFractionDigits: 2 })}${column.unit === "percent" ? "%" : ""}`;
}

export function MarketingReportVisual({ report }: { report: MarketingReport }) {
  const [metricKey, setMetricKey] = useState("");
  const column = report.columns.find((item) => item.key === metricKey) ?? report.columns[0];
  const chartId = useId();
  if (!column) return null;
  const data = report.rows.map((row) => ({ row, value: row.values[column.key] })).filter((point): point is { row: MarketingReport["rows"][number]; value: number } => point.value !== null && point.value !== undefined && Number.isFinite(point.value));
  const daily = report.view === "daily";
  const max = Math.max(1, ...data.map((point) => point.value));
  const min = Math.min(0, ...data.map((point) => point.value));
  const barMaximum = Math.max(0, ...data.map(point => point.value));
  const unit = column.unit === "currency" ? report.currency ?? "Currency not supplied" : column.unit === "percent" ? "Percent" : column.unit === "position" ? "Average position" : "Count";
  const axisValue = (value: number) => new Intl.NumberFormat("en-CA", {
    notation: "compact", maximumFractionDigits: 2,
    ...(column.unit === "currency" && report.currency ? { style: "currency", currency: report.currency } : {}),
  }).format(value) + (column.unit === "percent" ? "%" : "");
  const start = Date.parse(report.period.start), end = Date.parse(report.period.end);
  const y = (value: number) => 188 - (value - min) / (max - min) * 150;
  // Date-based spacing and explicit gaps: absent observations are not interpolated into sales.
  const points = report.rows.map((row) => ({ row, x: 62 + (Date.parse(row.label) - start) / Math.max(86_400_000, end - start) * 688, value: row.values[column.key] }));
  const path = points.map((point, index) => {
    if (point.value === null || point.value === undefined || !Number.isFinite(point.x)) return "";
    const previousPoint = points[index - 1];
    const previousDate = previousPoint && previousPoint.value !== null && previousPoint.value !== undefined ? Date.parse(previousPoint.row.label) : NaN;
    const date = Date.parse(point.row.label), command = date - previousDate === 86_400_000 ? "L" : "M";
    return `${command}${point.x.toFixed(2)},${y(point.value).toFixed(2)}`;
  }).join(" ");
  return <section className="mr-visual" aria-label="Marketing performance chart">
    <header><div><p className="mr-eyebrow">{daily ? "PERFORMANCE OVER TIME" : "WHERE ACTIVITY COMES FROM"}</p><h3>{column.label}</h3><p className="mr-chart-unit">{unit}</p></div><label>Chart metric<select value={column.key} onChange={(event) => setMetricKey(event.target.value)}>{report.columns.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></header>
    {!data.length ? <div className="mr-empty"><b>No values returned for this metric</b><p>The provider did not return usable observations. Nothing has been replaced with zero.</p></div> : daily ? <div className="mr-chart-scroll" role="region" aria-label="Scrollable performance chart" tabIndex={0}><svg viewBox="0 0 800 235" role="img" aria-labelledby={chartId}>
      <title id={chartId}>{`${column.label} from ${report.period.start} to ${report.period.end}. Exact values are in the table below.`}</title>
      {[0, 0.5, 1].map((fraction) => { const value = min + (max - min) * fraction; return <g key={fraction}><line x1="62" x2="750" y1={y(value)} y2={y(value)} className="mr-grid"/><text x="50" y={y(value) + 4} textAnchor="end">{axisValue(value)}</text></g>; })}
      <path d={path} className="mr-line"/>{points.filter((point) => point.value !== null && point.value !== undefined && Number.isFinite(point.x)).map((point) => <circle key={point.row.label} cx={point.x} cy={y(point.value!)} r={points.length > 35 ? 2 : 3.5}><title>{`${point.row.label}: ${formatMarketingValue(point.value, column, report.currency)}`}</title></circle>)}
      <text x="62" y="220">{report.period.start}</text><text x="750" y="220" textAnchor="end">{report.period.end}</text>
    </svg></div> : <div className="mr-bars">{[...data].sort((a,b) => b.value - a.value).slice(0, 8).map(({ row, value }, index) => {
      const bar = signedBarGeometry(value, min, barMaximum);
      return <div key={`${row.label}:${index}`}><span title={row.label}>{row.label}</span><div className="mr-bar-track" aria-hidden="true"><em className="mr-bar-zero" style={{ left: `${bar.zero}%` }}/><i className={bar.negative ? "is-negative" : undefined} style={{ left: `${bar.left}%`, width: `${bar.width}%` }}/></div><b data-negative={bar.negative || undefined}>{formatMarketingValue(value, column, report.currency)}</b></div>;
    })}</div>}
    <p className="mr-muted">{daily ? "Gaps mean no observation was returned. Dates follow the provider's reporting calendar." : "Largest returned values, up to eight shown. Bars extend from zero; negative values extend left. See the complete returned list below."}</p>
  </section>;
}

export function MarketingReportBody({ report, onPlan }: { report: MarketingReport; onPlan?: (draft: MarketingPlanDraft) => void }) {
  const suggestions = reportSuggestions(report);
  return <>
    <div className="mr-provenance"><span>{report.view === "realtime" ? "Rolling last 30 minutes" : `${report.period.start} to ${report.period.end}`}</span><span>{report.timeZone}</span><span>Fetched {new Date(report.fetchedAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}</span></div>
    {report.warnings.length > 0 && <div className="mr-warning" role="status">{report.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    {Object.keys(report.totals).length > 0 && <div className="mr-kpis" data-count={report.columns.length}>{report.columns.map((column) => {
      const value = report.totals[column.key], previous = report.previous?.[column.key] ?? null;
      const change = metricChange(value ?? null, previous);
      return <article key={column.key}><span>{column.label}</span><strong>{formatMarketingValue(value, column, report.currency)}</strong><small>{report.previousPeriod ? previous === null || value === null || value === undefined ? "Comparison unavailable" : column.unit === "percent" || column.unit === "position" ? `${value - previous > 0 ? "+" : ""}${(value - previous).toFixed(2)} ${column.unit === "percent" ? "percentage points" : "positions"} vs prior period` : change === null ? "No positive comparison baseline" : `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs prior period` : "Provider-reported value"}</small></article>;
    })}</div>}
    {report.previousPeriod && <p className="mr-muted">Comparison: {report.previousPeriod.start} to {report.previousPeriod.end}. A change is not automatically an improvement; lower average search position is better.</p>}
    {report.view !== "realtime" && <MarketingReportVisual key={`${report.dataset}:${report.view}`} report={report}/>}
    {suggestions.length > 0 && <div className="mr-suggestions"><h3>Worth reviewing next</h3>{suggestions.map((item) => <article key={item.title}><h4>{item.title}</h4><p>{item.detail}</p>{onPlan && <button type="button" onClick={() => onPlan({ title: item.title, channel: report.dataset === "meta_ads" ? "meta" : report.dataset === "google_analytics" ? "website" : "google", eventType: "audit", objective: item.detail, notes: `Source: ${REPORT_NAMES[report.dataset]} · ${viewLabels[report.view]}\nPeriod: ${report.period.start} to ${report.period.end}\nFetched: ${report.fetchedAt}\nReview the same source and comparison period after the change. Record external factors. This suggestion is not a promise of improved results.` })}>Plan this action →</button>}</article>)}</div>}
    {report.rows.length > 0 && <details className="mr-table-wrap" open><summary>Source details · {report.rows.length} returned {report.rows.length === 1 ? "row" : "rows"}</summary><div tabIndex={0} role="region" aria-label="Scrollable source report"><table><caption>{REPORT_NAMES[report.dataset]} · {viewLabels[report.view]}</caption><thead><tr><th scope="col">{report.view === "daily" ? "Date" : "Source dimension"}</th>{report.columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{report.rows.map((row, index) => <tr key={`${row.label}:${index}`}><th scope="row">{row.label}{row.note && <small>{row.note}</small>}</th>{report.columns.map((column) => <td key={column.key}>{formatMarketingValue(row.values[column.key], column, report.currency)}</td>)}</tr>)}</tbody></table></div></details>}
    <aside className="mr-method"><h3>What these numbers mean</h3><ul>{report.limitations.map((line) => <li key={line}>{line}</li>)}</ul></aside>
  </>;
}

export default function MarketingReporting({ locationId, navigate, onPlan }: { locationId: string | null; navigate: (page: "Integrations" | "Advisor") => void; onPlan?: (draft: MarketingPlanDraft) => void }) {
  const [sources, setSources] = useState<ReportSource[]>([]), [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<ReportView>("daily"), [days, setDays] = useState(28);
  const [report, setReport] = useState<MarketingReport | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [monitor, setMonitor] = useState(false);
  const [sourceRefresh, setSourceRefresh] = useState(0);
  const sequence = useRef(0);
  const base = `/api/v1/marketing/reports${locationId ? `?location=${encodeURIComponent(locationId)}` : ""}`;
  const selected = sources.find((source) => source.id === selectedId);
  const clearReport = useCallback(() => { setLoading(true); setError(""); setReport(null); }, []);
  const refreshReport = useCallback(() => { clearReport(); setRefresh((current) => current + 1); }, [clearReport]);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(base, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "Sources could not be loaded.");
      if (controller.signal.aborted) return;
      const nextSource = body.sources.find((source: ReportSource) => source.status === "ready") ?? body.sources[0];
      setSources(body.sources); setSelectedId(nextSource?.id ?? ""); setLoading(nextSource?.status === "ready");
    }).catch((caught) => { if (!controller.signal.aborted) { setError(caught instanceof Error ? caught.message : "Sources could not be loaded."); setLoading(false); } });
    return () => controller.abort();
  }, [base, sourceRefresh]);
  useEffect(() => {
    if (!selected || selected.status !== "ready") return;
    const controller = new AbortController(), current = ++sequence.current;
    const url = `${base}${base.includes("?") ? "&" : "?"}selectionId=${encodeURIComponent(selected.id)}&view=${view}&days=${days}`;
    void apiFetch(url, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "This report could not be loaded.");
      if (!controller.signal.aborted && current === sequence.current) { setReport(body.report); setLoading(false); }
    }).catch((caught) => { if (!controller.signal.aborted && current === sequence.current) { setError(caught instanceof Error ? caught.message : "This report could not be loaded."); setLoading(false); setMonitor(false); } });
    return () => controller.abort();
  }, [base, selected, view, days, refresh]);
  useEffect(() => {
    if (!monitor || selected?.status !== "ready" || selected.dataset === "google_business_profile") return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refreshReport(); }, view === "realtime" ? 60_000 : 600_000);
    return () => window.clearInterval(timer);
  }, [monitor, selected, view, refreshReport]);
  return <section className="mr-workspace" aria-label="Connected marketing reports">
    <header className="mr-heading"><div><h2>Source reports</h2><p>Compare like-for-like periods in the exact accounts you approve.</p></div><button type="button" onClick={() => navigate("Integrations")}>Manage connections →</button></header>
    <div className="mr-toolbar"><label>Reporting source<select value={selectedId} onChange={(event) => { clearReport(); setSelectedId(event.target.value); setView("daily"); setMonitor(false); setLoading(sources.find((source) => source.id === event.target.value)?.status === "ready"); }}><option value="">Select a source</option>{sources.map((source) => <option key={source.id} value={source.id}>{REPORT_NAMES[source.dataset]} · {source.name}</option>)}</select></label><label>Report<select value={view} disabled={!selected || selected.status !== "ready"} onChange={(event) => { clearReport(); setView(event.target.value as ReportView); }}>{(selected ? REPORT_VIEWS[selected.dataset] : ["daily" as const]).map((item) => <option key={item} value={item}>{viewLabels[item]}</option>)}</select></label><label>Period<select value={days} disabled={!selected || selected.status !== "ready" || view === "realtime" || view === "keywords"} onChange={(event) => { clearReport(); setDays(Number(event.target.value)); }}><option value={7}>7-day report</option><option value={28}>28-day report</option><option value={90}>90-day report</option></select></label><button type="button" disabled={loading || selected?.status !== "ready"} onClick={refreshReport}>Refresh report</button></div>
    {selected?.status === "ready" && <label className="mr-monitor"><input type="checkbox" checked={monitor} disabled={selected.dataset === "google_business_profile"} onChange={(event) => setMonitor(event.target.checked)}/>{selected.dataset === "google_business_profile" ? "Business Profile reports refresh only when requested." : `Refresh while this report is open: every ${view === "realtime" ? "minute" : "10 minutes"}. Stops when the tab is hidden or a request fails.`}</label>}
    {error && <div className="mr-warning" role="alert"><b>Report unavailable</b><p>{error}</p><button onClick={() => { clearReport(); setSources([]); setSelectedId(""); setView("daily"); setSourceRefresh((current) => current + 1); }}>Reload sources and try again</button></div>}
    {loading && <div className="mr-empty" role="status"><b>Loading approved source data…</b><p>Checking access and retrieving the provider report.</p></div>}
    {!loading && !error && (!selected || selected.status !== "ready") && <div className="mr-empty"><h3>{selected ? "Approve this connection first" : "Connect your first marketing source"}</h3><p>In Integrations, connect your account, choose the correct property or ad account, assign its location and approve its sample. No measurements appear before approval.</p><button onClick={() => navigate("Integrations")}>Set up reporting →</button></div>}
    {!loading && report && <MarketingReportBody report={report} onPlan={onPlan}/>}
    <aside className="mr-method"><h3>Coverage, without guesswork</h3><p>GA4 measures tagged website activity. Search Console reports Google search visibility. Business Profile reports local discovery. Meta advertising is separate from Facebook Page and Instagram organic insights, which are not yet available in Vanteloq and require their own permissions and resource setup.</p><button onClick={() => navigate("Advisor")}>Discuss approved marketing data with Vanteloq AI →</button><p>Vanteloq AI can use permitted, synchronized marketing totals. Refresh your approved connection in Integrations to update that saved evidence. Refreshing this report does not synchronize Vanteloq AI&apos;s evidence. Search terms, page addresses and Business Profile content from these on-demand reports are not sent to it.</p></aside>
  </section>;
}
