import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import OwnerBriefingPanel from "../app/owner-briefing";
import { buildOwnerBriefing, type OwnerBriefingSignal } from "../domain/owner-briefing";

const hours = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => ({ day, open: "09:00", close: "17:00", closed: false }));
const signal: OwnerBriefingSignal = { id: "cash", title: "Review your recorded cash balance", detail: "The verified balance is negative.", nextStep: "Confirm the balance and upcoming commitments.", category: "cash", destination: "BookLoQ", severity: "critical", evidence: [{ label: "Cash", value: "-$125.00", source: "Fictional bank fixture", asOf: "2026-10-05T14:15:00Z" }] };
const brief = (signals: OwnerBriefingSignal[]) => buildOwnerBriefing({ now: "2026-10-05T14:30:00Z", timezone: "America/Edmonton", hours, signals });

test("critical findings retain a visible alert, named source and exact next step", () => {
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief([signal])} scopeLabel="Test location" sourcePeriod={{ from: "2026-09-06", to: "2026-10-05" }} onEvidence={() => {}}/>);
  assert.match(html, /role="alert"/);
  assert.match(html, /1 critical/);
  assert.match(html, /Confirm the balance and upcoming commitments/);
  assert.match(html, /Test location/);
  assert.match(html, /2026-09-06 to 2026-10-05/);
  assert.match(html, /Fictional bank fixture/);
  assert.doesNotMatch(html, /Create an action|Explain with AI/);
});

test("insufficient evidence does not announce an all-clear or invent paid action controls", () => {
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief([{ ...signal, status: "estimate" }])} onEvidence={() => {}}/>);
  assert.doesNotMatch(html, /role="alert"|1 critical|Create an action|Explain with AI/);
  assert.match(html, /does not mean every balance or obligation has been checked/);
});

test("authorized action, AI and outcome pathways are separate explicit controls", () => {
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief([signal])} onEvidence={() => {}} onAction={() => {}} onAsk={() => {}} onReview={() => {}}/>);
  for (const label of ["Review records", "Create an action", "Explain with AI", "Review actions &amp; outcomes"]) assert.ok(html.includes(label), label);
});
