"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import IntegrationBrandLogo from "./integration-brand-logo";
import { apiFetch } from "./supabase-browser";

type Profile = {
  businessModel: string;
  primaryOffer: string;
  targetAudience: string;
  serviceArea: string;
  primaryGoal: "leads" | "visits" | "sales" | "awareness";
  websiteUrl: string;
  googleProfileStatus: "not_set" | "claimed" | "verified";
  notes: string;
  saved: boolean;
};
type Recommendation = {
  id: string;
  category: "local_search" | "content" | "conversion" | "measurement" | "technical";
  priority: "high" | "medium";
  title: string;
  rationale: string;
  action: string;
  metrics: string[];
  evidenceNeeded: string[];
  sourceLabel: string;
  sourceUrl: string;
  confidence: "high" | "medium" | "low" | "blocked";
  confidenceReason: string;
  evidence: string[];
  missingInputs: string[];
  actionOwner: string;
  actionDueDate: string;
  reviewMethod: string;
  sourceFreshness: string;
  operatingCoverage: CoverageItem[];
};
type CoverageItem = {
  key: "customers" | "inventory" | "margin" | "cashReadiness" | "location";
  label: string;
  status: "ready" | "limited" | "missing" | "stale";
  freshness: string;
  evidence: string[];
  missingInputs: string[];
};
type CalendarEntry = {
  id: string;
  title: string;
  channel: "content" | "google" | "meta" | "email" | "local" | "website";
  eventType: "campaign" | "content" | "audit" | "offer" | "follow_up";
  startDate: string;
  dueDate: string | null;
  status: "planned" | "in_progress" | "completed" | "cancelled";
  objective: string;
  notes: string;
};
type GrowthData = {
  growth: {
    status: "available" | "unavailable";
    reason: string | null;
    channels: { source: string; leads: number; customers: number; transactions: number; revenueCents: number; grossProfitCents: number | null }[];
    insight: null | { title: string; explanation: string; estimatedDiscoveryActionChange: number | null; confidence: string };
  };
  profile: Profile;
  organization: { businessName: string };
  recommendations: Recommendation[];
  operatingCoverage: Record<CoverageItem["key"], Omit<CoverageItem, "key" | "label">>;
  marketingEvidence: Omit<CoverageItem, "key" | "label">;
  calendar: CalendarEntry[];
  searchSeries: { query: string; observedDate: string; position: number; discoveryActions: number | null; sourceSystem: string }[];
  measurementSeries: { provider: "google" | "meta"; metricDate: string; metrics: Record<string, number> }[];
  reviewInsights: {
    available: boolean;
    reviewCount: number;
    averageRating: number | null;
    lowRatingCount: number;
    fiveStarShare: number | null;
    lastReviewAt: string | null;
    themes: { key: string; label: string; mentions: number; lowRatingMentions: number }[];
    recommendations: { id: string; title: string; rationale: string; action: string; evidence: string }[];
    privacyBoundary: string;
  };
  importCounts: { touchpoints: number; transactions: number; searchObservations: number };
  connections: { provider: string; providerId: "google" | "meta"; status: "connected" | "ready_to_connect" | "configuration_required"; label: string; availableNow: string; connectionId: string | null }[];
  canManage: boolean;
  period: { since: string; through: string };
  sourceBoundary: string;
  scopeBoundary: string;
  locationScope: { id: string; name: string } | null;
};

type Tab = "overview" | "context" | "data" | "calendar";
type CsvKind = "search_visibility" | "touchpoint" | "transaction";
type CsvRecord = Record<string, string>;
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

async function postGrowth(payload: Record<string, unknown>) {
  const response = await apiFetch("/api/v1/growth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "The marketing record could not be saved.");
  return body;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(field.trim()); field = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = "";
    } else field += character;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  const headers = (rows.shift() ?? []).map((header, index) => index === 0 ? header.replace(/^\uFEFF/, "") : header);
  if (!headers.length || headers.some((header) => !header)) throw new Error("The CSV needs a complete header row.");
  if (new Set(headers).size !== headers.length) throw new Error("The CSV contains duplicate column names.");
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])) as CsvRecord);
}

async function stableSourceEventId(kind: CsvKind, row: CsvRecord) {
  const normalized = JSON.stringify(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)));
  const bytes = new TextEncoder().encode(`${kind}:${normalized}`);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    return `owner_csv:${kind}:${hex.slice(0, 40)}`;
  }
  let hash = 2166136261;
  for (const value of bytes) hash = Math.imul(hash ^ value, 16777619);
  return `owner_csv:${kind}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const csvRequirements: Record<CsvKind, { label: string; required: string[]; sample: string }> = {
  search_visibility: { label: "Search visibility", required: ["query", "observedDate", "position"], sample: "query,observedDate,position,discoveryActions,sourceSystem,sourceEventId" },
  touchpoint: { label: "Marketing touchpoints", required: ["occurredAt", "source", "stage", "journeyRef"], sample: "occurredAt,source,stage,journeyRef,sourceSystem,sourceEventId" },
  transaction: { label: "Attributed transactions", required: ["occurredAt", "journeyRef", "revenueCents"], sample: "occurredAt,journeyRef,revenueCents,grossProfitCents,sourceSystem,sourceEventId" },
};

function SearchVisibilityChart({ rows }: { rows: GrowthData["searchSeries"] }) {
  if (!rows.length) return <div className="growth-chart-empty"><b>No search observations yet</b><span>Add an owner-entered Search Console or Business Profile observation to establish a baseline.</span></div>;
  const points = rows.slice(-12);
  const positions = points.map((row) => row.position);
  const minimum = Math.min(...positions);
  const maximum = Math.max(...positions);
  const range = Math.max(1, maximum - minimum);
  const coordinates = points.map((row, index) => ({ row, x: 38 + index * (652 / Math.max(1, points.length - 1)), y: 24 + ((row.position - minimum) / range) * 144 }));
  const path = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  return <div className="search-position-chart">
    <div className="growth-chart-key"><span><i />Search position</span><small>Lower is better</small></div>
    <svg viewBox="0 0 728 220" role="img" aria-label="Recorded search position over time">
      {[24, 72, 120, 168].map((y) => <line key={y} x1="38" x2="690" y1={y} y2={y} className="growth-gridline" />)}
      <path d={path} className="growth-position-line" />
      {coordinates.map(({ row, x, y }, index) => <g key={`${row.query}-${row.observedDate}-${index}`} tabIndex={0} role="img" aria-label={`${row.query}, position ${row.position}, ${row.observedDate}`}>
        <circle cx={x} cy={y} r="5" />
        <title>{`${row.query}: position ${row.position} on ${row.observedDate}${row.discoveryActions === null ? "" : `, ${row.discoveryActions} discovery actions`}`}</title>
      </g>)}
      {coordinates.map(({ row, x }, index) => (index === 0 || index === coordinates.length - 1) && <text key={row.observedDate} x={x} y="204" textAnchor={index ? "end" : "start"}>{row.observedDate}</text>)}
    </svg>
  </div>;
}

const measurementLabels: Record<string, string> = {
  search_clicks: "Search clicks",
  search_impressions: "Search impressions",
  business_website_clicks: "Profile website clicks",
  business_call_clicks: "Profile calls",
  business_direction_requests: "Direction requests",
  business_impressions: "Profile impressions",
  analytics_sessions: "Website sessions",
  analytics_engaged_sessions: "Engaged sessions",
  analytics_key_events: "Key events",
  meta_impressions: "Ad impressions",
  meta_reach: "Reach",
  meta_link_clicks: "Link clicks",
  meta_spend: "Spend",
  meta_ctr: "Click-through rate",
  meta_cpc: "Cost per click",
};

function metricTotal(rows: GrowthData["measurementSeries"], metric: string) {
  return rows.reduce((sum, row) => sum + (row.metrics[metric] ?? 0), 0);
}

function metricAverage(rows: GrowthData["measurementSeries"], metric: string) {
  const values = rows.map((row) => row.metrics[metric]).filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function MeasurementTrend({ rows, metric, labelText }: { rows: GrowthData["measurementSeries"]; metric: string; labelText: string }) {
  const points = rows.filter((row) => row.metrics[metric] !== undefined).slice(-30);
  if (!points.length) return <div className="marketing-metric-empty"><b>No {labelText.toLowerCase()} yet</b><span>Sync the connected provider after its account has reporting data.</span></div>;
  const maximum = Math.max(...points.map((row) => row.metrics[metric]), 1);
  const coordinates = points.map((row, index) => ({
    row,
    x: 28 + index * (632 / Math.max(1, points.length - 1)),
    y: 164 - (row.metrics[metric] / maximum) * 136,
  }));
  const path = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  return <div className="marketing-measurement-trend">
    <svg viewBox="0 0 688 196" role="img" aria-label={`${labelText} over the latest measured days`}>
      {[28, 73, 118, 164].map((y) => <line key={y} x1="28" x2="660" y1={y} y2={y} />)}
      <path d={path} />
      {coordinates.map(({ row, x, y }) => <circle key={row.metricDate} cx={x} cy={y} r="4"><title>{`${row.metricDate}: ${row.metrics[metric].toLocaleString("en-CA", { maximumFractionDigits: 2 })}`}</title></circle>)}
    </svg>
    <span>{points[0]?.metricDate}</span><span>{points.at(-1)?.metricDate}</span>
  </div>;
}

function ProviderMeasurementCard({ provider, rows, currency }: { provider: "google" | "meta"; rows: GrowthData["measurementSeries"]; currency: string }) {
  const providerRows = rows.filter((row) => row.provider === provider);
  const google = provider === "google";
  const primaryMetric = google ? "search_clicks" : "meta_link_clicks";
  const summaries = google
    ? [
        ["search_clicks", metricTotal(providerRows, "search_clicks")],
        ["business_website_clicks", metricTotal(providerRows, "business_website_clicks")],
        ["analytics_sessions", metricTotal(providerRows, "analytics_sessions")],
        ["business_call_clicks", metricTotal(providerRows, "business_call_clicks")],
      ] as const
    : [
        ["meta_impressions", metricTotal(providerRows, "meta_impressions")],
        ["meta_reach", metricTotal(providerRows, "meta_reach")],
        ["meta_link_clicks", metricTotal(providerRows, "meta_link_clicks")],
        ["meta_spend", metricTotal(providerRows, "meta_spend")],
      ] as const;
  return <article className={`card marketing-measurement-card ${provider}`}>
    <header><div><IntegrationBrandLogo name={google ? "Google" : "Meta"} compact /><span><small>{google ? "SEARCH, PROFILE & SITE" : "ADS INSIGHTS"}</small><h3>{google ? "Google demand and website actions" : "Meta reach and website clicks"}</h3></span></div><em>{providerRows.length ? `Through ${providerRows.at(-1)?.metricDate}` : "Awaiting sync"}</em></header>
    <div className="marketing-measurement-summary">{summaries.map(([metric, value]) => <span key={metric}><small>{measurementLabels[metric]}</small><b>{metric === "meta_spend" ? money(Math.round(value * 100), currency) : Math.round(value).toLocaleString("en-CA")}</b></span>)}</div>
    <MeasurementTrend rows={providerRows} metric={primaryMetric} labelText={measurementLabels[primaryMetric]} />
    {providerRows.length > 0 && <footer>{google ? <><span>Search CTR <b>{(metricAverage(providerRows, "search_ctr") * 100).toFixed(1)}%</b></span><span>Average position <b>{metricAverage(providerRows, "search_position").toFixed(1)}</b></span></> : <><span>Average CTR <b>{metricAverage(providerRows, "meta_ctr").toFixed(2)}%</b></span><span>Average CPC <b>{money(Math.round(metricAverage(providerRows, "meta_cpc") * 100), currency)}</b></span></>}</footer>}
  </article>;
}

function ReviewInsightsCard({ insights }: { insights: GrowthData["reviewInsights"] }) {
  return <article className="card google-review-insights">
    <header><div><p className="card-kicker">GOOGLE REVIEW SIGNALS</p><h3>Feedback patterns and recommended follow-up</h3></div><strong>{insights.averageRating === null ? "No reviews" : `${insights.averageRating.toFixed(1)} ★`}</strong></header>
    {insights.available ? <>
      <div className="review-score-row"><span><b>{insights.reviewCount}</b><small>Reviews</small></span><span><b>{insights.lowRatingCount}</b><small>Three stars or lower</small></span><span><b>{insights.fiveStarShare === null ? "—" : `${Math.round(insights.fiveStarShare * 100)}%`}</b><small>Five-star share</small></span></div>
      <div className="review-theme-list">{insights.themes.slice(0, 5).map((theme) => <span key={theme.key}><b>{theme.label}</b><i style={{ width: `${Math.max(8, theme.mentions / Math.max(...insights.themes.map((item) => item.mentions), 1) * 100)}%` }} /><small>{theme.mentions} mentions · {theme.lowRatingMentions} lower-rated</small></span>)}</div>
      <div className="review-recommendations">{insights.recommendations.length ? insights.recommendations.map((item) => <section key={item.id}><small>RECOMMENDATION</small><b>{item.title}</b><p>{item.rationale}</p><span>{item.action}</span><em>{item.evidence}</em></section>) : <section><small>MONITOR</small><b>No repeated concern has enough evidence yet</b><p>Keep collecting reviews and revisit after the next measured sample.</p></section>}</div>
      <footer>{insights.privacyBoundary}</footer>
    </> : <div className="marketing-metric-empty"><b>No connected Google reviews yet</b><span>Connect Google and run a sync to build aggregate feedback themes and recommendations.</span></div>}
  </article>;
}

export default function GrowthWorkspace({ currency, navigate, activeLocationId }: { currency: string; navigate: (view: "Integrations") => void; activeLocationId: string | null }) {
  const [data, setData] = useState<GrowthData | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [csvKind, setCsvKind] = useState<CsvKind>("search_visibility");
  const [csvFileName, setCsvFileName] = useState("");
  const [csvRows, setCsvRows] = useState<CsvRecord[]>([]);
  const growthPath = `/api/v1/growth${activeLocationId ? `?location=${encodeURIComponent(activeLocationId)}` : ""}`;

  const load = useCallback(async () => {
    const response = await apiFetch(growthPath, { headers: { Accept: "application/json" } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Growth intelligence could not be loaded.");
    setData(body);
    setProfile(body.profile);
  }, [growthPath]);

  useEffect(() => {
    let active = true;
    void apiFetch(growthPath, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Growth intelligence could not be loaded.");
        return body as GrowthData;
      })
      .then((body) => {
        if (!active) return;
        setData(body);
        setProfile(body.profile);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Growth intelligence could not be loaded.");
      });
    return () => { active = false; };
  }, [growthPath]);

  const totals = useMemo(() => data?.growth.channels.reduce((result, row) => ({ revenue: result.revenue + row.revenueCents, leads: result.leads + row.leads, customers: result.customers + row.customers }), { revenue: 0, leads: 0, customers: 0 }) ?? { revenue: 0, leads: 0, customers: 0 }, [data]);

  const runSave = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); await load(); setNotice(message); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) return;
    void runSave(() => postGrowth({ type: "marketing_profile", ...profile }), "Business context saved. Recommendations now use these details.");
  };

  const saveObservation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const actions = values.get("discoveryActions")?.toString().trim();
    void runSave(() => postGrowth({
      type: "search_visibility",
      query: values.get("query"),
      observedDate: values.get("observedDate"),
      position: Number(values.get("position")),
      discoveryActions: actions ? Number(actions) : null,
      sourceSystem: "owner_entry",
      sourceEventId: crypto.randomUUID(),
    }), "Search observation recorded with Owner entry as its source.").then(() => form.reset());
  };

  const saveCalendar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void runSave(() => postGrowth({
      type: "marketing_calendar",
      title: values.get("title"),
      channel: values.get("channel"),
      eventType: values.get("eventType"),
      startDate: values.get("startDate"),
      dueDate: values.get("dueDate"),
      objective: values.get("objective"),
      notes: values.get("notes"),
    }), "Marketing calendar entry created.").then(() => form.reset());
  };

  const completeEntry = (entry: CalendarEntry) => void runSave(() => postGrowth({ type: "marketing_calendar_status", id: entry.id, status: "completed" }), `Marked “${entry.title}” complete.`);

  const chooseCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError(""); setNotice(""); setCsvRows([]); setCsvFileName("");
    if (!file) return;
    if (file.size > 1_000_000) { setError("Marketing CSV files must be 1 MB or smaller."); return; }
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error("The CSV contains no data rows.");
      if (rows.length > 100) throw new Error("Import up to 100 rows at a time so each record can be validated and audited.");
      const missing = csvRequirements[csvKind].required.filter((header) => !(header in rows[0]));
      if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}.`);
      setCsvFileName(file.name); setCsvRows(rows);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The CSV could not be read."); }
    finally { event.target.value = ""; }
  };

  const importCsv = () => void runSave(async () => {
    for (const row of csvRows) {
      const sourceEventId = row.sourceEventId || await stableSourceEventId(csvKind, row);
      const payload: Record<string, unknown> = {
        type: csvKind,
        ...row,
        sourceSystem: row.sourceSystem || "owner_csv",
        sourceEventId,
      };
      if (csvKind === "search_visibility") {
        payload.position = Number(row.position);
        payload.discoveryActions = row.discoveryActions ? Number(row.discoveryActions) : null;
      } else if (csvKind === "transaction") {
        payload.revenueCents = Number(row.revenueCents);
        payload.grossProfitCents = row.grossProfitCents ? Number(row.grossProfitCents) : null;
      }
      await postGrowth(payload);
    }
  }, `${csvRows.length} marketing record${csvRows.length === 1 ? "" : "s"} validated and imported.`).then(() => { setCsvRows([]); setCsvFileName(""); });

  return <div className="content module-page growth-page">
    <section className="module-hero growth-visual-hero">
      <div><p>LOCAL BUSINESS GROWTH INTELLIGENCE</p><h2>Turn business context and measured outcomes into a focused marketing plan.</h2><span>Save who you serve, record the data you actually have, and receive recommendations that state their evidence and measurement limits.</span></div>
      <Image src="/brand/marketing-intelligence-v2.png" alt="Marketing channels connected to search, local discovery, content, conversion and a calendar" width={1672} height={941} sizes="(max-width: 900px) 100vw, 46vw" />
    </section>

    <nav className="growth-tabs" aria-label="Marketing workspace sections">
      {(["overview", "context", "data", "calendar"] as const).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item === "context" ? "Business context" : item === "data" ? "Import data" : item === "calendar" ? "Marketing calendar" : label(item)}</button>)}
    </nav>

    {error && <div className="growth-message error" role="alert">{error}</div>}
    {notice && <div className="growth-message success" role="status">{notice}</div>}

    {tab === "overview" && <>
      <section className="growth-summary-grid">
        <article><small>ATTRIBUTED REVENUE</small><b>{money(totals.revenue, currency)}</b><span>{data?.growth.status === "available" ? "First-touch records" : "Awaiting matched journeys"}</span></article>
        <article><small>ATTRIBUTED LEADS</small><b>{totals.leads.toLocaleString("en-CA")}</b><span>{totals.customers.toLocaleString("en-CA")} became recorded customers</span></article>
        <article><small>SEARCH OBSERVATIONS</small><b>{data?.searchSeries.length ?? 0}</b><span>Owner or verified source records</span></article>
        <article><small>PLANNED WORK</small><b>{data?.calendar.filter((item) => item.status !== "completed" && item.status !== "cancelled").length ?? 0}</b><span>Open calendar entries</span></article>
      </section>

      <section className="growth-connection-grid">
        {data?.connections.map((connection) => <article className={`card growth-connection ${connection.status}`} key={connection.provider}><div><IntegrationBrandLogo name={connection.provider} compact /><div><b>{connection.provider}</b><small>{connection.availableNow}</small></div></div><footer><em>{connection.label}</em><button onClick={() => navigate("Integrations")}>{connection.status === "connected" ? "Manage" : "Set up"} →</button></footer></article>)}
      </section>

      <section className="marketing-provider-metrics" aria-label="Connected marketing measurements">
        <ProviderMeasurementCard provider="google" rows={data?.measurementSeries ?? []} currency={currency} />
        <ProviderMeasurementCard provider="meta" rows={data?.measurementSeries ?? []} currency={currency} />
      </section>
      <ReviewInsightsCard insights={data?.reviewInsights ?? { available: false, reviewCount: 0, averageRating: null, lowRatingCount: 0, fiveStarShare: null, lastReviewAt: null, themes: [], recommendations: [], privacyBoundary: "Reviewer names and profile photos are not stored." }} />

      <section className="growth-overview-grid">
        <article className="card growth-recommendations">
          <div className="card-head"><div><p className="card-kicker">TAILORED NEXT ACTIONS</p><h3>{data?.organization.businessName ?? "Business"} growth plan</h3></div><button onClick={() => setTab("context")}>Edit context</button></div>
          <div className="recommendation-stack">{data?.recommendations.map((item, index) => <section key={item.id}>
            <span className={`recommendation-rank ${item.priority}`}>{String(index + 1).padStart(2, "0")}</span>
            <div><div className="recommendation-meta"><small>{label(item.category)}</small><em>{item.priority} priority</em><em>{label(item.confidence)} confidence</em></div><h4>{item.title}</h4><p>{item.rationale}</p><strong>Recommended action</strong><span>{item.action}</span><dl><dt>Confidence</dt><dd>{item.confidenceReason}</dd><dt>Source freshness</dt><dd>{item.sourceFreshness}</dd><dt>Evidence</dt><dd>{item.evidence.join(" · ")}</dd><dt>Missing inputs</dt><dd>{item.missingInputs.length ? item.missingInputs.join(" · ") : "No material inputs missing"}</dd><dt>Operating checks</dt><dd>{item.operatingCoverage.map((check) => `${check.label}: ${label(check.status)} (${check.freshness})`).join(" · ")}</dd><dt>Action owner</dt><dd>{item.actionOwner}</dd><dt>Action due</dt><dd>{item.actionDueDate}</dd><dt>Measure</dt><dd>{item.metrics.join(" · ")}</dd><dt>Evidence needed</dt><dd>{item.evidenceNeeded.join(" · ")}</dd><dt>Review method</dt><dd>{item.reviewMethod}</dd></dl><a href={item.sourceUrl} target="_blank" rel="noreferrer">Method source: {item.sourceLabel}</a></div>
          </section>)}</div>
        </article>
        <article className="card growth-search-card"><div className="card-head"><div><p className="card-kicker">SEARCH VISIBILITY</p><h3>Recorded position trend</h3></div><button onClick={() => setTab("data")}>Add data</button></div><SearchVisibilityChart rows={data?.searchSeries ?? []} />{data?.growth.insight && <div className="growth-search-insight"><b>{data.growth.insight.title}</b><span>{data.growth.insight.explanation}</span></div>}</article>
      </section>

      {data?.growth.status === "available" ? <article className="card growth-table"><div className="card-head"><div><p className="card-kicker">SOURCE TO CUSTOMER TO POS</p><h3>Revenue attribution</h3></div><span>{data.period.since} to {data.period.through}</span></div><div className="growth-row growth-head"><span>Source</span><span>Leads</span><span>Customers</span><span>Transactions</span><span>Revenue</span><span>Gross profit</span></div>{data.growth.channels.map((row) => <div className="growth-row" key={row.source}><b>{row.source}</b><span>{row.leads}</span><span>{row.customers}</span><span>{row.transactions}</span><strong>{money(row.revenueCents, currency)}</strong><span>{row.grossProfitCents === null ? "Unavailable" : money(row.grossProfitCents, currency)}</span></div>)}</article> : <article className="card growth-empty"><b>Revenue attribution needs matched journey records</b><span>{data?.growth.reason}</span><button onClick={() => navigate("Integrations")}>Review data connections</button></article>}
    </>}

    {tab === "context" && <section className="growth-form-layout">
      <form className="card growth-profile-form" onSubmit={saveProfile}>
        <div className="card-head"><div><p className="card-kicker">OWNER-PROVIDED CONTEXT</p><h3>Describe the business you are growing</h3></div><span>{profile?.saved ? "Saved profile" : "Not saved yet"}</span></div>
        <div className="growth-field-grid">
          <label>Business model<input value={profile?.businessModel ?? ""} onChange={(event) => setProfile((current) => current && ({ ...current, businessModel: event.target.value }))} maxLength={120} placeholder="Local retail, home services, professional practice" /></label>
          <label>Primary goal<select value={profile?.primaryGoal ?? "leads"} onChange={(event) => setProfile((current) => current && ({ ...current, primaryGoal: event.target.value as Profile["primaryGoal"] }))}><option value="leads">Qualified leads</option><option value="visits">Store visits</option><option value="sales">Sales</option><option value="awareness">Local awareness</option></select></label>
          <label className="wide">Primary offer<input value={profile?.primaryOffer ?? ""} onChange={(event) => setProfile((current) => current && ({ ...current, primaryOffer: event.target.value }))} maxLength={180} placeholder="The product or service you most want to grow" /></label>
          <label>Ideal customer<input value={profile?.targetAudience ?? ""} onChange={(event) => setProfile((current) => current && ({ ...current, targetAudience: event.target.value }))} maxLength={180} placeholder="Who benefits and who is a good fit" /></label>
          <label>Service area<input value={profile?.serviceArea ?? ""} onChange={(event) => setProfile((current) => current && ({ ...current, serviceArea: event.target.value }))} maxLength={180} placeholder="City, region, or online market" /></label>
          <label>Website<input type="url" value={profile?.websiteUrl ?? ""} onChange={(event) => setProfile((current) => current && ({ ...current, websiteUrl: event.target.value }))} maxLength={300} placeholder="https://example.com" /></label>
          <label>Google Business Profile<select value={profile?.googleProfileStatus ?? "not_set"} onChange={(event) => setProfile((current) => current && ({ ...current, googleProfileStatus: event.target.value as Profile["googleProfileStatus"] }))}><option value="not_set">Not set</option><option value="claimed">Claimed</option><option value="verified">Verified</option></select></label>
          <label className="wide">Useful context<textarea value={profile?.notes ?? ""} onChange={(event) => setProfile((current) => current && ({ ...current, notes: event.target.value }))} maxLength={1000} placeholder="Seasonality, differentiators, capacity limits, common customer questions, or current priorities" /></label>
        </div>
        <footer><span>Recommendations change only after this profile is saved.</span><button disabled={busy || !data?.canManage}>{busy ? "Saving..." : data?.canManage ? "Save business context" : "Owner or admin access required"}</button></footer>
      </form>
      <aside className="card growth-context-guide"><p className="card-kicker">WHY THIS MATTERS</p><h3>Useful detail beats generic marketing advice.</h3><p>Vanteloq uses these fields to frame the audience, offer, service area, conversion goal and measurement plan. It does not invent rankings, demand or return on spend.</p><ul><li>Use the offer customers actually buy.</li><li>Describe a customer group you can recognize.</li><li>State a real geographic or online service area.</li><li>Record capacity or seasonality in the notes.</li></ul></aside>
    </section>}

    {tab === "data" && <section className="growth-data-layout">
      <article className="card growth-csv-import">
        <div className="card-head"><div><p className="card-kicker">OWNER DATA IMPORT</p><h3>Import marketing evidence</h3></div><span>Checked · organization-only · recorded</span></div>
        <p>Upload a CSV exported by the owner. Vanteloq checks each record through the same protected API used by manual entry. Existing source event IDs are ignored safely on re-import.</p>
        <label>Record type<select value={csvKind} onChange={(event) => { setCsvKind(event.target.value as CsvKind); setCsvRows([]); setCsvFileName(""); }}><option value="search_visibility">Search visibility</option><option value="touchpoint">Marketing touchpoints</option><option value="transaction">Attributed transactions</option></select></label>
        <div className="growth-csv-columns"><small>Required columns</small><code>{csvRequirements[csvKind].sample}</code></div>
        <label className="growth-csv-drop"><input type="file" accept=".csv,text/csv" onChange={(event) => void chooseCsv(event)} disabled={busy || !data?.canManage} /><b>{csvFileName || "Choose a CSV file"}</b><span>{csvRows.length ? `${csvRows.length} rows ready to validate` : "Maximum 100 rows and 1 MB per import"}</span></label>
        <button className="growth-import-action" disabled={busy || !data?.canManage || !csvRows.length} onClick={importCsv}>{busy ? "Importing..." : csvRows.length ? `Validate and import ${csvRows.length} rows` : "Choose data to import"}</button>
        <div className="growth-import-counts"><span>Search observations<b>{data?.importCounts.searchObservations ?? 0}</b></span><span>Touchpoints<b>{data?.importCounts.touchpoints ?? 0}</b></span><span>Transactions<b>{data?.importCounts.transactions ?? 0}</b></span></div>
      </article>
      <form className="card growth-data-form" onSubmit={saveObservation}>
        <div className="card-head"><div><p className="card-kicker">MANUAL SEARCH SNAPSHOT</p><h3>Record an owner-exported observation</h3></div><span>Source: Owner entry</span></div>
        <p>Use values from Search Console or Business Profile. This records what you provide; it does not verify or connect the Google account.</p>
        <div className="growth-field-grid"><label className="wide">Search query<input name="query" maxLength={180} required placeholder="Search phrase exactly as shown in the export" /></label><label>Observation date<input name="observedDate" type="date" required /></label><label>Average position<input name="position" type="number" min="0.001" max="1000" step="0.001" required /></label><label>Discovery actions, if available<input name="discoveryActions" type="number" min="0" step="1" placeholder="Optional" /></label></div>
        <footer><button type="button" onClick={() => navigate("Integrations")}>Open Import data</button><button disabled={busy || !data?.canManage}>{busy ? "Recording..." : data?.canManage ? "Record observation" : "Owner or admin access required"}</button></footer>
      </form>
      <article className="card growth-source-status"><p className="card-kicker">CONNECTION ROADMAP</p><h3>Automated marketing sources</h3>{data?.connections.map((connection) => <div key={connection.provider}><IntegrationBrandLogo name={connection.provider} compact /><div><b>{connection.provider}</b><small>{connection.availableNow}</small></div><em>{connection.label}</em></div>)}<button onClick={() => navigate("Integrations")}>Review all connections</button></article>
      <article className="card growth-observation-table"><div className="card-head"><div><p className="card-kicker">RECORDED EVIDENCE</p><h3>Recent search observations</h3></div><span>{data?.searchSeries.length ?? 0} records shown</span></div>{data?.searchSeries.length ? <><div className="observation-row observation-head"><span>Date</span><span>Query</span><span>Position</span><span>Actions</span><span>Source</span></div>{[...data.searchSeries].reverse().map((row, index) => <div className="observation-row" key={`${row.query}-${row.observedDate}-${index}`}><span>{row.observedDate}</span><b>{row.query}</b><strong>{row.position}</strong><span>{row.discoveryActions ?? "Unavailable"}</span><em>{label(row.sourceSystem)}</em></div>)}</> : <div className="growth-chart-empty"><b>No observations recorded</b><span>Add a snapshot above or use Import data for existing records.</span></div>}</article>
    </section>}

    {tab === "calendar" && <section className="growth-calendar-layout">
      <form className="card growth-calendar-form" onSubmit={saveCalendar}>
        <div className="card-head"><div><p className="card-kicker">MARKETING CALENDAR</p><h3>Plan a measurable action</h3></div></div>
        <div className="growth-field-grid"><label className="wide">Title<input name="title" required maxLength={180} placeholder="Publish service-area guide" /></label><label>Channel<select name="channel" defaultValue="content"><option value="content">Content</option><option value="google">Google</option><option value="meta">Meta</option><option value="email">Email</option><option value="local">Local</option><option value="website">Website</option></select></label><label>Work type<select name="eventType" defaultValue="content"><option value="campaign">Campaign</option><option value="content">Content</option><option value="audit">Audit</option><option value="offer">Offer</option><option value="follow_up">Follow up</option></select></label><label>Start date<input name="startDate" type="date" required /></label><label>Due date<input name="dueDate" type="date" /></label><label className="wide">Objective<textarea name="objective" maxLength={500} placeholder="What should change, and how will you measure it?" /></label><label className="wide">Notes<textarea name="notes" maxLength={1000} placeholder="Owner, dependencies, audience, offer details, or evidence needed" /></label></div>
        <footer><button disabled={busy || !data?.canManage}>{busy ? "Creating..." : data?.canManage ? "Add to calendar" : "Owner or admin access required"}</button></footer>
      </form>
      <article className="card growth-calendar-list"><div className="card-head"><div><p className="card-kicker">UPCOMING & RECENT</p><h3>Marketing work</h3></div><span>{data?.calendar.length ?? 0} entries</span></div>{data?.calendar.length ? <div>{data.calendar.map((entry) => <section key={entry.id} className={`calendar-entry ${entry.status}`}><time dateTime={entry.startDate}><b>{new Date(`${entry.startDate}T12:00:00`).toLocaleDateString("en-CA", { day: "2-digit" })}</b><span>{new Date(`${entry.startDate}T12:00:00`).toLocaleDateString("en-CA", { month: "short" })}</span></time><div><div><small>{label(entry.channel)} · {label(entry.eventType)}</small><em>{label(entry.status)}</em></div><h4>{entry.title}</h4>{entry.objective && <p>{entry.objective}</p>}<span>{entry.dueDate ? `Due ${entry.dueDate}` : "No separate due date"}</span></div>{entry.status !== "completed" && entry.status !== "cancelled" && data.canManage && <button onClick={() => completeEntry(entry)}>Mark complete</button>}</section>)}</div> : <div className="growth-chart-empty"><b>No marketing work planned</b><span>Add the first campaign, content task, audit, offer or follow-up.</span></div>}</article>
    </section>}

    <article className="card growth-boundary"><b>{data?.locationScope ? `${data.locationScope.name} evidence boundary` : "Evidence boundary"}</b><span>{data ? `${data.scopeBoundary} ${data.sourceBoundary}` : "Loading source contract..."}</span></article>
  </div>;
}
