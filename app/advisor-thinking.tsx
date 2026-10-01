"use client";
import { useEffect, useState } from "react";
import VanteloqAiLogo from "./vanteloq-ai-logo";

export default function AdvisorThinking({ label = "Preparing your answer" }: {label?:string}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, []);
  return <section className="advisor-thinking" role="status" aria-label="Vanteloq AI is preparing a response" aria-live="polite" aria-atomic="true">
    <VanteloqAiLogo size={40} thinking decorative/>
    <div><strong className="ai-thinking-label">{slow ? "Still working on your answer…" : label}</strong>{slow && <p>This is taking longer than usual. You can stop and try again.</p>}</div>
  </section>;
}
