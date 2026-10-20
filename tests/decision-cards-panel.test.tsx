import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import DecisionCardsPanel, { decisionCardValue } from "../app/decision-cards-panel";
import type { DecisionCard } from "../domain/decision-cards";

const card: DecisionCard = {
  id: "fixture", kind: "bills_due", title: "Which bills need review?", status: "recorded",
  value: { amount: 10008, unit: "minor_currency", currency: "CAD" }, summary: "Reviewed outstanding bill amounts.",
  evidence: { asOf: "2026-10-11", period: { from: "2026-10-11", to: "2026-10-18" },
    sources: [{ system: "Fictional approved bills", currency: "CAD", recordCount: 150, recordIds: Array.from({ length: 100 }, (_, index) => `bill:${index}`), referencesTruncated: true }],
    formula: "Recorded total less applied payments.", limitations: ["Not bank cash or an automatic payment instruction."] },
  action: { label: "Review bills", destination: "BookLoQ" }, missingFields: [],
};

test("amounts preserve currency minor units and margin changes use percentage points", () => {
  assert.match(decisionCardValue(card), /CAD.*100\.08/);
  assert.match(decisionCardValue({ ...card, value: { amount: 10008, unit: "minor_currency", currency: "JPY" } }), /JPY.*10,008/);
  assert.match(decisionCardValue({ ...card, value: { amount: 10008, unit: "minor_currency", currency: "KWD" } }), /KWD.*10\.008/);
  assert.equal(decisionCardValue({ ...card, value: { amount: -171, unit: "basis_points", currency: null } }), "-1.71 pp");
});

test("unsupported or nonfinite amounts cannot appear as confirmed zero", () => {
  assert.equal(decisionCardValue({ ...card, status: "unavailable", value: { ...card.value!, amount: 0 } }), "Needs more evidence");
  assert.equal(decisionCardValue({ ...card, value: { ...card.value!, amount: NaN } }), "Needs more evidence");
  const html = renderToStaticMarkup(<DecisionCardsPanel cards={[{ ...card, status: "unavailable", value: null, missingFields: ["due_dates"] }]}/>);
  assert.match(html, /Missing inputs|due dates/);
  assert.doesNotMatch(html, /CAD.*0\.00|Review bills<\/button>/);
});

test("sources retain the full count, dates and a bounded reference preview", () => {
  const html = renderToStaticMarkup(<DecisionCardsPanel cards={[card]}/>);
  assert.match(html, /150 source records/);
  assert.match(html, /2026-10-11 to 2026-10-18/);
  assert.match(html, /Source as of 2026-10-11/);
  assert.match(html, /bill:11/);
  assert.doesNotMatch(html, /bill:12/);
  assert.match(html, /reference preview/);
  assert.match(html, /Not bank cash or an automatic payment instruction/);
});

test("estimates are labelled separately and action controls require callbacks", () => {
  const html = renderToStaticMarkup(<DecisionCardsPanel cards={[{ ...card, status: "estimate" }]}/>);
  assert.match(html, /Planning estimate/);
  assert.doesNotMatch(html, /<button/);
  const authorized = renderToStaticMarkup(<DecisionCardsPanel cards={[card]} onEvidence={() => {}} onAction={() => {}}/>);
  assert.match(authorized, /View source records/);
  assert.match(authorized, /Review bills/);
  assert.equal(renderToStaticMarkup(<DecisionCardsPanel cards={[]}/>), "");
});
