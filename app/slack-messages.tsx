"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";
import ProviderPrivacyNotice from "./provider-privacy-notice";
import { providerPrivacyAcceptance } from "../domain/provider-privacy";
import { SLACK_CONVERSATION_READ_NOTICE_VERSION } from "../domain/slack-conversations";
import WorkspaceSkeleton from "./workspace-skeleton";
import "./slack-messages.css";
import { readSlackConversationAuthorization } from "./slack-messages-reader";

type SlackSnapshot = {
  connectionId?: string | null; connected: boolean; readsMessages: boolean; requiresReconnect: boolean;
  channelName?: string | null; channelUrl?: string | null; nextReadAt?: string | null;
  messages?: { ts: string; authorId: string | null; text: string; replyCount: number }[];
  fetchedAt?: string | null; hasMore?: boolean; isLimited?: boolean;
};
const readScopes = ["incoming-webhook", "channels:read", "channels:history"] as const;
export function slackMessageTimestamp(ts: string) {
  const millis = Number(ts) * 1000;
  if (!Number.isFinite(millis) || millis <= 0) return "Time unavailable";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(millis)) + " UTC";
}
function safeSlackChannelUrl(value: string | null | undefined) {
  if (!value) return null;
  try { const url = new URL(value); return url.origin === "https://slack.com" && url.pathname === "/app_redirect" ? url.href : null; } catch { return null; }
}

export default function SlackMessages({ onManage }: { onManage?: () => void }) {
  const [snapshot, setSnapshot] = useState<SlackSnapshot | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [ownerOnly, setOwnerOnly] = useState(false), [consent, setConsent] = useState(false);
  const [now, setNow] = useState(Date.now);
  const request = useRef<AbortController | null>(null), serial = useRef(0);
  const requestRead = async (refresh = false) => {
    const generation = ++serial.current;
    request.current?.abort(); const abort = new AbortController(); request.current = abort;
    setError(""); refresh ? setBusy(true) : setLoading(true);
    try {
      const response = await apiFetch("/api/v1/integrations/slack/messages", refresh ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: snapshot?.connectionId }), signal: abort.signal } : { signal: abort.signal });
      const body = await response.json();
      if (abort.signal.aborted || serial.current !== generation) return;
      if (!response.ok) {
        if ([401, 403, 404, 409].includes(response.status)) setSnapshot(null);
        if (response.status === 403) setOwnerOnly(true);
        if (response.status === 429 && typeof body.nextReadAt === "string") setSnapshot(current => current ? { ...current, nextReadAt: body.nextReadAt } : current);
        throw Error(body.error?.message || "Slack could not load. Please try again.");
      }
      setOwnerOnly(false); setSnapshot(body);
    } catch (cause) {
      if (!abort.signal.aborted && serial.current === generation) setError(cause instanceof Error ? cause.message : "Slack could not load. Please try again.");
    } finally {
      if (!abort.signal.aborted && serial.current === generation) { setLoading(false); setBusy(false); }
    }
  };
  useEffect(() => {
    void requestRead();
    return () => { serial.current++; request.current?.abort(); };
    // The panel is remounted for each workspace scope. Provider reads are manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!snapshot?.nextReadAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot?.nextReadAt]);
  const connect = async (accepted: boolean) => {
    setConsent(false); if (!accepted) return;
    const generation = ++serial.current;
    request.current?.abort(); const abort = new AbortController(); request.current = abort;
    setBusy(true); setError("");
    try {
      const destination = await readSlackConversationAuthorization(apiFetch, { mode: "single_channel_conversations", ...providerPrivacyAcceptance(true), slackConversationReadAccepted: true, slackConversationReadNoticeVersion: SLACK_CONVERSATION_READ_NOTICE_VERSION }, abort.signal);
      if (abort.signal.aborted || serial.current !== generation) return;
      window.location.assign(destination);
    } catch (cause) { if (!abort.signal.aborted && serial.current === generation) { setError(cause instanceof Error ? cause.message : "Slack setup could not start. Please try again."); setBusy(false); } }
  };
  const next = Date.parse(snapshot?.nextReadAt || ""), waiting = Number.isFinite(next) && next > now;
  const channelUrl = safeSlackChannelUrl(snapshot?.channelUrl);
  return <section className="card slack-conversation-panel" aria-label="Slack conversations">
    <header><div><h3>{snapshot?.channelName ? `Slack · #${snapshot.channelName.replace(/^#/, "")}` : "Slack conversations"}</h3><p>A recent conversation beside your daily work. Open Slack for replies and threads.</p></div>{channelUrl && <a href={channelUrl} target="_blank" rel="noopener noreferrer">Open channel in Slack ↗</a>}</header>
    {loading ? <WorkspaceSkeleton compact label="Checking Slack connection"/> : ownerOnly ? <div className="slack-conversation-status"><b>Available to the workspace owner</b><p>External channel conversations have separate access from your team messages.</p></div> : <>
      {error && <div className="slack-conversation-status" role="alert"><b>Update unavailable</b><p>{error}</p><button type="button" className="secondary" disabled={busy} onClick={() => void requestRead()}>Check connection</button></div>}
      {snapshot?.readsMessages ? <>
        <div className="slack-conversation-toolbar"><div><small>{snapshot.fetchedAt ? `Last loaded ${slackMessageTimestamp(String(Date.parse(snapshot.fetchedAt) / 1000))}. These messages are a snapshot.` : "Messages load only when you choose Load messages."}</small><p>Up to 15 recent parent messages. Files and private conversations stay in Slack.</p></div><button type="button" className="primary" disabled={busy || waiting} onClick={() => void requestRead(true)}>{busy ? "Loading…" : waiting ? `Refresh in ${Math.ceil((next - now) / 1000)}s` : snapshot.messages ? "Refresh messages" : "Load messages"}</button></div>
        {snapshot.messages && (!snapshot.messages.length ? <div className="slack-conversation-status"><b>No readable messages in this recent page</b><p>Slack may return events, file-only posts or messages excluded by this connection. Open the channel for its full history.</p></div> : <ol className="slack-conversation-list">{snapshot.messages.map(message => <li key={message.ts}><header><strong>{message.authorId ? `Slack member ${message.authorId}` : "Slack message"}</strong><time dateTime={new Date(Number(message.ts) * 1000).toISOString()}><small>{slackMessageTimestamp(message.ts)}</small></time></header><p>{message.text}</p>{message.replyCount > 0 && <small>{message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}, read in Slack</small>}</li>)}</ol>)}
        {(snapshot.hasMore || snapshot.isLimited) && <small>Slack has more history or limits the available page. Open the channel for additional messages.</small>}
      </> : snapshot?.connected || snapshot?.requiresReconnect ? <div className="slack-conversation-status"><b>Conversation permission is not enabled</b><p>Your current Slack connection supports notifications. To add conversations, first disconnect it in Integrations and complete provider removal, then return here to choose a public channel and approve the read permissions. Disconnecting also pauses channel notifications.</p><button type="button" className="secondary" onClick={onManage} disabled={!onManage}>Manage Slack connection</button></div> : !error && <div className="slack-conversation-status"><b>Connect one public channel</b><p>Choose a channel you are authorised to share. Only you, as the workspace owner, can load its recent messages. You must invite the Vanteloq app to that channel in Slack.</p><button type="button" className="primary" disabled={busy} onClick={() => setConsent(true)}>Review Slack permissions</button></div>}
      <small>Messages are held in this open panel only. They are not saved, copied into team messages or sent to Vanteloq AI. Switching away clears this view. <a href="/privacy#financial-connections" target="_blank" rel="noopener noreferrer">Privacy and connection choices</a>.</small>
    </>}
    {consent && <ProviderPrivacyNotice provider="slack" scopes={readScopes} onComplete={accepted => void connect(accepted)}/>}
  </section>;
}
