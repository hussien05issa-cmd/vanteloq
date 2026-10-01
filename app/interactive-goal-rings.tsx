"use client";

import "./interactive-goal-rings.css";

type Ring = { key: string; label: string; visual: number; progress: number | null; status: string };

/** Selection only. Progress and eligibility always come from the shared goal calculation. */
export default function InteractiveGoalRings({ goals, selected, onSelect, label }: {
  goals: Ring[]; selected: string; onSelect: (key: string) => void; label: string;
}) {
  const active = goals.find(goal => goal.key === selected) ?? goals[0];
  return <div className="interactive-goal-rings">
    <svg viewBox="0 0 160 160" role="group" aria-label={label}>
      {goals.map((goal, index) => <g key={goal.key} className={`interactive-goal-ring ring-tone-${index}`}
        role="button" tabIndex={0} aria-pressed={active?.key === goal.key}
        aria-label={`${goal.label}: ${goal.progress === null ? goal.status : `${goal.progress.toFixed(1)}% of target`}. Select goal.`}
        onClick={() => onSelect(goal.key)} onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(goal.key); }
        }}>
        <circle className="interactive-ring-track" cx="80" cy="80" r={68 - index * 15}/>
        <circle className="interactive-ring-value" cx="80" cy="80" r={68 - index * 15} pathLength="100" strokeDasharray={`${goal.visual} 100`}/>
        <circle className="interactive-ring-hit" cx="80" cy="80" r={68 - index * 15}/>
        <title>{`${goal.label}: ${goal.status}`}</title>
      </g>)}
    </svg>
    <span className="interactive-ring-readout" aria-live="polite" aria-atomic="true">
      <strong>{active?.progress == null ? "—" : `${active.progress.toFixed(0)}%`}</strong>
      <small>{active?.label ?? "Your goals"}</small>
    </span>
  </div>;
}
