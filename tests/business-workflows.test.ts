import test from "node:test";
import assert from "node:assert/strict";
import {BUSINESS_WORKFLOW_DEFINITIONS,validateBusinessWorkflow,businessWorkflowReport,workflowTransition,type BusinessWorkflow,type BusinessWorkflowKind} from "../domain/business-workflows.ts";
function record(kind:BusinessWorkflowKind,values:Record<string,string>,groups:BusinessWorkflow['groups']={}):BusinessWorkflow{const d=BUSINESS_WORKFLOW_DEFINITIONS[kind];return validateBusinessWorkflow({kind,name:"Fictional workflow",source:"TEST_ONLY",asOfDate:"2026-09-01",currency:"CAD",values,groups:Object.fromEntries(d.groups.map(g=>[g.key,groups[g.key]??[]])),costCoverage:true,note:"Reviewed fictional source."});}
const metric=(r:ReturnType<typeof businessWorkflowReport>,label:string)=>r.metrics.find(x=>x.label===label)?.value;
test("job direct cost is based on actual minutes and missing costs cannot close a job",()=>{
 const job=record("job",{client:"Example",scope:"Approved work",quote:"1000",variations:"0",recognizedRevenue:"1000"},{work:[{reference:"T1",date:"2026-09-01",minutes:"90",hourlyCost:"40.01",hourlyRate:"90",status:"invoiced"}],costs:[{reference:"M1",amount:"19.98"}]});
 let r=businessWorkflowReport(job);assert.equal(metric(r,"Direct cost"),"CAD 80.00");assert.equal(metric(r,"Job contribution"),"CAD 920.00");assert.equal(r.canComplete,true);
 job.groups.work[0].hourlyCost="";r=businessWorkflowReport(job);assert.equal(metric(r,"Job contribution"),"Needs cost evidence");assert.equal(r.canComplete,false);
 job.groups.work[0].hourlyCost="40.01";job.groups.work[0].status="completed";r=businessWorkflowReport(job);assert.equal(metric(r,"Completed, not invoiced"),"CAD 135.00");assert.equal(r.canComplete,false);
});
test("payout reconciles signed provider components without recognising duplicate revenue",()=>{
 const payout=record("settlement",{provider:"Test provider",account:"A",payoutId:"P1",payoutDate:"2026-09-01",bankAmount:"950",bankReference:"BANK1",batchType:"provider-mapped"},{entries:[{reference:"SALE1",orderReference:"ORDER1",type:"sale",amount:"1100"},{reference:"REF1",orderReference:"ORDER1",type:"refund",amount:"-100"},{reference:"FEE1",type:"fee",amount:"-50"}]});
 assert.equal(metric(businessWorkflowReport(payout),"Expected settlement"),"CAD 950.00");assert.equal(businessWorkflowReport(payout).canComplete,true);
 payout.values.bankAmount="949.99";assert.equal(metric(businessWorkflowReport(payout),"Unmatched difference"),"CAD -0.01");assert.equal(businessWorkflowReport(payout).canComplete,false);
 payout.groups.entries[2].amount="50";assert.throws(()=>validateBusinessWorkflow(payout),/reduce/);
});
test("order contribution requires every cost input and confirmed return recovery",()=>{
 const order=record("order_margin",{orderId:"O1",channel:"Web",salesDate:"2026-09-01",grossSales:"100",refunds:"20",shippingCharged:"5",cogs:"40",recoveredCost:"10",returnDisposition:"resaleable"},{costs:[{reference:"P1",type:"payment-fee",amount:"3"},{reference:"S1",type:"shipping",amount:"12"}]});
 assert.equal(metric(businessWorkflowReport(order),"Contribution"),"CAD 40.00");assert.equal(metric(businessWorkflowReport(order),"Contribution margin"),"47.1%");
 order.costCoverage=false;assert.equal(metric(businessWorkflowReport(order),"Contribution"),"Needs cost evidence");assert.equal(businessWorkflowReport(order).canComplete,false);
 order.values.returnDisposition="damaged";assert.throws(()=>validateBusinessWorkflow(order),/resaleable/);
});
test("action outcomes require equal completed windows and guardrails, without causal claims",()=>{
 const outcome=record("outcome",{actionReference:"TASK1",metric:"Waste",unit:"CAD",baselineFrom:"2026-08-01",baselineTo:"2026-08-07",followupFrom:"2026-08-08",followupTo:"2026-08-14",baseline:"100",followup:"80",target:"75",actualCost:"5",coverage:"confirmed",guardrail:"Stockouts",guardrailBefore:"2",guardrailAfter:"2",decision:"keep"});
 const report=businessWorkflowReport(outcome,[],"2026-08-14");assert.equal(metric(report,"Observed change"),"-20 CAD");assert.equal(report.canComplete,true);assert.match(report.boundary,/not proof/);
 outcome.values.followupTo="2026-08-15";assert.equal(businessWorkflowReport(outcome,[],"2026-08-14").canComplete,false);
 outcome.values.followupFrom="2026-08-07";assert.throws(()=>validateBusinessWorkflow(outcome),/non-overlapping/);
});
test("workflow validation rejects invalid dates, overprecision, duplicate sources and unsupported fields",()=>{
 const c=record("custom",{template:"review-purchase",condition:"Invoice mismatch",owner:"Manager",dueDate:"2026-09-10",nextAction:"Review",approval:"owner-review",outcome:"Supplier credit confirmed"},{checks:[{reference:"Invoice",evidence:"BILL1",status:"complete"}]});
 const r=businessWorkflowReport(c);assert.equal(r.canComplete,true);assert.equal(workflowTransition("draft","review",r,""),"reviewed");assert.throws(()=>workflowTransition("draft","complete",r,""));assert.throws(()=>workflowTransition("reviewed","save",r,""));assert.throws(()=>workflowTransition("reviewed","reopen",r,""));assert.equal(workflowTransition("completed","reopen",r,"Correct the source"),"draft");
 assert.throws(()=>validateBusinessWorkflow({...c,asOfDate:"2026-02-30"}));assert.throws(()=>validateBusinessWorkflow({...c,values:{...c.values,execute:"arbitrary-code"}}));
 assert.throws(()=>validateBusinessWorkflow({...c,groups:{checks:[...c.groups.checks,...c.groups.checks]}}),/duplicate/);
});

 test("job minutes accept whole decimal input without precision loss and scoped invoice references",()=>{
 const job=record("job",{client:"Example",scope:"Work",quote:"100",variations:"0",recognizedRevenue:"100",invoiceRefs:"workspace:invoice.1"},{work:[{reference:"T1",date:"2026-09-01",minutes:"90.0000",hourlyCost:"40.01",hourlyRate:"90",status:"invoiced"}]});
 assert.equal(metric(businessWorkflowReport(job),"Direct cost"),"CAD 60.02");
 });
