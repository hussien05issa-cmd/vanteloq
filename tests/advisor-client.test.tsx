import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readAdvisorAnswer, requestAdvisorAnalysis } from "../app/advisor-client";
import AdvisorThinking from "../app/advisor-thinking";
import AdvisorComposer from "../app/advisor-composer";
import AdvisorResponse, { AdvisorAnswerContent } from "../app/advisor-response";
import { ADVISOR_CONSENT_NOTICE_VERSION, PRIVACY_POLICY_VERSION } from "../domain/privacy-controls";

test("one chat combines business and product questions with data sharing in Settings", () => {
  for (const purpose of ["analysis", "help"] as const) {
    const markup = renderToStaticMarkup(<AdvisorComposer purpose={purpose} onPurpose={() => {}} question="" onQuestion={() => {}} dataUseAccepted={false} onConsent={() => {}} loading={false} onSubmit={() => {}}/>);
    assert.doesNotMatch(markup, /Conversation purpose|>Business analysis<|>App help</);
    assert.match(markup, /What can I help you with/);
    assert.match(markup, /Help me get started/);
    assert.match(markup, /Review cash &amp; books/);
    const context = markup.match(/<input[^>]+aria-label="Include workspace data"[^>]*>/)?.[0];
    assert.ok(context);
    assert.equal(context.includes('checked=""'), purpose === "analysis");
    assert.ok(markup.indexOf(context) > markup.indexOf('<dialog'));
    assert.match(markup, /type="submit" disabled=""/);
    if (purpose === "help") assert.match(markup, /No workspace records are attached/);
  }
});

test("each provider selection travels with its consent and conversation to the advisor endpoint", async () => {
  for (const provider of ["openai"] as const) {
    let sent: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = async (url, init) => {
      assert.equal(url, "/api/v1/advisor/chat");
      assert.equal(init?.method, "POST");
      sent = JSON.parse(String(init?.body));
      return Response.json({ answer: "Test answer" });
    };
    const response = await requestAdvisorAnalysis(fetcher, { question: "Which KPIs changed?", provider, conversationId: "conversation-a", dataUseAccepted: true, memoryEnabled: false, locationId: "selected-location" });
    assert.equal(response.ok, true);
    assert.deepEqual(sent, { question: "Which KPIs changed?", provider, conversationId: "conversation-a", dataUseAccepted: true, memoryEnabled: false, locationId: "selected-location", noticeVersion: ADVISOR_CONSENT_NOTICE_VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION });
  }
});

test("thinking is announced as status and clearing never claims to analyze data", () => {
  const status = renderToStaticMarkup(<AdvisorThinking/>);
  assert.match(status, /role="status"/);
  assert.match(status, /Vanteloq AI is thinking/);
  assert.match(status, /is-thinking/);
  const clearing = renderToStaticMarkup(<AdvisorComposer question="Sales?" onQuestion={() => {}} dataUseAccepted loading thinking={false} onConsent={() => {}} onSubmit={() => {}}/>);
  assert.match(clearing, /Clearing…/);
  assert.doesNotMatch(clearing, /Analyzing…|Reviewing the permitted business context/);
});

test("financial answers render readable tables and lists while keeping provider text inert", () => {
  const markup = renderToStaticMarkup(<AdvisorAnswerContent text={'## Sales review\n| KPI | Value |\n| --- | ---: |\n| Gross margin | **Unavailable** |\n- Verify missing product costs\n1. Review the source\n<img src=x onerror=alert(1)>\n[Run code](javascript:alert(1))'}/>);
  assert.match(markup, /<h4>Sales review<\/h4>/);
  assert.match(markup, /<th scope="col"[^>]*>KPI/);
  assert.match(markup, /<strong>Unavailable<\/strong>/);
  assert.match(markup, /<ul><li>Verify missing product costs/);
  assert.match(markup, /<ol start="1"><li>Review the source/);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /<img|<script|href=/);
});

test("chat settings are labelled and closed initially while consent stays in the composer", () => {
  const markup = renderToStaticMarkup(<AdvisorComposer question="" onQuestion={() => {}} dataUseAccepted={false} onConsent={() => {}} loading={false} onSubmit={() => {}} onMemory={() => {}} onNewChat={() => {}}/>);
  assert.match(markup, /aria-haspopup="dialog" aria-controls="advisor-settings"/);
  assert.match(markup, /<dialog[^>]*aria-labelledby="advisor-settings-title"/);
  assert.doesNotMatch(markup, /<dialog[^>]* open=/);
  assert.match(markup, /role="switch" aria-label="Conversation memory"/);
  assert.doesNotMatch(markup, /type="checkbox"[^>]*checked=""/);
  assert.match(markup, /Saved chats are removed after 90 days of inactivity/);
  assert.match(markup, /New chat/);
  assert.ok(markup.indexOf('class="ai-consent"') < markup.indexOf('<dialog'));
  assert.match(markup, /aria-controls="advisor-suggestions"/);
});

test("unavailable providers cannot receive a question even after consent", () => {
  const markup = renderToStaticMarkup(<AdvisorComposer question="Which KPIs changed?" onQuestion={() => {}} dataUseAccepted onConsent={() => {}} loading={false} onSubmit={() => {}} provider="openai" providers={{openai:{ready:false,reason:"OpenAI setup required."}}}/>);
  assert.match(markup, /type="submit" disabled=""/);
  assert.match(markup, /Provider setup needed/);
  assert.match(markup, /OpenAI setup required/);
});

test("a pending availability check keeps sending disabled without claiming setup is missing", () => {
  const markup = renderToStaticMarkup(<AdvisorComposer question="Which KPIs changed?" onQuestion={() => {}} dataUseAccepted onConsent={() => {}} loading={false} onSubmit={() => {}} providersLoading providers={{openai:{ready:false,reason:"Checking OpenAI availability."}}}/>);
  assert.match(markup, /type="submit" disabled=""/);
  assert.match(markup, /Checking OpenAI availability…/);
  assert.doesNotMatch(markup, /Provider setup needed/);
});

test("accepted consent stays out of the message box and can be withdrawn in Settings", () => {
  const markup = renderToStaticMarkup(<AdvisorComposer question="Sales?" onQuestion={() => {}} dataUseAccepted onConsent={() => {}} loading={false} onSubmit={() => {}} providers={{openai:{ready:true}}}/>);
  assert.doesNotMatch(markup, /I agree to send|class="ai-consent-row"/);
  assert.match(markup, /New chats keep this choice/);
  assert.ok(markup.indexOf("Withdraw agreement") > markup.indexOf("<dialog"));
  const pending = renderToStaticMarkup(<AdvisorComposer question="Sales?" onQuestion={() => {}} dataUseAccepted consentLoading onConsent={() => {}} loading={false} onSubmit={() => {}} providers={{openai:{ready:true}}}/>);
  assert.match(pending, /type="submit" disabled=""/);
  assert.match(pending, /Checking your data-use setting/);
});

test("waiting has an enabled stop control and answers avoid duplicate headings", () => {
  const markup = renderToStaticMarkup(<AdvisorComposer question="Sales?" onQuestion={() => {}} dataUseAccepted onConsent={() => {}} loading thinking onStop={() => {}} onSubmit={() => {}}/>);
  assert.match(markup, /type="button" aria-label="Stop response"/);
  const answer = renderToStaticMarkup(<AdvisorResponse title="Vanteloq AI" body="Review the evidence." limitation="Example only."/>);
  assert.doesNotMatch(answer, /<h3>Vanteloq AI/);
  assert.match(answer, /Review the evidence/);
});

const requestInput = { question: "Sales?", provider: "openai" as const, conversationId: null, dataUseAccepted: true, memoryEnabled: false };
test("the entire request times out even when auth, fetch or response parsing stalls", async () => {
  for (const fetcher of [
    (async () => new Promise<Response>(() => {})) as typeof fetch,
    (async () => ({ json: () => new Promise(() => {}) })) as unknown as typeof fetch,
  ]) {
    const controller = new AbortController();
    await assert.rejects(readAdvisorAnswer(fetcher, requestInput, controller.signal, 20), error => error instanceof DOMException && error.name === "TimeoutError");
  }
});

test("stop aborts the request transport and cannot return a late answer", async () => {
  const controller = new AbortController();
  let transport: AbortSignal | null | undefined;
  let complete: (response: Response) => void = () => {};
  const fetcher: typeof fetch = async (_, init) => { transport = init?.signal; return new Promise<Response>(resolve => { complete = resolve; }); };
  const result = readAdvisorAnswer(fetcher, requestInput, controller.signal, 5000);
  controller.abort();
  await assert.rejects(result, error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(transport?.aborted, true);
  complete(Response.json({answer:"Late answer"}));
});

test("progressive replies retain full financial tables and accessible text immediately", () => {
  const markup = renderToStaticMarkup(<AdvisorAnswerContent animate text={"| KPI | Amount |\n| --- | --- |\n| Net sales | CAD $12,345.67 |\nThe complete answer is available immediately."}/>);
  assert.match(markup, /CAD \$12,345\.67/);
  assert.match(markup, /The complete answer is available immediately/);
  assert.doesNotMatch(markup, /aria-hidden|visibility:hidden|display:none/);
});
