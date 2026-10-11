"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";
import { createCommunicationsFeed, EMPTY_OPERATIONS_FEED, readCommunicationsFeed, visibleCommunicationsSnapshot, type CommunicationsSnapshot, type OutboundMessage } from "./communications-feed";

export default function CommunicationsWorkspace({ activeLocationId }: { activeLocationId: string | null }) {
  const [snapshot, setSnapshot] = useState<CommunicationsSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | OutboundMessage["status"]>("all");
  const controller = useRef<ReturnType<typeof createCommunicationsFeed> | null>(null);
  const visible = visibleCommunicationsSnapshot(snapshot, activeLocationId);
  const feed = visible.feed ?? EMPTY_OPERATIONS_FEED;
  const error = visible.error;
  const loading = !visible.feed && visible.refreshing;
  const emptyMessage = loading ? "Loading records for this scope…" : error ? "Records are unavailable. Retry the update." : null;

  useEffect(() => {
    const source = createCommunicationsFeed({
      locationId: activeLocationId,
      read: (after, signal, scopeFingerprint) => readCommunicationsFeed(apiFetch, activeLocationId, after, signal, scopeFingerprint),
      onChange: setSnapshot, now: Date.now,
      every: (callback, milliseconds) => { const timer = window.setInterval(callback, milliseconds); return () => window.clearInterval(timer); },
    });
    controller.current = source;
    queueMicrotask(() => { void source.refresh(); });
    return () => { source.dispose(); if (controller.current === source) controller.current = null; };
  }, [activeLocationId]);

  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const messages = feed.messages.filter((message) => {
    const matchesStatus = status === "all" || message.status === status;
    const matchesQuery = !deferredQuery || `${message.subject} ${message.recipient} ${message.status}`.toLowerCase().includes(deferredQuery);
    return matchesStatus && matchesQuery;
  });
  const stockRisks = feed.inventory.filter((item) => item.projectedQuantity <= item.reorderPoint);

  return <div className="content communications-page" aria-busy={loading}>
    <header className="workspace-titlebar">
      <div><p>COMMUNICATIONS & EVENT OPERATIONS</p><h2>One inbox for messages, system events and follow-up.</h2><span>Operational notifications stay linked to the payment, inventory movement and approval that created them.</span></div>
      <div className="sync-health"><i className={error ? "error" : ""} aria-hidden="true"/><span><b role="status">{error ? "Update delayed" : loading ? "Loading operational feed" : "Recorded operational feed"}</b><small>{error || "Checks for updates every 8 seconds"}</small><small>{visible.lastSuccessfulReadAt === null ? "No successful read for this scope yet" : `Last successful read: ${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(visible.lastSuccessfulReadAt)} UTC`}</small>{error && visible.feed && <small>Showing the last successful snapshot.</small>}{error && <button type="button" disabled={visible.refreshing} onClick={() => { if (controller.current?.locationId === activeLocationId) void controller.current.refresh(); }}>{visible.refreshing ? "Retrying…" : "Retry update"}</button>}</span></div>
    </header>
    <section className="communication-stats">
      <article><small>MESSAGES REQUIRING REVIEW</small><b>{visible.feed ? feed.messages.filter((message) => message.status === "held" || message.status === "failed").length : "Not available"}</b><span>Held messages never send without a configured provider.</span></article>
      <article><small>RECENT SYSTEM EVENTS</small><b>{visible.feed ? feed.events.length : "Not available"}</b><span>Repeated updates are handled safely within this organization.</span></article>
      <article><small>STOCK RISKS</small><b>{visible.feed ? stockRisks.length : "Not available"}</b><span>Projected at or below reorder point.</span></article>
    </section>
    <section className="communications-grid">
      <article className="dense-panel inbox-panel">
        <header><div><p>OUTBOUND QUEUE</p><h3>Customer communications</h3></div><span>{visible.feed ? `${messages.length} records` : error ? "Records unavailable" : "Records pending"}</span></header>
        <div className="table-toolbar"><input aria-label="Search communications" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject or recipient…"/><select aria-label="Filter by delivery status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="held">Held</option><option value="queued">Queued</option><option value="sending">Sending</option><option value="sent">Sent</option><option value="failed">Failed</option></select></div>
        <div className="dense-table" role="table" aria-label="Outbound messages"><div className="dense-row dense-head" role="row"><span>Message</span><span>Recipient</span><span>Status</span><span>Updated</span></div>{!visible.feed ? <p className="table-empty">{emptyMessage}</p> : !messages.length ? <p className="table-empty">No messages match this view.</p> : messages.map((message) => <div className="dense-row" role="row" key={message.id}><span><b>{message.subject}</b><small>Email · {message.attemptCount} attempts</small></span><span className="mono-cell">{message.recipient}</span><span><i className={`status-dot ${message.status}`}/>{message.status}</span><time>{new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(message.updatedAt * 1000))}</time></div>)}</div>
      </article>
      <aside className="context-rail">
        <article className="dense-panel"><header><div><p>EVENT STREAM</p><h3>What changed</h3></div></header><div className="event-stream">{feed.events.slice(-6).reverse().map((event) => <div key={event.id}><i/><span><b>{event.eventType.replaceAll(".", " ")}</b><small>{event.sourceSystem} · {event.aggregateId}</small></span><time>{new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(event.occurredAt * 1000))}</time></div>)}{!feed.events.length && <p className="table-empty">{visible.feed ? "No operational events recorded." : emptyMessage}</p>}</div></article>
        <article className="dense-panel"><header><div><p>INVENTORY FOLLOW-UP</p><h3>Reorder exceptions</h3></div></header><div className="stock-exceptions">{stockRisks.slice(0, 5).map((item) => <div key={`${item.locationRef}:${item.sku}`}><span><b>{item.name}</b><small>{item.sku} · {item.locationRef}</small></span><strong>{item.projectedQuantity}</strong></div>)}{!stockRisks.length && <p className="table-empty">{visible.feed ? "No projected stock risk." : emptyMessage}</p>}</div></article>
      </aside>
    </section>
  </div>;
}
