"use client";
import { useRef, useState } from "react";
import { reviewDisplayStatus, reviewLabels, type OpportunityReview, type ReviewStatus } from "../domain/opportunity-review";

export type ReviewChange = { status: ReviewStatus; note: string; snoozedUntil: string | null };
export default function OpportunityReviewPanel({ review, canReview, busy, onSave, onActions }: {
  review: OpportunityReview; canReview: boolean; busy: boolean;
  onSave: (change: ReviewChange) => Promise<void>; onActions: () => void;
}) {
  const [status, setStatus] = useState<ReviewStatus>(review.status);
  const [note, setNote] = useState("");
  const [days, setDays] = useState("7");
  const [error, setError] = useState("");
  const reminderAttempt = useRef<{ fields: string; until: string } | null>(null);
  return <section className="opportunity-review-panel" aria-label="Opportunity follow-up">
    <div className="review-state-line"><h4>Follow-up</h4><span className="decision-status">{reviewDisplayStatus(review)}</span></div>
    {review.snoozedUntil && review.status === "snoozed" && <p>Review again {new Date(review.snoozedUntil).toLocaleString()}. This is an in-app reminder.</p>}
    {review.task && <button type="button" className="review-task" onClick={onActions}><strong>{review.task.title}</strong><span>{review.task.assignee} · {review.task.status.replaceAll("_", " ")}{review.task.dueDate ? ` · Due ${review.task.dueDate}` : ""}</span><small>Open Action Centre →</small></button>}
    {canReview && <form onSubmit={async event => {
      event.preventDefault(); if (busy) return; setError("");
      const fields = JSON.stringify({ status, note, days });
      if (!reminderAttempt.current || reminderAttempt.current.fields !== fields) reminderAttempt.current = { fields, until: new Date(Date.now() + Number(days) * 86400000).toISOString() };
      try { await onSave({ status, note, snoozedUntil: status === "snoozed" ? reminderAttempt.current.until : null }); reminderAttempt.current = null; setNote(""); }
      catch (error) { setError(error instanceof Error ? error.message : "The review was not saved."); }
    }}>
      <div className="review-fields"><label>Review status<select value={status} disabled={busy} onChange={event => setStatus(event.target.value as ReviewStatus)}>{Object.entries(reviewLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {status === "snoozed" && <label>Remind me in<select value={days} disabled={busy} onChange={event => setDays(event.target.value)}><option value="1">1 day</option><option value="3">3 days</option><option value="7">1 week</option><option value="14">2 weeks</option><option value="30">30 days</option></select></label>}</div>
      <label>{status === "resolved" ? "Observed outcome" : status === "dismissed" ? "Reason for dismissal" : "Review note"}<textarea value={note} disabled={busy} maxLength={1000} required={status === "resolved" || status === "dismissed"} placeholder={status === "resolved" ? "What changed, over which dates, and what still needs checking?" : "Add evidence, a next step or a reason."} onChange={event => setNote(event.target.value)}/></label>
      {status === "resolved" && <p className="review-hint">Closing a review records your assessment. It does not verify a financial gain or establish what caused a change.</p>}
      {error && <p role="alert" className="action-update-error">{error}</p>}
      <button type="submit" className="secondary" disabled={busy}>{busy ? "Saving…" : "Save review"}</button>
    </form>}
    <details className="review-history"><summary>Activity ({review.events.length})</summary><ol>{review.events.map(event => <li key={event.id}><div><strong>{reviewLabels[event.status]}</strong><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></div><small>{event.actor}</small>{event.note && <p>{event.note}</p>}</li>)}</ol></details>
  </section>;
}
