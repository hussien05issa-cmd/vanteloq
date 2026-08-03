import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinancialStatements,
  bookkeepingHealthScore,
  calculateCanadianTax,
  forecastCash,
  journalInput,
  reconciliationDifference,
  reverseJournalLines,
  type LedgerAccountRow,
} from "../server/bookloq.ts";

test("balanced journal validation uses integer minor units", () => {
  const input = journalInput({
    entryDate: "2026-08-03",
    memo: "Record a verified supplier invoice",
    currency: "CAD",
    lines: [
      { accountId: "expense", description: "Supplies", debitCents: 10_000, creditCents: 0 },
      { accountId: "payable", description: "Supplier payable", debitCents: 0, creditCents: 10_000 },
    ],
  });
  assert.equal(input.totalDebitCents, 10_000);
  assert.equal(input.totalCreditCents, 10_000);
  assert.throws(() => journalInput({
    entryDate: "2026-08-03", memo: "Unbalanced", currency: "CAD",
    lines: [{ accountId: "expense", debitCents: 10_000, creditCents: 0 }, { accountId: "payable", debitCents: 0, creditCents: 9_999 }],
  }), /Total debits must equal total credits/);
});

test("reversals swap debit and credit without mutating source lines", () => {
  const source = [{ accountId: "cash", description: "Cash", debitCents: 25_000, creditCents: 0, taxCode: null, taxAmountCents: 0, contactId: null, locationRef: "all", departmentRef: null, projectRef: null }];
  const reversed = reverseJournalLines(source);
  assert.deepEqual(reversed[0], { ...source[0], debitCents: 0, creditCents: 25_000 });
  assert.equal(source[0].debitCents, 25_000);
});

test("Canadian tax and reconciliation calculations round deterministically", () => {
  assert.equal(calculateCanadianTax(12_345, 500), 617);
  assert.equal(reconciliationDifference(239_780, 239_904), -124);
});

test("financial statements reconcile trial balance and retain normal-balance semantics", () => {
  const base = { accountSubtype: "test", description: "", plainLanguage: "" };
  const rows: LedgerAccountRow[] = [
    { ...base, id: "cash", code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", systemKey: "operating_cash", debitCents: 60_000, creditCents: 0 },
    { ...base, id: "sales", code: "4000", name: "Sales", accountType: "revenue", normalBalance: "credit", systemKey: "sales_revenue", debitCents: 0, creditCents: 80_000 },
    { ...base, id: "expense", code: "6000", name: "Expense", accountType: "expense", normalBalance: "debit", systemKey: "cost_of_goods_sold", debitCents: 20_000, creditCents: 0 },
  ];
  const result = buildFinancialStatements(rows);
  assert.equal(result.trialBalance.totalDebitCents, result.trialBalance.totalCreditCents);
  assert.equal(result.profitAndLoss.grossProfitCents, 60_000);
  assert.equal(result.profitAndLoss.operatingProfitCents, 60_000);
  assert.equal(result.balanceSheet.assetCents, 60_000);
  assert.equal(result.balanceSheet.equityCents, 60_000);
});

test("health score and cash forecast expose assumptions", () => {
  assert.equal(bookkeepingHealthScore({ unbalancedJournalCount: 0, uncategorizedCount: 2, unreconciledCount: 3, openCriticalAlerts: 0, missingReceiptCount: 1, monthEndCompletionRate: 0.5 }), 87);
  const result = forecastCash(100_000, [
    { dueDate: "2026-08-10", amountCents: 40_000, direction: "out", certainty: "confirmed" },
    { dueDate: "2026-08-15", amountCents: 25_000, direction: "in", certainty: "probable" },
  ], "2026-08-03");
  assert.equal(result[0].closingCashCents, 60_000);
  assert.equal(result[1].closingCashCents, 85_000);
  assert.equal(result[1].confirmedNetCents, -40_000);
  assert.equal(result[1].probableNetCents, 25_000);
});
