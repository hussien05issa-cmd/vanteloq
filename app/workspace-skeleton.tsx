export default function WorkspaceSkeleton({ label = "Loading your workspace", compact = false }: { label?: string; compact?: boolean }) {
  return <section className={`workspace-skeleton${compact ? " compact" : ""}`} role="status" aria-label={label} aria-busy="true">
    <span className="skeleton-status">{label}</span>
    <div aria-hidden="true"><div className="skeleton-heading"><i/><i/></div><div className="skeleton-metrics">{[0,1,2,3].map(index => <div key={index}><i/><i/><i/></div>)}</div><div className="skeleton-records">{[0,1,2,3].map(index => <div key={index}><i/><i/><i/></div>)}</div></div>
  </section>;
}
