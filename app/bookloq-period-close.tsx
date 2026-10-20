"use client";
import { useRef, useState } from "react";
import type { BookLoQData } from "./bookloq-workspace";
import BookLoQSetup from "./bookloq-setup";
import { apiFetch } from "./supabase-browser";
import { bookloqRequest } from "./bookloq-request";
import { periodCloseState } from "../domain/bookloq-workflow";

const label = (value: string) => value.replaceAll("_", " ");
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

export default function BookLoQPeriodClose({ data, refresh, showNotice }: {
  data: BookLoQData; refresh: () => Promise<void>; showNotice: (message: string) => void;
}) {
  const [periodId, setPeriodId] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const period = data.periods.find(item => item.id === periodId) ?? data.periods[0] ?? null;
  const close = periodCloseState(period, data.closeItems);
  const canEdit = data.permissions.includes("reconcile_accounts");
  const canLock = data.permissions.includes("lock_periods");
  const canUnlock = data.permissions.includes("unlock_periods");
  const canManage = ["owner", "admin"].includes(data.role) && data.permissions.includes("post_journals") && data.permissions.includes("lock_periods");
  const perform = async (body: Record<string, unknown>, notice: string) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      await bookloqRequest(apiFetch, "/api/v1/bookloq/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await refresh(); setReopenReason(""); showNotice(notice);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The change could not be confirmed. Refresh the saved period before retrying."); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <div className="bookloq-content">
    <section className="bookloq-page-intro"><div><p>MONTH-END CLOSE</p><h3>{period ? `${period.label} close` : "Set up an accounting period"}</h3><span>Review the controls for one accounting period, then lock that period. Reopening requires permission and a recorded reason.</span></div>{period && canLock && <button type="button" disabled={busy || !close.readyToLock} title={!close.items.length ? "This period needs a close checklist before it can be locked." : !close.readyToLock ? "Complete this period's controls before locking it." : `Lock ${period.label}`} onClick={() => { if (close.readyToLock) void perform({ type: "lock_period", periodId: period.id }, `${period.label} locked and recorded in the audit log`); }}>{period.status === "locked" ? "Period locked" : busy ? "Saving…" : "Lock selected period"}</button>}</section>
    {period && <>
      <div className="bookloq-period-toolbar"><label>Accounting period<select value={period.id} disabled={busy} onChange={event => { setPeriodId(event.target.value); setReopenReason(""); setError(""); }}>{data.periods.map(item => <option key={item.id} value={item.id}>{item.label} · {label(item.status)}</option>)}</select></label><span>{date(period.startDate)} to {date(period.endDate)} · {label(period.status)}</span></div>
      <article className="bookloq-card close-progress"><div><span><b>{Math.round(close.progress * 100)}%</b><small>{close.complete} of {close.items.length} controls complete for {period.label}</small></span><i><b style={{ width: `${close.progress * 100}%` }}/></i></div></article>
      {close.items.length ? <article className="bookloq-card close-list">{close.items.map(item => <div key={item.id}><span className={`close-state ${item.status}`}>{label(item.status)}</span><span><b>{item.title}</b><small>{item.blocker || `Due ${item.dueDate ? date(item.dueDate) : "before lock"}`}</small></span><select aria-label={`Status for ${item.title}`} disabled={busy || !canEdit || !close.editable} value={item.status} onChange={event => { if (canEdit && close.editable && item.periodId === period.id) void perform({ type: "month_end_status", itemId: item.id, status: event.target.value }, `Updated ${period.label} close control`); }}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option></select></div>)}</article> : <p className="bookloq-empty-line">No close controls are recorded for this period. It cannot be marked ready from an empty checklist.</p>}
      {period.status === "locked" && <section className="bookloq-period-unlock"><h4>This period is locked</h4><p>Its close controls cannot be changed while locked. Reopening retains the recorded lock and change history.</p>{canUnlock ? <form onSubmit={event => { event.preventDefault(); if (reopenReason.trim()) void perform({ type: "unlock_period", periodId: period.id, reason: reopenReason.trim() }, `${period.label} reopened for review with your reason recorded`); }}><label>Reason for reopening<textarea required maxLength={1000} disabled={busy} value={reopenReason} onChange={event => setReopenReason(event.target.value)} placeholder="Explain what needs correction and why."/></label><button type="submit" className="bookloq-primary" disabled={busy || !reopenReason.trim()}>{busy ? "Reopening…" : "Reopen selected period for review"}</button></form> : <p>Ask a workspace owner with period-unlock permission to review any correction.</p>}</section>}
    </>}
    {error && <p className="bookloq-form-error" role="alert">{error}</p>}
    {canManage ? <details className="bookloq-period-setup" open={!period}><summary>Accounting setup and new period</summary><BookLoQSetup accountsExist={Boolean(data.settings?.status === "active" && (data.accountCatalog?.length ?? data.statements.accounts.length) > 0)} periodsExist={data.periods.length > 0} currency={data.organization.currency} canManage={canManage} refresh={refresh} showNotice={showNotice}/></details> : !period && <p>Ask an owner or administrator with accounting setup access to create the first period.</p>}
  </div>;
}
