"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { apiFetch } from "./supabase-browser";
import WorkspaceSkeleton from "./workspace-skeleton";
import SlackMessages from "./slack-messages";
import { messageLatestPageNeedsReset, reconcileMessagePage } from "../domain/collaboration";
import "./collaboration.css";

type Message = { id: number; body: string; authorName: string; authorUserId: string | null; createdAt: string };
type Directory = { members: { id: string; name: string }[]; locations: { id: string; name: string }[]; organizationWide: boolean; canManage: boolean; canPost: boolean; userId: string };
export default function CollaborationMessages({ activeLocationId = null, taskId = null, onBack, onManageIntegrations }: { activeLocationId?: string | null; taskId?: number | null; onBack?: () => void; onManageIntegrations?: () => void }) {
  const [messageSource, setMessageSource] = useState<"team" | "slack">("team");
  const sourceTabs = useRef<HTMLDivElement>(null);
  const moveSource = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "team" : event.key === "End" ? "slack" : messageSource === "team" ? "slack" : "team";
    setMessageSource(next);
    sourceTabs.current?.querySelector<HTMLButtonElement>(`#${next}-message-tab`)?.focus();
  };
  const [location, setLocation] = useState(activeLocationId ?? "");
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [sending, setSending] = useState(false);
  const [title, setTitle] = useState("Team messages"), [hasEarlier, setHasEarlier] = useState(false), [olderPending, setOlderPending] = useState(false);
  const [notice, setNotice] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const inFlight = useRef<symbol | null>(null), sendingRef = useRef(false), loaded = useRef(false), oldestKnown = useRef<number | null>(null);
  const newestRead = useRef<number | null>(null);
  const scope = `${location}:${taskId ?? ""}`;
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; }, [scope]);
  const params = useCallback((before?: number) => {
    const query = new URLSearchParams();
    if (location) query.set("location", location);
    if (taskId) query.set("task", String(taskId));
    if (before) query.set("before", String(before));
    return query.toString();
  }, [location, taskId]);
  useEffect(() => {
    const abort = new AbortController(); let active = true;
    void apiFetch(`/api/v1/collaboration/members${location ? `?location=${encodeURIComponent(location)}` : ""}`, { signal: abort.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw Error(body.error?.message || "Your team channels could not load. Try again.");
      if (!active) return; setDirectory(body);
      if (!body.organizationWide && !location && !taskId && body.locations?.[0]) setLocation(body.locations[0].id);
    }).catch(cause => { if (active && cause.name !== "AbortError") setError(cause.message); });
    return () => { active = false; abort.abort(); };
  }, [location, taskId]);
  const load = useCallback(async (before?: number, signal?: AbortSignal, reset = false) => {
    if (inFlight.current) return;
    const requestedScope = scope, request = Symbol("message-read"); inFlight.current = request;
    if (before) setOlderPending(true);
    try {
      const response = await apiFetch(`/api/v1/collaboration/messages?${params(before)}`, { signal });
      const body = await response.json();
      if (signal?.aborted || scopeRef.current !== requestedScope) return;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) { setMessages([]); setHasEarlier(false); setDirectory(null); }
        throw Error(body.error?.message || "Messages could not load. Please try again.");
      }
      const resetHistory = reset || (!before && messageLatestPageNeedsReset(newestRead.current, body.messages, Boolean(body.hasEarlier)));
      setMessages(current => reconcileMessagePage(current, body.messages, Boolean(before), Boolean(body.hasEarlier), resetHistory));
      if (before || resetHistory || !body.hasEarlier || !loaded.current || oldestKnown.current === null) setHasEarlier(body.hasEarlier);
      if (!body.messages.length || resetHistory || !body.hasEarlier && !before) oldestKnown.current = null;
      if (body.messages[0]) oldestKnown.current = Math.min(oldestKnown.current ?? Infinity, body.messages[0].id);
      if (!before) newestRead.current = body.messages.at(-1)?.id ?? null;
      setTitle(body.channel.taskTitle ? `Discussion: ${body.channel.taskTitle}` : location ? directory?.locations.find(item => item.id === location)?.name || "Location messages" : "Team messages");
      loaded.current = true; setError("");
    } catch (cause) { if (!signal?.aborted && scopeRef.current === requestedScope) setError(cause instanceof Error ? cause.message : "Messages could not load. Please try again."); }
    finally { if (inFlight.current === request) inFlight.current = null; if (scopeRef.current === requestedScope) { setLoading(false); setOlderPending(false); } }
  }, [scope, params, location, directory]);
  useEffect(() => {
    if (!directory || (!directory.organizationWide && !location && !taskId)) return;
    const abort = new AbortController();
    loaded.current = false; oldestKnown.current = null; newestRead.current = null; inFlight.current = null;
    queueMicrotask(() => { setLoading(true); setMessages([]); setError(""); void load(undefined, abort.signal); });
    const refresh = () => { if (document.visibilityState === "visible") void load(undefined, abort.signal); };
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { abort.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load, directory, location, taskId]);
  const send = async (event: FormEvent) => {
    event.preventDefault(); if (sendingRef.current || !draft.trim()) return;
    sendingRef.current = true; setSending(true); setError(""); setNotice("");
    const requestedScope = scope;
    const body = JSON.stringify({ body: draft.trim(), locationId: location || null, taskId });
    if (!attempt.current || attempt.current.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    try {
      const response = await apiFetch("/api/v1/collaboration/messages", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body });
      const payload = await response.json(); if (!response.ok) throw Error(payload.error?.message || "The message was not confirmed. Retry to avoid a duplicate.");
      if (scopeRef.current === requestedScope) { setMessages(current => current.some(item => item.id === payload.message.id) ? current : [...current, payload.message]); setDraft(""); attempt.current = null; setNotice("Message sent."); }
    } catch (cause) { if (scopeRef.current === requestedScope) setError(cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "The message was not confirmed. Your draft is preserved. Retry to avoid a duplicate."); }
    finally { sendingRef.current = false; setSending(false); }
  };
  return <div className="content collaboration-page">
    <section className="page-intro"><div><p>YOUR TEAM</p><h2>{title}</h2><span>Keep conversations beside the work they belong to.</span></div>{onBack && <button type="button" className="secondary" onClick={onBack}>Back to tasks</button>}</section>
    {!taskId && <div ref={sourceTabs} className="messages-source-tabs" role="tablist" aria-label="Message source" onKeyDown={moveSource}><button type="button" role="tab" id="team-message-tab" aria-controls="team-message-panel" aria-selected={messageSource === "team"} tabIndex={messageSource === "team" ? 0 : -1} onClick={() => setMessageSource("team")}>Team messages</button><button type="button" role="tab" id="slack-message-tab" aria-controls="slack-message-panel" aria-selected={messageSource === "slack"} tabIndex={messageSource === "slack" ? 0 : -1} onClick={() => setMessageSource("slack")}>Slack channel</button></div>}
    {messageSource === "slack" && <div id="slack-message-panel" role="tabpanel" aria-labelledby="slack-message-tab"><SlackMessages key={scope} onManage={onManageIntegrations}/></div>}
    <article id="team-message-panel" role="tabpanel" aria-labelledby={!taskId ? "team-message-tab" : undefined} hidden={messageSource !== "team"} className="card collaboration-thread">
      <div className="collaboration-toolbar">{!taskId && <label>Channel<select value={location} disabled={sending} onChange={event => { setLocation(event.target.value); setNotice(""); }}>{directory?.organizationWide && <option value="">Whole workspace</option>}{directory?.locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<button type="button" className="secondary" onClick={() => void load(undefined, undefined, true)} disabled={loading}>Refresh</button><small>Shared with authorised members of this {taskId ? "task" : "channel"}. New messages refresh every 20 seconds while visible. Refresh reloads the latest history.</small></div>
      {error && <div role="alert" className="collaboration-error"><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>}
      {loading ? <WorkspaceSkeleton compact label="Loading team messages"/> : <><div className="collaboration-history" aria-label="Team conversation">
        {hasEarlier && <button className="secondary" type="button" disabled={olderPending} onClick={() => void load(messages[0]?.id)}>{olderPending ? "Loading…" : "Earlier messages"}</button>}
        {!messages.length && <div className="empty-state"><b>Start a useful conversation.</b><span>Share an update, ask a question or agree on the next step. Task discussions are available from Tasks.</span></div>}
        {messages.map(message => <article key={message.id} className={`collaboration-message ${message.authorUserId === directory?.userId ? "is-own" : ""}`}><header><strong>{message.authorName}</strong><time dateTime={message.createdAt}>{new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt))}</time></header><p>{message.body}</p></article>)}
      </div><form className="collaboration-composer" onSubmit={send}><label htmlFor="team-message">Message<textarea id="team-message" value={draft} disabled={sending || !directory?.canPost} onChange={event => setDraft(event.target.value)} maxLength={4000} rows={3} placeholder={directory?.canPost ? "Write to your team…" : "You have read-only access to this conversation."}/></label><footer><small>Do not include passwords, payment details or unnecessary personal information.</small><button className="primary" type="submit" disabled={sending || !directory?.canPost || !draft.trim()}>{sending ? "Sending…" : "Send message"}</button></footer><p className="sr-only" role="status">{notice}</p></form></>}
    </article>
  </div>;
}
