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
  onStop?: () => void;
  consentLoading?: boolean;
  consentError?: string;
  onConsentRetry?: () => void;
  purpose?: "analysis" | "help";
  onPurpose?: (purpose: "analysis" | "help") => void;
  children?: ReactNode;
  hasConversation?: boolean;
  memoryEnabled?: boolean;
  onMemory?: (enabled: boolean) => void;
  privacyControls?: ReactNode;
  onNewChat?: () => void;
  provider?: AdvisorMode;
  providersLoading?: boolean;
  providers?: { openai: { ready: boolean; reason?: string | null } };
};

/** Shared by the authenticated advisor and isolated presentation tests. */
export default function AdvisorComposer({ question, onQuestion, dataUseAccepted, onConsent, loading, thinking = loading, onStop, consentLoading = false, consentError = "", onConsentRetry, purpose = "analysis", onPurpose, onSubmit, onNewChat, children, hasConversation = false, memoryEnabled = false, onMemory, privacyControls, provider = "openai", providersLoading = false, providers = { openai: { ready: false } } }: Props) {
  const selectedReady = advisorProviders(provider).every(item => providers[item].ready);
  const ready = !providersLoading && !consentLoading && !consentError && selectedReady && canAskAdvisor(question, dataUseAccepted, loading);
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
  const suggestions = [
    { icon: "Reports", title: "Review my business", question: "Which KPIs need attention, and what should I check next?" },
    { icon: "Sales", title: "Understand my products", question: "Which products and basket patterns deserve attention?" },
    { icon: "BookLoQ", title: "Review cash & books", question: "Review my available financial records, cash outlook and missing inputs." },
    { icon: "Integrations", title: "Help me get started", question: "How do I connect my POS and review its records in Vanteloq?" },
  ];
  const submitLabel = thinking ? "Analyzing…" : loading ? "Clearing…" : "Send message";

  return <section className={`ai-studio${hasConversation ? " has-conversation" : " is-empty"}`} aria-label="Vanteloq AI conversation">
    <header className="ai-studio-header">
      <div className="vanteloq-ai-heading"><VanteloqAiLogo size={36} thinking={thinking} active={Boolean(question.trim())} decorative/><strong>Vanteloq AI</strong></div>
      <div className="ai-header-tools">
        {onNewChat && <button type="button" disabled={loading} onClick={() => { onNewChat(); input.current?.focus(); }} title="Start a new chat. Saved chats stay in Settings."><WorkspaceIcon name="Business Brief"/><span>New chat</span></button>}
        <button type="button" aria-haspopup="dialog" aria-controls="advisor-settings" onClick={() => openSettings()}><WorkspaceIcon name="Settings"/><span>Settings</span></button>
      </div>
    </header>

    <div className="ai-chat-column">
      <div className="ai-conversation" aria-label="Conversation">
        {!hasConversation && <div className="ai-welcome"><VanteloqAiLogo size={96} active={Boolean(question.trim())} decorative/><h2>What can I help you with?</h2><p>Business insights, financial questions or help with Vanteloq.</p></div>}
        {children}
      </div>

      <div className="ai-compose-area">
        <form onSubmit={event => { if (!ready) { event.preventDefault(); return; } setSuggestionsOpen(false); onSubmit(event); }}>
          <label className="ai-visually-hidden" htmlFor="advisor-question">Your message</label>
          <textarea ref={input} id="advisor-question" rows={2} value={question} disabled={loading} onChange={event => onQuestion(event.target.value)} onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (ready) event.currentTarget.form?.requestSubmit();
            }
          }} maxLength={800} required aria-describedby="advisor-submit-help" placeholder="Ask Vanteloq AI…"/>
          <div className="ai-input-toolbar">
            <span>Powered by {ADVISOR_PROVIDER_LABELS[provider]}</span>
            <div className="ai-send-tools">{question.length > 600 && <span className="ai-character-count">{question.length}/800</span>}{thinking && onStop ? <button key="stop" className="ai-send ai-stop" type="button" onClick={event => { event.preventDefault(); onStop(); }} aria-label="Stop response" title="Stop response"><span aria-hidden="true"/></button> : <button key="send" className="ai-send" type="submit" disabled={!ready} aria-label={submitLabel} title={submitLabel} aria-describedby="advisor-submit-help"><WorkspaceIcon name="Chevron"/></button>}</div>
          </div>
        </form>

        {!dataUseAccepted && !consentLoading && !consentError && <div className="ai-consent-row"><label className="ai-consent"><input type="checkbox" checked={false} disabled={loading} onChange={event => onConsent(event.target.checked)}/><span>I agree to send {purpose === "help" ? "my question and product guidance" : "my question and permitted business data"} to <strong>{ADVISOR_PROVIDER_LABELS[provider]}</strong>. Remember for this workspace.</span></label><button className="ai-text-button" type="button" onClick={() => openSettings(true)}>Data use</button></div>}
        {consentError && <p className="ai-consent-error" role="alert">{consentError} <button className="ai-text-button" type="button" onClick={onConsentRetry} disabled={consentLoading}>Retry</button></p>}
        {purpose === "help" && <p className="ai-help-scope">Workspace data is off. Turn it on in Settings for analysis of your records.</p>}
        <div className="ai-composer-meta">
          <p id="advisor-submit-help" className="ai-submit-help" aria-live="polite">{thinking ? "You can stop this response." : loading ? "Clearing…" : consentLoading ? "Checking your data-use setting…" : providersLoading ? "Checking OpenAI availability…" : !selectedReady ? <>Provider setup needed. <button className="ai-text-button" type="button" onClick={() => openSettings()}>View details</button></> : !dataUseAccepted ? "Accept the data-use notice to send." : "AI can make mistakes. Verify important details."}</p>
          <button className="ai-text-button ai-memory-status" type="button" onClick={() => openSettings()} aria-label={`Memory ${memoryEnabled ? "on" : "off"}. Open settings.`}>Memory {memoryEnabled ? "on" : "off"}</button>
        </div>

        <div className="ai-suggestions">
          <button className="ai-text-button ai-suggestions-toggle" type="button" aria-expanded={suggestionsOpen} aria-controls="advisor-suggestions" onClick={() => setSuggestionsOpen(open => !open)}>{suggestionsOpen ? "Hide suggestions" : "Show suggestions"}</button>
          <div id="advisor-suggestions" className="ai-prompt-grid" role="group" aria-label="Suggested questions" hidden={!suggestionsOpen}>
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
        <section aria-labelledby="advisor-agreement-title"><h3 id="advisor-agreement-title">Data Use Agreement</h3><p>{consentLoading ? "Checking your saved agreement…" : dataUseAccepted ? "Accepted for this workspace. New chats keep this choice. We ask again if the notice or permitted data changes." : "Accept the notice below the message box before your first question."}</p>{dataUseAccepted && <button className="ai-text-button ai-withdraw-consent" type="button" disabled={loading || consentLoading} onClick={() => onConsent(false)}>Withdraw agreement</button>}{consentError && <p role="alert">{consentError} <button className="ai-text-button" type="button" onClick={onConsentRetry} disabled={consentLoading}>Retry</button></p>}</section>
        {onPurpose && <section aria-labelledby="advisor-context-title">
          <div className="ai-setting-row"><h3 id="advisor-context-title">Workspace Data</h3><label className="ai-memory-switch"><input type="checkbox" role="switch" aria-label="Include workspace data" checked={purpose === "analysis"} disabled={loading || consentLoading} onChange={event => { onPurpose(event.target.checked ? "analysis" : "help"); }}/><span aria-hidden="true"/></label></div>
          <p>{purpose === "analysis" ? "Include the business summaries your role can access. Vanteloq AI can analyze those records and help you use the app in this conversation." : "Your question and product guidance are included. No workspace records are attached; answers about business concepts are general guidance."}</p>
          <p>Changing this starts a new chat. We ask again only if your saved agreement does not cover the data you enable.</p>
        </section>}
        <section aria-labelledby="advisor-memory-title">
          <div className="ai-setting-row"><h3 id="advisor-memory-title">Conversation Memory</h3>{onMemory && <label className="ai-memory-switch"><input type="checkbox" role="switch" aria-label="Conversation memory" checked={memoryEnabled} disabled={loading} onChange={event => { onMemory(event.target.checked); }}/><span aria-hidden="true"/></label>}</div>
          <p>{memoryEnabled ? "On. New messages are saved. Up to six recent messages from this chat can inform replies when evidence and permissions still match." : "Off. Each question uses current permitted evidence. New questions and replies are not saved in Vanteloq’s chat database."}</p>
          <p>Off by default when you open Vanteloq AI. Changing memory starts a new chat. Saved chats stay until you delete them.</p>
        </section>
        <section aria-labelledby="advisor-saved-title"><h3 id="advisor-saved-title">Saved Chats</h3>{privacyControls ?? <p>No saved chats available.</p>}</section>
        <section aria-labelledby="advisor-provider-title"><h3 id="advisor-provider-title">AI Provider</h3><a href="/help" target="_blank" rel="noreferrer">Help centre ↗</a><p>Powered by {ADVISOR_PROVIDER_LABELS[provider]}.</p>{!selectedReady && <p className="ai-provider-pending" role="status">{advisorProviders(provider).filter(item => !providers[item].ready).map(item => providers[item].reason ?? `${ADVISOR_PROVIDER_LABELS[item]} setup is pending.`).join(" ")}</p>}</section>
        <section><details className="ai-data-details" open={dataDetailsOpen} onToggle={event => setDataDetailsOpen(event.currentTarget.open)}><summary>Data Use and Privacy</summary>{purpose === "help" ? <p>With workspace data off, your question and verified product guidance{memoryEnabled ? " and up to six recent messages from this chat" : " (without conversation history)"} are sent to OpenAI. Workspace records are not attached.</p> : <p>With workspace data on, your question, permitted aggregate financial and marketing KPIs, labour totals, inventory values, accounts payable, source status, aggregate cash and permitted BookLoQ ledger summaries{memoryEnabled ? " and up to six recent conversation messages" : " (without conversation history)"} and product guidance are sent to {ADVISOR_PROVIDER_LABELS[provider]} to answer your question.</p>}<p>Automatic evidence excludes credentials, account numbers, customer names, search queries, page addresses, Business Profile content, invoice files and raw transactions. Do not enter personal information or secrets.</p><p>Provider safety logs and managed backups follow separate retention periods. No automated business actions are taken.</p><a href="/privacy#automation" target="_blank" rel="noreferrer">Privacy policy and retention details</a></details></section>
      </div>
    </dialog>
  </section>;
}
