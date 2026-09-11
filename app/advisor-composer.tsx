"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  purpose?: "analysis" | "help";
  onPurpose?: (purpose: "analysis" | "help") => void;
  children?: ReactNode;
  hasConversation?: boolean;
  memoryEnabled?: boolean;
  onMemory?: (enabled: boolean) => void;
  privacyControls?: ReactNode;
  onNewChat?: () => void;
  provider?: AdvisorMode;
  onProvider?: (provider: AdvisorMode) => void;
  providers?: { gemini: { ready: boolean; reason?: string | null }; openai: { ready: boolean; reason?: string | null } };
};

/** Shared by the authenticated advisor and isolated presentation tests. */
export default function AdvisorComposer({ question, onQuestion, dataUseAccepted, onConsent, loading, thinking = loading, purpose = "analysis", onPurpose, onSubmit, onNewChat, children, hasConversation = false, memoryEnabled = false, onMemory, privacyControls, provider = "gemini", onProvider, providers = { gemini: { ready: true }, openai: { ready: false } } }: Props) {
  const selectedReady = advisorProviders(provider).every(item => providers[item].ready);
  const ready = selectedReady && canAskAdvisor(question, dataUseAccepted, loading);
  const input = useRef<HTMLTextAreaElement>(null);
  const settings = useRef<HTMLDialogElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataDetailsOpen, setDataDetailsOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(!hasConversation);

  useEffect(() => {
    const dialog = settings.current;
    if (settingsOpen && !dialog?.open) dialog?.showModal();
    else if (!settingsOpen && dialog?.open) dialog.close();
  }, [settingsOpen]);

  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.min(input.current.scrollHeight, 176)}px`;
  }, [question]);

  const openSettings = (showDataUse = false) => { setDataDetailsOpen(showDataUse); setSettingsOpen(true); };
  const suggestions = purpose === "help" ? [
    { icon: "Integrations", title: "Connect my data", question: "How do I connect my POS and approve the correct records?" },
    { icon: "BookLoQ", title: "Get started in BookLoQ", question: "How do I get started in BookLoQ and check my cash?" },
    { icon: "Reports", title: "Check a report", question: "How do I investigate a number that looks wrong?" },
    { icon: "Settings", title: "Manage AI privacy", question: "How do I turn memory off and delete saved chats?" },
  ] : [
    { icon: "Reports", title: "Review my KPIs", question: "Which KPIs need attention, and why?" },
    { icon: "Sales", title: "Find margin gaps", question: "Where is margin leaking?" },
    { icon: "Inventory", title: "Explore stock & cash", question: "How do labour and inventory affect performance?" },
    { icon: "Marketing", title: "Assess marketing", question: "What does our marketing data show?" },
  ];
  const submitLabel = thinking ? "Analyzing…" : loading ? "Clearing…" : "Send message";

  return <section className={`ai-studio${hasConversation ? " has-conversation" : " is-empty"}`} aria-label="Vanteloq AI business analysis workspace">
    <header className="ai-studio-header">
      <div className="vanteloq-ai-heading"><VanteloqAiLogo size={30} decorative/><strong>Vanteloq AI</strong></div>
      <div className="ai-header-tools">
        {onNewChat && <button type="button" disabled={loading} onClick={() => { onNewChat(); onConsent(false); input.current?.focus(); }} title="Start a new chat. Saved chats stay in Settings."><WorkspaceIcon name="Business Brief"/><span>New chat</span></button>}
        <button type="button" aria-haspopup="dialog" aria-controls="advisor-settings" onClick={() => openSettings()}><WorkspaceIcon name="Settings"/><span>Settings</span></button>
      </div>
    </header>

    <div className="ai-chat-column">
      {onPurpose && <div className="ai-purpose" role="group" aria-label="Conversation purpose"><button type="button" disabled={loading} aria-pressed={purpose === "analysis"} onClick={() => onPurpose("analysis")}>Business analysis</button><button type="button" disabled={loading} aria-pressed={purpose === "help"} onClick={() => onPurpose("help")}>App help</button><a href="/help" target="_blank" rel="noreferrer">Help centre ↗</a></div>}
      <div className="ai-conversation" aria-label="Conversation">
        {!hasConversation && <div className="ai-welcome"><VanteloqAiLogo size={56} decorative/><h2>What would you like to explore?</h2></div>}
        {children}
      </div>

      <div className="ai-compose-area">
        <form onSubmit={event => { if (!ready) { event.preventDefault(); return; } setSuggestionsOpen(false); onSubmit(event); }}>
          <label className="ai-visually-hidden" htmlFor="advisor-question">Your business question</label>
          <textarea ref={input} id="advisor-question" rows={2} value={question} disabled={loading} onChange={event => onQuestion(event.target.value)} onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (ready) event.currentTarget.form?.requestSubmit();
            }
          }} maxLength={800} required aria-describedby="advisor-submit-help" placeholder={purpose === "help" ? "Ask how to use Vanteloq or BookLoQ…" : "Ask about your business…"}/>
          <div className="ai-input-toolbar">
            {onProvider ? <label className="ai-provider-label"><span className="ai-visually-hidden">AI provider</span><select value={provider} disabled={loading} onChange={event => { onConsent(false); onProvider(event.target.value as AdvisorMode); }}><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option><option value="both">OpenAI + Gemini</option></select></label> : <span>Powered by {ADVISOR_PROVIDER_LABELS[provider]}</span>}
            <div className="ai-send-tools">{question.length > 600 && <span className="ai-character-count">{question.length}/800</span>}<button className="ai-send" type="submit" disabled={!ready} aria-label={submitLabel} title={submitLabel} aria-describedby="advisor-submit-help"><WorkspaceIcon name="Chevron"/></button></div>
          </div>
        </form>

        <div className="ai-consent-row"><label className="ai-consent"><input type="checkbox" checked={dataUseAccepted} disabled={loading} onChange={event => onConsent(event.target.checked)}/><span>I agree to send {purpose === "help" ? "my question and product guidance" : "my question and permitted business data"} to <strong>{ADVISOR_PROVIDER_LABELS[provider]}</strong>.</span></label><button className="ai-text-button" type="button" onClick={() => openSettings(true)}>Data use</button></div>
        {purpose === "help" && <p className="ai-help-scope">Workspace records are not attached in App help.</p>}
        <div className="ai-composer-meta">
          <p id="advisor-submit-help" className="ai-submit-help" aria-live="polite">{thinking ? "Analyzing…" : loading ? "Clearing…" : !selectedReady ? <>Provider setup needed. <button className="ai-text-button" type="button" onClick={() => openSettings()}>View details</button></> : !dataUseAccepted ? "Accept the data-use notice to send." : "AI can make mistakes. Verify important details."}</p>
          <button className="ai-text-button ai-memory-status" type="button" onClick={() => openSettings()} aria-label={`Memory ${memoryEnabled ? "on" : "off"}. Open settings.`}>Memory {memoryEnabled ? "on" : "off"}</button>
        </div>

        <div className="ai-suggestions">
          <button className="ai-text-button ai-suggestions-toggle" type="button" aria-expanded={suggestionsOpen} aria-controls="advisor-suggestions" onClick={() => setSuggestionsOpen(open => !open)}>{suggestionsOpen ? "Hide suggestions" : "Show suggestions"}</button>
          <div id="advisor-suggestions" className="ai-prompt-grid" role="group" aria-label="Suggested business questions" hidden={!suggestionsOpen}>
            {suggestions.map(item => <button key={item.title} type="button" disabled={loading} onClick={() => { onQuestion(item.question); setSuggestionsOpen(false); input.current?.focus(); }}><WorkspaceIcon name={item.icon}/><span>{item.title}</span></button>)}
          </div>
        </div>
      </div>
    </div>

    <dialog ref={settings} id="advisor-settings" className="ai-settings" aria-labelledby="advisor-settings-title" onCancel={() => setSettingsOpen(false)} onClose={() => setSettingsOpen(false)} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, summary, a[href], [tabindex="0"]')).filter(element => !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header className="ai-settings-header"><div><span>Vanteloq AI</span><h2 id="advisor-settings-title">Settings</h2></div><button type="button" onClick={() => setSettingsOpen(false)}>Done</button></header>
      <div className="ai-settings-body">
        <section aria-labelledby="advisor-memory-title">
          <div className="ai-setting-row"><h3 id="advisor-memory-title">Conversation memory</h3>{onMemory && <label className="ai-memory-switch"><input type="checkbox" role="switch" aria-label="Conversation memory" checked={memoryEnabled} disabled={loading} onChange={event => { onConsent(false); onMemory(event.target.checked); }}/><span aria-hidden="true"/></label>}</div>
          <p>{memoryEnabled ? "On. New messages are saved. Up to six recent messages from this chat can inform replies when evidence and permissions still match." : "Off. Each question uses current permitted evidence. New questions and replies are not saved in Vanteloq’s chat database."}</p>
          <p>Off by default when you open Vanteloq AI. Changing memory starts a new chat. Saved chats stay until you delete them.</p>
        </section>
        <section aria-labelledby="advisor-saved-title"><h3 id="advisor-saved-title">Saved chats</h3>{privacyControls ?? <p>No saved chats available.</p>}</section>
        <section aria-labelledby="advisor-provider-title"><h3 id="advisor-provider-title">AI provider</h3><p>Powered by {ADVISOR_PROVIDER_LABELS[provider]}. {provider === "both" && "Both providers receive the same permitted evidence and return separate analyses."}</p>{!selectedReady && <p className="ai-provider-pending" role="status">{advisorProviders(provider).filter(item => !providers[item].ready).map(item => providers[item].reason ?? `${ADVISOR_PROVIDER_LABELS[item]} setup is pending.`).join(" ")}</p>}</section>
        <section><details className="ai-data-details" open={dataDetailsOpen} onToggle={event => setDataDetailsOpen(event.currentTarget.open)}><summary>Data use & privacy</summary><p>In Business analysis, your question, permitted aggregate financial and marketing KPIs, labour totals, inventory values, accounts payable, source status, aggregate cash and permitted BookLoQ ledger summaries{memoryEnabled ? " and up to six recent conversation messages" : " (without conversation history)"} are sent to {ADVISOR_PROVIDER_LABELS[provider]} for business analysis.</p><p>Automatic evidence excludes credentials, account numbers, customer names, search queries, page addresses, Business Profile content, invoice files and raw transactions. Do not enter personal information or secrets.</p><p>Provider safety logs and managed backups follow separate retention periods. No automated business actions are taken.</p><a href="/privacy#automation" target="_blank" rel="noreferrer">Privacy policy and retention details</a></details></section>
      </div>
    </dialog>
  </section>;
}
