import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRecordedTrend } from '../domain/recorded-trend-summary.ts';
const row=(date,netSalesCents,grossProfitCents=0)=>({date,netSalesCents,grossProfitCents});
test('sparse dates use only recorded days and round the exact mean once',()=>{
 const result=summarizeRecordedTrend([row('2026-09-01',100,40),row('2026-09-07',101,51),row('2026-09-30',101,51)]);
 assert.deepEqual(result,{recordedDayCount:3,netSalesCents:302,averageSalesPerRecordedDayCents:101,grossProfitCents:142,peakDay:{date:'2026-09-07',netSalesCents:101}});
 assert.equal(summarizeRecordedTrend([row('2026-09-01',-1),row('2026-09-02',-2)]).averageSalesPerRecordedDayCents,-1);
});
test('peak ties use earliest date independent of input order, including all-negative sales',()=>{
 const points=Object.freeze([row('2026-09-03',-100,-60),row('2026-09-01',-100,-50),row('2026-09-02',-200,-80)]);
 const result=summarizeRecordedTrend(points);
 assert.deepEqual(result.peakDay,{date:'2026-09-01',netSalesCents:-100});
 assert.deepEqual(result,summarizeRecordedTrend([...points].reverse()));
 assert.equal(result.netSalesCents,-400);
 assert.equal(result.averageSalesPerRecordedDayCents,-133);
});
test('unknown or unsafe cost-derived profit stays unavailable without hiding valid sales',()=>{
 for(const profit of [null,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1]){
  const result=summarizeRecordedTrend([row('2026-09-01',100,40),row('2026-09-02',0,profit)]);
  assert.equal(result.netSalesCents,100);assert.equal(result.averageSalesPerRecordedDayCents,50);assert.equal(result.grossProfitCents,null);
 }
 const zero=summarizeRecordedTrend([row('2026-09-01',0,0)]);
 assert.equal(zero.netSalesCents,0);assert.equal(zero.grossProfitCents,0);
 const profitOverflow=summarizeRecordedTrend([row('2026-09-01',1,Number.MAX_SAFE_INTEGER),row('2026-09-02',1,1)]);
 assert.equal(profitOverflow.grossProfitCents,null);
});
test('empty, unsafe, overflowed or malformed observations never publish guessed amounts',()=>{
 const unavailable=result=>{assert.equal(result.netSalesCents,null);assert.equal(result.averageSalesPerRecordedDayCents,null);assert.equal(result.grossProfitCents,null);assert.equal(result.peakDay,null);};
 unavailable(summarizeRecordedTrend([]));
 for(const value of [NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1])unavailable(summarizeRecordedTrend([row('2026-09-01',value)]));
 unavailable(summarizeRecordedTrend([row('2026-09-01',Number.MAX_SAFE_INTEGER),row('2026-09-02',1)]));
 unavailable(summarizeRecordedTrend([row('2026-02-30',100)]));
 unavailable(summarizeRecordedTrend([row('2026-09-01',100),row('2026-09-01',200)]));
 // Exact cancellation still preserves a one-cent result near the safe bound.
 assert.equal(summarizeRecordedTrend([row('2026-09-01',Number.MAX_SAFE_INTEGER),row('2026-09-02',1),row('2026-09-03',-Number.MAX_SAFE_INTEGER)]).netSalesCents,1);
});
