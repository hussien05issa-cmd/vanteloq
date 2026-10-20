import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskCentre } from "../app/vanteloq-app";
import TaskReadSummary from "../app/task-read-summary";
import WorkspaceSkeleton from "../app/workspace-skeleton";

test("the real initial task read shows pending counts instead of reporting zero tasks", () => {
  const html = renderToStaticMarkup(<TaskCentre activeLocationId={null} showNotice={() => {}} openComposer={() => {}} navigate={() => {}} onReviewOutcome={() => {}}/>);
  const statistics = html.match(/<section class="task-stats"[\s\S]*?<\/section>/)?.[0];
  assert.ok(statistics, "the existing statistics region remains present");
  assert.doesNotMatch(statistics, /<strong>0<\/strong>/, "a pending read must not claim actual zero counts");
  assert.match(statistics, /aria-busy="true"/);
  assert.doesNotMatch(html, /0 loaded tasks|End of the accessible archive|No assigned actions/);
  assert.match(html, /Loading tasks/);
  assert.match(html, /skeleton-task-row/);
  assert.doesNotMatch(html, /skeleton-metrics/);
});

test("a failed initial task read reports unavailable counts and no archive conclusion", () => {
  const html = renderToStaticMarkup(<TaskReadSummary loading={false} error="Access denied" loaded={0} active={0} highPriority={0} fromIntelligence={0} completed={0} hasEarlier={false}/>);
  assert.match(html, /Task counts are unavailable/);
  assert.match(html, /Refresh actions to retry/);
  assert.equal((html.match(/<strong[^>]*>Unavailable<\/strong>/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<strong>0<\/strong>|0 loaded tasks|End of the accessible archive|Earlier tasks are available/);
  assert.match(html, /aria-busy="false"/);
});

test("a failed refresh does not present retained counts as current or infer the archive end", () => {
  const html = renderToStaticMarkup(<TaskReadSummary loading={false} error="Unable to load actions" loaded={8} active={6} highPriority={2} fromIntelligence={3} completed={2} hasEarlier={true}/>);
  assert.equal((html.match(/<strong[^>]*>Unavailable<\/strong>/g) ?? []).length, 4);
  assert.doesNotMatch(html, /8 loaded tasks|<strong>6<\/strong>|End of the accessible archive|Earlier tasks are available/);
});

test("revoked access during an earlier-page read reports unavailable counts after tasks are cleared", () => {
  const html = renderToStaticMarkup(<TaskReadSummary loading={false} error="" archiveError="Access denied" loaded={0} active={0} highPriority={0} fromIntelligence={0} completed={0} hasEarlier={false}/>);
  assert.match(html, /Task counts are unavailable/);
  assert.equal((html.match(/<strong[^>]*>Unavailable<\/strong>/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<strong>0<\/strong>|0 loaded tasks|End of the accessible archive|Earlier tasks are available/);
});

test("an earlier-page read failure keeps retained loaded-page counts and qualifies the archive status", () => {
  const html = renderToStaticMarkup(<TaskReadSummary loading={false} error="" archiveError="Unable to load earlier tasks" loaded={9} active={7} highPriority={3} fromIntelligence={4} completed={2} hasEarlier={true}/>);
  for (const [count, label] of [[7, "Active"], [3, "High priority"], [4, "From intelligence"], [2, "Completed"]]) assert.ok(html.includes(`<strong>${count}</strong><span>${label}</span>`));
  assert.match(html, /9 loaded tasks\. Earlier tasks could not be loaded\. Counts and filters describe retained loaded tasks\./);
  assert.doesNotMatch(html, /End of the accessible archive|Earlier tasks are available|Unavailable|task-count-placeholder/);
});

test("a successful empty task response shows actual zeros and confirms the accessible archive end", () => {
  const html = renderToStaticMarkup(<TaskReadSummary loading={false} error="" loaded={0} active={0} highPriority={0} fromIntelligence={0} completed={0} hasEarlier={false}/>);
  assert.equal((html.match(/<strong>0<\/strong>/g) ?? []).length, 4);
  assert.match(html, /0 loaded tasks\. End of the accessible archive\./);
  assert.doesNotMatch(html, /Unavailable|task-count-placeholder|Loading tasks/);
});

test("populated summaries preserve each supplied count and the loaded-page archive qualification", () => {
  const html = renderToStaticMarkup(<TaskReadSummary loading={false} error="" loaded={9} active={7} highPriority={3} fromIntelligence={4} completed={2} hasEarlier={true}/>);
  for (const [count, label] of [[7, "Active"], [3, "High priority"], [4, "From intelligence"], [2, "Completed"]]) assert.ok(html.includes(`<strong>${count}</strong><span>${label}</span>`));
  assert.match(html, /9 loaded tasks\. Earlier tasks are available below\. Counts and filters describe loaded tasks\./);
  assert.doesNotMatch(html, /End of the accessible archive|Unavailable|task-count-placeholder/);
});

test("task board loading exposes a single real status and hides decorative rows from assistive technology", () => {
  const html = renderToStaticMarkup(<WorkspaceSkeleton compact variant="tasks" label="Loading your actions"/>);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true" aria-label="Loading your actions" aria-busy="true"/);
  assert.match(html, /class="skeleton-task-list" aria-hidden="true"/);
  assert.equal(html.replace(/<[^>]*>/g, ""), "Loading your actions");
  assert.doesNotMatch(html, /<button|<input|<select|skeleton-metrics|skeleton-heading/);
});
