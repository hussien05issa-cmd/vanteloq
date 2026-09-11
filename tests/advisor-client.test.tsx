import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { requestAdvisorAnalysis } from "../app/advisor-client";
import AdvisorThinking from "../app/advisor-thinking";
import AdvisorComposer from "../app/advisor-composer";
import { AdvisorAnswerContent } from "../app/advisor-response";
import { ADVISOR_CONSENT_NOTICE_VERSION, PRIVACY_POLICY_VERSION } from "../domain/privacy-controls";

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
  assert.match(markup, /<th scope="col">KPI/);
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
  assert.match(markup, /Saved chats stay until you delete them/);
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
