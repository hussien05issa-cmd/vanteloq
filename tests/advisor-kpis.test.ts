import test from "node:test";
import assert from "node:assert/strict";
import { advisorKpis, advisorDailySeries, type AdvisorDay } from "../domain/advisor-kpis.ts";
const now=new Date("2026-09-10T12:00:00Z");
function fixture(): AdvisorDay[] {return Array.from({length:56},(_,i)=>["A","B"].map(locationRef=>({date:new Date(now.getTime()-i*86400000).toISOString().slice(0,10),locationRef,netSalesCents:i<28?10000:5000,grossProfitCents:i<28?4000:2000,transactions:10,unitsSold:20,labourCostCents:i<28?2000:1000,discountsCents:100,refundsCents:50,inventoryValueCents:150000,accountsPayableCents:30000}))).flat();}
test("financial KPIs use weighted totals, complete aligned periods and explicit definitions",()=>{
 const result=advisorKpis(fixture(),now); assert.equal(result.current?.netSalesCents,560000);assert.equal(result.current?.grossProfitCents,224000);assert.equal(result.current?.grossMarginPercent,40);assert.equal(result.current?.averageTransactionCents,1000);assert.equal(result.current?.labourToSalesPercent,20);assert.equal(result.current?.contributionAfterLabourCents,112000);assert.equal(result.salesChangePercent,100);assert.equal(result.netProfitCents,null);assert.equal(result.inventorySnapshotCents,300000);assert.equal(result.accountsPayableSnapshotCents,60000);
});
test("missing days, location coverage and zero denominators do not create confident comparisons",()=>{
 const rows=fixture().slice(1);const result=advisorKpis(rows,now);assert.equal(result.comparisonComplete,false);assert.equal(result.salesChangePercent,null);assert.equal(result.inventorySnapshotCents,null);
 assert.equal(advisorKpis(fixture().map(row=>({...row,transactions:0})),now).current?.averageTransactionCents,null);
});
test("permission-withheld costs and labour never become zero or inferred net profit",()=>{
 const rows=fixture().map(row=>({...row,grossProfitCents:null,labourCostCents:null,inventoryValueCents:null,accountsPayableCents:null}));const result=advisorKpis(rows,now);assert.equal(result.current?.grossProfitCents,null);assert.equal(result.current?.grossMarginPercent,null);assert.equal(result.current?.labourCostCents,null);assert.equal(result.current?.contributionAfterLabourCents,null);assert.equal(result.inventorySnapshotCents,null);
});
test("daily series removes location identifiers and aggregates same-date locations",()=>{
 const series=advisorDailySeries(fixture());assert.equal(series.length,56);assert.equal(series.at(-1)?.netSalesCents,20000);assert.equal(series.at(-1)?.observedLocations,2);assert.doesNotMatch(JSON.stringify(series),/locationRef|\"A\"|\"B\"/);
});
test("empty and unsafe numeric evidence stay unavailable",()=>{
 assert.equal(advisorKpis([],now).current,null);assert.equal(advisorKpis(fixture().map(row=>({...row,netSalesCents:Number.MAX_SAFE_INTEGER})),now).current?.netSalesCents,null);
});
