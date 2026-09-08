"use client";

import type { FormEvent } from "react";
import IntegrationBrandLogo from "./integration-brand-logo";

export function canAskAdvisor(question: string, consent: boolean, loading: boolean) {
  return consent && !loading && question.trim().length > 0 && question.trim().length <= 800;
}

type Props = {
  question: string; onQuestion: (value: string) => void;
  dataUseAccepted: boolean; onConsent: (value: boolean) => void;
  loading: boolean; onSubmit: (event: FormEvent) => void;
  onClear?: () => void;
};

/** Shared by the authenticated advisor and isolated presentation tests. */
export default function AdvisorComposer({ question, onQuestion, dataUseAccepted, onConsent, loading, onSubmit, onClear }: Props) {
  const ready = canAskAdvisor(question, dataUseAccepted, loading);
  return <section className="advisor-hero" aria-labelledby="advisor-question-title">
    <p>EVIDENCE-BOUND ADVISOR · GOOGLE GEMINI</p>
    <h2 id="advisor-question-title">Ask the business. See the limits.</h2>
    <span>Gemini explains the approved business summaries available to your workspace. It highlights missing evidence, and actions remain under your control.</span>
    <form onSubmit={(event) => { if (!ready) { event.preventDefault(); return; } onSubmit(event); }}>
      <label className="advisor-question-label" htmlFor="advisor-question">Your business question</label>
      <input id="advisor-question" value={question} onChange={(event) => onQuestion(event.target.value)} maxLength={800} required
        aria-describedby="advisor-submit-help" placeholder="Why were sales lower? Where is margin leaking?" />
      <button type="submit" disabled={!ready} aria-describedby="advisor-submit-help">{loading ? "Thinking…" : "Ask Gemini →"}</button>
    </form>
    <p id="advisor-submit-help" className="advisor-submit-help" aria-live="polite">{loading ? "Reviewing the permitted business context." : !dataUseAccepted ? "Accept the data-use notice below before sending a question." : !question.trim() ? "Enter a question or choose a suggestion below." : "Ready to ask. Avoid including personal information in your question."}</p>
    <label className="advisor-data-consent">
      <input type="checkbox" checked={dataUseAccepted} onChange={(event) => onConsent(event.target.checked)} />
      <span>I understand that my question, approved aggregate business and marketing metrics, source status, permitted aggregate cash, and short conversation context are sent to Google Gemini to produce this explanation. Credentials, account numbers, customer names, search queries, page addresses, Business Profile content, invoice files, and raw transactions are excluded. <a href="/privacy#automation">Review the Privacy Policy.</a></span>
    </label>
    <div className="advisor-provider-note"><IntegrationBrandLogo name="Google" compact/><span><strong>Powered by Google Gemini</strong><small>Evidence first · No actions without your approval</small></span>{onClear && <button type="button" disabled={loading} onClick={onClear}>Clear conversation</button>}</div>
    <div className="suggested-questions" role="group" aria-label="Suggested business questions">
      {["Why did sales change?", "Where is margin leaking?", "What does our marketing data show?", "What can the current data not answer?"].map((item) => <button type="button" key={item} onClick={() => onQuestion(item)}>{item}</button>)}
    </div>
  </section>;
}
