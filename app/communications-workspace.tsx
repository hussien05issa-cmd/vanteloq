"use client";

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";

type OperationalEvent = {
  id: string;
  eventType: "payment.settled" | "inventory.depleted" | "message.queued" | "message.sent" | "message.failed";
  aggregateType: "sale" | "inventory" | "message";
  aggregateId: string;
  sourceSystem: string;
  occurredAt: number;
  recordedAt: number;
  payload: { paymentId?: string; locationRef?: string; totalCents?: number; currency?: string; lineCount?: number };
};

type OutboundMessage = {
  id: string;
  channel: "email";
  recipient: string;
  subject: string;
  status: "held" | "queued" | "sending" | "sent" | "failed";
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
};

type InventoryProjection = { locationRef: string; sku: string; name: string; projectedQuantity: number; reorderPoint: number; updatedAt: number };
type OperationsFeed = { cursor: number; events: OperationalEvent[]; messages: OutboundMessage[]; inventory: InventoryProjection[] };

const EMPTY: OperationsFeed = { cursor: 0, events: [], messages: [], inventory: [] };

export default function CommunicationsWorkspace() {
  const [feed, setFeed] = useState<OperationsFeed>(EMPTY);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | OutboundMessage["status"]>("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const cursor = useRef(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await apiFetch(`/api/v1/operations?after=${cursor.current}`, { headers: { Accept: "application/json" }, signal });
    const body = await response.json() as OperationsFeed & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || "The communications feed is unavailable.");
    cursor.current = body.cursor;
    startTransition(() => {
      setFeed((current) => ({
        cursor: body.cursor,
        events: [...current.events, ...body.events].slice(-300),
        messages: body.messages,
        inventory: body.inventory,
      }));
      setError("");
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "The communications feed is unavailable.");
      setLoading(false);
    });
    const interval = window.setInterval(() => void refresh(controller.signal).catch(() => undefined), 8_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [refresh]);

  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const messages = useMemo(() => feed.messages.filter((message) => {
    const matchesStatus = status === "all" || message.status === status;
    const matchesQuery = !deferredQuery || `${message.subject} ${message.recipient} ${message.status}`.toLowerCase().includes(deferredQuery);
    return matchesStatus && matchesQuery;
  }), [deferredQuery, feed.messages, status]);
  const stockRisks = useMemo(() => feed.inventory.filter((item) => item.projectedQuantity <= item.reorderPoint), [feed.inventory]);

  return <div className="content communications-page">
    <header className="workspace-titlebar">
      <div><p>COMMUNICATIONS & EVENT OPERATIONS</p><h2>One inbox for messages, system events and follow-up.</h2><span>Operational notifications stay linked to the payment, inventory movement and approval that created them.</span></div>
      <div className="sync-health"><i className={error ? "error" : ""}/><span><b>{error ? "Update delayed" : "Live operational feed"}</b><small>{error || "Buffered updates every 8 seconds"}</small></span></div>
    </header>
    <section className="communication-stats">
      <article><small>MESSAGES REQUIRING REVIEW</small><b>{feed.messages.filter((message) => message.status === "held" || message.status === "failed").length}</b><span>Held messages never send without a configured provider.</span></article>
      <article><small>RECENT SYSTEM EVENTS</small><b>{feed.events.length}</b><span>Idempotent, tenant-scoped operating events.</span></article>
      <article><small>STOCK RISKS</small><b>{stockRisks.length}</b><span>Projected at or below reorder point.</span></article>
    </section>
    <section className="communications-grid">
      <article className="dense-panel inbox-panel">
        <header><div><p>OUTBOUND QUEUE</p><h3>Customer communications</h3></div><span>{messages.length} records</span></header>
        <div className="table-toolbar"><input aria-label="Search communications" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject or recipient…"/><select aria-label="Filter by delivery status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="held">Held</option><option value="queued">Queued</option><option value="sending">Sending</option><option value="sent">Sent</option><option value="failed">Failed</option></select></div>
        <div className="dense-table" role="table" aria-label="Outbound messages"><div className="dense-row dense-head" role="row"><span>Message</span><span>Recipient</span><span>Status</span><span>Updated</span></div>{loading ? <p className="table-empty">Loading verified records…</p> : !messages.length ? <p className="table-empty">No messages match this view.</p> : messages.map((message) => <div className="dense-row" role="row" key={message.id}><span><b>{message.subject}</b><small>Email · {message.attemptCount} attempts</small></span><span className="mono-cell">{message.recipient}</span><span><i className={`status-dot ${message.status}`}/>{message.status}</span><time>{new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(message.updatedAt * 1000))}</time></div>)}</div>
      </article>
      <aside className="context-rail">
        <article className="dense-panel"><header><div><p>EVENT STREAM</p><h3>What changed</h3></div></header><div className="event-stream">{feed.events.slice(-6).reverse().map((event) => <div key={event.id}><i/><span><b>{event.eventType.replaceAll(".", " ")}</b><small>{event.sourceSystem} · {event.aggregateId}</small></span><time>{new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(event.occurredAt * 1000))}</time></div>)}{!feed.events.length && <p className="table-empty">No operational events recorded.</p>}</div></article>
        <article className="dense-panel"><header><div><p>INVENTORY FOLLOW-UP</p><h3>Reorder exceptions</h3></div></header><div className="stock-exceptions">{stockRisks.slice(0, 5).map((item) => <div key={`${item.locationRef}:${item.sku}`}><span><b>{item.name}</b><small>{item.sku} · {item.locationRef}</small></span><strong>{item.projectedQuantity}</strong></div>)}{!stockRisks.length && <p className="table-empty">No projected stock risk.</p>}</div></article>
      </aside>
    </section>
  </div>;
}
