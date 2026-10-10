"use client";
import { useState } from "react";
import { apiFetch } from "./supabase-browser";
import { POS_SYNC_CONSENT_VERSION, posSyncDataCategories } from "../domain/pos-sync-consent";
import type { ConnectorHealth } from "../domain/connector-guidance";

export type AutomaticSyncStatus = {
  configured: boolean; healthy: boolean; canManage: boolean; enabled: boolean;
  status: string; lastErrorCode: string | null; nextRunAt: string | null;
  lastFinishedAt: string | null; intervalMinutes: number;
};
export default function AutomaticSyncControl({ provider, connectionId, accountName, status, health, refresh }: {
  provider: string; connectionId: string; accountName: string; status: AutomaticSyncStatus; health?: ConnectorHealth; refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const labels: Record<string, string> = { off: "Off", paused: "Paused", queued: "Queued", running: "Syncing",
    backfilling: "Importing history", completed: "Last run completed", waiting: "Import in progress", retrying: "Retry scheduled", attention: "Needs attention" };
  const now = Date.now();
  const validDate = (value: string | null, allowFuture: boolean) => {
    const timestamp = value ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) && (allowFuture || timestamp <= now) ? new Date(timestamp) : null;
  };
  const lastFinished = validDate(status.lastFinishedAt, false);
  const nextRun = validDate(status.nextRunAt, true);
  const dateLabel = (date: Date) => `${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
  async function change() {
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/v1/integrations/schedule", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, connectionId, enabled: !status.enabled, authorizationVersion: "owner-background-sync-v1", consentAccepted: !status.enabled, consentNoticeVersion: POS_SYNC_CONSENT_VERSION }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "The sync setting could not be saved.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }
  const detail = health?.state === "reauthorize" ? "Reconnect this account before automatic or manual imports can resume."
    : !status.configured ? "Automatic updates are unavailable. Your saved records are unchanged."
    : status.enabled && !status.healthy ? "The background service is delayed. Review this account's status before requesting a manual sync."
    : status.status === "backfilling" ? "Continuing saved history in small batches. Reports stay provisional until the import finishes."
    : status.status === "retrying" ? "Automatic updates will retry at the scheduled time. Review the last completed import before relying on current results."
    : status.enabled ? `Checks are scheduled about every ${status.intervalMinutes} minutes, including when this tab is closed.`
    : "Automatically import new records and continue saved history. Reviewed sources update reports; test and unapproved sources stay excluded.";
  return <section className="automatic-sync-control" aria-label={`Automatic sync for ${accountName}`}>
    <div className="automatic-sync-heading"><strong>Automatic sync</strong><span data-active={status.enabled} data-health-tone={status.status === "completed" ? "neutral" : undefined}>{labels[status.status] ?? "Needs attention"}</span></div>
    <p>{detail}</p>
    {health && <p role="status">{health.detail}</p>}
    {lastFinished ? <small>Last run finished: <time dateTime={lastFinished.toISOString()}>{dateLabel(lastFinished)}</time></small>
      : status.status !== "off" && <small>Last run time is unavailable.</small>}
    {!status.enabled && status.canManage && <details><summary>Data access and consent</summary><p>Enabling automatic sync authorizes Vanteloq to continue reading this connected account while you are signed out. It uses {posSyncDataCategories(provider).map(value => value.toLowerCase()).join("; ")}. Pause here or disconnect the account to stop future imports. This does not approve staged data for reports.</p></details>}
    {status.enabled && (nextRun ? <small>{nextRun.getTime() < now ? "Scheduled check overdue: " : "Next scheduled check: "}<time dateTime={nextRun.toISOString()}>{dateLabel(nextRun)}</time></small>
      : <small>Next check time is unavailable.</small>)}
    {status.lastErrorCode && <small role="status">Sync needs attention: {status.lastErrorCode.toLowerCase().replaceAll("_", " ")}.</small>}
    {status.canManage && <button type="button" disabled={busy || !status.configured || (!status.enabled && health?.state === "reauthorize")} onClick={() => void change()}
      title={!status.enabled && health?.state === "reauthorize" ? "Reconnect this account before enabling automatic imports." : undefined}
      aria-label={`${status.enabled ? "Pause" : "Enable"} automatic sync for ${accountName}`}>
      {busy ? "Saving…" : status.enabled ? "Pause automatic sync" : "Enable automatic sync"}
    </button>}
    {!status.canManage && <small>The workspace owner manages automatic sync.</small>}
    {status.enabled && <small>Pausing stops future jobs. An import already running may finish its current batch.</small>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
