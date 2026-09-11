"use client";

import type { FormEvent } from "react";
import VanteloqAiLogo from "./vanteloq-ai-logo";
import { ADVISOR_PROVIDER_LABELS, advisorProviders, type AdvisorMode } from "../domain/advisor-providers";

export function canAskAdvisor(question: string, consent: boolean, loading: boolean) {
  return consent && !loading && question.trim().length > 0 && question.trim().length <= 800;
}

type Props = {
  question: string; onQuestion: (value: string) => void;
  dataUseAccepted: boolean; onConsent: (value: boolean) => void;
  loading: boolean; onSubmit: (event: FormEvent) => void;
  onClear?: () => void;
  provider?: AdvisorMode;
  onProvider?: (provider: AdvisorMode) => void;
  providers?: { gemini: { ready: boolean; reason?: string | null }; openai: { ready: boolean; reason?: string | null } };
};

/** Shared by the authenticated advisor and isolated presentation tests. */
export default function AdvisorComposer({ question, onQuestion, dataUseAccepted, onConsent, loading, onSubmit, onClear, provider = "gemini", onProvider, providers = { gemini: { ready: true }, openai: { ready: false } } }: Props) {
  const selectedReady = advisorProviders(provider).every(item => providers[item].ready);
  const ready = selectedReady && canAskAdvisor(question, dataUseAccepted, loading);
  return <section className="advisor-hero" aria-labelledby="advisor-question-title">
    <div className="vanteloq-ai-heading"><VanteloqAiLogo size={56} decorative/><div><p>Vanteloq AI</p><small>OpenAI + Google Gemini</small></div></div>
    <h2 id="advisor-question-title">Understand the numbers. Plan your next move.</h2>
    <span>Analyze sales, margins, cash, inventory value, labour and marketing KPIs from the approved information you can access. Every answer shows its evidence and limits.</span>
    {onProvider && <label className="advisor-question-label" htmlFor="advisor-provider">AI provider<select id="advisor-provider" value={provider} disabled={loading} onChange={event => { onConsent(false); onProvider(event.target.value as AdvisorMode); }}>
      <option value="gemini">Google Gemini{providers.gemini.ready ? "" : " — setup pending"}</option>
      <option value="openai">OpenAI{providers.openai.ready ? "" : " — setup pending"}</option>
      <option value="both">Both — two independent analyses{providers.gemini.ready && providers.openai.ready ? "" : " — setup pending"}</option>
    </select></label>}
    {!selectedReady && <p role="status">{advisorProviders(provider).filter(item => !providers[item].ready).map(item => providers[item].reason ?? `${ADVISOR_PROVIDER_LABELS[item]} setup is pending.`).join(" ")}</p>}
    <form onSubmit={(event) => { if (!ready) { event.preventDefault(); return; } onSubmit(event); }}>
      <label className="advisor-question-label" htmlFor="advisor-question">Your business question</label>
      <input id="advisor-question" value={question} onChange={(event) => onQuestion(event.target.value)} maxLength={800} required
        aria-describedby="advisor-submit-help" placeholder="Why were sales lower? Where is margin leaking?" />
      <button type="submit" disabled={!ready} aria-describedby="advisor-submit-help">{loading ? "Analyzing…" : "Ask Vanteloq AI →"}</button>
    </form>
    <p id="advisor-submit-help" className="advisor-submit-help" aria-live="polite">{loading ? "Reviewing the permitted business context." : !dataUseAccepted ? "Accept the data-use notice below before sending a question." : !question.trim() ? "Enter a question or choose a suggestion below." : "Ready to ask. Avoid including personal information in your question."}</p>
    <label className="advisor-data-consent">
      <input type="checkbox" checked={dataUseAccepted} onChange={(event) => onConsent(event.target.checked)} />
      <span>I agree to send my question, permitted aggregate financial and marketing KPIs, labour totals, inventory values, accounts payable, source status, aggregate cash and up to six recent conversation messages to {ADVISOR_PROVIDER_LABELS[provider]} for business analysis. {provider === "both" && "Both providers receive the same permitted evidence and return separate analyses. "}The automatic evidence excludes credentials, account numbers, customer names, search queries, page addresses, Business Profile content, invoice files, and raw transactions. Do not enter personal information or secrets. Provider safety retention may apply. <a href="/privacy#automation">Review data use, retention and your choices.</a></span>
    </label>
    <div className="advisor-provider-note"><VanteloqAiLogo size={28} decorative/><span><strong>{selectedReady ? `Powered by ${ADVISOR_PROVIDER_LABELS[provider]}` : `${ADVISOR_PROVIDER_LABELS[provider]} — setup pending`}</strong><small>Review AI conclusions before acting. No automated business actions.</small></span>{onClear && <button type="button" disabled={loading} onClick={onClear}>Clear conversation</button>}</div>
    <div className="suggested-questions" role="group" aria-label="Suggested business questions">
      {["Which KPIs need attention, and why?", "Where is margin leaking?", "How do labour and inventory affect performance?", "What does our marketing data show?", "What inputs are missing for a cash forecast?"].map((item) => <button type="button" key={item} onClick={() => onQuestion(item)}>{item}</button>)}
    </div>
  </section>;
}
