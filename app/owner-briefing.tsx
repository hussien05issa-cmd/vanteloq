"use client";

import { useId, useState } from "react";
import type { OwnerBriefing, OwnerBriefingPriority } from "../domain/owner-briefing";
import "./owner-briefing.css";

type Props = {
  briefing: OwnerBriefing;
  scopeLabel?: string;
  sourcePeriod?: { from: string; to: string } | null;
  hoursBasis?: string;
  onEvidence: (item: OwnerBriefingPriority) => void;
  onAction?: (item: OwnerBriefingPriority) => void;
  onAsk?: (item: OwnerBriefingPriority) => void;
  onReview?: () => void;
  onSettings?: () => void;
  expanded?: boolean;
};

function stamp(value: string | null, timeZone: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Update time not supplied";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timeZone || "UTC" }).format(new Date(value));
}

/** Presents authorized server findings. It never calculates new financial facts. */
export default function OwnerBriefingPanel({ briefing, scopeLabel = "All permitted locations", sourcePeriod, hoursBasis, onEvidence, onAction, onAsk, onReview, onSettings, expanded = false }: Props) {
  const id = useId();
  const [showAll, setShowAll] = useState(expanded);
  const topPriorities = briefing.priorities.filter((item, index) => index < 3 || item.severity === "critical");
  const visible = showAll ? briefing.priorities : topPriorities;
  return <section className="owner-briefing" aria-labelledby={`${id}-title`}>
    <header className="owner-briefing-heading">
      <div><p className="owner-briefing-eyebrow">YOUR DAILY BRIEF <span>{briefing.schedule.localTime || "Time not configured"}{briefing.schedule.timeZone ? ` · ${briefing.schedule.timeZone.replaceAll("_", " ")}` : ""}</span></p><h2 id={`${id}-title`}>{briefing.title}</h2><p>{briefing.summary}</p></div>
      <span className={`owner-briefing-count${briefing.criticalCount ? " is-critical" : ""}`}>{briefing.criticalCount ? `${briefing.criticalCount} critical` : `${briefing.totalCount} to review`}</span>
    </header>
    <div className="owner-briefing-context"><span>{scopeLabel}</span>{sourcePeriod && <span>Evidence window: {sourcePeriod.from} to {sourcePeriod.to}</span>}<span>Prepared {stamp(briefing.generatedAt, briefing.schedule.timeZone)}</span></div>
    {briefing.criticalCount > 0 && <p className="owner-critical-alert" role="alert"><strong>Financial attention required.</strong> Review the critical findings below before committing more cash. A recorded warning is not an approval to pay or change your accounts.</p>}
    <div className="owner-briefing-priorities">{visible.map((item, index) => <article className={`owner-briefing-item severity-${item.severity}`} key={item.id}>
      <details className="owner-priority-detail" open={expanded || index === 0 || item.severity === "critical"}>
      <summary className="owner-priority-summary"><span className="owner-briefing-rank" aria-hidden="true">{item.rank}</span><span className="owner-briefing-item-heading"><span className="owner-priority-title">{item.title}</span><span>{item.severity === "critical" ? "Critical" : item.severity === "high" ? "Review first" : "Review"}</span></span><span className="owner-priority-toggle" aria-hidden="true">⌄</span></summary>
      <div className="owner-briefing-item-body"><p>{item.detail}</p><p className="owner-briefing-next"><b>Next step</b> {item.nextStep}</p>
        <div className="owner-briefing-actions"><button type="button" className="owner-evidence-button" onClick={() => onEvidence(item)}>Review records <span aria-hidden="true">↗</span></button>{onAction && <button type="button" onClick={() => onAction(item)}>Create an action</button>}{onAsk && <button type="button" onClick={() => onAsk(item)}>Explain with AI</button>}</div>
        <details className="owner-briefing-evidence"><summary>Why this is here</summary><dl>{item.evidence.map((evidence, index) => <div key={index}><dt>{evidence.label}</dt><dd>{String(evidence.value)}<small>{evidence.source}{evidence.asOf ? ` · ${stamp(evidence.asOf, briefing.schedule.timeZone)}` : ""}</small></dd></div>)}</dl></details>
      </div>
      </details>
    </article>)}</div>
    {!visible.length && <div className="owner-briefing-empty"><h3>Start with a reliable operating picture.</h3><p>No supported exception is available in the current records. This does not mean every balance or obligation has been checked.</p></div>}
    {briefing.priorities.length > topPriorities.length && <button type="button" className="owner-briefing-more" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? "Show top priorities" : `Show all ${briefing.priorities.length} priorities`}</button>}
    <details className="owner-briefing-checklist" open={expanded}><summary>{briefing.schedule.phase === "closing" ? "Before you finish the day" : briefing.schedule.phase === "opening" ? "Before the first sale" : "Your next checks"}</summary><ol>{briefing.checklist.map(item => <li key={item}>{item}</li>)}</ol><p>These are suggested checks. They are not marked complete automatically.</p>{hoursBasis && <p>{hoursBasis}</p>}</details>
    <footer className="owner-briefing-footer"><span>{briefing.boundary}</span><div>{onReview && <button type="button" onClick={onReview}>Review actions & outcomes</button>}{onSettings && <button type="button" onClick={onSettings}>Business hours & settings</button>}</div></footer>
    {briefing.schedule.reason && <p className="owner-briefing-note">{briefing.schedule.reason}</p>}
  </section>;
}
