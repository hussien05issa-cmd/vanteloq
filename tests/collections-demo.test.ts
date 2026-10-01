import assert from 'node:assert/strict';
import test from 'node:test';
import {collectionsDemo} from '../domain/collections-demo.ts';
test('sample aging totals reconcile through the production calculator and filters',()=>{
  const a=collectionsDemo('2026-10-01','receivable','all');
  assert.equal(a.report.receivables.totalCents,1864000);
  assert.equal(a.report.payables.totalCents,1118400);
  assert.equal(a.records.reduce((s,r)=>s+r.outstandingCents,0),1864000);
  const overdue=collectionsDemo('2026-10-01','receivable','91+');assert.equal(overdue.total,1);assert.equal(overdue.records[0].outstandingCents,143000);
  const empty=collectionsDemo('2026-10-01','receivable','all',true);assert.equal(empty.total,0);assert.equal(empty.report.receivables.count,0);
});
