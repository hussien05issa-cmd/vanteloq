"use client";
import { useEffect, useRef } from "react";
import VanteloqAiLogo from "./vanteloq-ai-logo";

export default function AdvisorThinking() {
  const status = useRef<HTMLElement>(null);
  useEffect(() => {
    status.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);
  return <section ref={status} className="advisor-thinking" role="status" aria-live="polite" aria-atomic="true">
    <VanteloqAiLogo size={42} thinking decorative/>
    <div><strong>Vanteloq AI is thinking</strong><p>Analyzing your permitted business data. This may take a moment.</p></div>
  </section>;
}
