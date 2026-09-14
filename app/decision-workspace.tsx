"use client";

import { useId, useState } from "react";
import type { OperatingDecision } from "../server/operating-system";

type Props = {
  decisions: OperatingDecision[];
  period: { from: string; to: string } | null;
  freshness: string;
  verifiedDays: number;
  comparisonNote?: string | null;
  onAction?: (decision: OperatingDecision) => void;
  onAsk?: (decision: OperatingDecision) => void;
  onEvidence: () => void;
  onConnections: () => void;
  onActions: () => void;
};

const categories: Record<OperatingDecision["pillar"], string> = {
  sales: "Sales & margin", money: "Cash flow", inventory: "Inventory", operations: "Operations", data: "Data quality",
};

/** Uses the existing permission-filtered decision engine. No second opportunity store. */
export default function DecisionWorkspace({ decisions, period, freshness, verifiedDays, comparisonNote, onAction, onAsk, onEvidence, onConnections, onActions }: Props) {
  const id = useId();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visible = decisions.filter(item => (category === "all" || item.pillar === category)
    && `${item.title} ${item.decision}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find(item => item.id === selectedId) ?? visible[0];
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
    <div className="decision-toolbar">
      <label>Find an opportunity<input type="search" placeholder="Search findings" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Area<select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All areas</option>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <span role="status">{visible.length} {visible.length === 1 ? "finding" : "findings"}</span>
    </div>
    {selected ? <div className="decision-explorer">
      <nav className="decision-findings" aria-label="Opportunity findings">{visible.map(item => <button type="button" key={item.id} aria-pressed={selected.id === item.id} aria-controls={id + "-evidence"} onClick={() => setSelectedId(item.id)}>
        <span className={"decision-priority " + item.priority}>{item.priority === "critical" ? "Urgent review" : item.priority + " priority"}</span>
        <strong>{item.title}</strong><small>{categories[item.pillar]}</small>
      </button>)}</nav>
      <article className="decision-detail" id={id + "-evidence"} aria-live="polite">
        <header><span>{categories[selected.pillar]}</span><h3>{selected.title}</h3></header>
        <section><h4>What the records show</h4><ul>{selected.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></section>
        <section className="decision-next"><h4>Recommended next step</h4><p>{selected.decision}</p></section>
        <details className="decision-limitations" open={selected.missing.length > 0} key={selected.id}>
          <summary>Evidence quality & limitations</summary>
          <p>{selected.confidence.charAt(0).toUpperCase() + selected.confidence.slice(1)} evidence confidence, based on the engine’s available inputs. This is a qualitative assessment, not a probability of success.</p>
          {selected.missing.length > 0 ? <><strong>Check before acting</strong><ul>{selected.missing.map(item => <li key={item}>{item}</li>)}</ul></> : <p>No additional gaps were listed by this check. Review coverage and source totals.</p>}
          <p>A recorded change is not a causal finding or a guaranteed recoverable amount.</p>
        </details>
        <footer className="decision-detail-actions">
          {onAction && <button className="primary" type="button" onClick={() => onAction(selected)}>Create action</button>}
          <button className="secondary" type="button" onClick={onEvidence}>Inspect report</button>
          {onAsk && <button className="secondary" type="button" onClick={() => onAsk(selected)}>Ask Vanteloq AI</button>}
        </footer>
        <p className="decision-followup">Assign the owner and deadline in the action form. Track progress in the Action Centre and record a later outcome in the Decision Journal.</p>
      </article>
    </div> : <div className="decision-empty"><h3>{decisions.length ? "No findings match these filters." : "No supported opportunities yet."}</h3><p>{decisions.length ? "Try another area or search term." : "Connect and review source records. Findings appear when the evidence supports a check."}</p><button type="button" onClick={decisions.length ? () => { setQuery(""); setCategory("all"); } : onConnections}>{decisions.length ? "Clear filters" : "Review connections"}</button></div>}
    <details className="decision-method"><summary>How findings are prioritized</summary><p>The existing engine orders checks by severity, available evidence and freshness. These are review rules, not a business health score. Changing priorities does not place orders, move money or alter provider accounts.</p></details>
  </section>;
}
