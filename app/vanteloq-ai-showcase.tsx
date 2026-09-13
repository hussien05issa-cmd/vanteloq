"use client";

import { useEffect, useState } from "react";
import VanteloqAiLogo from "./vanteloq-ai-logo";

/** A visual preview only. It never submits a prompt or reads workspace data. */
export default function VanteloqAiShowcase() {
  const [thinking, setThinking] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!thinking) return;
    const timer = setTimeout(() => setThinking(false), 4000);
    return () => clearTimeout(timer);
  }, [thinking]);
  return <aside className={"home-ai-mark ai-orbit-showcase" + (paused ? " motion-paused" : "")} aria-label="Vanteloq AI visual preview">
    <div className="ai-orbit-stage"><VanteloqAiLogo size={236} thinking={thinking} decorative/></div>
    <div className="ai-orbit-wordmark"><span>VANTELOQ <b>AI</b></span><p>Business intelligence,<br/>in conversation.</p></div>
    <div className="ai-orbit-topics"><span>Sales & margin</span><span>Cash & books</span><span>App guidance</span></div>
    <div className="ai-orbit-preview-controls"><button type="button" onClick={() => { setPaused(false); setThinking(true); }} disabled={thinking}>{thinking ? "Thinking…" : "Preview thinking"}</button><button type="button" aria-label={paused ? "Resume logo animation" : "Pause logo animation"} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? "Play" : "Pause"}</button><span aria-live="polite">{thinking ? "Animation preview" : "Powered by OpenAI"}</span></div>
  </aside>;
}
