"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import VanteloqAiLogo from "./vanteloq-ai-logo";
import WorkspaceIcon from "./workspace-icon";
import { ADVISOR_PROVIDER_LABELS, advisorProviders, type AdvisorMode } from "../domain/advisor-providers";

export function canAskAdvisor(question: string, consent: boolean, loading: boolean) {
  return consent && !loading && question.trim().length > 0 && question.trim().length <= 800;
}

type Props = {
  question: string; onQuestion: (value: string) => void;
  dataUseAccepted: boolean; onConsent: (value: boolean) => void;
  loading: boolean; onSubmit: (event: FormEvent) => void;
  thinking?: boolean;
  children?: ReactNode;
  hasConversation?: boolean;
  memoryEnabled?: boolean;
  onMemory?: (enabled: boolean) => void;
  privacyControls?: ReactNode;
  onClear?: () => void;
  provider?: AdvisorMode;
  onProvider?: (provider: AdvisorMode) => void;
  providers?: { gemini: { ready: boolean; reason?: string | null }; openai: { ready: boolean; reason?: string | null } };
};

/** Shared by the authenticated advisor and isolated presentation tests. */
export default function AdvisorComposer({ question, onQuestion, dataUseAccepted, onConsent, loading, thinking = loading, onSubmit, onClear, children, hasConversation = false, memoryEnabled = false, onMemory, privacyControls, provider = "gemini", onProvider, providers = { gemini: { ready: true }, openai: { ready: false } } }: Props) {
  const selectedReady = advisorProviders(provider).every(item => providers[item].ready);
  const ready = selectedReady && canAskAdvisor(question, dataUseAccepted, loading);
  const input = useRef<HTMLTextAreaElement>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const suggestions = [
    { icon: "Sales", title: "Performance briefing", detail: "Find the KPIs that need attention.", question: "Which KPIs need attention, and why?" },
    { icon: "Profit", title: "Margin & pricing", detail: "Understand what is affecting profit.", question: "Where is margin leaking?" },
    { icon: "Inventory", title: "Inventory & cash", detail: "Connect stock decisions to cash needs.", question: "How do labour and inventory affect performance?" },
    { icon: "Marketing", title: "Marketing & growth", detail: "Turn approved channel data into a plan.", question: "What does our marketing data show?" },
  ];
  return <section className="ai-studio" aria-label="Vanteloq AI business analysis workspace">
    <header className="ai-studio-header">
      <div className="vanteloq-ai-heading"><VanteloqAiLogo size={46} decorative/><div><strong>Vanteloq AI</strong><small>OpenAI + Google Gemini</small></div></div>
      <div className="ai-header-tools"><span>{thinking ? "Analysis in progress" : selectedReady ? "Business intelligence" : "Provider setup pending"}</span>{onClear && <button type="button" aria-label="Clear conversation" disabled={loading} onClick={onClear}><span className="ai-clear-label">Clear conversation</span><span className="ai-clear-short" aria-hidden="true">Clear</span></button>}</div>
    </header>
    <div className="ai-studio-grid">
      <div className="ai-chat-column">
        <div className="ai-conversation" aria-label="Conversation">
          {!hasConversation && <div className="ai-welcome">
            <VanteloqAiLogo size={68} decorative/>
            <span className="ai-eyebrow">YOUR BUSINESS, IN FOCUS</span>
            <h2>Better questions.<br/>Clearer business decisions.</h2>
            <p>Explore performance, uncover patterns and plan your next move—with the evidence behind every answer.</p>
            <div className="ai-suggestions-heading"><span>Suggested starting points</span><button type="button" aria-expanded={suggestionsOpen} aria-controls="advisor-suggestions" onClick={() => setSuggestionsOpen(open => !open)}>{suggestionsOpen ? "Hide suggestions" : "Show suggestions"}</button></div>
            <div id="advisor-suggestions" className="ai-prompt-grid" role="group" aria-label="Suggested business questions" hidden={!suggestionsOpen}>
              {suggestions.map(item => <button key={item.title} type="button" disabled={loading} onClick={() => { onQuestion(item.question); setSuggestionsOpen(false); input.current?.focus(); }}><WorkspaceIcon name={item.icon}/><span><strong>{item.title}</strong><small>{item.detail}</small></span><b aria-hidden="true">↗</b></button>)}
            </div>
          </div>}
          {children}
        </div>
        <div className="ai-compose-area">
          <label className="ai-consent"><input type="checkbox" checked={dataUseAccepted} disabled={loading} onChange={event => onConsent(event.target.checked)}/><span>I agree to send my question and the permitted business context described in Data use to <strong>{ADVISOR_PROVIDER_LABELS[provider]}</strong> for this analysis.</span></label>
          <form onSubmit={event => { if (!ready) { event.preventDefault(); return; } onSubmit(event); }}>
            <label className="ai-input-label" htmlFor="advisor-question">Your business question</label>
            <textarea ref={input} id="advisor-question" rows={2} value={question} disabled={loading} onChange={event => onQuestion(event.target.value)} maxLength={800} required aria-describedby="advisor-submit-help" placeholder="Ask about performance, margins, stock or cash…"/>
            <div className="ai-input-toolbar"><span>{question.length}/800 · Keep personal data out</span><button type="submit" disabled={!ready} aria-describedby="advisor-submit-help">{thinking ? "Analyzing…" : loading ? "Clearing…" : "Ask Vanteloq AI →"}</button></div>
          </form>
          <p id="advisor-submit-help" className="ai-submit-help" aria-live="polite">{thinking ? "Reviewing the permitted business context." : loading ? "Deleting the saved conversation." : !selectedReady ? "Complete provider setup before sending a question." : !dataUseAccepted ? "Accept the data-use notice before sending a question." : !question.trim() ? "Enter a question or choose a suggested analysis." : "Ready to ask. Review AI conclusions before acting."}</p>
        </div>
      </div>
      <aside className="ai-context-panel" aria-label="Analysis controls and data use">
        <section><span className="ai-eyebrow">ANALYSIS CONTROLS</span>
          {onProvider && <label className="ai-provider-label" htmlFor="advisor-provider">AI provider<select id="advisor-provider" value={provider} disabled={loading} onChange={event => { onConsent(false); onProvider(event.target.value as AdvisorMode); }}>
      <option value="gemini">Google Gemini</option>
      <option value="openai">OpenAI</option>
      <option value="both">Both providers</option>
          </select></label>}
          {selectedReady ? <p className="ai-provider-ready">Powered by {ADVISOR_PROVIDER_LABELS[provider]}</p> : <p className="ai-provider-pending" role="status">{advisorProviders(provider).filter(item => !providers[item].ready).map(item => providers[item].reason ?? `${ADVISOR_PROVIDER_LABELS[item]} setup is pending.`).join(" ")}</p>}
          <p>{provider === "both" ? "Compare two independent analyses of the same permitted evidence." : "One focused analysis from your selected provider."}</p>
        </section>
        <section><span className="ai-eyebrow">BUILT FOR COMMERCE</span><h3>Context that matters.</h3><ul className="ai-context-list"><li><WorkspaceIcon name="Sales"/><span>Sales & performance</span></li><li><WorkspaceIcon name="Inventory"/><span>Stock, costs & cash</span></li><li><WorkspaceIcon name="Marketing"/><span>Marketing & growth</span></li></ul><p>Only approved information your role can access. Missing inputs stay visible.</p></section>
        <section className="ai-memory-controls"><span className="ai-eyebrow">PRIVACY & MEMORY</span>{onMemory && <label className="ai-consent"><input type="checkbox" checked={memoryEnabled} disabled={loading} onChange={event => onMemory(event.target.checked)}/><span>Enable conversation memory</span></label>}<p>{memoryEnabled ? "Memory is on. Save new messages and include up to six recent messages from this chat when evidence and permissions still match." : "Memory is off. Each question uses current permitted evidence only. New questions and replies are not saved in Vanteloq’s chat database."}</p><p>Off by default when you open Vanteloq AI. Switching off starts a fresh chat; previously saved chats stay until deleted. Provider safety retention may still apply.</p>{privacyControls}</section>
        <section><details className="ai-data-details"><summary>Data use</summary><p>Your question, permitted aggregate financial and marketing KPIs, labour totals, inventory values, accounts payable, source status, aggregate cash{memoryEnabled ? " and up to six recent conversation messages" : " (without conversation history)"} are sent to {ADVISOR_PROVIDER_LABELS[provider]} for business analysis. {provider === "both" && "Both providers receive the same permitted evidence and return separate analyses."}</p><p>The automatic evidence excludes credentials, account numbers, customer names, search queries, page addresses, Business Profile content, invoice files, and raw transactions. Do not enter personal information or secrets. Provider safety retention may apply.</p><a href="/privacy#automation">Review data use, retention and your choices.</a></details></section>
        <div className="ai-human-control"><WorkspaceIcon name="Action Centre"/><p>You make the decisions.<small>No automated business actions. Verify conclusions before acting.</small></p></div>
      </aside>
    </div>
  </section>;
}
