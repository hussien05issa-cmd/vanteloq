import assert from "node:assert/strict";
import test from "node:test";
import { executivePeriod,ledgerIntelligence,exactSum,agingBuckets,classifyCashMovements,changePercent,type ExecutiveLedgerRow } from "../domain/executive-metrics.ts";
import { buildFinancialReview } from "../domain/financial-review.ts";
import { buildFinancialStatements } from "../server/bookloq.ts";
const row=(accountType:string,systemKey:string,debitCents=0,creditCents=0):ExecutiveLedgerRow=>({id:systemKey,name:systemKey,accountType,accountSubtype:systemKey,systemKey,debitCents,creditCents});
test("executive date windows use real calendar periods and clamp leap-day year comparisons",()=>{
  const p=(query:string,today="2026-09-17")=>executivePeriod(new URLSearchParams(query),today);
  assert.equal(p("period=qtd").from,"2026-07-01");assert.equal(p("period=mtd").from,"2026-09-01");assert.equal(p("period=ytd").days,260);
  const leap=p("period=today&compare=yoy","2024-02-29");assert.equal(leap.comparisonFrom,"2023-02-28");assert.equal(leap.comparisonTo,"2023-02-28");
  assert.throws(()=>p("period=custom&from=2026-02-30&to=2026-03-03"));assert.throws(()=>p("period=custom&from=2024-01-01&to=2026-01-01"));assert.throws(()=>p("period=custom&from=2026-09-18&to=2026-09-18"));
  assert.equal(changePercent(100,0),null);assert.equal(changePercent(-50,-100),50);
});
test("operating results exclude non-operating income, finance costs and income tax without breaking the balance equation",()=>{
  const rows=[row("revenue","sales_revenue",0,100000),row("revenue","interest_income",0,2000),row("expense","cost_of_goods_sold",40000),row("expense","rent",10000),row("expense","interest_expense",3000),row("expense","income_tax_expense",5000),row("asset","operating_cash",44000)];
  const f=ledgerIntelligence(rows);assert.equal(f.grossProfitCents,60000);assert.equal(f.operatingProfitCents,50000);assert.equal(f.netProfitCents,44000);assert.equal(f.balanceDifferenceCents,0);
  const legacy=buildFinancialStatements(rows.map(r=>({...r,accountType:r.accountType as "asset",code:r.id,normalBalance:"debit" as const,description:"",plainLanguage:""})));
  assert.equal(legacy.profitAndLoss.operatingProfitCents,f.operatingProfitCents);assert.equal(legacy.profitAndLoss.netProfitCents,f.netProfitCents);assert.equal(legacy.balanceSheet.equityCents,44000);assert.equal(buildFinancialReview(legacy,true).status,"balanced");
  assert.throws(()=>exactSum([Number.MAX_SAFE_INTEGER,1]));assert.throws(()=>exactSum([.1]));
});
test("ratios require classified balance accounts and a positive liability denominator",()=>{
  assert.equal(ledgerIntelligence([row("asset","mystery",100)]).currentRatio,null);
  const classified=ledgerIntelligence([row("asset","operating_cash",10000),row("asset","inventory_asset",5000),row("liability","accounts_payable",0,5000)]);
  assert.equal(classified.currentRatio,3);assert.equal(classified.quickRatio,2);assert.equal(classified.workingCapitalCents,10000);
  assert.equal(ledgerIntelligence([row("asset","operating_cash",10000)]).quickRatio,null);
});
test("cash classification reconciles movements while keeping mixed and policy-sensitive journals unclassified",()=>{
  const entry=(id:string,rows:ExecutiveLedgerRow[])=>rows.map(r=>({...r,entryId:id}));
  const rows=[...entry("sale",[row("asset","operating_cash",10000),row("revenue","sales",0,10000)]),...entry("loan",[row("asset","operating_cash",5000),row("liability","loan",0,5000)]),...entry("mixed",[row("asset","operating_cash",0,2000),row("expense","rent",1000),row("liability","loan",1000)]),...entry("transfer",[row("asset","operating_cash",0,600),row("asset","bank",600)])];
  assert.deepEqual(classifyCashMovements(rows),{operating:10000,investing:0,financing:5000,unclassified:-2000,total:13000});
});
test("aging distinguishes due today, overdue, part payments and draft documents",()=>{
  const buckets=agingBuckets([{dueDate:"2026-09-17",totalCents:1000,paidCents:0,status:"sent"},{dueDate:"2026-08-17",totalCents:2000,paidCents:500,status:"partially_paid"},{dueDate:"2025-01-01",totalCents:9000,paidCents:0,status:"draft"}],"2026-09-17");
  assert.deepEqual(buckets.map(r=>r.cents),[1000,0,1500,0,0]);
});
