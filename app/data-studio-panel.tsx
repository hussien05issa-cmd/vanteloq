"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { businessClock } from "../domain/intraday-sales";
import { excelMoneyValue, type StudioExecutiveReview } from "../domain/data-studio";
import "./data-studio.css";

const tabs = ["Overview", "Sales", "Margin", "Inventory", "Cash", "Data Quality", "Sources"] as const;
type Tab = typeof tabs[number];
const failure = (body: unknown, fallback: string) => body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "message" in body.error && typeof body.error.message === "string" ? body.error.message : fallback;
export default function DataStudioPanel({ activeLocationId, sourceConnectionId, from, to, timeZone, onClose, onDatesChange, closeLabel = "Back to reports" }: {
  activeLocationId: string | null; sourceConnectionId: string; from: string; to: string; timeZone: string; onClose: () => void; onDatesChange?: (from:string,to:string)=>void; closeLabel?:string;
}) {
  const today = businessClock(new Date(), timeZone)?.date ?? new Date().toISOString().slice(0, 10);
  const defaultStart = new Date(`${today}T00:00:00Z`); defaultStart.setUTCDate(defaultStart.getUTCDate() - 29);
  const [start, setStart] = useState(from || defaultStart.toISOString().slice(0, 10));
  const [end, setEnd] = useState(to || today);
  const [tab, setTab] = useState<Tab>("Overview");
  const [loaded, setLoaded] = useState<{ scopeKey: string; review: StudioExecutiveReview } | null>(null);
  const [busy, setBusy] = useState<"preview" | "export" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const request = useRef<AbortController | null>(null), sequence = useRef(0);
  const scopeKey = `${start}:${end}:${activeLocationId ?? ""}:${sourceConnectionId}`;
  const review = loaded?.scopeKey === scopeKey ? loaded.review : null;
  const cancel = () => { sequence.current++; request.current?.abort(); request.current = null; setLoaded(null); setBusy(null); setStatus(""); };
  useEffect(() => {
    const clear = () => { sequence.current++; request.current?.abort(); setLoaded(null); setBusy(null); setStatus(""); };
    const visibility = () => { if (document.visibilityState !== "visible") clear(); };
    window.addEventListener("vanteloq-session-expired", clear); window.addEventListener("storage", clear); window.addEventListener("pagehide", clear); document.addEventListener("visibilitychange", visibility);
    return () => {
      // These refs hold the current in-flight operation, not a DOM node captured on mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++; request.current?.abort();
      window.removeEventListener("vanteloq-session-expired", clear); window.removeEventListener("storage", clear); window.removeEventListener("pagehide", clear); document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const params = (format: string) => {
    const p = new URLSearchParams({ from: start, to: end, format });
    if (activeLocationId) p.set("location", activeLocationId);
    if (sourceConnectionId) p.set("connection", sourceConnectionId);
    return p;
  };
  const preview = async () => {
    const originatingBusiness = new URL(window.location.href).searchParams.get("workspace");
    const id = ++sequence.current, controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setBusy("preview"); setLoaded(null); setError(""); setStatus("Reading your permitted source records…");
    try {
      const response = await apiFetch(`/api/v1/data-studio/executive?${params("preview")}`, { signal: controller.signal });
      const body: unknown = await response.json();
      if (controller.signal.aborted || id !== sequence.current || originatingBusiness !== new URL(window.location.href).searchParams.get("workspace")) return;
      if (!response.ok) throw new Error(failure(body, "The review could not be prepared. Check the period and try again."));
      const next = body as StudioExecutiveReview;
      if (next.version !== "studio-v1" || next.metadata?.truncated !== false || !Array.isArray(next.sales?.rows)) throw new Error("The review response was incomplete. Please try again.");
      setLoaded({ scopeKey, review: next }); setStatus(`Review ready. ${next.metadata.rowCount.toLocaleString("en-CA")} recorded daily rows. Source limitations are included.`);
    } catch (e) { if (!controller.signal.aborted && id === sequence.current) { setLoaded(null); setError(e instanceof Error ? e.message : "Please try again."); setStatus(""); } }
    finally { if (id === sequence.current) setBusy(null); }
  };
  const exportWorkbook = async () => {
    if (!review || !review.metadata.canExport || busy) return;
    const originatingBusiness = new URL(window.location.href).searchParams.get("workspace");
    const expected = review.metadata.snapshotHash, id = ++sequence.current, controller = new AbortController();
    request.current?.abort(); request.current = controller; setBusy("export"); setError(""); setStatus("Rechecking access and preparing your workbook…");
    const p = params("xlsx"); p.set("snapshot", expected);
    try {
      const response = await apiFetch(`/api/v1/data-studio/executive?${p}`, { signal: controller.signal });
      if (!response.ok) { const body: unknown = await response.json(); throw new Error(failure(body, "The workbook could not be downloaded. Please try again.")); }
      if (response.headers.get("X-Studio-Snapshot") !== expected || !response.headers.get("content-type")?.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) throw new Error("The workbook did not match this review. Refresh it before exporting.");
      const blob = await response.blob();
      if (controller.signal.aborted || id !== sequence.current || originatingBusiness !== new URL(window.location.href).searchParams.get("workspace")) return;
      if (!blob.size || blob.size > 5 * 1024 * 1024) throw new Error("The file exceeded the supported download size. Narrow the period.");
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `vanteloq-executive-review-${start}-${end}.xlsx`; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus("Workbook generated and download requested. Its source and exact-value notes are included.");
    } catch (e) { if (!controller.signal.aborted && id === sequence.current) { setLoaded(null); setError(e instanceof Error ? e.message : "Please try again."); setStatus(""); } }
    finally { if (id === sequence.current) setBusy(null); }
  };
  const money = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "Unavailable";
    const display = excelMoneyValue(value), currency = review?.metadata.currency ?? "CAD";
    if (typeof display === "string") { const [whole, fraction] = display.split("."); return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`; }
    return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(display!);
  };
  const summary = review?.sales.summary;
  return <section className="data-studio" aria-labelledby="data-studio-title">
    <header className="page-intro"><div><p>DATA STUDIO TEMPLATE</p><h2 id="data-studio-title">Executive Review</h2><span>Inspect the scope, then take the same numbers into Excel.</span></div><button type="button" onClick={onClose}>{closeLabel}</button></header>
    <details className="card studio-scope-card" open={!review}><summary>Reporting scope{review ? ` · ${start} to ${end} · ${review.metadata.currency}` : ""}</summary>
    <form className="studio-scope" onSubmit={e => { e.preventDefault(); void preview(); }}>
      <label>From<input type="date" value={start} max={end} onChange={e => { cancel(); setError(""); setStart(e.target.value); onDatesChange?.(e.target.value,end); }} required/></label>
      <label>To<input type="date" value={end} min={start} max={today} onChange={e => { cancel(); setError(""); setEnd(e.target.value); onDatesChange?.(start,e.target.value); }} required/></label>
      <p>{activeLocationId ? "Selected location" : "Your authorized locations"} · {sourceConnectionId ? "Selected approved provider" : "Approved reporting sources"} · {timeZone}</p>
      <div className="studio-actions"><button className="primary" type="submit" disabled={busy !== null}>{busy === "preview" ? "Preparing review…" : "Preview review"}</button>{review?.metadata.canExport && <button className="primary" type="button" onClick={() => void exportWorkbook()} disabled={busy !== null}>{busy === "export" ? "Preparing workbook…" : "Download XLSX"}</button>}{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>
    </form></details>
    <p role="status" aria-live="polite">{status}</p>{error && <p className="studio-error" role="alert">{error}</p>}
    {!review && !busy && <div className="card studio-empty"><h3>Choose the period you want to understand.</h3><p>The review includes Sales, Margin, Inventory, Cash, Data Quality and Sources. Missing or restricted sections stay clear. It does not post entries or change your records.</p></div>}
    {busy === "preview" && <div className="card studio-loading" aria-busy="true"><span>Loading review sections…</span><div/><div/><div/></div>}
    {review && <>
      <div className="studio-actions">{review.metadata.canExport && <button className="primary" type="button" onClick={() => void exportWorkbook()} disabled={busy !== null}>{busy === "export" ? "Preparing workbook…" : "Download XLSX"}</button>}<button type="button" disabled={busy !== null} onClick={() => void preview()}>Refresh review</button>{busy && <button type="button" onClick={cancel}>Cancel</button>}</div>
      {review.ledger?.dataMode === "demonstration" && <p className="studio-access-note" role="note">Demonstration accounting data. Posted ledger, inventory and cash figures in this review are examples, not live business balances.</p>}
      {review.metadata.recordedDayCount < review.metadata.calendarDayCount && <p className="studio-access-note">Some dates have no recorded sales. Review Data Quality before interpreting the period.</p>}
      <nav className="studio-tabs" aria-label="Executive Review sections">{tabs.map(name => <button type="button" key={name} aria-current={tab === name ? "page" : undefined} onClick={() => setTab(name)}>{name}</button>)}</nav>
      <section className="card studio-result" aria-labelledby="studio-section-title"><h3 id="studio-section-title">{tab}</h3>
        {tab === "Overview" && <><p>{review.metadata.from} to {review.metadata.to} · {review.metadata.currency} · {review.metadata.rowCount.toLocaleString("en-CA")} recorded daily rows</p><dl className="studio-kpis"><div><dt>Recorded net sales</dt><dd>{money(summary?.netSalesCents)}</dd></div><div><dt>Transactions</dt><dd>{summary?.transactionCount?.toLocaleString("en-CA") ?? "Unavailable"}</dd></div>{review.margin.state !== "restricted" && <div><dt>Recorded gross profit</dt><dd>{money(summary?.grossProfitCents)}</dd></div>}</dl><p>Stored records, with complete accepted extraction. Provider history and source reconciliation are not certified.</p>{review.ledger && <><h4>Posted accrual figures</h4><dl className="studio-kpis"><div><dt>Ledger revenue</dt><dd>{money(review.ledger.revenueCents)}</dd></div><div><dt>Net earnings</dt><dd>{money(review.ledger.netEarningsCents)}</dd></div></dl><p>Separate accounting evidence. These figures are not added to operational sales.</p></>}</>}
        {(tab === "Sales" || tab === "Margin") && <>{tab === "Margin" && <><p>{review.margin.reason}</p>{review.margin.state !== "restricted" && <><dl className="studio-kpis"><div><dt>Weighted gross margin</dt><dd>{summary?.grossMargin === null || summary?.grossMargin === undefined ? "Unavailable" : new Intl.NumberFormat("en-CA", { style:"percent", maximumFractionDigits:2 }).format(summary.grossMargin)}</dd></div></dl><p>Total recorded gross profit divided by positive net sales. Daily percentages are not averaged.</p></>}</>}{review.sales.reason && <p>{review.sales.reason}</p>}{(tab !== "Margin" || review.margin.state !== "restricted") && review.sales.rows.length > 0 && <div className="studio-table" tabIndex={0} aria-label={`${tab} records, scroll horizontally if needed`}><table><caption>Every accepted daily row in this scope. Identifiers and dates are preserved.</caption><thead><tr><th>Record</th><th>Date</th><th>Location</th><th>Net sales</th><th>{tab === "Sales" ? "Transactions" : "Recorded cost"}</th><th>Evidence</th></tr></thead><tbody>{review.sales.rows.map(row => <tr key={row.id}><td>{row.id}</td><td>{row.businessDate}</td><td>{row.locationRef}</td><td>{money(row.netSalesCents)}</td><td>{tab === "Sales" ? row.transactionCount.toLocaleString("en-CA") : money(row.costOfGoodsCents)}</td><td>{row.sourceKind === "provider_summary" ? "Provider summary" : "Owner-reviewed summary"}</td></tr>)}</tbody></table></div>}</>}
        {tab === "Inventory" && <><p className="studio-balance">{review.inventory.state === "recorded" ? money(review.inventory.ledgerCents) : "Unavailable in this scope"}</p><p>{review.inventory.reason}</p></>}
        {tab === "Cash" && <><p className="studio-balance">{review.cash.state === "recorded" ? money(review.cash.ledgerCents) : "Unavailable in this scope"}</p><p>{review.cash.reason}</p></>}
        {tab === "Data Quality" && <><p>{review.metadata.recordedDayCount} of {review.metadata.calendarDayCount} calendar dates contain at least one recorded row. This does not certify every location or establish zero sales on missing dates. Latest recorded update: {review.metadata.latestRecordUpdateUtc ?? "Unavailable"}.</p><p>{review.margin.reason}</p><ul>{review.limitations.map(line => <li key={line}>{line}</li>)}</ul>{review.ledger && <p>Posted balance difference: {money(review.ledger.balanceDifferenceCents)}. Foreign-currency entries excluded: {review.ledger.foreignCurrencyEntriesExcluded}.</p>}</>}
        {tab === "Sources" && <><dl className="studio-sources"><dt>Sales extraction UTC</dt><dd>{review.metadata.extractionUtc}</dd><dt>Generated UTC</dt><dd>{review.metadata.generatedUtc}</dd><dt>Calculation version</dt><dd>{review.metadata.calculationVersion}</dd>{review.ledger && <><dt>Posted ledger generated UTC</dt><dd>{review.ledger.generatedUtc}</dd></>}<dt>Result fingerprint</dt><dd><code>{review.metadata.snapshotHash}</code></dd></dl><p>Each component has its own read transaction and timestamp. Long identifiers and exact cents remain text in the workbook; monetary display values exceeding Excel’s precision limit remain decimal text.</p></>}
      </section><p className="studio-access-note">Workbook exports follow your existing plan and report export permissions. Posted financial sections also require organization-wide access, All locations, BookLoQ and financial export permission.</p>
    </>}
  </section>;
}
