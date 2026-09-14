"use client";

import { useId, useState } from "react";
import type { OperatingDecision } from "../server/operating-system";
import { reviewDisplayStatus, reviewIsActive, type OpportunityReview } from "../domain/opportunity-review";
import OpportunityReviewPanel, { type ReviewChange } from "./opportunity-review-panel";

type Props = {
  decisions: OperatingDecision[];
  period: { from: string; to: string } | null;
  freshness: string;
  verifiedDays: number;
  comparisonNote?: string | null;
  onAction?: (decision: OperatingDecision, review?: OpportunityReview) => void;
  onAsk?: (decision: OperatingDecision, period?: { from: string; to: string }) => void;
  onEvidence: (period?: { from: string; to: string }) => void;
  onConnections: () => void;
  onActions: () => void;
  reviews?: OpportunityReview[];
  canReview?: boolean;
  reviewLoading?: boolean;
  reviewBusy?: boolean;
  reviewError?: string;
  onRefresh?: () => void;
  onCapture?: (decision: OperatingDecision) => void;
  onReview?: (review: OpportunityReview, change: ReviewChange) => Promise<void>;
};

const categories: Record<OperatingDecision["pillar"], string> = {
  sales: "Sales & margin", money: "Cash flow", inventory: "Inventory", operations: "Operations", data: "Data quality",
};

/** Live findings and permission-filtered saved reviews share the decision engine. */
export default function DecisionWorkspace({ decisions, period, freshness, verifiedDays, comparisonNote, onAction, onAsk, onEvidence, onConnections, onActions, reviews = [], canReview = false, reviewLoading = false, reviewBusy = false, reviewError, onRefresh, onCapture, onReview }: Props) {
  const id = useId();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState("active");
  const [detailTab, setDetailTab] = useState("evidence");
  const entries = decisions.map(decision => {
    const review = reviews.find(review => review.ruleId === decision.id && review.period.from === period?.from && review.period.to === period?.to);
    return { key: review?.id ?? decision.id, decision: review?.snapshot ?? decision, review };
  });
  for (const review of reviews) if (!entries.some(entry => entry.review?.id === review.id)) entries.push({ key: review.id, decision: review.snapshot, review });
  const visible = entries.filter(({ decision, review }) => (category === "all" || decision.pillar === category)
    && `${decision.title} ${decision.decision} ${review?.task?.assignee ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
    && (view === "all" || view === "history" ? view === "all" || Boolean(review) : !review || reviewIsActive(review)));
  const selectedEntry = visible.find(item => item.key === selectedId) ?? visible[0];
  const selected = selectedEntry?.decision;
  const selectedReview = selectedEntry?.review;
  const coverage = !verifiedDays ? "Insufficient data" : freshness === "stale" ? "Delayed" : comparisonNote ? "Partial" : "Records available";

  return <section className="decision-workspace" aria-labelledby={id + "-heading"}>
    <header className="decision-workspace-heading">
      <div><p className="card-kicker">OPPORTUNITIES</p><h2 id={id + "-heading"}>Decide what needs your attention.</h2><p>Review the finding, inspect its evidence, then assign the next step.</p></div>
      <button className="secondary" type="button" onClick={onActions}>Assigned actions →</button>
    </header>
    <div className="decision-coverage">
      <span className={"decision-status " + (coverage === "Records available" ? "available" : "partial")}>{coverage}</span>
      <span>{period ? `${period.from} to ${period.to}` : "No verified reporting period"}</span>
      <span>{verifiedDays} dates with records</span>
      <button type="button" onClick={onConnections}>Review sources</button>
    </div>
    {comparisonNote && <p className="decision-coverage-note">{comparisonNote}</p>}
    {reviewError && <div className="action-update-error" role="alert">{reviewError} {onRefresh && <button type="button" onClick={onRefresh}>Retry</button>}</div>}
    <div className="decision-toolbar">
      <label>Find an opportunity<input type="search" placeholder="Search findings" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Area<select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All areas</option>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {onRefresh && <><label>Show<select value={view} onChange={event => setView(event.target.value)}><option value="active">Needs attention</option><option value="history">Saved reviews</option><option value="all">All findings</option></select></label><button type="button" className="secondary" disabled={reviewLoading || reviewBusy} onClick={onRefresh}>Refresh</button></>}
      <span role="status">{reviewLoading ? "Loading reviews…" : `${visible.length} ${visible.length === 1 ? "finding" : "findings"}`}</span>
    </div>
    {selected ? <div className="decision-explorer">
      <nav className="decision-findings" aria-label="Opportunity findings">{visible.map(({ decision: item, key, review }) => <button type="button" key={key} disabled={reviewBusy} aria-pressed={selectedEntry.key === key} aria-controls={id + "-evidence"} onClick={() => { setSelectedId(key); setDetailTab("evidence"); }}>
        <span className={"decision-priority " + item.priority}>{item.priority === "critical" ? "Urgent review" : item.priority + " priority"}</span>
        <strong>{item.title}</strong><small>{categories[item.pillar]}</small>
        <span className="review-list-state">{review ? reviewDisplayStatus(review) : "New finding"}</span>{review && <small>{review.period.from} to {review.period.to}</small>}
      </button>)}</nav>
      <article className="decision-detail" id={id + "-evidence"} aria-live="polite">
        <header><span>{categories[selected.pillar]}</span><h3>{selected.title}</h3></header>
        {selectedReview && <p className="review-snapshot-note">Saved evidence · {selectedReview.scopeLabel} · {selectedReview.period.from} to {selectedReview.period.to}. Captured {new Date(selectedReview.createdAt).toLocaleDateString()}. Current reports may have changed.</p>}
        {selectedReview && <nav className="review-detail-tabs" aria-label="Opportunity details"><button type="button" aria-pressed={detailTab === "evidence"} onClick={() => setDetailTab("evidence")}>Evidence</button><button type="button" aria-pressed={detailTab === "followup"} onClick={() => setDetailTab("followup")}>Follow-up & activity</button></nav>}
        {(!selectedReview || detailTab === "evidence") && <>
        <section><h4>What the records show</h4><ul>{selected.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></section>
        <section className="decision-next"><h4>Recommended next step</h4><p>{selected.decision}</p></section>
        <details className="decision-limitations" open={selected.missing.length > 0} key={selected.id}>
          <summary>Evidence quality & limitations</summary>
          <p>{selected.confidence.charAt(0).toUpperCase() + selected.confidence.slice(1)} evidence confidence, based on the engine’s available inputs. This is a qualitative assessment, not a probability of success.</p>
          {selected.missing.length > 0 ? <><strong>Check before acting</strong><ul>{selected.missing.map(item => <li key={item}>{item}</li>)}</ul></> : <p>No additional gaps were listed by this check. Review coverage and source totals.</p>}
          <p>A recorded change is not a causal finding or a guaranteed recoverable amount.</p>
        </details>
        </>}
        {selectedReview && onReview && <div className="review-tab-panel" hidden={detailTab !== "followup"}><OpportunityReviewPanel key={selectedReview.id + ":" + selectedReview.version} review={selectedReview} canReview={canReview} busy={reviewBusy} onSave={change => onReview(selectedReview, change)} onActions={onActions}/></div>}
        <footer className="decision-detail-actions">
          {onAction && <button className="primary" type="button" disabled={reviewBusy || reviewLoading || Boolean(reviewError)} onClick={() => selectedReview?.task ? onActions() : onAction(selected, selectedReview)}>{selectedReview?.task ? "View action" : "Create action"}</button>}
          <button className="secondary" type="button" onClick={() => onEvidence(selectedReview?.period)}>Inspect report</button>
          {onAsk && <button className="secondary" type="button" onClick={() => onAsk(selected, selectedReview?.period)}>Ask Vanteloq AI</button>}
          {canReview && !selectedReview && onCapture && <button className="secondary" type="button" disabled={reviewBusy || reviewLoading || Boolean(reviewError)} onClick={() => { setDetailTab("followup"); onCapture(selected); }}>Start review</button>}
        </footer>
        <p className="decision-followup">Assign the owner and deadline in the action form. Track progress in the Action Centre and record the outcome in your review.</p>
      </article>
    </div> : <div className="decision-empty"><h3>{entries.length ? "No findings match these filters." : "No supported opportunities yet."}</h3><p>{entries.length ? "Snoozed and closed reviews stay available under All findings." : "Connect and review source records. Findings appear when the evidence supports a check."}</p><button type="button" onClick={entries.length ? () => { setQuery(""); setCategory("all"); setView("all"); } : onConnections}>{entries.length ? "Show all findings" : "Review connections"}</button></div>}
    <details className="decision-method"><summary>How findings are prioritized</summary><p>The existing engine orders checks by severity, available evidence and freshness. These are review rules, not a business health score. Changing priorities does not place orders, move money or alter provider accounts.</p></details>
  </section>;
}
