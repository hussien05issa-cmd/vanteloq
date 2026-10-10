"use client";

import { useId, useRef } from "react";
import WorkspaceIcon from "./workspace-icon";
import { useModalFocus } from "./use-modal-focus";
import "./report-imports.css";

export type ReportImportTarget = "sales" | "costs" | "documents" | "statement" | "vehicles";
export type ReportImportChoice = { target: ReportImportTarget; title: string; formats: string; description: string; icon: string };
export function ReportImportChoices({ choices, onSelect }: { choices: ReportImportChoice[]; onSelect: (target: ReportImportTarget) => void }) {
  return <div className="report-import-choices">{choices.map(choice => <button type="button" className="report-import-choice" key={choice.target} onClick={() => onSelect(choice.target)}>
    <span className="report-import-icon"><WorkspaceIcon name={choice.icon}/></span><span><strong>{choice.title}</strong><small>{choice.formats}</small><span>{choice.description}</span></span><span className="report-import-arrow" aria-hidden="true">→</span>
  </button>)}</div>;
}
export default function ReportImportHub({ choices, onSelect, onClose }: {
  choices: ReportImportChoice[]; onSelect: (target: ReportImportTarget) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null), id = useId();
  useModalFocus(ref, true, onClose);
  return <div className="modal-backdrop report-import-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} className="report-import-dialog">
      <header><div><p>YOUR BUSINESS RECORDS</p><h2 id={`${id}-title`}>Import reports</h2></div><button type="button" aria-label="Close report imports" onClick={onClose}>×</button></header>
      <p id={`${id}-description`}>Choose what you want to update. Download the matching template, review your records, then confirm.</p>
      <ReportImportChoices choices={choices} onSelect={onSelect}/>
      {!choices.length && <p role="status">Your role cannot import reports. Ask your workspace owner for access.</p>}
      <footer><WorkspaceIcon name="Documents"/><p>Financial statements are calculated from posted bookkeeping records. A PDF or photo is a supporting document, so it needs review before it becomes a transaction.</p></footer>
    </section>
  </div>;
}
