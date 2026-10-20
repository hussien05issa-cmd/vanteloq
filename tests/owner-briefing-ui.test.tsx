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

test("a selected lower-ranked priority exposes its exact records and next step without adding permissions", () => {
  const signals = Array.from({ length: 5 }, (_, index) => ({ ...signal, id: `finding-${index}`, severity: "medium" as const, title: `Finding ${index}`, nextStep: `Check fixture ${index}`, evidence: [{ label: "Fixture source", value: `Value ${index}`, source: `Source ${index}` }] }));
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief(signals)} selectedPriority={{ id: "finding-4", request: 1 }} onEvidence={() => {}}/>);
  const selected = html.slice(html.indexOf('data-briefing-priority="finding-4"')).split("</article>")[0];
  assert.match(selected, /class="owner-priority-detail" open=""/);
  assert.match(selected, /class="owner-briefing-evidence" open=""/);
  assert.match(selected, /Check fixture 4/);
  assert.match(selected, /Value 4/);
  assert.match(selected, /Source 4/);
  assert.doesNotMatch(selected, /Source 0|Create an action|Explain with AI/);
});

test("a removed or unauthorized selected priority cannot reveal a stale finding", () => {
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief([{ ...signal, status: "unavailable" }])} selectedPriority={{ id: signal.id, request: 1 }} onEvidence={() => {}}/>);
  assert.doesNotMatch(html, /Fictional bank fixture|\-\$125|data-briefing-priority=/);
  assert.match(html, /No supported exception/);
});

test("scan view exposes three closed priorities with recorded values, source dates and clear severity", () => {
  const signals = Array.from({ length: 5 }, (_, index) => ({ ...signal, id: `finding-${index}`, severity: "medium" as const, title: `Finding ${index}` }));
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief(signals)} onEvidence={() => {}}/>);
  assert.equal((html.match(/data-briefing-priority=/g) ?? []).length, 3);
  assert.doesNotMatch(html, /class="owner-priority-detail" open=|owner-briefing-rank/);
  assert.match(html, /Show all 5 priorities/);
  const summary = html.slice(html.indexOf('class="owner-priority-summary"')).split("</summary>")[0];
  assert.match(summary, /Cash/);
  assert.match(summary, /-\$125\.00/);
  assert.match(summary, /Fictional bank fixture/);
  assert.match(summary, /Source dated.*America\/Edmonton/);
});

test("every critical finding stays in the scan view even when the critical queue exceeds five", () => {
  const signals = Array.from({ length: 7 }, (_, index) => ({ ...signal, id: `critical-${index}`, title: `Critical finding ${index}` }));
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief(signals)} onEvidence={() => {}}/>);
  assert.match(html, /7 critical/);
  assert.equal((html.match(/data-briefing-priority=/g) ?? []).length, 7);
  assert.doesNotMatch(html, /class="owner-priority-detail" open=/);
});

test("missing and mixed source dates remain visible rather than acquiring the briefing preparation date", () => {
  const evidence = [{ label: "Cash", value: "$10", source: "Cash record" }, { label: "Bills", value: "$20", source: "Bill record", asOf: "2026-10-04" }];
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief([{ ...signal, evidence }])} onEvidence={() => {}}/>);
  const summary = html.slice(html.indexOf('class="owner-priority-summary"')).split("</summary>")[0];
  assert.match(summary, /2 recorded sources/);
  assert.match(summary, /Some source dates not supplied/);
  assert.doesNotMatch(summary, /Source dated Oct 5/);
  assert.match(html, /Cash record.*Source date not supplied/);
});

test("a loading empty briefing shows stable placeholders without claiming a completed review", () => {
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief([])} sourceStatus={{ state: "loading", message: "The connected source is refreshing." }} onEvidence={() => {}}/>);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /owner-briefing-loading/);
  assert.match(html, /The connected source is refreshing/);
  assert.doesNotMatch(html, /No supported exception|0 to review|owner-briefing-empty/);
});

test("a source error retains prior findings and offers a real source recovery callback", () => {
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief([signal])} sourceStatus={{ state: "error", message: "The latest refresh did not finish. Review the source status before acting." }} onRetry={() => {}} onEvidence={() => {}}/>);
  assert.match(html, /state-error" role="alert"/);
  assert.match(html, /Review source status/);
  assert.match(html, /data-briefing-priority="cash"/);
  assert.match(html, /Fictional bank fixture/);
});

test("partial evidence and omitted ordinary findings are disclosed without adding unauthorized controls", () => {
  const signals = Array.from({ length: 8 }, (_, index) => ({ ...signal, id: `ordinary-${index}`, severity: "medium" as const }));
  const html = renderToStaticMarkup(<OwnerBriefingPanel briefing={brief([...signals, { ...signal, id: "estimated", status: "estimate" }])} onEvidence={() => {}}/>);
  assert.match(html, /1 supplied item was excluded/);
  assert.match(html, /3 additional recorded items are available/);
  assert.doesNotMatch(html, /Create an action|Explain with AI|Try again/);
});
