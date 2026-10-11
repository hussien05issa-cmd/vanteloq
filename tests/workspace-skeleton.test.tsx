import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import WorkspaceSkeleton from "../app/workspace-skeleton";
import ExecutiveOverview from "../app/executive-overview";
import { dashboardPreferencePreset } from "../domain/dashboard-preferences";

test("dashboard loading reserves the four-card overview and its chart, goals, attention and AI regions", () => {
  const html = renderToStaticMarkup(<WorkspaceSkeleton label="Loading executive overview" variant="overview"/>);
  assert.equal((html.match(/class="skeleton-metric-card /g) ?? []).length, 4);
  for (const panel of ["trend", "goals", "attention", "advisor", "collections", "composition", "recent"]) assert.ok(html.includes(`skeleton-${panel}-panel`), panel);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true" aria-label="Loading executive overview" aria-busy="true"/);
  assert.match(html, /class="skeleton-overview-shape" aria-hidden="true"/);
  assert.equal(html.replace(/<[^>]*>/g, ""), "Loading executive overview");
  assert.doesNotMatch(html, /<button|<input|<svg|role="img"|\$|\d+%/);
});

test("loading follows saved metric widths, visibility and optional section choices", () => {
  const overview = dashboardPreferencePreset();
  overview.widgets = overview.widgets.map((widget, index) => ({ ...widget, visible: index < 2, size: index === 0 ? "wide" : "standard" }));
  overview.sections = { needsAttention: false, collections: false, financialDetail: false };
  const html = renderToStaticMarkup(<WorkspaceSkeleton variant="overview" heading={false} overview={overview} summary={false}/>);
  assert.equal((html.match(/class="skeleton-metric-card /g) ?? []).length, 2);
  assert.equal((html.match(/skeleton-metric-card size-wide/g) ?? []).length, 1);
  assert.match(html, /skeleton-overview-inline/);
  assert.doesNotMatch(html, /skeleton-overview-heading|skeleton-attention-panel|skeleton-collections-panel|skeleton-summary-panels|skeleton-financial-disclosure/);
  assert.match(html, /skeleton-goals-panel/);
  assert.match(html, /skeleton-advisor-panel/);
});

test("hiding every metric does not fabricate replacement metric cards or a trend", () => {
  const overview = dashboardPreferencePreset();
  overview.widgets = overview.widgets.map(widget => ({ ...widget, visible: false }));
  const html = renderToStaticMarkup(<WorkspaceSkeleton variant="overview" overview={overview}/>);
  assert.match(html, /skeleton-no-metrics/);
  assert.doesNotMatch(html, /skeleton-metric-card|skeleton-trend-panel/);
});

test("a compact overview reserves only its metrics and trend", () => {
  const html = renderToStaticMarkup(<WorkspaceSkeleton variant="overview" compact heading={false}/>);
  assert.match(html, /skeleton-metric-card/);
  assert.match(html, /skeleton-trend-panel/);
  assert.doesNotMatch(html, /skeleton-goals-panel|skeleton-attention-panel|skeleton-advisor-panel|skeleton-collections-panel|skeleton-summary-panels|skeleton-financial-disclosure/);
});

test("existing compact record loaders keep their list shape and descriptive status", () => {
  const html = renderToStaticMarkup(<WorkspaceSkeleton compact label="Loading your actions"/>);
  assert.match(html, /class="workspace-skeleton compact"/);
  assert.match(html, /skeleton-records/);
  assert.match(html, /aria-label="Loading your actions"/);
  assert.doesNotMatch(html, /skeleton-overview-shape/);
});

test("the real pending dashboard uses the shared shape without fictional amounts", () => {
  const html = renderToStaticMarkup(<ExecutiveOverview currency="CAD" navigate={() => {}}/>);
  assert.match(html, /Loading executive overview/);
  assert.equal((html.match(/class="skeleton-metric-card /g) ?? []).length, 4);
  assert.match(html, /skeleton-trend-panel/);
  assert.match(html, /skeleton-goals-panel/);
  assert.doesNotMatch(html, /\$|Sample Preview|Fictional Data/);
});
