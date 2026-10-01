import VanteloqAiLogo from "./vanteloq-ai-logo";

/** Decorative branding. It never submits a prompt or reads workspace data. */
export default function VanteloqAiShowcase() {
  return <aside className="home-ai-mark ai-orbit-showcase" aria-label="Vanteloq AI" data-motion-group>
    <div className="ai-orbit-stage" data-motion-item="0"><VanteloqAiLogo size={236} decorative/></div>
    <div className="ai-orbit-wordmark" data-motion-item="1"><span>VANTELOQ <b>AI</b></span><p>Your store’s numbers,<br/>in conversation.</p></div>
    <div className="ai-orbit-topics" data-motion-item="2"><span>Sales & margin</span><span>Cash & books</span><span>App help</span></div>
    <p className="ai-orbit-attribution" data-motion-item="3">Powered by <strong>OpenAI</strong></p>
  </aside>;
}
