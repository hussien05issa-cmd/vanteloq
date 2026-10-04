import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import DealershipWorkspace, { DealershipSalesTable, DealershipStockTable, DealershipSummary, DealershipTeam, dealershipActionAllowed, dealershipActionPayload, dealershipCalendarAge, dealershipDeliveryBlockers, dealershipMoney } from "../app/dealership-workspace";
import { DEALERSHIP_BOUNDARY, type DealershipDashboard, type DealershipPermissions } from "../domain/dealership";

const fullPermissions: DealershipPermissions = { stockEdit: true, import: true, costs: true, costEdit: true, costApprove: true, profit: true, export: true, tasks: true, tasksEdit: true, sales: true, salesEdit: true, customers: true, customersEdit: true };
function fixture(): DealershipDashboard {
  return {
    locations: [{ id: "location-a", name: "Fictional test location", currency: "CAD", timezone: "America/Edmonton" }], people: [{ id: "person-a", name: "Test member" }], permissions: { ...fullPermissions },
    stock: [{ id: "episode-a", vehicleId: "vehicle-a", version: 7, locationId: "location-a", locationName: "Fictional test location", identifierKind: "vin", identifier: "1HGCM82633A004352", year: 2003, make: "Honda", model: "Accord", stockNumber: "TEST-001", currency: "CAD", acquiredDate: "2026-09-15", ownership: "owned", physicalStatus: "on_lot", prepStatus: "ready", availability: "available", askingCents: 2500000, postedCostCents: 1734567, costComplete: true, source: "manual", legacyIncomplete: false, reservationId: null, reservationExpiresAt: null }],
    costs: [], tasks: [], leads: [], appointments: [],
    sales: [{ id: "sale-a", episodeId: "episode-a", stockNumber: "TEST-001", deliveredDate: "2026-10-02", channel: "retail", amountCents: 3200000, currency: "CAD", costCents: 1734567, grossCents: 1465433, status: "delivered", reversalDate: null, credits: [{ personId: "person-a", shareBps: 6000, allocatedSalesCents: 1920000 }], unallocatedBps: 4000 }],
    summary: { from: "2026-10-01", to: "2026-10-03", currencies: [{ currency: "CAD", deliveredUnits: 1, vehicleSalesCents: 3200000, grossCents: 1465433, grossEligibleUnits: 1, missingCostUnits: 0, reversedUnits: 0, reversedSalesCents: 0 }], activeStock: 125, availableStock: 99, legacyIncomplete: 0 },
    nextCursor: "episode-next", legacyAvailable: 0, boundary: DEALERSHIP_BOUNDARY, limits: { relatedRows: 100, truncated: false }, generatedAt: "2026-10-03T19:00:00.000Z",
  };
}

test("initial dealership workspace shows loading without fabricated operating results", () => {
  const html = renderToStaticMarkup(<DealershipWorkspace activeLocationId="location-a" initialTab="inventory" compactOverview/>);
  assert.match(html, /Vehicle operations/);
  assert.match(html, /Loading dealership records/);
  assert.doesNotMatch(html, /CAD|Operational gross|Add vehicle|TEST-001/);
});

test("stock age uses location calendar days across midnight and daylight saving time", () => {
  assert.equal(dealershipCalendarAge("2026-10-01", "2026-10-03T01:00:00Z", "America/Edmonton"), 1);
  assert.equal(dealershipCalendarAge("2026-10-01", "2026-10-03T01:00:00Z", "Asia/Tokyo"), 2);
  assert.equal(dealershipCalendarAge("2026-03-07", "2026-03-09T18:00:00Z", "America/Edmonton"), 2);
  assert.equal(dealershipCalendarAge("2026-10-04", "2026-10-03T01:00:00Z", "UTC"), null);
  const html = renderToStaticMarkup(<DealershipStockTable data={fixture()} agingReviewDays={45}/>);
  assert.match(html, /45\+ calendar days/); assert.match(html, /loaded stock only/);
});

test("overview uses full-scope server aggregates rather than the loaded stock page", () => {
  const html = renderToStaticMarkup(<DealershipSummary data={fixture()} search="Honda"/>);
  assert.match(html, /<strong>125<\/strong>/);
  assert.match(html, /<strong>99<\/strong>/);
  assert.match(html, /matching search/);
  assert.match(html, /On lot, preparation ready and available/);
  assert.match(html, /CAD.*32,000.00/);
});

test("cost and profit restrictions also protect against accidentally overpopulated payloads", () => {
  const data = fixture(); data.permissions.costs = false; data.permissions.profit = false;
  const html = renderToStaticMarkup(<><DealershipSummary data={data}/><DealershipStockTable data={data}/><DealershipSalesTable data={data}/></>);
  assert.doesNotMatch(html, /17,345.67|14,654.33|Posted cost|Known operational gross|<th>Operational gross/);
  assert.match(html, /25,000.00/);
  assert.match(html, /32,000.00/);
});

test("viewing inventory value does not imply permission to view sales profit", () => {
  const data = fixture(); data.permissions.profit = false;
  const html = renderToStaticMarkup(<><DealershipSummary data={data}/><DealershipStockTable data={data}/><DealershipSalesTable data={data}/></>);
  assert.match(html, /17,345.67/);
  assert.doesNotMatch(html, /14,654.33|Known operational gross|<th>Operational gross/);
});

test("missing costs stay unknown and do not turn into zero gross", () => {
  const data = fixture(); data.stock[0].postedCostCents = null; data.stock[0].costComplete = false; data.sales[0].costCents = null; data.sales[0].grossCents = null;
  data.summary.currencies[0] = { ...data.summary.currencies[0], grossCents: null, grossEligibleUnits: 0, missingCostUnits: 1 };
  const html = renderToStaticMarkup(<><DealershipSummary data={data}/><DealershipStockTable data={data}/><DealershipSalesTable data={data}/></>);
  assert.match(html, /Not recorded/); assert.match(html, /Costs incomplete/); assert.match(html, /1 excluded for missing costs/);
  assert.doesNotMatch(html, /CAD(?:&#x27;|&#xA0;|\s)*0\.00/);
  assert.match(dealershipMoney(0, "CAD"), /0.00/);
  assert.equal(dealershipMoney(null, "CAD"), "Not recorded");
});

test("a role without sales access has no sales results or team sales allocations", () => {
  const data = fixture(); data.permissions.sales = false;
  const html = renderToStaticMarkup(<><DealershipSummary data={data}/><DealershipSalesTable data={data}/><DealershipTeam data={data}/></>);
  assert.doesNotMatch(html, /32,000|19,200|credited units|vehicle sales|Delivery activity|Recorded deliveries/);
});

test("team breakdown labels truncation and never substitutes zero for a missing allocation", () => {
  const data = fixture(); data.limits.truncated = true; delete data.sales[0].credits[0].allocatedSalesCents;
  const html = renderToStaticMarkup(<DealershipTeam data={data}/>);
  assert.match(html, /Partial team view/); assert.match(html, /loaded records only/); assert.match(html, /Not recorded allocated vehicle sales/);
  assert.match(html, /0.6 credited units/); assert.match(html, /0.4 delivered units have unallocated credit/);
});

test("manual acquisition creates integer cents and leaves optional unknown asking price null", () => {
  const editor = { action: "acquire" as const, draft: { locationId: "location-a", identifierKind: "vin", identifier: "1HGCM82633A004352", year: "2003", make: "Honda", model: "Accord", stockNumber: "TEST-001", acquiredDate: "2026-10-03", ownership: "owned", physicalStatus: "on_lot", prepStatus: "not_started", availability: "available", asking: "25000.01" }, context: {}, credits: [] };
  const result = dealershipActionPayload(editor, fullPermissions);
  assert.equal(result.askingCents, 2500001); assert.equal((result.vehicle as { year: number }).year, 2003);
  assert.equal(dealershipActionPayload({ ...editor, draft: { ...editor.draft, asking: "" } }, fullPermissions).askingCents, null);
});

test("restricted cost-completeness values are omitted from stock writes", () => {
  const editor = { action: "update_stock" as const, draft: { ownership: "owned", physicalStatus: "on_lot", prepStatus: "ready", availability: "available", asking: "", costComplete: "true" }, context: { episodeId: "episode-a", expectedVersion: 7 }, credits: [] };
  const result = dealershipActionPayload(editor, { ...fullPermissions, costApprove: false });
  assert.equal(Object.hasOwn(result, "costComplete"), false); assert.equal(result.expectedVersion, 7);
  assert.equal(dealershipActionPayload(editor, fullPermissions).costComplete, true);
});

test("estimation access cannot approve or post cost evidence", () => {
  const editor = { action: "add_cost" as const, draft: { category: "preparation", status: "posted", amount: "25.00", description: "Reviewed repair", sourceReference: "invoice-1" }, context: { episodeId: "episode-a" }, credits: [] };
  assert.throws(() => dealershipActionPayload(editor, { ...fullPermissions, costApprove: false }), /Approval is required/);
  assert.equal(dealershipActionPayload({ ...editor, draft: { ...editor.draft, status: "estimated" } }, { ...fullPermissions, costApprove: false }).amountCents, 2500);
});

test("reservation writes use sales authority and the reviewed stock version", () => {
  assert.equal(dealershipActionAllowed("reserve", { ...fullPermissions, sales: false, salesEdit: false, stockEdit: true }), false);
  const result = dealershipActionPayload({ action: "reserve", draft: { localTime: "2026-10-04T14:30", utcOffset: "-06:00", leadId: "lead-a" }, context: { episodeId: "episode-a", expectedVersion: 7 }, credits: [] }, { ...fullPermissions, stockEdit: false });
  assert.equal(result.expectedVersion, 7); assert.equal(result.expiresAt, "2026-10-04T20:30:00.000Z");
});

test("delivery readiness matches the actual delivery milestone requirements", () => {
  const stock = fixture().stock[0];
  assert.deepEqual(dealershipDeliveryBlockers(stock), []);
  assert.deepEqual(dealershipDeliveryBlockers({ ...stock, availability: "reserved", ownership: "consignment" }), []);
  assert.equal(dealershipDeliveryBlockers({ ...stock, availability: "held" }).length, 1);
  assert.equal(dealershipDeliveryBlockers({ ...stock, prepStatus: "blocked", physicalStatus: "offsite", ownership: "unknown" }).length, 3);
  assert.equal(dealershipDeliveryBlockers({ ...stock, availability: "delivered" }).length, 1);
});

test("a task requires exactly one vehicle or lead and preserves the version", () => {
  const editor = { action: "save_task" as const, draft: { title: "Photograph stock", status: "open" }, context: { id: "task-a", expectedVersion: 4 }, credits: [] };
  assert.throws(() => dealershipActionPayload(editor, fullPermissions), /exactly one/);
  assert.throws(() => dealershipActionPayload({ ...editor, draft: { ...editor.draft, episodeId: "episode-a", leadId: "lead-a" } }, fullPermissions), /exactly one/);
  const result = dealershipActionPayload({ ...editor, draft: { ...editor.draft, episodeId: "episode-a" } }, fullPermissions);
  assert.equal(result.leadId, null); assert.equal(result.expectedVersion, 4);
});

test("delivery credit accepts precise percentages and rejects over-allocation", () => {
  const editor = { action: "deliver" as const, draft: { deliveredDate: "2026-10-03", channel: "retail", amount: "32000.05" }, context: { episodeId: "episode-a", expectedVersion: 7 }, credits: [{ personId: "person-a", share: "33.33" }] };
  const result = dealershipActionPayload(editor, fullPermissions);
  assert.equal(result.amountCents, 3200005); assert.deepEqual(result.credits, [{ personId: "person-a", shareBps: 3333 }]);
  assert.throws(() => dealershipActionPayload({ ...editor, credits: [{ personId: "person-a", share: "60" }, { personId: "person-b", share: "50" }] }, fullPermissions), /cannot exceed 100/);
});

test("appointment conversion requires an explicit offset and retains the original record version", () => {
  const editor = { action: "save_appointment" as const, draft: { leadId: "lead-a", localTime: "2026-11-01T01:30", utcOffset: "-07:00", status: "scheduled" }, context: { id: "appointment-a", expectedVersion: 2 }, credits: [] };
  const result = dealershipActionPayload(editor, fullPermissions);
  assert.equal(result.scheduledAt, "2026-11-01T08:30:00.000Z"); assert.equal(result.expectedVersion, 2);
  assert.throws(() => dealershipActionPayload({ ...editor, draft: { ...editor.draft, utcOffset: "" } }, fullPermissions), /timezone offset/);
});
