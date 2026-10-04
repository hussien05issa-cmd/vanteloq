"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";

export const DICTATION_CHARACTER_LIMIT = 800;
export const DICTATION_DURATION_MS = 30_000;
type RecognitionResults = { length: number; [index: number]: { [index: number]: { transcript: string } } };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: RecognitionResults }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onstart: (() => void) | null; onend: (() => void) | null;
  start: () => void; abort: () => void;
};
type RecognitionWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
type Session = { recognition: Recognition; base: string; lastText: string; timer: ReturnType<typeof setTimeout> | null };
export type AdvisorDictationHandle = { stop: () => void };

/** A result list is cumulative. Rebuild it so revised interim results never duplicate final words. */
export function dictationTranscript(results: RecognitionResults): string {
  return Array.from({ length: results.length }, (_, index) => results[index]?.[0]?.transcript.trim() ?? "").filter(Boolean).join(" ");
}

/** Keep the typed prefix intact, and do not split a surrogate pair at the textarea limit. */
export function dictationText(base: string, transcript: string): string {
  const speech = transcript.trim();
  const text = `${base}${base && speech && !/\s$/.test(base) ? " " : ""}${speech}`;
  const truncated = text.slice(0, DICTATION_CHARACTER_LIMIT);
  return truncated.length < text.length && /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
}

const AdvisorDictation = forwardRef<AdvisorDictationHandle, { question: string; onQuestion: (text: string) => void; disabled: boolean }>(function AdvisorDictation({ question, onQuestion, disabled }, ref) {
  const id = useId();
  const active = useRef<Session | null>(null);
  const mounted = useRef(false);
  const callback = useRef(onQuestion);
  const button = useRef<HTMLButtonElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "listening">("idle");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState(false);

  const finish = useCallback((session: Session, message = "Dictation stopped. Review your text before sending.") => {
    if (active.current !== session) return;
    // Invalidate before abort: browsers may deliver an already queued result or end callback.
    active.current = null;
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
    const recognition = session.recognition;
    recognition.onresult = recognition.onerror = recognition.onstart = recognition.onend = null;
    try { recognition.abort(); } catch { /* Already stopped by the browser. */ }
    if (mounted.current) { setPhase("idle"); setNotice(message); }
  }, []);

  const stop = useCallback(() => {
    if (active.current) finish(active.current);
    if (mounted.current) setReview(false);
  }, [finish]);
  useImperativeHandle(ref, () => ({ stop }), [stop]);

  useEffect(() => { callback.current = onQuestion; }, [onQuestion]);
  useEffect(() => {
    mounted.current = true;
    const browser = window as RecognitionWindow;
    setSupported(Boolean(browser.SpeechRecognition ?? browser.webkitSpeechRecognition));
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    return () => {
      mounted.current = false;
      if (active.current) finish(active.current);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
    };
  }, [finish, stop]);
  useEffect(() => { if (disabled) stop(); }, [disabled, stop]);
  useEffect(() => {
    // Also protect replacements from outside the textarea, such as a saved prompt or new chat.
    if (active.current && question !== active.current.lastText) stop();
  }, [question, stop]);

  const start = () => {
    if (disabled || document.hidden || question.length >= DICTATION_CHARACTER_LIMIT) return;
    stop();
    setNotice("");
    const Constructor = (window as RecognitionWindow).SpeechRecognition ?? (window as RecognitionWindow).webkitSpeechRecognition;
    if (!Constructor) { setSupported(false); return; }
    try {
      const recognition = new Constructor();
      const session: Session = { recognition, base: question, lastText: question, timer: null };
      active.current = session;
      recognition.lang = navigator.language || "en-CA";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onstart = () => { if (active.current === session && mounted.current) setPhase("listening"); };
      recognition.onresult = event => {
        if (active.current !== session || !mounted.current) return;
        if (document.hidden) { finish(session); return; }
        const transcript = dictationTranscript(event.results);
        const next = dictationText(session.base, transcript);
        session.lastText = next;
        callback.current(next);
        const fullLength = session.base.length + (session.base && transcript && !/\s$/.test(session.base) ? 1 : 0) + transcript.length;
        if (fullLength >= DICTATION_CHARACTER_LIMIT) finish(session, "Message limit reached. Review your text before sending.");
      };
      recognition.onerror = event => {
        const message = event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone access was not granted. Type instead, or review your browser’s microphone settings."
          : event.error === "no-speech" ? "No speech was detected. Try again or type your message."
          : "Dictation could not finish. Your text is kept; try again or type instead.";
        finish(session, message);
      };
      recognition.onend = () => finish(session);
      setPhase("starting");
      session.timer = setTimeout(() => finish(session, "The 30-second dictation limit was reached. Review your text before sending."), DICTATION_DURATION_MS);
      recognition.start();
    } catch {
      if (active.current) finish(active.current, "Dictation is unavailable here. Type your message instead.");
      else { setPhase("idle"); setNotice("Dictation is unavailable here. Type your message instead."); }
    }
  };

  const listening = phase !== "idle";
  const atLimit = question.length >= DICTATION_CHARACTER_LIMIT;
  const help = supported === false ? "Voice dictation is unavailable in this browser. You can still type your message."
    : atLimit ? "The message has reached its 800-character limit." : "Dictate for up to 30 seconds, then review before sending. Browser microphone permission is required.";
  return <div className="ai-dictation" onKeyDown={event => { if (event.key === "Escape" && (review || listening)) { event.preventDefault(); stop(); button.current?.focus(); } }}>
    <button ref={button} type="button" className={`ai-dictation-button${listening ? " is-listening" : ""}`} disabled={disabled || supported !== true || (atLimit && !listening)} aria-label={listening ? "Stop dictation" : "Dictate a message"} aria-pressed={listening} aria-expanded={review} aria-controls={`${id}-review`} aria-describedby={`${id}-help`} title={help} onClick={() => { if (listening) stop(); else { setNotice(""); setReview(value => !value); } }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>
    </button>
    <span className="ai-visually-hidden" id={`${id}-help`}>{help}</span>
    {review && <div id={`${id}-review`} className="ai-dictation-review" role="group" aria-labelledby={`${id}-title`}>
      <strong id={`${id}-title`}>Dictate your message</strong>
      <p>Your browser needs microphone permission and may send audio to its speech service. Vanteloq does not record audio. <a href="/privacy#dictation" target="_blank" rel="noreferrer">Privacy details</a></p>
      <p>Up to 30 seconds. Review the text before sending; dictation never sends a message automatically.</p>
      <div><button type="button" onClick={() => { start(); button.current?.focus(); }} disabled={disabled || atLimit}>Start dictation</button><button type="button" onClick={() => { stop(); button.current?.focus(); }}>Cancel</button></div>
    </div>}
    {(listening || notice) && <div className="ai-dictation-feedback"><p className="ai-dictation-status" role="status" aria-live="polite">{phase === "starting" ? "Waiting for microphone permission…" : phase === "listening" ? "Listening. Start typing or press the microphone to stop." : notice}</p>{!listening && <button type="button" aria-label="Dismiss dictation status" onClick={() => setNotice("")}>×</button>}</div>}
  </div>;
});

export default AdvisorDictation;
