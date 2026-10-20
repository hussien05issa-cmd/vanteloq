import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionCards, type DecisionCardsInput, type DecisionEvidenceContext, type DecisionCardKind } from "../domain/decision-cards.ts";
import { parseCommercePeriod } from "../domain/commerce-intelligence.ts";
import { buildThirteenWeekCashFlow } from "../domain/thirteen-week-cash-flow.ts";
import type { CollectionRecord } from "../domain/collections-dashboard.ts";
import type { RetailLine } from "../domain/retail-intelligence.ts";
import type { InventoryLotEvidence } from "../domain/inventory-lifecycle.ts";
import type { SavedBusinessWorkflow } from "../domain/business-workflows.ts";
import type { FoodSavedRecord } from "../domain/foodservice.ts";
import type { DealershipStock } from "../domain/dealership.ts";
import type { ReorderInputs } from "../domain/reorder-engine.ts";

const asOf = "2026-10-11", currency = "CAD";
const context: DecisionEvidenceContext = { period: { from: asOf, to: asOf }, asOf, currency, freshness: "current", coverage: "complete", sources: [{ system: "Reviewed records", recordIds: ["record-1"], currency }] };
const one = (kind: DecisionCardKind, input: Partial<DecisionCardsInput>) => buildDecisionCards({ asOf, currency, kinds: [kind], ...input })[0];
function collection(id: string, changes: Partial<CollectionRecord> = {}): CollectionRecord {
  return { id, kind: "receivable", reference: id, contactId: "contact", contactName: "Owner record", invoiceDate: "2026-10-01", dueDate: "2026-10-10", status: "sent", approvalStatus: "not_required", totalCents: 10_000, paidCents: 2_000, currency, updatedAt: Date.parse(asOf), ...changes };
}

test("all ten definitions remain explicit unavailable decisions when their sources are missing", () => {
  const cards = buildDecisionCards({ asOf, currency });
  assert.equal(cards.length, 10);
  assert.equal(new Set(cards.map(card => card.kind)).size, 10);
  assert.ok(cards.every(card => card.status === "unavailable" && card.value === null && card.missingFields.length && card.evidence.formula && card.action.destination));
});

test("collections retain exact cents, distinguish overdue and seven-day obligations, and include disputes", () => {
  const records = [collection("invoice"), collection("current", { dueDate: asOf }), collection("bill-overdue", { kind: "payable", status: "approved" }), collection("bill-dispute", { kind: "payable", status: "disputed", dueDate: "2026-10-17" }), collection("bill-later", { kind: "payable", dueDate: "2026-10-18", status: "approved" }), collection("draft", { status: "draft" })];
  const cards = buildDecisionCards({ asOf, currency, kinds: ["overdue_invoices", "bills_due"], collections: { context, records } });
  assert.deepEqual(cards.map(card => [card.status, card.value?.amount]), [["recorded", 8_000], ["recorded", 16_000]]);
  assert.match(cards[1].evidence.limitations.join(" "), /disputed.*included/);
  assert.match(cards[0].evidence.formula, /due date precedes/);
  assert.deepEqual(cards[1].evidence.period, { from: asOf, to: asOf });
  assert.deepEqual(cards[0].evidence.sources[0].recordIds, ["invoice"]);
  assert.deepEqual(cards[1].evidence.sources[0].recordIds, ["bill-overdue", "bill-dispute"]);
});

test("unusable bills do not withhold supported invoice decisions", () => {
  const records = [collection("invoice"), collection("undated", { kind: "payable", dueDate: null })];
  assert.equal(one("overdue_invoices", { collections: { context, records } }).status, "recorded");
  assert.equal(one("bills_due", { collections: { context, records } }).status, "unavailable");
});

test("invalid, duplicate, undated and foreign-currency balances fail closed", () => {
  for (const records of [[collection("i", { currency: "USD" })], [collection("i", { dueDate: null })], [collection("i"), collection("i")], [collection("i", { paidCents: 20_000 })]]) {
    const card = one("overdue_invoices", { collections: { context, records } });
    assert.equal(card.status, "unavailable");
    assert.equal(card.value, null);
  }
});

test("stale, incomplete or unreferenced source contexts cannot produce a numeric decision", () => {
  for (const changed of [{ freshness: "stale" as const }, { coverage: "partial" as const }, { sources: [] }, { asOf: "2026-10-12" }, { sources: [{ system: "Source", recordIds: ["id"], currency: "USD" }] }]) {
    const card = one("overdue_invoices", { collections: { context: { ...context, ...changed }, records: [collection("i")] } });
    assert.equal(card.status, "unavailable");
    assert.equal(card.value, null);
  }
});

test("an explicitly verified empty scope supports zero without inventing source records", () => {
  const empty = { ...context, sources: [{ system: "Current complete BookLoQ document query", recordIds: [], recordCount: 0, currency }] };
  const card = one("overdue_invoices", { collections: { context: empty, records: [] } });
  assert.equal(card.status, "recorded");
  assert.equal(card.value?.amount, 0);
  assert.deepEqual(card.evidence.sources[0].recordIds, []);
  assert.equal(one("overdue_invoices", { collections: { context: { ...empty, sources: [{ system: "Unknown query", recordIds: [], currency }] }, records: [] } }).status, "unavailable");
});

test("evidence previews remain bounded while every current document contributes", () => {
  const records = Array.from({ length: 400 }, (_, i) => collection(`i-${i}`));
  const full = { ...context, sources: [{ system: "BookLoQ", recordIds: records.map(record => record.id), currency }] };
  const card = one("overdue_invoices", { collections: { context: full, records } });
  assert.equal(card.value?.amount, 3_200_000);
  assert.equal(card.evidence.sources[0].recordIds.length, 100);
  assert.equal(card.evidence.sources[0].recordCount, 400);
  assert.equal(card.evidence.sources[0].referencesTruncated, true);
  assert.ok(card.evidence.limitations.length <= 25);
  assert.match(card.evidence.limitations.join(" "), /400 documents contribute/);
});

const lot: InventoryLotEvidence = { id: "lot-1", sku: "MILK", productName: "Milk", locationRef: "main", lotNumber: "1", batchNumber: "", receivedDate: "2026-10-01", expirationDate: "2026-10-13", bestBeforeDate: null, quantityRemaining: 10, unitCostCents: 100, unitRetailCents: 250, unitsSold30Days: 150, demandHistoryDays: 30 };
test("expiry allocates SKU demand once across FEFO lots rather than counting it for every lot", () => {
  const card = one("expiry_risk", { expiry: { context, lots: [lot, { ...lot, id: "lot-2", lotNumber: "2" }] } });
  assert.equal(card.status, "estimate");
  assert.equal(card.value?.amount, 1_000);
  assert.match(card.evidence.limitations.join(" "), /lot-1: 0 whole units/);
  assert.match(card.evidence.limitations.join(" "), /lot-2: 10 whole units/);
  assert.equal(one("expiry_risk", { expiry: { context, lots: [{ ...lot, unitCostCents: null }] } }).status, "unavailable");
  assert.equal(one("expiry_risk", { expiry: { context, lots: [lot, { ...lot, id: "lot-2", unitsSold30Days: 90 }] } }).status, "unavailable");
});

const reorderInputs: ReorderInputs = { onHandUnits: 20, incomingUnits: 0, averageDailyDemand: 10, demandStdDevDaily: 2, leadTimeDays: 7, reviewPeriodDays: 7, serviceLevelZ: 1.65, seasonalityFactor: 1, promotionFactor: 1, casePackUnits: 12, minimumOrderUnits: 48, unitCostCents: 500, availableCashCents: 100_000, cashSafetyThresholdCents: 30_000, accountsPayableCents: 20_000, payrollCommitmentsCents: 0, taxCommitmentsCents: 0, debtCommitmentsCents: 0, otherCommitmentsCents: 0, shelfLifeDays: null, storageCapacityUnits: null, demandHistoryDays: 84, dataAgeHours: 4 };
test("reorder adapts existing constraints and never presents a supplier-blocked quantity", () => {
  const card = one("reorder", { reorder: { context, sku: "SKU", inputs: reorderInputs } });
  assert.equal(card.status, "estimate");
  assert.equal(card.value?.amount, 96);
  assert.equal(one("reorder", { reorder: { context, sku: "SKU", inputs: { ...reorderInputs, supplierMinimumSpendCents: 60_000 } } }).value, null);
  assert.equal(one("reorder", { reorder: { context, sku: "SKU", inputs: { ...reorderInputs, dataAgeHours: 73 } } }).status, "unavailable");
});

test("immediate affordability requires a proposal and retains reserved-cash authority", () => {
  const forecast = buildThirteenWeekCashFlow({ asOf, openingCashCents: 100_000, safetyThresholdCents: 20_000, actualTransactions: [], forecastItems: [{ id: "bill", dueDate: asOf, amountCents: 30_000, direction: "out", certainty: "confirmed", label: "Bill" }, { id: "receipt", dueDate: asOf, amountCents: 500_000, direction: "in", certainty: "expected", label: "Expected receipt" }] });
  const card = one("order_affordability", { cash: { context, forecast, proposedOrderCostCents: 60_000 } });
  assert.equal(card.status, "estimate");
  assert.equal(card.value?.amount, -10_000);
  assert.equal(one("order_affordability", { cash: { context, forecast, proposedOrderCostCents: null } }).value, null);
  assert.equal(one("order_affordability", { cash: { context, forecast: { ...forecast, capacityStatus: "source_refresh_required" }, proposedOrderCostCents: 10 } }).status, "unavailable");
});

function line(id: string, soldAt: string, netCents: number, costCents: number | null): RetailLine {
  return { provider: "square", connectionId: "connection", saleId: id, lineId: "line", productRef: "product", sku: "SKU", name: "Coffee", category: null, itemType: null, customerRef: null, outletRef: "main", soldAt, quantityMilli: 1000, netCents, discountCents: 0, costCents };
}
test("product margin comparison uses matching source periods and complete signed historical costs", () => {
  const period = parseCommercePeriod("2026-10-05", "2026-10-11", asOf), evidence = { ...context, period: { from: period.from, to: period.to } };
  const lines = [line("prior", "2026-10-02T12:00:00Z", 10_000, 4_000), line("current", "2026-10-06T12:00:00Z", 10_000, 5_000)];
  const card = one("margin_change", { margin: { context: evidence, lines, period, timeZone: "UTC", comparisonComplete: true } });
  assert.equal(card.status, "recorded");
  assert.equal(card.value?.amount, -1_000);
  assert.equal(card.value?.unit, "basis_points");
  assert.match(card.summary, /Coffee/);
  assert.equal(one("margin_change", { margin: { context: evidence, lines: [{ ...lines[0], costCents: null }, lines[1]], period, timeZone: "UTC", comparisonComplete: true } }).status, "unavailable");
});

test("product margin change rounds the exact difference once at the reporting boundary", () => {
  const period = parseCommercePeriod("2026-10-05", "2026-10-11", asOf), evidence = { ...context, period: { from: period.from, to: period.to } };
  const lines = [line("prior", "2026-10-02T12:00:00Z", 1_000_000, 666_649), line("current", "2026-10-06T12:00:00Z", 1_000_000, 666_651)];
  const card = one("margin_change", { margin: { context: evidence, lines, period, timeZone: "UTC", comparisonComplete: true } });
  assert.equal(card.value?.amount, 0);
});

const settlement: SavedBusinessWorkflow = { id: "settlement", locationId: "main", version: 1, updatedAt: Date.parse(asOf), state: "reviewed", kind: "settlement", name: "Payout", source: "Provider mapped CSV and bank statement", asOfDate: asOf, currency, costCoverage: false, note: "", values: { provider: "Stripe", account: "merchant", payoutId: "payout-1", payoutDate: asOf, bankAmount: "95.00", bankReference: "bank-1", batchType: "manual-reviewed" }, groups: { entries: [{ reference: "sale", orderReference: "order", type: "sale", amount: "100.00" }, { reference: "fee", orderReference: "", type: "fee", amount: "-4.00" }] } };
test("settlement adapts typed reviewed components and a bank reference without inferring provider membership", () => {
  const card = one("payout_difference", { settlement: { context, record: settlement } });
  assert.equal(card.status, "recorded");
  assert.equal(card.value?.amount, -100);
  assert.equal(one("payout_difference", { settlement: { context, record: { ...settlement, state: "draft" } } }).status, "unavailable");
  assert.equal(one("payout_difference", { settlement: { context, record: { ...settlement, values: { ...settlement.values, bankReference: "" } } } }).value, null);
  const older = one("payout_difference", { settlement: { context, record: { ...settlement, values: { ...settlement.values, payoutDate: "2026-10-03" } } } });
  assert.deepEqual(older.evidence.period, { from: "2026-10-03", to: "2026-10-03" });
  assert.equal(one("payout_difference", { settlement: { context, record: { ...settlement, values: { ...settlement.values, payoutDate: "2026-10-12" } } } }).status, "unavailable");
});

test("food variance reuses exact reviewed inventory depletion and distinguishes unexplained cost from cause", () => {
  const money = (minor: number) => ({ minor, currency });
  const record: FoodSavedRecord = { id: "food", locationId: "main", version: 1, updatedAt: Date.parse(asOf), kind: "period", name: "Food review", source: "Reviewed counts and recipes", asOfDate: asOf, from: asOf, to: asOf,
    payload: { currency, opening: money(30_000), purchases: money(10_000), supplierCredits: money(0), transfersIn: money(0), transfersOut: money(0), closing: money(20_000), foodNetSales: money(50_000), totalNetSales: money(50_000), theoreticalCost: money(15_000), recordedWasteCost: money(2_000), labourCost: money(10_000), otherVariableCosts: money(1_000), closedChecks: 10 } };
  const card = one("food_variance", { food: { context, record } });
  assert.equal(card.status, "recorded");
  assert.equal(card.value?.amount, 3_000);
  assert.match(card.evidence.limitations.join(" "), /does not establish theft/);
});

test("vehicle holding uses a separately confirmed additional daily cost and labels owner assumptions", () => {
  const stock = { currency, ownership: "owned", availability: "available", postedCostCents: 1_000_000, costComplete: true, stockNumber: "ST-1" } as DealershipStock;
  const assumptions = { offerNowCents: 1_500_000, futurePriceCents: 1_500_000, dailyHoldingCents: 1_000, waitingDays: 9, additionalCostConfirmed: true };
  const card = one("vehicle_holding", { dealer: { context, stock, permissions: { costs: true, profit: true }, assumptions } });
  assert.equal(card.status, "estimate");
  assert.equal(card.value?.amount, 30_000);
  assert.equal(one("vehicle_holding", { dealer: { context, stock, permissions: { costs: false, profit: true }, assumptions } }).status, "unavailable");
});

test("campaign provider conversion events never become qualified customers or contribution return", () => {
  const report: NonNullable<DecisionCardsInput["marketing"]>["report"] = { dataset: "google_ads", view: "campaigns", period: { start: asOf, end: asOf }, previousPeriod: null, columns: [], rows: [], totals: { cost: 100, conversions: 20 }, previous: null, currency, timeZone: "UTC", fetchedAt: `${asOf}T12:00:00Z`, warnings: [], limitations: [], truncated: false };
  const card = one("campaign_budget", { marketing: { context, report } });
  assert.equal(card.status, "unavailable");
  assert.equal(card.value, null);
  assert.ok(card.missingFields.includes("deduplicated_qualified_leads"));
});

test("adapters are deterministic and leave permission-filtered inputs unchanged", () => {
  const input: DecisionCardsInput = { asOf, currency, kinds: ["overdue_invoices"], collections: { context, records: [collection("i")] } };
  const before = JSON.stringify(input);
  assert.deepEqual(buildDecisionCards(input), buildDecisionCards(input));
  assert.equal(JSON.stringify(input), before);
});
