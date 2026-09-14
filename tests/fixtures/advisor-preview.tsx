import { useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import AdvisorPrivacy from "../../app/advisor-privacy";
import AdvisorComposer from "../../app/advisor-composer";
import AdvisorThinking from "../../app/advisor-thinking";
import AdvisorResponse from "../../app/advisor-response";
import type { AdvisorMode } from "../../domain/advisor-providers";
import { useAdvisorConsent } from "../../app/advisor-consent";
import { readAdvisorAnswer } from "../../app/advisor-client";

let fixtureChats = [{ id: "fixture-chat-one", createdAt: Date.now(), updatedAt: Date.now() }];
const example = '## Performance at a glance\nIllustrative figures for this local preview.\n| KPI | Example value |\n| --- | --- |\n| Net sales | CAD $24,800.00 |\n| Gross margin | Unavailable |\n| Transactions | 620 |\n## What deserves attention\n- **Verify product costs.** Revenue alone cannot establish profitability.\n- **Compare matched periods.** Check that both windows include the same locations and complete sales days.\n## Next step\nConfirm the source coverage, then ask which changes are supported by the verified records.';
let fixtureConsent = JSON.parse(sessionStorage.getItem("fixture-advisor-consent") ?? '{"analysis":false,"help":false}');
const fixtureFetch: typeof fetch = async (url, init) => {
  if (url === "/api/v1/advisor/consent") {
    if (init?.method === "POST") {
      const { purpose } = JSON.parse(String(init.body));
      fixtureConsent = { analysis: fixtureConsent.analysis || purpose === "analysis", help: true };
    } else if (init?.method === "DELETE") fixtureConsent = { analysis: false, help: false };
    sessionStorage.setItem("fixture-advisor-consent", JSON.stringify(fixtureConsent));
    return Response.json({ consent: fixtureConsent });
  }
  if (url === "/api/v1/advisor/chat") {
    if (new URLSearchParams(location.search).get("state") === "timeout") return new Promise(() => {});
    await new Promise(resolve => setTimeout(resolve, new URLSearchParams(location.search).get("state") === "slow" ? 20_000 : 2200));
    return Response.json({ status: "answered", answer: example });
  }
  if (init?.method === "DELETE") { fixtureChats = []; return Response.json({ deleted: true }); }
  if (url === "/api/v1/advisor/conversations") return Response.json({ conversations: fixtureChats, hasMore: false });
  throw new Error("This fixture does not make network requests.");
};
function Preview() {
  const initial = new URLSearchParams(location.search).get("state") ?? "welcome";
  const [state, setState] = useState(initial), [question, setQuestion] = useState("");
  const [sent, setSent] = useState((initial === "welcome" || initial === "pending") ? "" : "Which KPIs need attention, and why?");
  const provider: AdvisorMode = "openai";
  const savedConsent = useAdvisorConsent(fixtureFetch, "fictional-workspace");
  const activeRequest = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [purpose, setPurpose] = useState<"analysis" | "help">("analysis");
  async function ask(event: FormEvent) {
    event.preventDefault(); setSent(question); setError(""); setState("thinking");
    const controller = new AbortController(); activeRequest.current = controller;
    try {
      await readAdvisorAnswer(fixtureFetch, { question, provider, conversationId: null, dataUseAccepted: true, memoryEnabled }, controller.signal, initial === "timeout" ? 1800 : 75_000);
      if (activeRequest.current === controller) { setQuestion(""); setState("answer"); }
    } catch (failure) { if (activeRequest.current === controller) { setError(failure instanceof Error ? failure.message : "Could not complete the reply."); setState("error"); } }
    finally { if (activeRequest.current === controller) activeRequest.current = null; }
  }
  return <div className="operating-shell"><main className="content advisor-page"><AdvisorComposer purpose={purpose} onPurpose={value => { setPurpose(value); setSent(""); setQuestion(""); setState("welcome"); }} privacyControls={<AdvisorPrivacy fetcher={fixtureFetch} disabled={state === "thinking"} onDeleted={() => { setState("welcome"); setSent(""); }}/>} memoryEnabled={memoryEnabled} onMemory={value => { setMemoryEnabled(value); setSent(""); setState("welcome"); }} question={question} onQuestion={setQuestion} dataUseAccepted={savedConsent.consent[purpose]} onConsent={accepted => void savedConsent.refresh(accepted, purpose)} consentLoading={savedConsent.busy} consentError={savedConsent.error} onConsentRetry={() => void savedConsent.refresh()} onStop={() => { activeRequest.current?.abort(); activeRequest.current = null; setError("Response stopped. You can edit or resend your question."); setState("error"); }} loading={state === "thinking"} onSubmit={ask} provider={provider} providers={{ openai: { ready: initial !== "pending", reason: "Secure setup is pending in this example." } }} hasConversation={Boolean(sent)} onNewChat={() => { setState("welcome"); setSent(""); setQuestion(""); setError(""); }}>
    {sent && <div className="ai-user-message"><small>You</small>{sent}</div>}
    {state === "thinking" && <AdvisorThinking/>}
    {error && <div className="ai-response-error" role="status"><strong>Reply not completed</strong><p>{error}</p></div>}
    {state === "answer" && <AdvisorResponse title="Vanteloq AI" body={example} animate limitation="Visual fixture only. No customer data, AI request or business action."/>}
  </AdvisorComposer></main></div>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);
