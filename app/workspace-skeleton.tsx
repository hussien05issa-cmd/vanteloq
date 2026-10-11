import type { DashboardPreferences } from "../domain/dashboard-preferences";
import "./workspace-skeleton.css";

type SkeletonProps = {
  label?: string;
  compact?: boolean;
  variant?: "records" | "overview";
  heading?: boolean;
  overview?: Pick<DashboardPreferences, "widgets" | "sections">;
  summary?: boolean;
};

const standardWidgets = Array.from({ length: 4 }, (_, index) => ({ id: String(index), size: "standard" as const, visible: true }));

function Placeholder({ className = "" }: { className?: string }) {
  return <i className={`skeleton-placeholder ${className}`}/>;
}

function RecordRows({ count = 3 }: { count?: number }) {
  return <div className="skeleton-data-rows">{Array.from({ length: count }, (_, index) => <div key={index}><Placeholder/><Placeholder/><Placeholder/></div>)}</div>;
}

function OverviewShape({ compact, heading, overview, summary }: SkeletonProps) {
  const widgets = (overview?.widgets ?? standardWidgets).filter(widget => widget.visible);
  const sections = overview?.sections ?? { needsAttention: true, collections: true, financialDetail: true };
  return <div className="skeleton-overview-shape" aria-hidden="true">
    {heading && <div className="skeleton-overview-heading"><div><Placeholder className="skeleton-title"/><Placeholder/></div><div className="skeleton-control-group"><Placeholder/><Placeholder/></div></div>}
    {widgets.length ? <div className="skeleton-overview-metrics">{widgets.map(widget => <div className={`skeleton-metric-card size-${widget.size}`} key={widget.id}><Placeholder className="skeleton-label"/><Placeholder className="skeleton-amount"/><div className="skeleton-metric-meta"><Placeholder/><Placeholder/></div><Placeholder className="skeleton-source"/></div>)}</div> : <div className="skeleton-panel skeleton-no-metrics"><Placeholder/></div>}
    <div className={`skeleton-overview-workbench${compact ? " skeleton-overview-compact" : ""}`}>
      {widgets.length > 0 && <div className="skeleton-panel skeleton-trend-panel"><Placeholder className="skeleton-panel-title"/><Placeholder className="skeleton-panel-subtitle"/><div className="skeleton-plot"/><Placeholder className="skeleton-source-link"/></div>}
      {!compact && <>
        <div className="skeleton-panel skeleton-goals-panel"><Placeholder className="skeleton-panel-title"/><Placeholder className="skeleton-panel-subtitle"/><div className="skeleton-goals-body"><div className="skeleton-rings"/><div className="skeleton-goal-rows">{[0, 1, 2].map(index => <div key={index}><Placeholder/><Placeholder/></div>)}</div></div><Placeholder className="skeleton-source-link"/></div>
        {sections.needsAttention && <div className="skeleton-panel skeleton-attention-panel"><Placeholder className="skeleton-panel-title"/>{[0, 1, 2].map(index => <div className="skeleton-attention-row" key={index}><Placeholder className="skeleton-icon"/><div><Placeholder/><Placeholder/></div><Placeholder className="skeleton-action"/></div>)}</div>}
        <div className="skeleton-panel skeleton-advisor-panel"><div className="skeleton-advisor-heading"><Placeholder className="skeleton-icon"/><Placeholder className="skeleton-panel-title"/></div><Placeholder/><Placeholder/><Placeholder className="skeleton-question"/><div className="skeleton-advisor-input"><Placeholder/><Placeholder className="skeleton-icon"/></div></div>
      </>}
    </div>
    {!compact && sections.collections && <div className="skeleton-panel skeleton-collections-panel"><Placeholder className="skeleton-panel-title"/><div className="skeleton-collection-totals">{[0, 1, 2].map(index => <div key={index}><Placeholder/><Placeholder className="skeleton-amount"/></div>)}</div><RecordRows/></div>}
    {!compact && summary && <div className="skeleton-summary-panels"><div className="skeleton-panel skeleton-composition-panel"><Placeholder className="skeleton-panel-title"/><div className="skeleton-goals-body"><div className="skeleton-rings skeleton-single-ring"/><RecordRows/></div></div><div className="skeleton-panel skeleton-recent-panel"><Placeholder className="skeleton-panel-title"/><RecordRows count={4}/></div></div>}
    {!compact && sections.financialDetail && <div className="skeleton-panel skeleton-financial-disclosure"><Placeholder className="skeleton-panel-title"/></div>}
  </div>;
}

export default function WorkspaceSkeleton({ label = "Loading your workspace", compact = false, variant = "records", heading = true, overview, summary = true }: SkeletonProps) {
  return <section className={`workspace-skeleton${variant === "overview" ? ` skeleton-overview${heading ? "" : " skeleton-overview-inline"}` : compact ? " compact" : ""}`} role="status" aria-live="polite" aria-atomic="true" aria-label={label} aria-busy="true">
    <span className="skeleton-status">{label}</span>
    {variant === "overview" ? <OverviewShape compact={compact} heading={heading} overview={overview} summary={summary}/> : <div aria-hidden="true"><div className="skeleton-heading"><i/><i/></div><div className="skeleton-metrics">{[0,1,2,3].map(index => <div key={index}><i/><i/><i/></div>)}</div><div className="skeleton-records">{[0,1,2,3].map(index => <div key={index}><i/><i/><i/></div>)}</div></div>}
  </section>;
}
