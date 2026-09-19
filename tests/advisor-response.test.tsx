import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import AdvisorResponse, { AdvisorAnswerContent } from "../app/advisor-response";

test("wrapped prose remains one paragraph and list hierarchy stays with its parent", () => {
  const markup = renderToStaticMarkup(<AdvisorAnswerContent text={"Start with the cash balance\nand compare it with upcoming bills.\n\n## Next steps\n1. Check the source\n   - Confirm **invoice dates**\n   - Confirm amounts\n\n   Record any missing evidence.\n2. Review the result\n\nKeep the final decision with the owner."}/>);
  assert.match(markup, /<p>Start with the cash balance and compare it with upcoming bills\.<\/p>/);
  assert.match(markup, /<ol start="1"><li>Check the source<ul><li>Confirm <strong>invoice dates<\/strong><\/li><li>Confirm amounts<\/li><\/ul><p>Record any missing evidence\.<\/p><\/li><li>Review the result<\/li><\/ol>/);
  assert.match(markup, /<p>Keep the final decision with the owner\.<\/p>/);
});

test("code examples preserve whitespace and never interpret HTML or embedded Markdown", () => {
  const markup = renderToStaticMarkup(<AdvisorAnswerContent text={'Use `net_sales` and *check the source*.\n\n```html\n<div onclick="steal()">\n\t**literal**\n</div>\n```\n\n[Run](javascript:alert(1))\n<script>alert(1)</script>'}/>);
  assert.match(markup, /<code>net_sales<\/code>/);
  assert.match(markup, /<em>check the source<\/em>/);
  assert.match(markup, /<pre[^>]+><code>&lt;div onclick=&quot;steal\(\)&quot;&gt;\n\t\*\*literal\*\*\n&lt;\/div&gt;<\/code><\/pre>/);
  assert.doesNotMatch(markup, /<script|<div onclick=|href=|<strong>literal/);
});

test("table alignment and escaped separators preserve the financial values", () => {
  const markup = renderToStaticMarkup(<AdvisorAnswerContent text={'| Source | Balance |\n| :--- | ---: |\n| A \\| B | CAD $12,345.67 |\n| `cash|bank` | **Unavailable** |'}/>);
  assert.match(markup, /<th scope="col" style="text-align:right">Balance/);
  assert.match(markup, /<td style="text-align:left">A \| B<\/td>/);
  assert.match(markup, /<td style="text-align:right">CAD \$12,345\.67<\/td>/);
  assert.match(markup, /<code>cash\|bank<\/code>/);
  assert.match(markup, /<strong>Unavailable<\/strong>/);
  assert.match(markup, /tabindex="0" role="region" aria-label="Analysis data table"/);
});

test("a long answer has a short bounded transition without removing any content", () => {
  const body = Array.from({ length: 1000 }, (_, index) => `word${index}`).join(" ");
  const animated = renderToStaticMarkup(<AdvisorAnswerContent text={body} animate/>);
  const delays = [...animated.matchAll(/--ai-reveal-delay:(\d+)ms/g)].map(match => Number(match[1]));
  assert.ok(delays.length > 1);
  assert.equal(delays[0], 0);
  assert.equal(Math.max(...delays), 1200);
  assert.match(animated, /word999/);
  assert.equal(animated.replace(/<[^>]+>/g, ""), body);
  assert.doesNotMatch(animated, /aria-hidden|visibility:hidden|display:none/);
  const immediate = renderToStaticMarkup(<AdvisorAnswerContent text={body}/>);
  assert.doesNotMatch(immediate, /ai-reply-chunk|ai-reveal-delay/);
});

test("the initial accessible answer includes its complete text and limitation", () => {
  const markup = renderToStaticMarkup(<AdvisorResponse title="Vanteloq AI" body="**Check cash.** Review missing costs." limitation="Based on permitted evidence." animate/>);
  assert.match(markup, /<strong>Check cash\.<\/strong> Review missing costs\./);
  assert.match(markup, /Based on permitted evidence/);
  assert.match(markup, /Reply ready/);
  assert.doesNotMatch(markup, /Vanteloq AI is writing|Show full answer|class="ai-response-body" aria-hidden/);
});


test("filenames and metric identifiers keep their literal underscores", () => {
  const markup = renderToStaticMarkup(<AdvisorAnswerContent text={"TEST_ONLY_AI_receipt.pdf, net_revenue_cents and sample__file.csv. _Emphasis_ and __strong text__ remain supported."}/>);
  assert.match(markup, /TEST_ONLY_AI_receipt\.pdf, net_revenue_cents and sample__file\.csv/);
  assert.match(markup, /<em>Emphasis<\/em>/);
  assert.match(markup, /<strong>strong text<\/strong>/);
});
