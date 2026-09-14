import VanteloqAiLogo from "./vanteloq-ai-logo";

/** Decorative branding. It never submits a prompt or reads workspace data. */
export default function VanteloqAiShowcase() {
  return <aside className="home-ai-mark ai-orbit-showcase" aria-label="Vanteloq AI">
    <div className="ai-orbit-stage"><VanteloqAiLogo size={236} decorative/></div>
    <div className="ai-orbit-wordmark"><span>VANTELOQ <b>AI</b></span><p>Business intelligence,<br/>in conversation.</p></div>
    <div className="ai-orbit-topics"><span>Sales & margin</span><span>Cash & books</span><span>App guidance</span></div>
    <p className="ai-orbit-attribution">Powered by <strong>OpenAI</strong></p>
  </aside>;
}
