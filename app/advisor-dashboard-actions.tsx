"use client";
import { useEffect, useRef, useState } from "react";
import { applyDashboardActions, dashboardActionLabel, proposedDashboardActions } from "../domain/advisor-dashboard-actions";
import { normalizeDashboardPreferences, type DashboardPreferences } from "../domain/dashboard-preferences";
import { apiFetch } from "./supabase-browser";
type Review = { before: DashboardPreferences; after: DashboardPreferences; scope: { userId: string; workspaceId: string } };
export default function AdvisorDashboardActions({ question, disabled, onOpenOverview, fetcher = apiFetch }: { question: string; disabled: boolean; onOpenOverview: () => void; fetcher?: typeof apiFetch }) {
  const actions = proposedDashboardActions(question);
  const [review, setReview] = useState<Review | null>(null), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  if (!actions.length) return null;
  const read = async () => {
    if (busy || disabled) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setNotice("");
    try {
      const response = await fetcher("/api/v1/preferences", { signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Your layout could not load. Please try again.");
      if (!body.preferenceScope?.userId || !body.preferenceScope?.workspaceId) throw new Error("Your workspace could not be confirmed. Please try again.");
      const before = normalizeDashboardPreferences(body.dashboardPreferences);
      setReview({ before, after: applyDashboardActions(before, actions), scope: body.preferenceScope });
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Please try again."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const save = async (undo = false) => {
    if (!review || busy || disabled) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setNotice("");
    try {
      const response = await fetcher("/api/v1/preferences", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dashboardPreferences: undo ? review.before : review.after, expectedDashboardPreferences: undo ? review.after : review.before, expectedPreferenceScope: review.scope }) });
      const body = await response.json();
      if (!response.ok) { if (response.status === 409) { setReview(null); setSaved(false); } throw new Error(body.error?.message ?? "Your layout could not save. Please try again."); }
      const after = normalizeDashboardPreferences(body.dashboardPreferences);
      setSaved(!undo); setReview(undo ? null : { ...review, after });
      setNotice(undo ? "Previous layout restored." : "Your dashboard layout is saved.");
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Please try again."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <section className="ai-dashboard-action" aria-label="Proposed dashboard changes">
    <div><strong>{saved ? "Dashboard updated" : "A layout you can apply"}</strong><p>Changes apply to your personal overview in this workspace.</p></div>
    {review && !saved && <><ul>{actions.map((action, index) => <li key={index}>{dashboardActionLabel(action)}</li>)}</ul><p>Your goals, saved views, accounting records and BookLoQ layout are kept.</p></>}
    <div className="ai-dashboard-action-controls">{saved ? <><button type="button" disabled={busy || disabled} onClick={onOpenOverview}>Open dashboard</button><button type="button" disabled={busy || disabled} onClick={() => void save(true)}>Undo layout change</button></> : review ? <><button type="button" disabled={busy || disabled} onClick={() => void save()}>{busy ? "Saving…" : "Apply dashboard changes"}</button><button type="button" disabled={busy} onClick={() => setReview(null)}>Cancel</button></> : <button type="button" disabled={busy || disabled} onClick={() => void read()}>{busy ? "Loading your layout…" : "Review dashboard changes"}</button>}</div>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
