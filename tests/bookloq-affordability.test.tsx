import assert from "node:assert/strict";
import test from "node:test";
import { bookloqGuidedAnswer, type BookLoQData } from "../app/bookloq-workspace.tsx";
import { buildThirteenWeekCashFlow } from "../domain/thirteen-week-cash-flow.ts";

function data(openingCashCents: number, options: { dated?: boolean; review?: boolean } = {}): BookLoQData {
  const flow = buildThirteenWeekCashFlow({ asOf: "2026-10-11", openingCashCents, safetyThresholdCents: 10000,
    forecastItems: [], actualTransactions: [], confirmedPurchasingObligationsCents: 60000,
    obligationReviewBlocks: options.review ? ["linked_bill_currency_mismatch"] : [] });
  return { settings: { dataMode: "live" }, organization: { currency: "CAD" },
    summary: { currentCashCents: options.dated ? null : openingCashCents, availableCashCents: flow.purchasingCapacityCents },
    cashPlanning: options.dated ? { source: "reconciled_statement", sourceAsOf: "2026-10-10" } : { source: "connected_bank" },
    thirteenWeekCashFlow: flow } as unknown as BookLoQData;
}

test("guided affordability explains actual funding shortfalls instead of claiming coverage at zero capacity", () => {
  const answer = bookloqGuidedAnswer("Can I afford another supplier order?", data(50000));
  assert.equal(answer.title, "Recorded cash falls short of the reserved plan");
  assert.match(answer.answer, /funding shortfall/);
  assert.match(answer.answer, /bills still under review/);
  assert.match(answer.calculation, /signed remainder/);
  assert.doesNotMatch(answer.answer, /covers|30 days|30-day/);
});

test("fully reserved and positive cash plans have distinct conclusions", () => {
  const exhausted = bookloqGuidedAnswer("Can I afford stock?", data(70000));
  assert.equal(exhausted.title, "Cash is fully reserved");
  assert.match(exhausted.answer, /No unreserved cash remains/);
  const positive = bookloqGuidedAnswer("Can I afford stock?", data(100000));
  assert.equal(positive.title, "Cash remains after the recorded reserves");
  assert.match(positive.answer, /unrecorded commitments/);
  assert.match(positive.answer, /Expected invoice receipts do not increase purchasing authority/);
});

test("a fresh dated statement is labelled and obligation review withholds affordability guidance", () => {
  const statement = bookloqGuidedAnswer("Can I afford stock?", data(100000, { dated: true }));
  assert.equal(statement.title, "Cash remains after the recorded reserves");
  assert.match(statement.answer, /as of 2026-10-10/);
  assert.match(statement.answer, /not a live bank balance/);
  const blocked = bookloqGuidedAnswer("Can I afford stock?", data(100000, { review: true }));
  assert.equal(blocked.title, "More verified records are needed");
  assert.equal(blocked.confidence, "low");
});
