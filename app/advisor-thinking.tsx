"use client";
import { useEffect, useRef, useState } from "react";
import VanteloqAiLogo from "./vanteloq-ai-logo";

export default function AdvisorThinking() {
  const status = useRef<HTMLElement>(null);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    status.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, []);
  return <section ref={status} className="advisor-thinking" role="status" aria-label="Vanteloq AI is thinking" aria-live="polite" aria-atomic="true">
    <VanteloqAiLogo size={40} thinking decorative/>
    <div><strong className="ai-thinking-label">{slow ? "Still working on your answer…" : "Thinking…"}</strong>{slow && <p>This is taking longer than usual. You can stop and try again.</p>}</div>
  </section>;
}
