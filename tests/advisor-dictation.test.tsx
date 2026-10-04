import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import AdvisorComposer from "../app/advisor-composer";
import AdvisorDictation, { DICTATION_CHARACTER_LIMIT, DICTATION_DURATION_MS, dictationText, dictationTranscript } from "../app/advisor-dictation";

const results = (...transcripts: string[]) => transcripts.map(transcript => [{ transcript }]);

test("dictation appends to an intact typed prefix and preserves deliberate whitespace", () => {
  assert.equal(dictationText("  Review Q3:\n", "  compare margins  "), "  Review Q3:\ncompare margins");
  assert.equal(dictationText("Revenue", " grew"), "Revenue grew");
  assert.equal(dictationText("Revenue  ", "grew"), "Revenue  grew");
  assert.equal(dictationText("", " Review margins "), "Review margins");
});

test("an empty transcript leaves the existing draft unchanged", () => {
  assert.equal(dictationText(" Keep my draft \n", "  "), " Keep my draft \n");
  assert.equal(dictationTranscript(results()), "");
});

test("cumulative recognition results can be replayed without duplicating final words", () => {
  const cumulative = results("Sales increased.", "Review margins.");
  const first = dictationText("Question:", dictationTranscript(cumulative));
  const replay = dictationText("Question:", dictationTranscript(cumulative));
  assert.equal(first, "Question: Sales increased. Review margins.");
  assert.equal(replay, first);
});

test("a revised or removed interim result replaces its prior wording", () => {
  const prefix = "Question:";
  assert.equal(dictationText(prefix, dictationTranscript(results("Sales increased.", "review mar"))), "Question: Sales increased. review mar");
  assert.equal(dictationText(prefix, dictationTranscript(results("Sales increased.", "Review margins."))), "Question: Sales increased. Review margins.");
  assert.equal(dictationText(prefix, dictationTranscript(results("Sales increased."))), "Question: Sales increased.");
});

test("dictation respects the textarea limit including separator space", () => {
  assert.equal(DICTATION_CHARACTER_LIMIT, 800);
  assert.equal(DICTATION_DURATION_MS, 30_000);
  assert.equal(dictationText("x".repeat(798), "a longer phrase"), `${"x".repeat(798)} a`);
  assert.equal(dictationText("x".repeat(800), "more words"), "x".repeat(800));
  assert.equal(dictationText("", "y".repeat(900)).length, 800);
});

test("a character limit never leaves half of a spoken emoji", () => {
  const clipped = dictationText("x".repeat(798), "😀 next");
  assert.equal(clipped, `${"x".repeat(798)} `);
  assert.equal(clipped.isWellFormed(), true);
  assert.equal(dictationText("x".repeat(797), "😀 next"), `${"x".repeat(797)} 😀`);
});

test("the microphone is a labelled non-submit control and does not start during rendering", () => {
  let writes = 0;
  const markup = renderToStaticMarkup(<AdvisorDictation question="Existing question" onQuestion={() => { writes += 1; }} disabled={false}/>);
  assert.match(markup, /type="button"[^>]*aria-label="Dictate a message"/);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /Browser microphone permission is required/);
  assert.doesNotMatch(markup, /type="submit"|role="group"|Listening\./);
  assert.equal(writes, 0);
});

test("the composer includes microphone and send controls while retaining the data-use gate", () => {
  const markup = renderToStaticMarkup(<AdvisorComposer question="Review sales" onQuestion={() => {}} dataUseAccepted={false} onConsent={() => {}} loading={false} onSubmit={() => {}} providers={{ openai: { ready: true } }}/>);
  assert.ok(markup.indexOf('class="ai-send-tools"') < markup.indexOf('aria-label="Dictate a message"'));
  assert.match(markup, /type="submit" disabled=""/);
  assert.match(markup, /Accept the data-use notice to send/);
});
