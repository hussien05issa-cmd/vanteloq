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
  verifiedBookLoQBankBalance,
  type LedgerAccountRow,
} from "../server/bookloq.ts";
import * as bookloqModule from "../server/bookloq.ts";
import {
  buildBusinessCashSummary,
  rankTransactionMatches,
  normalizeCategoryRuleText,
} from "../domain/bookloq-cash-management.ts";

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

test("BookLoQ bank totals only use fresh healthy non-demonstration balances", () => {
  const now = Date.parse("2026-08-11T12:00:00Z");
  const banks = [
    { accountType: "chequing", liveBalanceCents: 120_000, currency: "CAD", connectionStatus: "healthy", lastSyncAt: now - 60_000, demoRecord: false },
    { accountType: "chequing", liveBalanceCents: 900_000, currency: "CAD", connectionStatus: "healthy", lastSyncAt: now - 60_000, demoRecord: true },
    { accountType: "savings", liveBalanceCents: 600_000, currency: "USD", connectionStatus: "healthy", lastSyncAt: now - 60_000, demoRecord: false },
    { accountType: "credit_card", liveBalanceCents: -20_000, currency: "CAD", connectionStatus: "healthy", lastSyncAt: now - 60_000, demoRecord: false },
  ];
  assert.equal(verifiedBookLoQBankBalance(banks, "CAD", now), 120_000);
  assert.equal(verifiedBookLoQBankBalance([
    ...banks,
    { accountType: "savings", liveBalanceCents: 800_000, currency: "CAD", connectionStatus: "error", lastSyncAt: now - 60_000, demoRecord: false },
  ], "CAD", now), null);
  assert.equal(verifiedBookLoQBankBalance([
    { accountType: "chequing", liveBalanceCents: 700_000, currency: "CAD", connectionStatus: "healthy", lastSyncAt: now - 72 * 60 * 60 * 1_000, demoRecord: false },
  ], "CAD", now), null);
  assert.equal(verifiedBookLoQBankBalance([
    { accountType: "chequing", liveBalanceCents: 700_000, currency: "CAD", connectionStatus: "healthy", lastSyncAt: now + 1_000, demoRecord: false },
  ], "CAD", now), null);
});

test("BookLoQ normalizes SQLite timestamps before freshness checks", () => {
  const normalizeBookLoQTimestamp = (
    bookloqModule as Record<string, unknown>
  ).normalizeBookLoQTimestamp as ((value: number | Date | null) => number | null) | undefined;
  const nowMs = Date.parse("2026-08-11T12:00:00Z");

  assert.equal(normalizeBookLoQTimestamp?.(Math.floor(nowMs / 1_000)), nowMs);
  assert.equal(normalizeBookLoQTimestamp?.(nowMs), nowMs);
  assert.equal(normalizeBookLoQTimestamp?.(new Date(nowMs)), nowMs);
  assert.equal(normalizeBookLoQTimestamp?.(null), null);
});

test("financial statement access does not imply banking, payroll, contacts, or audit access", async () => {
  const bookloq = await import("../server/bookloq.ts") as Record<string, unknown>;
  assert.equal(typeof bookloq.bookloqAccessForPermissions, "function");
  const accessFor = bookloq.bookloqAccessForPermissions as (permissions: readonly string[]) => Record<string, boolean>;

  assert.deepEqual(accessFor(["finance.statements"]), {
    statements: true,
    bankBalances: false,
    bankTransactions: false,
    accountsPayableReceivable: false,
    costs: false,
    payrollTotals: false,
    payrollIndividuals: false,
    contactIdentity: false,
    audit: false,
    export: false,
  });
});

test("BookLoQ sensitive response sections follow their exact permissions", async () => {
  const bookloq = await import("../server/bookloq.ts") as Record<string, unknown>;
  assert.equal(typeof bookloq.bookloqAccessForPermissions, "function");
  const accessFor = bookloq.bookloqAccessForPermissions as (permissions: readonly string[]) => Record<string, boolean>;
  const access = accessFor([
    "finance.statements",
    "finance.bank_balances",
    "finance.bank_transactions",
    "finance.ap_ar",
    "finance.costs",
    "payroll.totals",
    "customers.identity",
    "audit.view",
  ]);

  assert.equal(access.bankBalances, true);
  assert.equal(access.bankTransactions, true);
  assert.equal(access.accountsPayableReceivable, true);
  assert.equal(access.costs, true);
  assert.equal(access.payrollTotals, true);
  assert.equal(access.payrollIndividuals, false);
  assert.equal(access.contactIdentity, true);
  assert.equal(access.audit, true);
});

test("BookLoQ presentation never serializes missing metrics as null text", async () => {
  const presentation = await import("../domain/bookloq-presentation.ts").catch(() => ({})) as Record<string, unknown>;
  const metricCount = presentation.bookloqMetricCount as ((value: number | null) => string) | undefined;
  const health = presentation.bookloqHealthPresentation as ((value: number | null) => { score: number; degrees: number } | null) | undefined;

  assert.equal(metricCount?.(null), "Not available");
  assert.equal(metricCount?.(4), "4");
  assert.equal(health?.(null), null);
  assert.deepEqual(health?.(87), { score: 87, degrees: 313.2 });
});

test("business cash summary uses integer cents and keeps inflows separate from outflows", () => {
  const summary = buildBusinessCashSummary([
    { postingDate: "2026-08-01", amountCents: 240_000, category: "Sales revenue", categorized: true, matched: true },
    { postingDate: "2026-08-02", amountCents: -75_000, category: "Inventory purchases", categorized: true, matched: true },
    { postingDate: "2026-08-03", amountCents: -25_000, category: "Rent", categorized: false, matched: false },
  ], "2026-08-12", 30);

  assert.equal(summary.inflowCents, 240_000);
  assert.equal(summary.outflowCents, 100_000);
  assert.equal(summary.netCashFlowCents, 140_000);
  assert.equal(summary.categorizedBasisPoints, 6_667);
  assert.equal(summary.matchedBasisPoints, 6_667);
  assert.deepEqual(summary.categories.map((item) => [item.name, item.amountCents]), [
    ["Inventory purchases", 75_000],
    ["Rent", 25_000],
  ]);
});

test("invoice matching is explainable and never silently auto-confirms", () => {
  const matches = rankTransactionMatches({
    id: "txn-1",
    postingDate: "2026-08-12",
    amountCents: -12_500,
    description: "ACME SUPPLY INV 4421",
  }, [{
    id: "bill-1",
    kind: "supplier_bill",
    date: "2026-08-10",
    amountCents: 12_500,
    label: "Acme Supply · invoice 4421",
    reference: "4421",
  }]);

  assert.equal(matches[0]?.candidateId, "bill-1");
  assert.equal(matches[0]?.requiresConfirmation, true);
  assert.equal(matches[0]?.confidenceBasisPoints, 10_000);
  assert.deepEqual(matches[0]?.reasons, ["Exact amount", "Reference found", "Date within 7 days", "Name overlap"]);
  assert.equal(normalizeCategoryRuleText("  ACME–Supply #4421  "), "acme supply 4421");
});
