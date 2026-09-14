import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import DecisionWorkspace from "../app/decision-workspace";
import { buildOperatingSystem } from "../server/operating-system";
import { ReportsWorkspace } from "../app/control-workspaces";

const noop = () => {};
const base = { period: null, freshness: "missing", verifiedDays: 0, onConnections: noop, onEvidence: noop, onActions: noop };
test("empty opportunities distinguish missing evidence from a healthy business", () => {
  const html = renderToStaticMarkup(<DecisionWorkspace {...base} decisions={[]}/>);
  assert.match(html, /Insufficient data/);
  assert.match(html, /No supported opportunities yet/);
  assert.doesNotMatch(html, /100|healthy|Create action|Ask Vanteloq AI/);
});
test("the board retains actual evidence, missing inputs and permission-gated actions", () => {
  const { decisions } = buildOperatingSystem({ ready: true, currency: "CAD", source: { rowCount: 60, freshness: "stale", latestBusinessDate: "2026-09-01" }, balances: null, dataQuality: { status: "usable", missingDimensions: [] }, insights: [{ id: "sales-trend", severity: "attention", title: "Sales changed", whatHappened: "$500 lower recorded sales", financialImpact: "Recovery not estimated", recommendedAction: "Review purchase counts", confidence: "medium", evidence: ["60 recorded dates"], missingInformation: ["Opening hours"] }] });
  const html = renderToStaticMarkup(<DecisionWorkspace {...base} decisions={decisions} verifiedDays={60} freshness="stale" onAction={noop} onAsk={noop}/>);
  assert.match(html, /\$500 lower recorded sales/);
  assert.match(html, /Opening hours/);
  assert.match(html, /Delayed/);
  assert.match(html, /not a probability of success/);
  assert.match(html, /Create action/);
  assert.match(html, /Ask Vanteloq AI/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("an opportunity report starts with the evidence period rather than all history", () => {
  const html = renderToStaticMarkup(<ReportsWorkspace currency="CAD" showNotice={noop} createTask={noop} activeLocationId="selected-location" canExportFeature={false} initialPeriod={{ from: "2026-08-05", to: "2026-09-03" }}/>);
  assert.match(html, /value="2026-08-05"/);
  assert.match(html, /value="2026-09-03"/);
});
