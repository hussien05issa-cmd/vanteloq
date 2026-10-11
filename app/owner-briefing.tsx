"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { OwnerBriefing, OwnerBriefingCategory, OwnerBriefingPriority } from "../domain/owner-briefing";
import WorkspaceIcon from "./workspace-icon";
import "./owner-briefing.css";

export type OwnerBriefingSourceStatus = {
  state: "loading" | "partial" | "stale" | "error";
  message: string;
};
type PriorityAction = "evidence" | "action" | "ask";
// Existing navigation callbacks may return an ignored value; async workflows
// can return a Promise so this view retains a truthful pending/recovery state.
type PriorityCallback = (item: OwnerBriefingPriority) => unknown;

type Props = {
  briefing: OwnerBriefing;
  scopeLabel?: string;
  sourcePeriod?: { from: string; to: string } | null;
  hoursBasis?: string;
  onEvidence: PriorityCallback;
  onAction?: PriorityCallback;
  onAsk?: PriorityCallback;
  onReview?: () => void;
  onSettings?: () => void;
  sourceStatus?: OwnerBriefingSourceStatus;
  onRetry?: () => void;
  expanded?: boolean;
  selectedPriority?: { id: string; request: number };
};

function stamp(value: string | null, timeZone: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Update time not supplied";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timeZone || "UTC" }).format(new Date(value));
}

const categoryIcons: Record<OwnerBriefingCategory, string> = { cash: "Banking", payables: "Bills", receivables: "Invoicing", sales: "Sales", inventory: "Inventory", operations: "Operations", data: "Data Quality" };
const categoryLabels: Record<OwnerBriefingCategory, string> = { cash: "Cash", payables: "Bills", receivables: "Invoices", sales: "Sales", inventory: "Inventory", operations: "Operations", data: "Data quality" };
const actionLabels: Record<PriorityAction, string> = { evidence: "Review records", action: "Create an action", ask: "Explain with AI" };

function sourceDate(item: OwnerBriefingPriority, timeZone: string | null) {
  const dates = [...new Set(item.evidence.map(evidence => evidence.asOf))];
  if (dates.length === 1 && dates[0]) return `Source dated ${stamp(dates[0], timeZone)}${/^\d{4}-\d{2}-\d{2}$/.test(dates[0]) ? "" : ` (${timeZone || "UTC"})`}`;
  if (dates.some(date => !date)) return dates.every(date => !date) ? "Source date not supplied" : "Some source dates not supplied";
  return "Sources have different dates";
}

function sourceName(item: OwnerBriefingPriority) {
  const sources = [...new Set(item.evidence.map(evidence => evidence.source))];
  return sources.length === 1 ? sources[0] : `${sources.length} recorded sources`;
}

/** Selection belongs to the reviewed scope and can be requested again after closing. */
export function useBriefingSelection(scope: string, priorities: readonly OwnerBriefingPriority[]) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [previousScope, setPreviousScope] = useState(scope);
  const [selectedPriority, setSelectedPriority] = useState<{ id: string; request: number }>();
  if (previousScope !== scope) { setPreviousScope(scope); setSelectedPriority(undefined); }
  const onFinding = (item: OwnerBriefingPriority) => {
    if (!priorities.some(priority => priority.id === item.id)) return;
    if (detailsRef.current) detailsRef.current.open = true;
    setSelectedPriority(current => ({ id: item.id, request: (current?.request ?? 0) + 1 }));
  };
  return { detailsRef, selectedPriority, onFinding };
}

/** Presents authorized server findings. It never calculates new financial facts. */
export default function OwnerBriefingPanel({ briefing, scopeLabel = "All permitted locations", sourcePeriod, hoursBasis, onEvidence, onAction, onAsk, onReview, onSettings, sourceStatus, onRetry, expanded = false, selectedPriority }: Props) {
  const id = useId();
  const selectedSummary = useRef<HTMLElement>(null);
  const [showAll, setShowAll] = useState(expanded);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const pendingActions = useRef(new Set<string>());
  const [failed, setFailed] = useState<{ id: string; kind: PriorityAction } | null>(null);
  const topPriorities = briefing.priorities.filter((item, index) => index < 3 || item.severity === "critical");
  const selectedId = briefing.priorities.some(item => item.id === selectedPriority?.id) ? selectedPriority?.id : undefined;
  const visible = showAll ? briefing.priorities : briefing.priorities.filter(item => topPriorities.includes(item) || item.id === selectedId);
  const loadingEmpty = sourceStatus?.state === "loading" && !briefing.priorities.length;
  const callbacks = { evidence: onEvidence, action: onAction, ask: onAsk };
  const runAction = async (kind: PriorityAction, item: OwnerBriefingPriority) => {
    const callback = callbacks[kind];
    if (!callback) return;
    const key = `${item.id}:${kind}`;
    if (pendingActions.current.has(key)) return;
    pendingActions.current.add(key);
    setFailed(null);
    try {
      const result = callback(item);
      if (result && (typeof result === "object" || typeof result === "function") && "then" in result && typeof result.then === "function") { setPending(current => new Set([...current, key])); await result; }
    } catch {
      // Provider, database and permission errors stay in the owning workflow.
      // Retain the reviewed finding here without exposing internal error strings.
      setFailed({ id: item.id, kind });
    } finally { pendingActions.current.delete(key); setPending(current => { if (!current.has(key)) return current; const remaining = new Set(current); remaining.delete(key); return remaining; }); }
  };
  useEffect(() => {
    if (!selectedId) return;
    const article = selectedSummary.current?.closest("article");
    article?.querySelectorAll("details").forEach(detail => { detail.open = true; });
    selectedSummary.current?.focus({ preventScroll: true });
    selectedSummary.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [selectedId, selectedPriority?.request]);
  return <section className="owner-briefing" aria-labelledby={`${id}-title`} aria-busy={sourceStatus?.state === "loading" ? true : undefined}>
    <header className="owner-briefing-heading">
      <div><p className="owner-briefing-eyebrow">YOUR DAILY BRIEF <span>{briefing.schedule.localTime || "Time not configured"}{briefing.schedule.timeZone ? ` · ${briefing.schedule.timeZone.replaceAll("_", " ")}` : ""}</span></p><h2 id={`${id}-title`}>{briefing.title}</h2><p>{loadingEmpty ? "Preparing your priorities from the permitted records." : briefing.summary}</p></div>
      {!loadingEmpty && <span className={`owner-briefing-count${briefing.criticalCount ? " is-critical" : ""}`}>{briefing.criticalCount ? `${briefing.criticalCount} critical` : `${briefing.totalCount} to review`}</span>}
    </header>
    <div className="owner-briefing-context"><span>{scopeLabel}</span>{sourcePeriod && <span>Evidence window: {sourcePeriod.from} to {sourcePeriod.to}</span>}<span>Prepared {stamp(briefing.generatedAt, briefing.schedule.timeZone)}</span></div>
    {sourceStatus && <div className={`owner-briefing-source-state state-${sourceStatus.state}`} role={sourceStatus.state === "error" ? "alert" : "status"}><WorkspaceIcon name={sourceStatus.state === "loading" ? "Refresh" : "Data Quality"}/><div><strong>{sourceStatus.state === "loading" ? "Refreshing records" : sourceStatus.state === "error" ? "Records need another check" : sourceStatus.state === "stale" ? "Earlier records are displayed" : "Some records are missing"}</strong><p>{sourceStatus.message}</p></div>{onRetry && sourceStatus.state !== "loading" && <button type="button" onClick={onRetry}>Review source status</button>}</div>}
    {briefing.criticalCount > 0 && <p className="owner-critical-alert" role="alert"><strong>Critical items need your review.</strong> Open each finding to inspect its evidence and next step before making a financial commitment.</p>}
    {briefing.excludedCount > 0 && <p className="owner-briefing-coverage">{briefing.excludedCount} supplied {briefing.excludedCount === 1 ? "item was" : "items were"} excluded because of duplicates or insufficient recorded evidence. This review covers the supported findings below.</p>}
    {loadingEmpty && <div className="owner-briefing-loading" aria-hidden="true">{[0, 1, 2].map(row => <div key={row}><i/><span><i/><i/></span></div>)}</div>}
    <div className="owner-briefing-priorities">{visible.map(item => <article className={`owner-briefing-item severity-${item.severity}`} key={item.id} data-briefing-priority={item.id}>
      <details className="owner-priority-detail" open={expanded || item.id === selectedId}>
      <summary className="owner-priority-summary" ref={item.id === selectedId ? selectedSummary : undefined}><span className="owner-priority-icon"><WorkspaceIcon name={categoryIcons[item.category]}/></span><span className="owner-briefing-item-heading"><span className="owner-priority-title">{item.title}</span><small className="owner-priority-preview"><span>{item.evidence[0]?.label}</span><strong>{item.evidence[0]?.value}</strong></small><small className="owner-priority-provenance">{categoryLabels[item.category]} · {sourceName(item)} · {sourceDate(item, briefing.schedule.timeZone)}</small></span><span className="owner-priority-severity">{item.severity === "critical" ? "Critical" : item.severity === "high" ? "Review first" : "Review"}</span><span className="owner-priority-toggle" aria-hidden="true">⌄</span></summary>
      <div className="owner-briefing-item-body"><p>{item.detail}</p><p className="owner-briefing-next"><b>Next step</b> {item.nextStep}</p>
        <div className="owner-briefing-actions">{(["evidence", "action", "ask"] as const).filter(kind => callbacks[kind]).map(kind => <button key={kind} type="button" className={kind === "evidence" ? "owner-evidence-button" : undefined} disabled={pending.has(`${item.id}:${kind}`)} onClick={() => void runAction(kind, item)}>{pending.has(`${item.id}:${kind}`) ? "Opening…" : actionLabels[kind]}{kind === "evidence" && <span aria-hidden="true"> ↗</span>}</button>)}</div>
        {(["evidence", "action", "ask"] as const).some(kind => pending.has(`${item.id}:${kind}`)) && <p className="owner-priority-pending" role="status">Opening the selected step with this finding&apos;s evidence.</p>}
        {failed?.id === item.id && <div className="owner-priority-recovery" role="alert"><p>{actionLabels[failed.kind]} could not open. Your finding and evidence are still here.</p>{callbacks[failed.kind] && <button type="button" onClick={() => void runAction(failed.kind, item)}>Try again</button>}</div>}
        <details className="owner-briefing-evidence" open={item.id === selectedId}><summary>Why this is here</summary><dl>{item.evidence.map((evidence, index) => <div key={index}><dt>{evidence.label}</dt><dd><span className="owner-evidence-value">{String(evidence.value)}</span><small>{evidence.source}{evidence.asOf ? <> · <time dateTime={evidence.asOf} title={evidence.asOf}>{stamp(evidence.asOf, briefing.schedule.timeZone)}</time></> : " · Source date not supplied"}</small></dd></div>)}</dl></details>
      </div>
      </details>
    </article>)}</div>
    {!visible.length && !loadingEmpty && <div className="owner-briefing-empty"><WorkspaceIcon name="Data Quality"/><div><h3>{sourceStatus?.state === "error" ? "Review the connection before relying on this briefing." : "Start with a reliable operating picture."}</h3><p>No supported exception is available in the current records. This does not mean every balance or obligation has been checked.</p>{onRetry && !sourceStatus && <button type="button" onClick={onRetry}>Review source status</button>}</div></div>}
    {briefing.priorities.length > topPriorities.length && <button type="button" className="owner-briefing-more" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? "Show top priorities" : `Show all ${briefing.priorities.length} priorities`}</button>}
    {briefing.omittedCount > 0 && <p className="owner-briefing-coverage">{briefing.omittedCount} additional recorded {briefing.omittedCount === 1 ? "item is" : "items are"} available in the source workspaces. This briefing presents the highest priorities.</p>}
    <details className="owner-briefing-checklist" open={expanded}><summary>{briefing.schedule.phase === "closing" ? "Before you finish the day" : briefing.schedule.phase === "opening" ? "Before the first sale" : "Your next checks"}</summary><ol>{briefing.checklist.map(item => <li key={item}>{item}</li>)}</ol><p>These are suggested checks. They are not marked complete automatically.</p>{hoursBasis && <p>{hoursBasis}</p>}</details>
    <footer className="owner-briefing-footer"><span>{briefing.boundary}</span><div>{onReview && <button type="button" onClick={onReview}>Review actions & outcomes</button>}{onSettings && <button type="button" onClick={onSettings}>Business hours & settings</button>}</div></footer>
    {briefing.schedule.reason && <p className="owner-briefing-note">{briefing.schedule.reason}</p>}
  </section>;
}
