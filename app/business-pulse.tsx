"use client";
import { useRef, useState } from "react";
import ExpandingSurface from "./expanding-surface";
import type { OwnerBriefingPriority } from "../domain/owner-briefing";

export type PulseOverview = { scope: string; period: string; metrics: { label: string; value: string; detail: string }[]; priorities: OwnerBriefingPriority[]; criticalCount: number; onFinding: (item: OwnerBriefingPriority) => void };
export default function BusinessPulse({ sourceName, coverage, syncText, syncing, needsAttention, onConnections, overview }: { sourceName: string; coverage: string; syncText: string; syncing: boolean; needsAttention: boolean; onConnections: () => void; overview?: PulseOverview }) {
  const [open, setOpen] = useState(false), triggerRef = useRef<HTMLButtonElement>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const critical = Boolean(overview?.criticalCount), review = needsAttention || critical;
  const pulseState = syncing ? "syncing" : critical ? "critical" : review ? "review" : "ready";
  const status = syncing ? "Updating source records" : critical ? `${overview!.criticalCount} critical finding${overview!.criticalCount === 1 ? "" : "s"}` : needsAttention ? "Review source coverage" : "Explore your recorded picture";
  const action = (fn: () => void) => { pendingAction.current = fn; setOpen(false); };
  const afterClose = () => { const next = pendingAction.current; pendingAction.current = null; next?.(); };
  return <>
    <button type="button" ref={triggerRef} data-pulse-state={pulseState} className={`business-pulse-control${syncing ? " is-syncing" : ""}${critical ? " is-critical" : review ? " needs-review" : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { pendingAction.current = null; setOpen(true); }}>
      <svg width="34" height="28" viewBox="0 0 40 28" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M1 15h8l4-10 7 21 6-17 4 6h9"/></svg><span><b>Business Pulse</b><small>{status}</small></span><i aria-hidden="true">↗</i>
    </button>
    <ExpandingSurface open={open} onClose={() => { pendingAction.current = null; setOpen(false); }} onAfterClose={afterClose} originRef={triggerRef} title="Business Pulse">
      <div data-pulse-state={pulseState} className={`pulse-status${critical ? " is-critical" : ""}`}><i aria-hidden="true"/><div><strong>{status}</strong><p>{syncing ? "Amounts stay unavailable until the source refresh and coverage checks finish." : syncText}</p></div></div>
      <p className="pulse-context">{overview?.scope ?? sourceName}{overview?.period ? ` · ${overview.period}` : ""}</p>
      {overview?.metrics.length ? <div className="pulse-metrics">{overview.metrics.map(metric => <article key={metric.label}><span>{metric.label}</span><strong key={metric.value}>{metric.value}</strong><small>{metric.detail}</small></article>)}</div> : <div className="pulse-empty"><b>Your operating picture starts with records.</b><p>{coverage}. Connect a source or review a file import to build the overview.</p></div>}
      <section className="pulse-attention"><h3>What needs attention</h3>{overview?.priorities.length ? overview.priorities.slice(0,3).map(item => <button type="button" key={item.id} onClick={() => action(() => overview.onFinding(item))}><span className={item.severity === "critical" ? "pulse-critical-marker" : ""} aria-hidden="true"/><span><b>{item.title}</b><small>{item.nextStep}</small></span><i aria-hidden="true">↗</i></button>) : <p>No supported finding is available. Review coverage before treating this as an all-clear.</p>}</section>
      <footer className="pulse-footer"><p>{coverage}. Successful sync alone does not confirm complete coverage.</p><button type="button" onClick={() => action(onConnections)}>Review connections</button></footer>
    </ExpandingSurface>
  </>;
}
