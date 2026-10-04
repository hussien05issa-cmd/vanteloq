import assert from "node:assert/strict";
import test from "node:test";
import { dealerAppointmentOutcomes, dealerAverageGross, dealerStockAging, dealershipCalendarAge } from "../domain/dealer-analytics";
import type { DealershipAppointment, DealershipDashboard, DealershipStock } from "../domain/dealership";

function fixture(): DealershipDashboard {
  return {
    locations: [{ id: "main", name: "Main", currency: "CAD", timezone: "America/Edmonton" }], people: [],
    permissions: { stockEdit: false, import: false, export: false, costs: true, profit: true, costEdit: false, costApprove: false, tasks: true, tasksEdit: false, sales: true, salesEdit: false, customers: true, customersEdit: false },
    stock: [], costs: [], tasks: [], leads: [{ id: "lead", locationId: "main", customerName: "Test", contact: "", stage: "appointment", assigneeId: null, nextActionDate: null, version: 1 }], appointments: [], sales: [],
    summary: { from: "2026-10-01", to: "2026-10-03", currencies: [], activeStock: 0, availableStock: 0, legacyIncomplete: 0 },
    nextCursor: null, legacyAvailable: 0, boundary: "Recorded operations", limits: { relatedRows: 100, truncated: false }, generatedAt: "2026-10-04T00:30:00Z",
  };
}
function stock(id: string, patch: Partial<DealershipStock> = {}): DealershipStock {
  return { id, vehicleId: id, version: 1, locationId: "main", locationName: "Main", identifierKind: "legacy", identifier: id,
    year: 2020, make: "Test", model: "Vehicle", stockNumber: id, currency: "CAD", acquiredDate: "2026-08-01", ownership: "owned", physicalStatus: "on_lot", prepStatus: "ready", availability: "available", askingCents: 5_000_000, postedCostCents: 2_000_000, costComplete: true, source: "manual", legacyIncomplete: false, reservationId: null, reservationExpiresAt: null, ...patch };
}
function appointment(id: string, status: DealershipAppointment["status"], scheduledAt = "2026-10-02T15:00:00Z"): DealershipAppointment {
  return { id, leadId: "lead", scheduledAt, status, version: 1 };
}

test("aging uses each location calendar and rejects invalid or future acquisition dates", () => {
  assert.equal(dealershipCalendarAge("2026-09-03", "2026-10-04T00:30:00Z", "America/Edmonton"), 30);
  assert.equal(dealershipCalendarAge("2026-09-03", "2026-10-04T00:30:00Z", "Asia/Tokyo"), 31);
  assert.equal(dealershipCalendarAge("2026-10-04", "2026-10-04T00:30:00Z", "America/Edmonton"), null);
  assert.equal(dealershipCalendarAge("2026-02-30", "2026-10-04T00:30:00Z", "UTC"), null);
  assert.equal(dealershipCalendarAge("2026-09-03", "invalid", "UTC"), null);
  assert.equal(dealershipCalendarAge("2026-09-03", "2026-10-04T00:30:00Z", "invalid"), null);
});

test("active stock aging separates ownership and currencies without inventing missing costs or unsold gross", () => {
  const data = fixture();
  data.stock = [stock("owned"), stock("zero", { postedCostCents: 0 }), stock("missing", { postedCostCents: null, costComplete: false }), stock("partial", { postedCostCents: 100_000, costComplete: false }), stock("consignment", { ownership: "consignment" }), stock("unknown-owner", { ownership: "unknown" }), stock("sold", { availability: "delivered" }), stock("archived", { availability: "archived" }), stock("legacy", { availability: "legacy_sold" }), stock("usd", { currency: "USD", postedCostCents: 70_000 }), stock("bad-age", { acquiredDate: "invalid", postedCostCents: null })];
  const result = dealerStockAging(data);
  assert.equal(result.activeUnits, 8); assert.equal(result.agedUnits, 7); assert.equal(result.unknownAgeUnits, 1);
  const bucket = result.currencies.find(row => row.currency === "CAD")!.buckets[2];
  assert.equal(bucket.units, 6); assert.equal(bucket.ownedUnits, 4); assert.equal(bucket.consignmentUnits, 1); assert.equal(bucket.unknownOwnershipUnits, 1);
  assert.equal(bucket.postedOwnedCostCents, 2_100_000); assert.equal(bucket.knownCostUnits, 3); assert.equal(bucket.reviewedCostUnits, 2);
  assert.equal(result.currencies.find(row => row.currency === "CAD")!.buckets[4].postedOwnedCostCents, null);
  assert.equal(result.currencies.find(row => row.currency === "USD")!.buckets[2].postedOwnedCostCents, 70_000);
  assert.equal(Object.hasOwn(bucket, "grossCents"), false);
});

test("stock pagination remains partial and hidden costs never feed analytics", () => {
  const data = fixture(); data.stock = [stock("owned")]; data.nextCursor = "more"; data.permissions.costs = false;
  const result = dealerStockAging(data, 30);
  assert.equal(result.partial, true); assert.equal(result.agedUnits, 1);
  assert.ok(result.currencies[0].buckets.every(bucket => bucket.postedOwnedCostCents === null && bucket.knownCostUnits === 0 && bucket.reviewedCostUnits === 0));
  assert.equal(dealerStockAging(data, Number.NaN).threshold, 60);
  data.stock[0].locationId = "unavailable";
  assert.equal(dealerStockAging(data).unknownAgeUnits, 1);
});

test("average gross uses the server aggregate and exact complete-cost denominator even with paged detail", () => {
  const data = fixture(); data.limits.truncated = true;
  data.summary.currencies = [{ currency: "CAD", deliveredUnits: 6, vehicleSalesCents: 15_000_000, grossCents: 500_001, grossEligibleUnits: 2, missingCostUnits: 4, reversedUnits: 1, reversedSalesCents: 2_000_000 }];
  assert.equal(dealerAverageGross(data)[0].averageCents, 250_000.5);
  assert.equal(dealerAverageGross(data)[0].missingCostUnits, 4);
  data.summary.currencies[0].grossCents = -50_000;
  assert.equal(dealerAverageGross(data)[0].averageCents, -25_000);
  data.summary.currencies[0].grossCents = 0;
  assert.equal(dealerAverageGross(data)[0].averageCents, 0);
  data.summary.currencies[0].grossEligibleUnits = 0;
  assert.equal(dealerAverageGross(data)[0].averageCents, null);
  data.summary.currencies[0].grossEligibleUnits = 2; data.summary.currencies[0].grossCents = null;
  assert.equal(dealerAverageGross(data)[0].averageCents, null);
  data.permissions.profit = false; assert.deepEqual(dealerAverageGross(data), []);
  data.permissions.profit = true; data.permissions.sales = false; assert.deepEqual(dealerAverageGross(data), []);
});

test("appointment show rate includes only attended and no-show outcomes within local calendar dates", () => {
  const data = fixture();
  data.appointments = [appointment("a", "attended"), appointment("b", "no_show"), appointment("c", "cancelled"), appointment("d", "scheduled"), appointment("before", "attended", "2026-10-01T01:00:00Z"), appointment("after", "attended", "2026-10-05T15:00:00Z")];
  const result = dealerAppointmentOutcomes(data)!;
  assert.equal(result.showRate, .5); assert.equal(result.decided, 2); assert.equal(result.attended, 1); assert.equal(result.noShow, 1);
  assert.equal(result.scheduled, 1); assert.equal(result.cancelled, 1); assert.equal(result.complete, true);
});

test("appointment rates are withheld for incomplete denominators, unknown links and future outcome claims", () => {
  const data = fixture(); data.appointments = [appointment("a", "attended")]; data.limits.truncated = true;
  assert.equal(dealerAppointmentOutcomes(data)!.showRate, null);
  data.limits.truncated = false; data.leads = [];
  assert.equal(dealerAppointmentOutcomes(data)!.showRate, null); assert.equal(dealerAppointmentOutcomes(data)!.unresolved, 1);
  const future = fixture(); future.appointments = [appointment("future", "attended", "2026-10-04T01:00:00Z")];
  assert.equal(dealerAppointmentOutcomes(future)!.showRate, null); assert.equal(dealerAppointmentOutcomes(future)!.unresolved, 1);
  future.permissions.customers = false; assert.equal(dealerAppointmentOutcomes(future), null);
});

test("empty records never invent investment, gross or conversion", () => {
  const data = fixture();
  assert.deepEqual(dealerStockAging(data).currencies, []); assert.deepEqual(dealerAverageGross(data), []);
  assert.equal(dealerAppointmentOutcomes(data)!.showRate, null);
  assert.equal(Object.hasOwn(dealerAppointmentOutcomes(data)!, "leadConversionRate"), false);
});
