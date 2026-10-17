import assert from "node:assert/strict";
import test from "node:test";
import { buildThirteenWeekCashFlow } from "../domain/thirteen-week-cash-flow.ts";
import { buildDatedCashObligations, datedPurchasingCapacity } from "../domain/dated-cash-obligations.ts";

test("linked currency mismatch and other obligation reviews preserve scenarios but cannot authorize purchasing", () => {
  const base = { baseCurrency: "CAD", asOf: "2026-10-11",
    orders: [{ id: "po", orderNumber: "PO-1", supplierName: "Example", committedCashDate: "2026-10-12", expectedDeliveryDate: null, totalCents: 10000, currency: "CAD", status: "sent" }],
    bills: [{ id: "bill", billNumber: "B-1", supplierName: "Example", dueDate: "2026-10-12", totalCents: 20000, paidCents: 0, status: "approved", currency: "USD", approvalStatus: "approved", demoRecord: 0, purchaseOrderRef: "po" }], invoices: [] };
  for (const obligations of [buildDatedCashObligations(base), buildDatedCashObligations({ ...base, bills: [],
    invoices: [{ id: "invoice", invoiceNumber: "I-1", customerName: "Example", dueDate: "2026-02-30", totalCents: 5000, paidCents: 0, status: "sent", currency: "CAD", demoRecord: 0 }] })]) {
    const flow = buildThirteenWeekCashFlow({ asOf: base.asOf, openingCashCents: 100000, safetyThresholdCents: 10000,
      actualTransactions: [], forecastItems: obligations.schedule, confirmedPurchasingObligationsCents: obligations.exposureCents,
      excludedCurrencyItemCount: obligations.excludedCurrencyItemCount, undatedCommittedItemCount: obligations.undatedCommittedItemCount,
      obligationReviewBlocks: obligations.blocks });
    assert.equal(datedPurchasingCapacity({ openingCashCents: 100000, safetyReserveCents: 10000, obligations }), null);
    assert.equal(flow.purchasingCapacityCents, null);
    assert.equal(flow.unreservedCashCents, null);
    assert.equal(flow.fundingShortfallCents, null);
    assert.equal(flow.status, "needs_review");
    assert.equal(flow.capacityStatus, "obligation_review_required");
    assert.equal(flow.openingCashCents, 100000);
    assert.ok(flow.weeks.every(week => week.conservativeClosingCashCents !== null));
    assert.deepEqual(flow.obligationReviewBlocks, obligations.blocks);
  }
});

test("zero purchasing capacity retains the actual shortfall or fully reserved cash distinction", () => {
  for (const [openingCashCents, remainder, shortfall, capacity] of [[50000, -20000, 20000, 0], [70000, 0, 0, 0], [100000, 30000, 0, 30000]]) {
    const flow = buildThirteenWeekCashFlow({ asOf: "2026-10-11", openingCashCents, safetyThresholdCents: 10000,
      actualTransactions: [], forecastItems: [], confirmedPurchasingObligationsCents: 60000 });
    assert.equal(flow.unreservedCashCents, remainder);
    assert.equal(flow.fundingShortfallCents, shortfall);
    assert.equal(flow.purchasingCapacityCents, capacity);
    assert.equal(flow.reservedPurchasingObligationsCents, 60000);
  }
});

test("a dated statement supports explicit scenarios while withholding current cash purchasing authority", () => {
  const result = buildThirteenWeekCashFlow({ asOf: "2026-10-11", openingCashCents: 100000,
    safetyThresholdCents: 10000, actualTransactions: [], decisionBlocks: ["dated_statement_cash"],
    forecastItems: [{ id: "bill", dueDate: "2026-10-15", amountCents: 25000, direction: "out", certainty: "confirmed", label: "Recorded bill" },
      { id: "invoice", dueDate: "2026-10-16", amountCents: 50000, direction: "in", certainty: "expected", label: "Expected collection" }] });
  assert.equal(result.status, "available"); assert.equal(result.openingCashCents, 100000);
  assert.equal(result.capacityStatus, "source_refresh_required"); assert.equal(result.purchasingCapacityCents, null);
  assert.equal(result.cashSourceRefreshRequired, true);
  assert.equal(result.weeks[1].conservativeClosingCashCents, 75000);
  assert.equal(result.weeks[1].planningClosingCashCents, 125000);
  assert.match(result.boundary, /not current available bank cash/);
  const denied = buildThirteenWeekCashFlow({ asOf: "2026-10-11", openingCashCents: 100000,
    safetyThresholdCents: 0, actualTransactions: [], forecastItems: [], decisionBlocks: ["dated_statement_cash", "finance_permissions_required"] });
  assert.equal(denied.openingCashCents, null); assert.equal(denied.status, "unavailable");
});

test("13-week cash flow separates actual, confirmed, and expected movements", () => {
  const result = buildThirteenWeekCashFlow({
    asOf: "2026-08-11",
    openingCashCents: 500_000,
    safetyThresholdCents: 150_000,
    actualTransactions: [
      { postingDate: "2026-08-10", amountCents: -20_000 },
      { postingDate: "2026-08-11", amountCents: 75_000 },
      { postingDate: "2026-08-12", amountCents: 999_000 },
    ],
    forecastItems: [
      { id: "bill-1", dueDate: "2026-08-13", amountCents: 100_000, direction: "out", certainty: "confirmed", label: "Supplier bill" },
      { id: "overdue-1", dueDate: "2026-08-01", amountCents: 20_000, direction: "out", certainty: "confirmed", label: "Overdue supplier bill" },
      { id: "invoice-1", dueDate: "2026-08-14", amountCents: 60_000, direction: "in", certainty: "expected", label: "Customer invoice" },
      { id: "po-1", dueDate: "2026-08-20", amountCents: 80_000, direction: "out", certainty: "confirmed", label: "Approved purchase order" },
    ],
  });

  assert.equal(result.status, "available");
  assert.equal(result.weeks.length, 13);
  assert.equal(result.weeks[0].weekStart, "2026-08-10");
  assert.equal(result.weeks[0].actualNetCents, 55_000);
  assert.equal(result.weeks[0].actualInflowCents, 75_000);
  assert.equal(result.weeks[0].actualOutflowCents, 20_000);
  assert.equal(result.weeks[0].confirmedNetCents, -120_000);
  assert.equal(result.weeks[0].overdueItemCount, 1);
  assert.equal(result.weeks[0].expectedNetCents, 60_000);
  assert.equal(result.weeks[0].conservativeClosingCashCents, 380_000);
  assert.equal(result.weeks[0].planningClosingCashCents, 440_000);
  assert.equal(result.weeks[1].confirmedNetCents, -80_000);
  assert.equal(result.purchasingCapacityCents, 150_000);
  assert.equal(result.actualPeriodOpeningCashCents, 445_000);
  assert.equal(result.actualPeriodClosingCashCents, 500_000);
  assert.equal(result.actualNetChangeCents, 55_000);
});

test("cash flow fails closed without a verified opening cash balance", () => {
  const result = buildThirteenWeekCashFlow({
    asOf: "2026-08-11",
    openingCashCents: null,
    safetyThresholdCents: 100_000,
    actualTransactions: [],
    forecastItems: [],
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.purchasingCapacityCents, null);
  assert.ok(result.weeks.every((week) => week.conservativeClosingCashCents === null));
});

test("foreign-currency and undated commitments block purchasing capacity", () => {
  const result = buildThirteenWeekCashFlow({
    asOf: "2026-08-11",
    openingCashCents: 500_000,
    safetyThresholdCents: 100_000,
    actualTransactions: [],
    forecastItems: [
      { id: "bill-1", dueDate: "2026-08-20", amountCents: 120_000, direction: "out", certainty: "confirmed", label: "Supplier bill" },
    ],
    excludedCurrencyItemCount: 1,
    undatedCommittedItemCount: 1,
    decisionBlocks: ["foreign_currency_obligations", "undated_purchase_commitments"],
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.capacityStatus, "currency_review_required");
  assert.equal(result.purchasingCapacityCents, null);
  assert.equal(result.observedOpeningCashCents, 500_000);
  assert.equal(result.openingCashCents, 500_000);
  assert.equal(result.weeks[1].conservativeClosingCashCents, 380_000);
});

test("an undated commitment preserves the verified forecast while withholding only decision capacity", () => {
  const result = buildThirteenWeekCashFlow({
    asOf: "2026-08-11",
    openingCashCents: 500_000,
    safetyThresholdCents: 100_000,
    actualTransactions: [],
    forecastItems: [],
    undatedCommittedItemCount: 1,
    decisionBlocks: ["undated_purchase_commitments"],
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.capacityStatus, "commitment_date_required");
  assert.equal(result.purchasingCapacityCents, null);
  assert.equal(result.openingCashCents, 500_000);
  assert.ok(result.weeks.every((week) => week.conservativeClosingCashCents === 500_000));
});
