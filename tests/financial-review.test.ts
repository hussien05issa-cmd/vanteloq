import assert from "node:assert/strict";
import test from "node:test";
import { buildFinancialStatements, calculateCanadianTax, reconciliationDifference, type LedgerAccountRow } from "../server/bookloq.ts";
import { buildFinancialReview, financialRatioBasisPoints } from "../domain/financial-review.ts";
import { projectAdvisorBookloq } from "../domain/advisor-bookloq.ts";
import { bookloqDemo } from "../domain/bookloq-demo.ts";

const row = (id: string, accountType: LedgerAccountRow["accountType"], normalBalance: LedgerAccountRow["normalBalance"], debitCents: number, creditCents: number): LedgerAccountRow => ({ id, code: id, name: id, accountType, normalBalance, debitCents, creditCents, accountSubtype: "", description: "", plainLanguage: "", systemKey: null });
const ledger = [
 row("cash", "asset", "debit", 240000, 0), row("equipment", "asset", "debit", 100000, 0),
 row("accumulated_depreciation", "asset", "credit", 0, 20000), row("capital", "equity", "credit", 0, 300000),
 row("drawings", "equity", "debit", 10000, 0), row("sales", "revenue", "credit", 0, 80000),
 row("returns", "revenue", "debit", 5000, 0), row("depreciation", "expense", "debit", 20000, 0),
 row("cogs", "expense", "debit", 25000, 0),
].map(x => x.id === "cogs" ? { ...x, systemKey: "cost_of_goods_sold" } : x);

test("contra assets, sales returns and owner draws preserve the accounting equation", () => {
 const s=buildFinancialStatements(ledger);
 assert.deepEqual(s.trialBalance,{totalDebitCents:400000,totalCreditCents:400000});
 assert.deepEqual(s.balanceSheet,{assetCents:320000,liabilityCents:0,equityCents:320000});
 assert.deepEqual(s.profitAndLoss,{revenueCents:75000,expenseCents:45000,cogsCents:25000,grossProfitCents:50000,operatingProfitCents:30000});
 assert.equal(s.accounts.find(x=>x.id==="accumulated_depreciation")?.balanceCents,20000);
 assert.equal(buildFinancialReview(s,true).status,"balanced");
});
test("missing postings are flagged without inserting an automatic balancing entry",()=>{
 const s=buildFinancialStatements(ledger.map(x=>x.id==="cash"?{...x,debitCents:x.debitCents-1000}:x));
 const review=buildFinancialReview(s,true);
 assert.equal(review.status,"needs_review");
 assert.deepEqual(review.checks.map(x=>x.differenceCents),[-1000,-1000,0,0]);
});
test("financial checks treat missing or withheld values as unavailable and reject unsafe arithmetic",()=>{
 const s=buildFinancialStatements(ledger);
 assert.ok(buildFinancialReview(s,false).checks.every(x=>x.status==="unavailable"));
 assert.equal(buildFinancialReview(null,true).status,"unavailable");
 assert.equal(buildFinancialReview({...s,profitAndLoss:{...s.profitAndLoss,grossProfitCents:NaN}},true).checks[2].status,"unavailable");
 assert.throws(()=>buildFinancialStatements([row("bad","asset","debit",0.5,0)]),/integer/);
 assert.throws(()=>buildFinancialStatements([row("a","asset","debit",Number.MAX_SAFE_INTEGER,0),row("b","asset","debit",1,0)]),/precision/);
 assert.throws(()=>reconciliationDifference(Number.MAX_SAFE_INTEGER,-1),/precision/);
 assert.equal(calculateCanadianTax(Number.MAX_SAFE_INTEGER,500),450359962737050);
 assert.equal(calculateCanadianTax(10,500),1);
 assert.equal(financialRatioBasisPoints(1,32),313);
 assert.equal(financialRatioBasisPoints(-1,32),-313);
 assert.equal(financialRatioBasisPoints(100,0),null);
});
test("AI receives checked totals and bounded cash scenarios, never raw ledger or contact identities",()=>{
 const cash={...bookloqDemo(600000,false,false),privateContact:"PRIVATE_SUPPLIER"};
 const input={bookloq:{settings:{status:"active",dataMode:"live",baseCurrency:"CAD"},ledgerAccess:{available:true},statements:{...buildFinancialStatements(ledger),privateAccount:"PRIVATE_ACCOUNT"},thirteenWeekCashFlow:cash}};
 const r=projectAdvisorBookloq(input);
 assert.equal(r.financialReview?.status,"balanced");
 assert.ok(r.cashOutlook && "weeks" in r.cashOutlook);
 assert.equal(r.cashOutlook?.weeks?.length,13);
 assert.equal(r.cashOutlook?.minimumConservativeCashCents,1200000);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_SUPPLIER|PRIVATE_ACCOUNT|accumulated_depreciation/);
 const withheld=projectAdvisorBookloq({bookloq:{...input.bookloq,ledgerAccess:{available:false},thirteenWeekCashFlow:null}});
 assert.equal(withheld.statements,null);
 assert.equal(withheld.financialReview?.status,"unavailable");
 assert.equal(withheld.cashOutlook?.status,"unavailable");
 const bad=projectAdvisorBookloq({bookloq:{...input.bookloq,thirteenWeekCashFlow:{...cash,weeks:cash.weeks.map((x,i)=>i===1?cash.weeks[0]:x)}}});
 assert.equal(bad.cashOutlook?.status,"unavailable");
});
