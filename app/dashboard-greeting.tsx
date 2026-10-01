"use client";

import { useEffect, useState } from "react";

export function greetingForHour(hour: number | null) {
  if (hour == null) return "Welcome back";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function greetingName(name: string) {
  const value = name.trim();
  return !value || /@/.test(value) || /^(account owner|team member)$/i.test(value)
    ? ""
    : value.split(/\s+/)[0];
}

export function syncLabel(value: string | null, now: number | null) {
  if (!value) return "No sync yet";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || (now != null && timestamp > now + 60_000)) return "Check sync time";
  if (now == null) return "Last sync recorded";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "Last sync just now";
  if (minutes < 60) return `Last sync ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  return `Last sync ${new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp))}`;
}

export default function DashboardGreeting({ accountName = "", sourceName, latestBusinessDate, lastSuccessfulSyncAt, needsAttention, onConnections, syncing = false }: {
  accountName?: string; sourceName: string; latestBusinessDate: string | null; lastSuccessfulSyncAt: string | null;
  needsAttention: boolean; syncing?: boolean; onConnections: () => void;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const frame = requestAnimationFrame(update);
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { cancelAnimationFrame(frame); clearInterval(interval); window.removeEventListener("focus", update); };
  }, []);
  const firstName = greetingName(accountName);
  const coverage = latestBusinessDate
    ? `Records through ${new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${latestBusinessDate}T00:00:00Z`))}`
    : "Connect a source to get started";
  return <section className="dashboard-greeting" aria-label="Your business overview">
    <div className="dashboard-greeting-copy">
      <div className="dashboard-greeting-title">
        {/* Static brand artwork is served directly by the Sites asset cache. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/vantatalk-greeting-smile.png" alt="" width={36} height={36}/>
        <h2>{greetingForHour(now?.getHours() ?? null)}{firstName ? `, ${firstName}` : ""}.</h2>
      </div>
      <p>Here’s your business at a glance.</p>
      <span className="dashboard-record-coverage">{coverage}{latestBusinessDate ? ` · ${sourceName}` : ""}</span>
    </div>
    <details className={`business-pulse${syncing?" is-syncing":""}`}>
      <summary><svg key={lastSuccessfulSyncAt} width="34" height="28" viewBox="0 0 40 28" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M1 15h8l4-10 7 21 6-17 4 6h9"/></svg><span><b>Business Pulse</b><small>Your business, in focus.</small></span><i aria-hidden="true">⌄</i></summary>
      <div><b>{syncing?"Updating your records…":needsAttention?"A connection needs attention":syncLabel(lastSuccessfulSyncAt,now?.getTime()??null)}</b><p>{coverage}{latestBusinessDate?` · ${sourceName}`:""}.</p><p>A successful sync does not confirm complete coverage. Inspect source records before acting.</p><button type="button" onClick={onConnections}>Review Connections</button></div>
    </details>
  </section>;
}
