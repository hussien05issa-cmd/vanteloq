import assert from "node:assert/strict";
import test from "node:test";
import { buildCollectionsDashboard, collectionBucket, filterCollections, normalizeCollectionsPreferences, type CollectionRecord } from "../domain/collections-dashboard.ts";
const record = (id: string, extra: Partial<CollectionRecord> = {}): CollectionRecord => ({ id, kind:"receivable", reference:id, contactId:id, contactName:id, invoiceDate:"2026-09-01", dueDate:"2026-09-26", status:"sent", approvalStatus:"not_required", totalCents:10001, paidCents:1000, currency:"CAD", updatedAt:null, ...extra });
test("outstanding amounts retain exact cents, while disputes and overdue stay out of the due-date schedule", () => {
  const report = buildCollectionsDashboard([record("today"),record("overdue",{dueDate:"2026-09-25"}),record("dispute",{status:"disputed"}),record("foreign",{currency:"USD"}),record("invalid-date",{dueDate:"2026-02-30"})],"2026-09-26","CAD",7);
  assert.equal(report.receivables.totalCents,36004); assert.equal(report.receivables.overdueCents,9001); assert.equal(report.receivables.disputedCents,9001); assert.equal(report.otherCurrencyCount,1); assert.equal(report.undatedCents,9001); assert.equal(report.schedule[0].incomingCents,9001); assert.equal(report.schedule.at(-1)!.to,"2026-10-02");
});
test("ageing boundaries include due today and reject impossible dates", () => {
  for (const [date,bucket] of [["2026-09-26","current"],["2026-09-25","1-30"],["2026-08-27","1-30"],["2026-08-26","31-60"],["2026-07-28","31-60"],["2026-07-27","61-90"],["2026-06-28","61-90"],["2026-06-27","91+"],["2026-02-30","undated"]]) assert.equal(collectionBucket(date,"2026-09-26"),bucket);
});
test("closed, invalid and foreign balances never create a misleading total", () => {
  const records = ["draft","void","cancelled","paid","reconciled","written_off"].map(status=>record(status,{status}));
  records.push(record("unsafe",{totalCents:Number.MAX_SAFE_INTEGER+1}),record("fractional",{paidCents:0.5}),record("negative",{paidCents:-1}),record("overpaid",{paidCents:20000}),record("zero",{paidCents:10001}));
  const report=buildCollectionsDashboard(records,"2026-09-26","CAD"); assert.equal(report.receivables.totalCents,0); assert.equal(report.invalidCount,4);
  assert.throws(()=>buildCollectionsDashboard([record("a",{totalCents:Number.MAX_SAFE_INTEGER,paidCents:0}),record("b",{totalCents:1,paidCents:0})],"2026-09-26","CAD"));
});
test("due filters match headline amounts and concentration groups the same contact",()=>{
  const report=buildCollectionsDashboard([record("a",{contactId:"same"}),record("b",{contactId:"same",kind:"receivable"}),record("c",{kind:"payable",dueDate:"2026-09-01",approvalStatus:"pending"}),record("d",{kind:"payable",dueDate:"2026-10-03"})],"2026-09-26","CAD",7);
  const due=filterCollections(report.records,"payable","due",report.asOf,7); assert.equal(due.reduce((s,r)=>s+r.outstandingCents,0),report.payables.dueCents); assert.equal(report.largestCustomer?.cents,18002); assert.equal(filterCollections(report.records,"payable","unapproved",report.asOf,7).length,1);
});
test("customization preserves ordering without dropping required defaults",()=>{
  const prefs=normalizeCollectionsPreferences({widgets:[{id:"actions",visible:false},{id:"actions",visible:true},{id:"nonsense",visible:true}],density:"compact",horizon:7}); assert.deepEqual(prefs.widgets,[{id:"actions",visible:false},{id:"schedule",visible:true},{id:"aging",visible:true}]); assert.equal(prefs.horizon,7); assert.equal(normalizeCollectionsPreferences(null).horizon,30);
});

test("due-date schedules reconcile exact cents across each supported horizon without changing source records", () => {
  const asOf = "2026-09-26";
  const records = [-1, 0, 6, 7, 29, 30, 89, 90].flatMap(days => {
    const dueDate = new Date(Date.parse(asOf + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
    return [record(`in-${days}`, { dueDate }), record(`out-${days}`, { kind: "payable", dueDate, totalCents: 5001, paidCents: 1000 })];
  });
  records.push(record("undated", { dueDate: "2026-02-30" }), record("disputed", { status: "disputed" }));
  const before = structuredClone(records);
  for (const horizon of [7, 30, 90] as const) {
    const report = buildCollectionsDashboard(records, asOf, "CAD", horizon);
    const includedDates = horizon === 7 ? 2 : horizon === 30 ? 4 : 6;
    assert.equal(report.schedule.reduce((sum, bucket) => sum + bucket.incomingCents, 0), includedDates * 9001);
    assert.equal(report.schedule.reduce((sum, bucket) => sum + bucket.outgoingCents, 0), includedDates * 4001);
    assert.equal(report.schedule.at(-1)!.cumulativeCents, includedDates * 5000);
    assert.equal(report.undatedCents, 9001);
    assert.equal(filterCollections(report.records, "receivable", "due", asOf, horizon).reduce((sum, item) => sum + item.outstandingCents, 0), report.receivables.dueCents);
  }
  assert.deepEqual(records, before);
});
