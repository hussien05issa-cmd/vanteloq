import assert from "node:assert/strict";
import test from "node:test";
import { defaultForecastSettings, type ForecastLocation } from "../domain/forecasting.ts";
import { outcomeSalesValues, outcomeWindows, recordedOutcomeSales, validateOutcomeSalesSnapshot } from "../domain/workflow-outcomes.ts";
import { validateBusinessWorkflow, businessWorkflowReport } from "../domain/business-workflows.ts";
const windows={baselineFrom:'2026-10-01',baselineTo:'2026-10-02',followupFrom:'2026-10-03',followupTo:'2026-10-04'};
const location=():ForecastLocation=>({id:'loc',name:'TEST_ONLY',currency:'CAD',timezone:'America/Edmonton',sourceIds:['source-b','source-a','source-a'],sourceCutoff:'2026-10-05T10:00:00Z',blocked:[],settings:{...defaultForecastSettings(),reviewedAt:'2026-10-05T12:00:00Z'},days:[{date:'2026-10-01',status:'complete',netSalesCents:10000,transactions:1,units:1},{date:'2026-10-02',status:'complete',netSalesCents:-3000,transactions:1,units:1},{date:'2026-10-03',status:'complete',netSalesCents:9000,transactions:1,units:1},{date:'2026-10-04',status:'closed',netSalesCents:0,transactions:0,units:0}]});
test('recorded outcome periods are equal, ordered, historical and bounded',()=>{
  assert.deepEqual(outcomeWindows(windows,'2026-10-05'),windows);
  for(const invalid of [{...windows,baselineFrom:'2026-02-30'},{...windows,followupFrom:windows.baselineTo},{...windows,followupTo:'2026-10-05'},{...windows,baselineTo:'2026-10-01'},{baselineFrom:'2024-01-01',baselineTo:'2024-01-02',followupFrom:'2026-10-03',followupTo:'2026-10-04'}])assert.throws(()=>outcomeWindows(invalid,'2026-10-05'));
});
test('negative refunds and confirmed zero days retain exact minor-unit totals',()=>{
  const result=recordedOutcomeSales(location(),windows,'2026-10-05T13:00:00Z');assert.ok(!('reason'in result));assert.equal(result.baselineMinor,7000);assert.equal(result.followupMinor,9000);assert.deepEqual(result.sourceIds,['source-a','source-b']);assert.deepEqual(outcomeSalesValues(result),{baseline:'70.00',followup:'90.00'});
});
test('missing, partial, duplicate or changed coverage never becomes a zero',()=>{
  for(const change of [(l:ForecastLocation)=>l.days.pop(),(l:ForecastLocation)=>{l.days[1].status='missing';},(l:ForecastLocation)=>{l.days[1].status='partial';},(l:ForecastLocation)=>{l.days[1].netSalesCents=null;},(l:ForecastLocation)=>{l.days[1]=l.days[0];},(l:ForecastLocation)=>{l.settings.reviewedAt=null;},(l:ForecastLocation)=>{l.blocked=['Overlapping sources'];}]){const input=location();change(input);assert.ok('reason'in recordedOutcomeSales(input,windows,'2026-10-05T13:00:00Z'));}
});
test('retained snapshots require matching values and cannot label manual evidence as source-derived',()=>{
  const result=recordedOutcomeSales(location(),windows,'2026-10-05T13:00:00Z');assert.ok(!('reason'in result));const snapshot={...result,fingerprint:'a'.repeat(64)};assert.deepEqual(validateOutcomeSalesSnapshot(snapshot),snapshot);
  const record=validateBusinessWorkflow({kind:'outcome',name:'TEST_ONLY',source:'Reviewed net sales',asOfDate:'2026-10-04',currency:'CAD',values:{...windows,taskId:'1',measurementMode:'recorded-net-sales',metric:'Net sales',unit:'CAD',...outcomeSalesValues(snapshot),coverage:'confirmed',guardrail:'Stockouts',guardrailBefore:'0',guardrailAfter:'0',decision:'keep'},groups:{},costCoverage:false,note:'Observed change, seasonality reviewed.',outcomeSnapshot:snapshot});
  assert.equal(businessWorkflowReport(record,[],'2026-10-05').canComplete,true);assert.match(businessWorkflowReport(record).boundary,/not proof/);
  assert.throws(()=>validateBusinessWorkflow({...record,values:{...record.values,baseline:'100.00'}}),/must match/);
  assert.throws(()=>validateBusinessWorkflow({...record,values:{...record.values,measurementMode:'manual'}}),/must match/);
  assert.equal(businessWorkflowReport({...record,outcomeSnapshot:null},[],'2026-10-05').canComplete,false);
});
test('unsupported metrics remain explicitly manual and never imply causation',()=>{
  const record=validateBusinessWorkflow({kind:'outcome',name:'TEST_ONLY',source:'Owner log',asOfDate:'2026-10-04',currency:'CAD',values:{...windows,actionReference:'External task',measurementMode:'manual',metric:'Waste',unit:'units',baseline:'20',followup:'15',coverage:'confirmed',guardrail:'Stockouts',guardrailBefore:'0',guardrailAfter:'0',decision:'keep'},groups:{},costCoverage:false,note:'Owner-reviewed manual observation.'});
  const report=businessWorkflowReport(record,[],'2026-10-05');assert.equal(report.canComplete,true);assert.match(report.metrics.find(m=>m.label==='Measurement evidence')!.value,/Manually entered/);assert.match(report.boundary,/not proof/);
});
