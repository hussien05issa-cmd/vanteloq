"use client";

import { useEffect, useId, useRef, useState } from "react";
import IntegrationBrandLogo from "./integration-brand-logo";
import { apiFetch } from "./supabase-browser";
import { formatMarketingValue } from "./marketing-reporting";
import { REPORT_NAMES, type MarketingReport, type ReportSource } from "../domain/marketing-reporting";
import { formatRecordedTimestamp } from "../domain/executive-presentation";
import { marketingSourceSummary } from "../domain/marketing-source-summary";
import { createMarketingReportReader, readMarketingReport, readMarketingSources, visibleMarketingReport, type MarketingReportRequest, type MarketingReportSnapshot } from "./marketing-report-reader";
import "./marketing-source-overview.css";

export type MarketingReportTarget = { selectionId: string; days: number };
type OverviewProps = { locationId: string | null; onReport: (target: MarketingReportTarget) => void; onConnections: () => void; onJourneys: () => void };

export function MarketingSourceReportSummary({ report }: { report: MarketingReport }) {
  const summary = marketingSourceSummary(report);
  return <div className="ms-report">
    <div className="ms-report-provenance"><b>{summary.basis}</b><span>Requested report: {report.period.start} to {report.period.end}</span><span>{report.timeZone}</span><span>Fetched {formatRecordedTimestamp(report.fetchedAt) ?? "time unavailable"}</span></div>
    {(report.warnings.length > 0 || report.truncated) && <div className="ms-report-warning" role="status"><b>Review the reporting limits</b>{report.warnings.map(warning => <p key={warning}>{warning}</p>)}{report.truncated && <p>The provider limited this response. Open the full report before comparing results.</p>}</div>}
    <dl className="ms-report-metrics">{summary.metrics.map(({ column, value }) => <div key={column.key}><dt>{column.label}</dt><dd>{formatMarketingValue(value, column, report.currency)}</dd></div>)}</dl>
    {report.dataset === "google_business_profile" && <p>No device or date totals are combined. Missing values stay unavailable.</p>}
    <div className="ms-lead-coverage"><b>Lead reporting</b><p>{summary.leadCoverage}</p></div>
  </div>;
}

function ProviderSourceCard({ provider, sources, locationId, days, onReport, onConnections }: {
  provider: "google" | "meta"; sources: ReportSource[]; locationId: string | null; days: number;
  onReport: OverviewProps["onReport"]; onConnections: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [snapshot, setSnapshot] = useState<MarketingReportSnapshot | null>(null);
  const reader = useRef<ReturnType<typeof createMarketingReportReader> | null>(null);
  const source = sources.find(item => item.id === selectedId);
  const request: MarketingReportRequest | null = source ? { locationId, selectionId: source.id, dataset: source.dataset, view: "daily", days } : null;
  const visible = source?.status === "ready" ? visibleMarketingReport(snapshot, request) : null;
  const id = useId();
  useEffect(() => {
    const next = createMarketingReportReader({ read: (context, signal) => readMarketingReport(apiFetch, context, signal), onChange: setSnapshot });
    reader.current = next;
    return () => { next.dispose(); reader.current = null; };
  }, []);
  useEffect(() => { reader.current?.clear(); }, [days, locationId]);
  const name = provider === "google" ? "Google" : "Meta";
  const load = () => { if (request && source?.status === "ready") void reader.current?.load(request); };
  return <article className="ms-provider" aria-labelledby={`${id}-title`}>
    <header><IntegrationBrandLogo name={name} compact/><div><h3 id={`${id}-title`}>{name}</h3><p>{provider === "google" ? "Search, website, profile and ad activity" : "Advertising activity and spend"}</p></div></header>
    {sources.length ? <>
      <label htmlFor={`${id}-source`}>{name} reporting source</label>
      <select id={`${id}-source`} value={selectedId} onChange={event => { reader.current?.clear(); setSelectedId(event.target.value); }}>
        <option value="">Choose an exact source</option>
        {sources.map(item => <option key={item.id} value={item.id}>{REPORT_NAMES[item.dataset]} · {item.name}</option>)}
      </select>
      {source && <p className="ms-selected-source"><b>{source.name}</b><span>{REPORT_NAMES[source.dataset]} · {source.status === "ready" ? "Available to request" : "Connection review required"}</span></p>}
      {!source && <p className="ms-state">Choose the property, profile or ad account to review. No accounts are combined.</p>}
      {source && source.status !== "ready" && <div className="ms-state"><b>Review this source in Integrations</b><p>Check its connection, selected resource and approval before requesting its report.</p><button type="button" onClick={onConnections}>Review connection</button></div>}
      {source?.status === "ready" && <div className="ms-source-actions"><button type="button" disabled={visible?.status === "loading"} onClick={load}>{visible?.status === "loading" ? "Loading report…" : visible?.status === "error" ? "Retry report" : visible?.status === "ready" ? "Refresh this source" : "Load source report"}</button><button type="button" onClick={() => onReport({ selectionId: source.id, days })}>Open full report →</button></div>}
      {visible?.status === "loading" && <p className="ms-state" role="status">Retrieving this source&apos;s {days}-day report. Provider reporting dates may lag today.</p>}
      {visible?.status === "error" && <div className="ms-state" role="alert"><b>Report unavailable</b><p>{visible.error}</p></div>}
      {visible?.status === "ready" && visible.report && <MarketingSourceReportSummary report={visible.report}/>}
    </> : <div className="ms-state"><b>No {name} reporting sources in this scope</b><p>Connect an account and choose the exact resource and location in Integrations.</p><button type="button" onClick={onConnections}>Review {name} connection</button></div>}
  </article>;
}

function MarketingSourceOverviewPanel({ locationId, onReport, onConnections, onJourneys }: OverviewProps) {
  const [sources, setSources] = useState<ReportSource[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [days, setDays] = useState(28);
  const periodId = useId();
  useEffect(() => {
    const controller = new AbortController();
    void readMarketingSources(apiFetch, locationId, controller.signal).then(rows => { if (!controller.signal.aborted) setSources(rows); }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Marketing sources could not be loaded."); });
    return () => controller.abort();
  }, [locationId, revision]);
  return <section className="ms-overview" aria-label="Google and Meta source overview">
    <header className="ms-heading"><div><p className="ms-eyebrow">CONNECTED MARKETING</p><h2>Google and Meta performance</h2><p>Choose a source to see its original measures, reporting dates and lead coverage.</p></div><label htmlFor={periodId}>Report window<select id={periodId} value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>7 days</option><option value={28}>28 days</option><option value={90}>90 days</option></select></label></header>
    {error ? <div className="ms-state" role="alert"><b>Sources unavailable</b><p>{error}</p><button type="button" onClick={() => { setError(""); setSources(null); setRevision(value => value + 1); }}>Retry source list</button></div> : !sources ? <p className="ms-state" role="status">Loading the reporting sources available for this location…</p> : <div className="ms-providers">
      <ProviderSourceCard provider="google" sources={sources.filter(source => source.dataset !== "meta_ads")} locationId={locationId} days={days} onReport={onReport} onConnections={onConnections}/>
      <ProviderSourceCard provider="meta" sources={sources.filter(source => source.dataset === "meta_ads")} locationId={locationId} days={days} onReport={onReport} onConnections={onConnections}/>
    </div>}
    <footer className="ms-outcomes"><div><b>Keep lead outcomes connected to their evidence</b><p>Recorded journey leads come from lead or phone-call events in your journey records. They are separate from ad clicks, profile interactions and account-configured conversions. Facebook Page and Instagram organic insights are not included here.</p></div><button type="button" onClick={onJourneys}>Review journey records →</button></footer>
  </section>;
}

/** A new location discards the entire previous source directory and its in-memory reports. */
export default function MarketingSourceOverview(props: OverviewProps) {
  return <MarketingSourceOverviewPanel key={props.locationId ?? "all"} {...props}/>;
}
