"use client";
import { useState } from "react";
import { apiFetch } from "./supabase-browser";

export type AutomaticSyncStatus = {
  configured: boolean; healthy: boolean; canManage: boolean; enabled: boolean;
  status: string; lastErrorCode: string | null; nextRunAt: string | null;
  lastFinishedAt: string | null; intervalMinutes: number;
};
export default function AutomaticSyncControl({ provider, connectionId, accountName, status, refresh }: {
  provider: string; connectionId: string; accountName: string; status: AutomaticSyncStatus; refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const labels: Record<string, string> = { off: "Off", paused: "Paused", queued: "Queued", running: "Syncing",
    backfilling: "Importing history", completed: "Up to date", waiting: "Import in progress", retrying: "Retry scheduled", attention: "Needs attention" };
  async function change() {
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/v1/integrations/schedule", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, connectionId, enabled: !status.enabled, authorizationVersion: "owner-background-sync-v1" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "The sync setting could not be saved.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }
  const detail = !status.configured ? "Background service is being activated."
    : status.enabled && !status.healthy ? "The background service is delayed. Manual sync remains available."
    : status.status === "backfilling" ? "Continuing saved history in small batches. Reports stay provisional until the import finishes."
    : status.enabled ? `Refreshes about every ${status.intervalMinutes} minutes, including when this tab is closed.`
    : "Automatically import new records and continue saved history. Reviewed sources update reports; test and unapproved sources stay excluded.";
  return <section className="automatic-sync-control" aria-label={`Automatic sync for ${accountName}`}>
    <div className="automatic-sync-heading"><strong>Automatic sync</strong><span data-active={status.enabled}>{labels[status.status] ?? "Needs attention"}</span></div>
    <p>{detail}</p>
    {status.enabled && status.nextRunAt && <small>Next check: {new Date(status.nextRunAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>}
    {status.lastErrorCode && <small role="status">Sync needs attention: {status.lastErrorCode.toLowerCase().replaceAll("_", " ")}.</small>}
    {status.canManage && <button type="button" disabled={busy || !status.configured} onClick={() => void change()}
      aria-label={`${status.enabled ? "Pause" : "Enable"} automatic sync for ${accountName}`}>
      {busy ? "Saving…" : status.enabled ? "Pause automatic sync" : "Enable automatic sync"}
    </button>}
    {!status.canManage && <small>The workspace owner manages automatic sync.</small>}
    {status.enabled && <small>Pausing stops future jobs. An import already running may finish its current batch.</small>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

