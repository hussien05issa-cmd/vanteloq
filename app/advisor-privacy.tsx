"use client";

import { useState } from "react";

type SavedChat = { id: string; createdAt: number; updatedAt: number };
type Props = { fetcher: typeof fetch; disabled: boolean; onDeleted: (id: string | null) => void };

export default function AdvisorPrivacy({ fetcher, disabled, onDeleted }: Props) {
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(""), [hasMore, setHasMore] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  async function load() {
    setOpen(true); setBusy(true); setNotice("");
    try {
      const response = await fetcher("/api/v1/advisor/conversations");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Saved chats could not be loaded.");
      setChats(payload.conversations); setHasMore(payload.hasMore);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Try again shortly."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setNotice("");
    try {
      const all = id === "all";
      const response = await fetcher(all ? "/api/v1/advisor/conversations" : "/api/v1/advisor/chat", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(all ? { confirmDeleteAll: true } : { conversationId: id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Deletion failed. Your saved chats have not been confirmed deleted.");
      onDeleted(all ? null : id); setConfirm(null);
      await load(); setNotice(all ? "Your saved chats were deleted from this workspace." : "Chat deleted.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Deletion failed. Try again shortly."); }
    finally { setBusy(false); }
  }
  return <div className="ai-saved-chats">
    <button type="button" title={disabled || busy ? "Wait for the current request to finish." : undefined} disabled={disabled || busy} aria-expanded={open} onClick={() => open ? setOpen(false) : void load()}>{open ? "Hide saved chats" : "Manage saved chats"}</button>
    {open && <div><p>Only your chats in this workspace. Dates identify saved chats without exposing old question content.</p>
      {busy && <p role="status">Updating saved chats…</p>}
      {!busy && !chats.length && !notice && <p>No saved chats.</p>}
      <ul>{chats.map(chat => <li key={chat.id}><time dateTime={new Date(chat.updatedAt).toISOString()}>{new Date(chat.updatedAt).toLocaleString()}</time><button type="button" title={disabled || busy ? "Wait for the current request to finish." : undefined} disabled={disabled || busy} onClick={() => setConfirm(chat.id)}>Delete</button></li>)}</ul>
      {hasMore && <p>Showing the latest 50. Delete entries and refresh to see older chats.</p>}
      <div className="ai-privacy-actions"><button type="button" title={disabled || busy ? "Wait for the current request to finish." : undefined} disabled={disabled || busy} onClick={() => void load()}>Refresh</button>{chats.length > 0 && <button type="button" title={disabled || busy ? "Wait for the current request to finish." : undefined} disabled={disabled || busy} onClick={() => setConfirm("all")}>Delete all saved chats</button>}</div>
      {confirm && <div className="ai-delete-confirm" role="group" aria-label="Confirm chat deletion"><p>{confirm === "all" ? "Permanently delete all your saved AI chats in this workspace?" : "Permanently delete this saved chat?"} This cannot be undone. Provider safety logs and managed backups follow their own retention periods.</p><button type="button" title={disabled || busy ? "Wait for the current request to finish." : undefined} disabled={disabled || busy} onClick={() => void remove(confirm)}>Confirm deletion</button><button type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button></div>}
    </div>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
