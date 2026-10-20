type TaskReadSummaryProps = {
  loading: boolean;
  error: string;
  archiveError?: string;
  loaded: number;
  active: number;
  highPriority: number;
  fromIntelligence: number;
  completed: number;
  hasEarlier: boolean;
};

export default function TaskReadSummary({ loading, error, archiveError = "", loaded, active, highPriority, fromIntelligence, completed, hasEarlier }: TaskReadSummaryProps) {
  const counts = [["Active", active], ["High priority", highPriority], ["From intelligence", fromIntelligence], ["Completed", completed]] as const;
  const unavailable = Boolean(error || (archiveError && loaded === 0));
  return <>
    <p className="task-archive-summary" role="status">{loading ? "Loading tasks…" : unavailable ? "Task counts are unavailable. Refresh actions to retry." : `${loaded} loaded tasks. ${archiveError ? "Earlier tasks could not be loaded. Counts and filters describe retained loaded tasks." : hasEarlier ? "Earlier tasks are available below. Counts and filters describe loaded tasks." : "End of the accessible archive."}`} The latest page refreshes every 30 seconds while visible. Reading earlier tasks pauses automatic refresh. Refresh actions starts from the latest page.</p>
    <section className="task-stats" aria-label="Loaded task counts" aria-busy={loading}>
      {counts.map(([label, count]) => <div key={label}>
        <strong className={unavailable && !loading ? "task-count-unavailable" : undefined}>{loading ? <><span className="sr-only">Loading</span><i className="task-count-placeholder" aria-hidden="true"/></> : unavailable ? "Unavailable" : count}</strong>
        <span>{label}</span>
      </div>)}
    </section>
  </>;
}
