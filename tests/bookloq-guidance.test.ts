import assert from "node:assert/strict";
import test from "node:test";
import { bookloqGuidedAnswer } from "../app/bookloq-workspace.tsx";

function fixture() {
  return {
    settings: { dataMode: "live" }, ledgerAccess: { available: true }, organization: { currency: "CAD" },
    summary: { bankBalanceCents: 12000, bookBalanceCents: 10000, currentCashCents: 12000, availableCashCents: 5000, monthEndCompletionRate: null },
    statements: { accounts: [], balanceSheet: { assetCents: 12000, liabilityCents: 5000, equityCents: 7000 } },
    reconciliations: [], bills: [], closeItems: [], alerts: [],
  } as unknown as Parameters<typeof bookloqGuidedAnswer>[1];
}

test("missing and demonstration ledgers never create a zero tax result", () => {
  for (const kind of ["no-access", "demonstration", "no-tax-accounts"]) {
    const data = fixture();
    if (kind === "no-access") data.ledgerAccess = { available: false, reason: "Missing ledger" };
    if (kind === "demonstration") data.settings!.dataMode = "demonstration";
    const answer = bookloqGuidedAnswer("Review recorded GST balances", data);
    assert.equal(answer.confidence, "low");
    assert.equal(answer.calculation, "Unavailable");
    assert.doesNotMatch(answer.title, /\$0|payable/);
  }
});
test("bank comparison preserves the direction and does not invent a cause", () => {
  const data = fixture();
  const above = bookloqGuidedAnswer("Compare bank and book balances", data);
  assert.match(above.title, /above/);
  assert.match(above.answer, /do not establish the cause/);
  assert.doesNotMatch(above.answer, /settlement timing/);
  data.summary.bankBalanceCents = 8000;
  assert.match(bookloqGuidedAnswer("Compare bank and book balances", data).title, /below/);
  data.summary.bankBalanceCents = 10000;
  assert.match(bookloqGuidedAnswer("Compare bank and book balances", data).answer, /does not prove every transaction is reconciled/);
});
test("empty close controls and absent cash are unavailable rather than complete", () => {
  const data = fixture();
  assert.equal(bookloqGuidedAnswer("Review the month-end checklist", data).calculation, "Unavailable");
  data.summary.availableCashCents = null;
  assert.equal(bookloqGuidedAnswer("Review the supplier payment plan", data).confidence, "low");
});
test("empty alerts do not imply complete books or no business risk", () => {
  const answer = bookloqGuidedAnswer("What requires my attention today?", fixture());
  assert.match(answer.answer, /does not establish that the books are complete/);
  assert.notEqual(answer.confidence, "high");
});
test("balance-sheet explanation preserves discrepancies instead of asserting equality", () => {
  const data = fixture();
  data.statements.balanceSheet.equityCents = 6000;
  const answer = bookloqGuidedAnswer("Explain my balance sheet", data);
  assert.match(answer.calculation, /70(?:\.00)? net assets.*60(?:\.00)?/);
  assert.doesNotMatch(answer.title, /balanced/);
});
