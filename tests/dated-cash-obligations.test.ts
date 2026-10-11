import assert from "node:assert/strict";
import test from "node:test";
import { buildDatedCashObligations, datedPurchasingCapacity, type DatedCashBill, type DatedCashOrder } from "../domain/dated-cash-obligations.ts";
import { reconciledCashSnapshot, type ReconciledCashAccount } from "../domain/bank-cash-snapshot.ts";
const bill = (overrides: Partial<DatedCashBill> = {}): DatedCashBill => ({ id: "b", billNumber: "B1", supplierName: "Supplier", dueDate: "2026-10-17", totalCents: 60000, paidCents: 10000, status: "approved", currency: "CAD", approvalStatus: "approved", demoRecord: false, purchaseOrderRef: "po", ...overrides });
const order = (overrides: Partial<DatedCashOrder> = {}): DatedCashOrder => ({ id: "po", orderNumber: "PO1", supplierName: "Supplier", committedCashDate: "2026-10-20", expectedDeliveryDate: "2026-10-18", totalCents: 100000, currency: "CAD", status: "received", ...overrides });
const obligations = (overrides: Partial<Parameters<typeof buildDatedCashObligations>[0]> = {}) => buildDatedCashObligations({ baseCurrency: "CAD", asOf: "2026-10-11", bills: [bill()], invoices: [], orders: [order()], ...overrides });
test("a partially paid PO and its bills have one exposure and distinct remaining due dates", () => {
  const result = obligations();
  assert.equal(result.exposureCents, 90000);
  assert.deepEqual(result.schedule.map(item => [item.id, item.amountCents, item.dueDate]), [["bill:b", 50000, "2026-10-17"], ["purchase-order:po", 40000, "2026-10-20"]]);
  assert.equal(datedPurchasingCapacity({ openingCashCents: 200000, safetyReserveCents: 30000, obligations: result }), 80000);
});
test("fully invoiced purchase uses the bill date and reserves unreviewed exposure", () => {
  const result = obligations({ bills: [bill({ totalCents: 100000, status: "under_review", approvalStatus: "pending" })], orders: [order({ committedCashDate: null })] });
  assert.equal(result.schedule.length, 1); assert.equal(result.schedule[0].certainty, "expected");
  assert.equal(result.exposureCents, 90000); assert.equal(result.undatedCommittedItemCount, 0);
  assert.equal(datedPurchasingCapacity({ openingCashCents: 100000, safetyReserveCents: 0, obligations: result }), 10000);
});
test("unbilled undated, foreign or mismatched obligations cannot authorize purchasing", () => {
  for (const result of [obligations({ orders: [order({ committedCashDate: null })] }), obligations({ bills: [bill({ purchaseOrderRef: null, currency: "USD" })], orders: [] }), obligations({ bills: [bill({ currency: "USD" })] })]) {
    assert.ok(result.blocks.length); assert.equal(datedPurchasingCapacity({ openingCashCents: 200000, safetyReserveCents: 0, obligations: result }), null);
  }
  assert.equal(obligations({ orders: [order({ committedCashDate: "2026-02-30" })] }).undatedCommittedItemCount, 1);
});
test("expected invoice receipts do not inflate purchasing cash and paid/void/demo records do not create exposure", () => {
  const result = obligations({ orders: [], bills: [bill({ status: "void" }), bill({ id: "demo", demoRecord: true }), bill({ id: "paid", status: "paid", paidCents: 60000 })], invoices: [{ id: "i", invoiceNumber: "I1", customerName: "Customer", dueDate: "2026-10-13", totalCents: 1000000, paidCents: 0, status: "sent", currency: "CAD", demoRecord: false }] });
  assert.equal(result.exposureCents, 0); assert.equal(result.schedule[0].direction, "in");
  assert.equal(datedPurchasingCapacity({ openingCashCents: 10000, safetyReserveCents: 5000, obligations: result }), 5000);
  assert.throws(() => obligations({ bills: [bill({ paidCents: 60001 })] }), /payment balances/);
  assert.throws(() => obligations({ bills: [bill(), bill()] }), /Duplicate/);
});
const cashAccount = (overrides: Partial<ReconciledCashAccount> = {}): ReconciledCashAccount => ({ accountId: "cash", provider: "manual", currency: "CAD", runId: "run", sourceId: "source", runStatus: "completed", endDate: "2026-10-10", closingBalanceCents: 100000, closingBookCents: 103000, currentClosingBookCents: 103000, unclearedCents: 3000, outstandingWithdrawalsCents: 2000, outstandingReceiptsCents: 5000, sourceValid: true, postCutoffMovementCount: 0, ...overrides });
const statement = (accounts = [cashAccount()], overrides: Partial<Parameters<typeof reconciledCashSnapshot>[0]> = {}) => reconciledCashSnapshot({ allowed: true, bookloqActive: true, dataMode: "live", currency: "CAD", asOf: "2026-10-11", nowMs: Date.parse("2026-10-11T12:00:00Z"), accounts, ...overrides });
test("dated reconciled cash deducts withdrawals, excludes receipts, retains source cutoff and signed balances", () => {
  const result = statement(); assert.equal(result.scenarioOpeningCashCents, 98000); assert.equal(result.purchasingOpeningCashCents, 98000);
  assert.equal(result.outstandingReceiptsCents, 5000); assert.equal(result.sourceAsOf, "2026-10-10");
  assert.match(result.boundary, /not a live bank balance/);
  assert.equal(statement([cashAccount({ closingBalanceCents: -10000, closingBookCents: -7000, currentClosingBookCents: -7000 })]).scenarioOpeningCashCents, -12000);
});
test("stale statements and later movements remain dated-only and withhold purchasing authority", () => {
  for (const result of [statement(undefined, { nowMs: Date.parse("2026-10-13T00:00:00Z"), asOf: "2026-10-13" }), statement([cashAccount({ postCutoffMovementCount: 1 })])]) {
    assert.equal(result.status, "dated_only"); assert.equal(result.scenarioOpeningCashCents, 98000); assert.equal(result.purchasingOpeningCashCents, null);
  }
});
test("incomplete accounts, mixed dates, reopened runs, damaged ledger and denial do not disclose a partial balance", () => {
  for (const result of [statement([cashAccount(), cashAccount({ accountId: "second", endDate: "2026-10-09" })]), statement([cashAccount({ runStatus: "reopened" })]), statement([cashAccount({ sourceValid: false })]), statement([cashAccount({ currentClosingBookCents: 102999 })]), statement([cashAccount({ outstandingReceiptsCents: null })]), statement([cashAccount({ provider: "plaid" })]), statement(undefined, { allowed: false }), statement(undefined, { dataMode: "demonstration" })]) {
    assert.equal(result.status, "unavailable"); assert.equal(result.scenarioOpeningCashCents, null); assert.equal(result.accountsUsed, 0); assert.deepEqual(result.sourceIds, []);
  }
});
