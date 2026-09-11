import { useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import AdvisorPrivacy from "../../app/advisor-privacy";
import AdvisorComposer from "../../app/advisor-composer";
import AdvisorThinking from "../../app/advisor-thinking";
import AdvisorResponse from "../../app/advisor-response";
import type { AdvisorMode } from "../../domain/advisor-providers";

let fixtureChats = [{ id: "fixture-chat-one", createdAt: Date.now(), updatedAt: Date.now() }];
const fixtureFetch: typeof fetch = async (url, init) => {
  if (init?.method === "DELETE") { fixtureChats = []; return Response.json({ deleted: true }); }
  if (url === "/api/v1/advisor/conversations") return Response.json({ conversations: fixtureChats, hasMore: false });
  throw new Error("This fixture does not make network requests.");
};
function Preview() {
  const initial = new URLSearchParams(location.search).get("state") ?? "welcome";
  const [state, setState] = useState(initial), [question, setQuestion] = useState("");
  const [sent, setSent] = useState((initial === "welcome" || initial === "pending") ? "" : "Which KPIs need attention, and why?");
  const [provider, setProvider] = useState<AdvisorMode>("both"), [consent, setConsent] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  function ask(event: FormEvent) {
    event.preventDefault(); setSent(question); setQuestion(""); setState("thinking");
    setTimeout(() => setState("answer"), 2200);
  }
  return <div className="operating-shell"><main className="content advisor-page"><AdvisorComposer privacyControls={<AdvisorPrivacy fetcher={fixtureFetch} disabled={state === "thinking"} onDeleted={() => { setState("welcome"); setSent(""); }}/>} memoryEnabled={memoryEnabled} onMemory={value => { setMemoryEnabled(value); setConsent(false); setSent(""); setState("welcome"); }} question={question} onQuestion={setQuestion} dataUseAccepted={consent} onConsent={setConsent} loading={state === "thinking"} onSubmit={ask} provider={provider} onProvider={value => { setProvider(value); setConsent(false); setSent(""); setQuestion(""); setState("welcome"); }} providers={{ gemini: { ready: initial !== "pending", reason: "Provider verification is pending in this example." }, openai: { ready: initial !== "pending", reason: "Secure setup is pending in this example." } }} hasConversation={Boolean(sent)} onNewChat={() => { setState("welcome"); setSent(""); setQuestion(""); }}>
    {sent && <div className="ai-user-message"><small>You</small>{sent}</div>}
    {state === "thinking" && <AdvisorThinking/>}
    {state === "answer" && <AdvisorResponse title="Your commerce briefing" body={'## Performance at a glance\nIllustrative figures for this local preview.\n| KPI | Example value |\n| --- | --- |\n| Net sales | $24,800 |\n| Gross margin | Unavailable |\n| Transactions | 620 |\n## What deserves attention\n- **Verify product costs.** Revenue alone cannot establish profitability.\n- **Compare matched periods.** Check that both windows include the same locations and complete sales days.\n## Next step\nConfirm the source coverage, then ask which changes are supported by the verified records.'} limitation="Visual fixture only. No customer data, AI request or business action."/>}
  </AdvisorComposer></main></div>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);
