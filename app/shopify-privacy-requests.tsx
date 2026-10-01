"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";

type RequestRow = { id: string; provider: string; status: string; receivedAt: number; dueAt: number; lastExportedAt: number | null; lastExportComplete: number; completedAt: number | null };
const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString();
async function fetchRequests() {
  const response = await apiFetch("/api/v1/integrations/shopify/privacy", { signal: AbortSignal.timeout(30_000) });
  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
}

export default function ShopifyPrivacyRequests({ quietUnauthorized = false }: { quietUnauthorized?: boolean }) {
  const [rows, setRows] = useState<RequestRow[]>([]), [hasMore, setHasMore] = useState(false), [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [selected, setSelected] = useState<string | null>(null), [reference, setReference] = useState("");
  const [method, setMethod] = useState("secure_delivery"), [confirmed, setConfirmed] = useState(false);
  const alive = useRef(true), working = useRef(false), formId = useId();
  const receive = useCallback(({ ok, status, body }: Awaited<ReturnType<typeof fetchRequests>>) => {
    if (!ok) {
      if (alive.current) setUnavailable(status === 401 || status === 403);
      throw new Error(body.error?.message || "Privacy requests could not be loaded.");
    }
    if (alive.current) { setRows(body.requests); setHasMore(body.hasMore); setLoaded(true); setUnavailable(false); }
  }, []);
  const load = useCallback(() => fetchRequests().then(receive), [receive]);
  useEffect(() => { alive.current = true; void fetchRequests().then(receive).catch(e => { if (alive.current) setError(e.message); }); return () => { alive.current = false; }; }, [receive]);
  async function act(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "The request could not be completed."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function post(body: Record<string, unknown>) {
    const response = await apiFetch("/api/v1/integrations/shopify/privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "The privacy action failed.");
    return result;
  }
  async function download(id: string) {
    const result = await post({ action: "export", id });
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `shopify-privacy-${id}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    await load();
    if (alive.current) setMessage("Export downloaded for your review. No customer response has been sent. Verify the recipient and deliver the response securely before recording completion.");
  }
  if (quietUnauthorized && unavailable) return null;
  return <section className="card" id="shopify-privacy-requests" aria-labelledby={`${formId}-title`}>
    <header><h3 id={`${formId}-title`}>Shopify privacy requests</h3><button type="button" disabled={busy} onClick={() => void act(load)}>Refresh requests</button></header>
    <p>Authorized workspace owners and administrators can review customer requests, download a private export and record a completed response. Disconnecting Shopify does not complete these requests.</p>
    <p><a href="/privacy-requests">Open the privacy request page</a>, including after subscription access ends.</p>
    {error && <p role="alert">{error}{unavailable ? " Sign in to the correct workspace with privacy management and customer export permissions." : ""}</p>}
    {message && <p role="status">{message}</p>}
    {!loaded && !error && <p role="status">Loading privacy requests…</p>}
    {loaded && !rows.length && <p>No Shopify privacy requests have been received for this workspace.</p>}
    {hasMore && <p>Showing the first 100 requests. Complete pending requests to move through the queue. Contact the privacy operator if older completed evidence is needed.</p>}
    {rows.map(row => <article className="settings-panel" key={row.id}>
      <h4>{row.provider === "shopify-pos" ? "Shopify POS" : "Shopify"} request</h4>
      <p>Received {date(row.receivedAt)} · Due {date(row.dueAt)} · {row.status === "completed" ? "Response confirmed" : "Pending response"}</p>
      <small>Reference: {row.id}</small>
      {row.status === "pending" && <div className="form-actions">
        <button type="button" disabled={busy} onClick={() => void act(() => download(row.id))}>Download customer export</button>
        <button type="button" disabled={busy || row.lastExportComplete !== 1} onClick={() => { setSelected(row.id); setReference(""); setConfirmed(false); setMethod("secure_delivery"); }}>Record completed response</button>
      </div>}
      {selected === row.id && row.status === "pending" && <form onSubmit={event => { event.preventDefault(); void act(async () => {
        await post({ action: "complete", id: row.id, method, reference, confirmed });
        await load(); if (alive.current) { setSelected(null); setMessage("Response recorded. The identifying request scope has been erased from the queue."); }
      }); }}>
        <p>The export covers imported Shopify customer, sale, payment and staged-order records. Review separate documents, communications and other retained systems. Send the response through a verified secure channel. A download is not fulfilment.</p>
        <label htmlFor={`${formId}-method`}>Response type</label>
        <select id={`${formId}-method`} value={method} onChange={e => setMethod(e.target.value)} disabled={busy}>
          <option value="secure_delivery">Customer data securely delivered</option><option value="no_retained_data">No retained data, response delivered</option>
        </select>
        <label htmlFor={`${formId}-reference`}>Delivery or review reference, without personal data</label>
        <input id={`${formId}-reference`} value={reference} maxLength={120} required disabled={busy} onChange={e => setReference(e.target.value)} autoComplete="off" />
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> I verified the recipient, reviewed all relevant retained systems and delivered the response securely.</label>
        <div className="form-actions"><button type="submit" disabled={busy || !confirmed || !reference.trim()}>Confirm response</button><button type="button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button></div>
      </form>}
    </article>)}
  </section>;
}
