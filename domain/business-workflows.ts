import type { IndustryConfiguration } from "./industry-templates";
import { foodAmountText, foodAmountToMinor } from "./foodservice";

export const BUSINESS_WORKFLOW_KINDS = ["job", "settlement", "order_margin", "outcome", "custom"] as const;
export type BusinessWorkflowKind = typeof BUSINESS_WORKFLOW_KINDS[number];
export type WorkflowState = "draft" | "reviewed" | "completed";
export type WorkflowField = { key: string; label: string; type: "text" | "date" | "money" | "number" | "select"; required?: boolean; options?: readonly string[]; hint?: string; signed?: boolean };
export type WorkflowGroup = { key: string; label: string; fields: WorkflowField[] };
export type WorkflowDefinition = { title: string; description: string; fields: WorkflowField[]; groups: WorkflowGroup[]; boundary: string };
const field = (key: string, label: string, type: WorkflowField["type"] = "text", extra: Partial<WorkflowField> = {}): WorkflowField => ({ key, label, type, ...extra });
export const BUSINESS_WORKFLOW_DEFINITIONS: Record<BusinessWorkflowKind, WorkflowDefinition> = {
  job: {
    title: "Client jobs", description: "Keep scope, work, costs and invoicing together.",
    fields: [field("client", "Client", "text", {required: true}), field("scope", "Approved scope", "text", {required: true}), field("dueDate", "Delivery date", "date"), field("quote", "Approved quote, excluding tax", "money"), field("variations", "Approved scope changes, excluding tax", "money"), field("recognizedRevenue", "Reviewed revenue for this job", "money", {hint: "Use your accounting records. An invoice or payment alone does not establish recognised revenue."}), field("invoiceRefs", "BookLoQ invoice IDs", "text", {hint: "Select saved invoices below. Their balances are read from BookLoQ."})],
    groups: [
      {key: "work", label: "Time and work", fields: [field("reference", "Work reference", "text", {required: true}), field("date", "Work date", "date", {required: true}), field("minutes", "Minutes worked", "number", {required: true}), field("hourlyCost", "Cost per hour", "money"), field("hourlyRate", "Billable rate per hour", "money"), field("status", "Work status", "select", {required: true, options: ["planned", "completed", "invoiced"]})]},
      {key: "costs", label: "Direct expenses and subcontractors", fields: [field("reference", "Expense source", "text", {required: true}), field("amount", "Direct cost", "money", {required: true})]},
      {key: "milestones", label: "Milestones", fields: [field("reference", "Milestone", "text", {required: true}), field("date", "Due date", "date", {required: true}), field("status", "Status", "select", {required: true, options: ["planned", "completed", "invoiced"]})]},
    ], boundary: "Job contribution is reviewed revenue less direct costs. It is not company net profit. This workspace does not post revenue or send invoices.",
  },
  settlement: {
    title: "Payout reconciliation", description: "Explain the amount that reached the bank.",
    fields: [field("provider", "Payment provider", "text", {required: true}), field("account", "Provider account reference", "text", {required: true}), field("payoutId", "Payout ID", "text", {required: true}), field("payoutDate", "Payout date", "date", {required: true}), field("bankAmount", "Bank deposit received", "money", {signed: true}), field("bankReference", "Bank transaction reference"), field("batchType", "Payout mapping", "select", {required: true, options: ["provider-mapped", "manual-reviewed"]})],
    groups: [{key: "entries", label: "Payout components", fields: [field("reference", "Provider transaction ID", "text", {required: true}), field("orderReference", "Original order / refund reference"), field("type", "Type", "select", {required: true, options: ["sale", "refund", "fee", "dispute", "reserve", "adjustment"]}), field("amount", "Signed settlement amount", "money", {required: true, signed: true, hint: "Money credited is positive; fees, refunds and withheld reserves are negative."})]}],
    boundary: "Reconciliation explains cash settlement. It does not recognise revenue or post a clearing journal. Manual or instant payouts need reviewed provider mapping.",
  },
  order_margin: {
    title: "Order contribution", description: "Review the costs that remain after a sale.",
    fields: [field("orderId", "Order ID", "text", {required: true}), field("channel", "Sales channel", "text", {required: true}), field("salesDate", "Sale date", "date", {required: true}), field("grossSales", "Item sales before refunds, excluding tax", "money", {required: true}), field("refunds", "Item refunds", "money"), field("shippingCharged", "Shipping charged to the customer", "money"), field("cogs", "Matched cost of goods sold", "money"), field("recoveredCost", "Confirmed resaleable returns at cost", "money", {hint: "Only confirmed stock recovery. A refund alone does not reverse cost."}), field("returnReason", "Return reason", "select", {options: ["none", "fit", "damaged", "wrong-item", "late", "changed-mind", "other"]}), field("returnDisposition", "Returned goods", "select", {options: ["none", "awaiting-inspection", "resaleable", "damaged", "supplier-return"]})],
    groups: [{key: "costs", label: "Attributable variable costs", fields: [field("reference", "Cost source", "text", {required: true}), field("type", "Cost type", "select", {required: true, options: ["payment-fee", "commission", "shipping", "packaging", "fulfilment", "return-handling", "promotion", "other"]}), field("amount", "Cost", "money", {required: true})]}],
    boundary: "Contribution includes only the costs you confirm. It is not net profit or advertising attribution. Returns and stock recovery remain separate.",
  },
  outcome: {
    title: "Action outcomes", description: "Compare the result with the decision you made.",
    fields: [field("actionReference", "Task / decision reference", "text", {required: true}), field("metric", "Metric being measured", "text", {required: true}), field("unit", "Unit", "text", {required: true, hint: "For example CAD, units, minutes or percentage points."}), field("baselineFrom", "Baseline start", "date", {required: true}), field("baselineTo", "Baseline end", "date", {required: true}), field("followupFrom", "Follow-up start", "date", {required: true}), field("followupTo", "Follow-up end", "date", {required: true}), field("baseline", "Baseline value", "number", {signed: true}), field("followup", "Follow-up value", "number", {signed: true}), field("target", "Expected result", "number", {signed: true}), field("actualCost", "Cost of the intervention", "money"), field("coverage", "Periods comparable and complete", "select", {required: true, options: ["not-yet", "confirmed"]}), field("guardrail", "Trade-off to watch", "text", {required: true}), field("guardrailBefore", "Trade-off baseline", "number", {signed: true}), field("guardrailAfter", "Trade-off follow-up", "number", {signed: true}), field("decision", "Next decision", "select", {required: true, options: ["review", "keep", "adjust", "reverse"]})],
    groups: [], boundary: "A before-and-after change is an observation, not proof the action caused it. Confirm comparable periods and preserve seasonal or missing-data qualifications.",
  },
  custom: {
    title: "Your workflows", description: "Give a recurring job an owner, evidence and a clear finish.",
    fields: [field("template", "Workflow", "select", {required: true, options: ["collect-money", "deliver-work", "review-purchase", "resolve-exception"]}), field("condition", "When this needs attention", "text", {required: true}), field("owner", "Responsible person", "text", {required: true}), field("dueDate", "Next action date", "date", {required: true}), field("nextAction", "Next action", "text", {required: true}), field("approval", "Review requirement", "select", {required: true, options: ["owner-review", "manager-review"]}), field("outcome", "Observed result")],
    groups: [{key: "checks", label: "Required evidence", fields: [field("reference", "Required check", "text", {required: true}), field("evidence", "Evidence reference"), field("status", "Status", "select", {required: true, options: ["pending", "complete", "not-applicable"]})]}],
    boundary: "This is a reviewed work checklist. Conditions do not execute payments, messages or arbitrary code.",
  },
};
export type BusinessWorkflow = { kind: BusinessWorkflowKind; name: string; source: string; asOfDate: string; currency: string; values: Record<string, string>; groups: Record<string, Record<string,string>[]>; costCoverage: boolean; note: string };
export type SavedBusinessWorkflow = BusinessWorkflow & { id: string; locationId: string; version: number; state: WorkflowState; updatedAt: number };
export type WorkflowMetric = { label: string; value: string; attention?: boolean };
export type WorkflowReport = { metrics: WorkflowMetric[]; attention: string[]; canComplete: boolean; boundary: string };
export type LinkedInvoice = { id: string; number: string; currency: string; totalMinor: number; outstandingMinor: number; status: string };

export function businessWorkflowKinds(config: IndustryConfiguration): BusinessWorkflowKind[] {
  return [...(config.templateId === "services" || config.templateId === "other" ? ["job" as const] : []), ...(config.capabilities.includes("products") ? ["settlement" as const,"order_margin" as const] : []), "outcome", "custom"];
}
function object(value: unknown): Record<string,unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Enter a valid workflow record."); return value as Record<string,unknown>; }
function text(value: unknown, label: string, max = 500, required = false) { if (value == null && !required) return ""; if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error(`Review ${label.toLowerCase()}.`); const s=value.trim(); if (required && !s) throw Error(`${label} is required.`); return s; }
export function workflowDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value) throw Error("Enter a valid calendar date."); return value; }
function validateFields(raw: unknown, fields: WorkflowField[], currency: string) {
  const p=object(raw); if(Object.keys(p).some(k=>!fields.some(f=>f.key===k))) throw Error("Remove unsupported workflow fields.");
  return Object.fromEntries(fields.map(f=>{
    const value=text(p[f.key],f.label, f.key === "invoiceRefs" ? 1200 : 1000,Boolean(f.required));
    if (value && f.type==="date") workflowDate(value);
    if (value && f.type==="select" && !f.options?.includes(value)) throw Error(`Choose a valid ${f.label.toLowerCase()}.`);
    if (value && f.type==="number" && (!/^-?\d+(?:\.\d{1,4})?$/.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value))>1_000_000_000 || (!f.signed && Number(value)<0))) throw Error(`Enter a valid ${f.label.toLowerCase()}.`);
    if(value && f.type==="money") { const amount=foodAmountToMinor(value,currency); if(amount===null || !Number.isSafeInteger(amount) || Math.abs(amount)>1_000_000_000_000 || (!f.signed && amount<0)) throw Error(`Enter a valid ${f.label.toLowerCase()}.`); }
    return [f.key,value];
  }));
}
export function validateBusinessWorkflow(raw: unknown): BusinessWorkflow {
  const p=object(raw); if(!BUSINESS_WORKFLOW_KINDS.includes(p.kind as BusinessWorkflowKind)) throw Error("Choose a supported workflow.");
  if (Object.keys(p).some(k=>!["kind","name","source","asOfDate","currency","values","groups","costCoverage","note"].includes(k))) throw Error("Remove unsupported workflow properties.");
  const kind=p.kind as BusinessWorkflowKind, d=BUSINESS_WORKFLOW_DEFINITIONS[kind], currency=text(p.currency,"Currency",3,true);
  if(!/^[A-Z]{3}$/.test(currency)) throw Error("Choose a supported currency.");
  // Use the same currency scale as existing reviewed financial records.
  foodAmountToMinor("0",currency);
  const values=validateFields(p.values,d.fields,currency), rawGroups=object(p.groups??{});
  if(Object.keys(rawGroups).some(k=>!d.groups.some(g=>g.key===k))) throw Error("Remove unsupported workflow sections.");
  const groups=Object.fromEntries(d.groups.map(g=>{const rows=rawGroups[g.key]??[]; if(!Array.isArray(rows)||rows.length>100)throw Error("Use at most 100 entries per section.");const clean=rows.map(r=>validateFields(r,g.fields,currency));if(new Set(clean.map(r=>r.reference)).size!==clean.length)throw Error(`${g.label} contains a duplicate reference.`);return[g.key,clean];}));
  const record={kind,name:text(p.name,"Name",120,true),source:text(p.source,"Source reference",300,true),asOfDate:workflowDate(text(p.asOfDate,"Source date",10,true)),currency,values,groups,costCoverage:p.costCoverage===true,note:text(p.note,"Review notes",2000)};
  if(p.costCoverage!==true && p.costCoverage!==false)throw Error("Confirm the cost coverage explicitly.");
  if(kind==="job") { if(invoiceReferences(record).length>20)throw Error("Link at most 20 invoices.");for(const r of groups.work)if(!Number.isInteger(Number(r.minutes)))throw Error("Record work in whole minutes."); }
  if(kind==="settlement")for(const r of groups.entries){const v=minor(r.amount,currency);if((r.type==="sale" && v!==null && v<0)||(["fee","refund","dispute"].includes(r.type)&&v!==null&&v>0))throw Error("Sales credit the payout. Fees, refunds and disputes reduce it.");}
  if(kind==="order_margin") { const recovered=minor(values.recoveredCost,currency); if(recovered!==null&&recovered>0&&values.returnDisposition!=="resaleable")throw Error("Recovered cost requires confirmed resaleable goods."); const cogs=minor(values.cogs,currency);if(cogs!==null&&recovered!==null&&recovered>cogs)throw Error("Recovered stock cost cannot exceed the recorded cost of goods sold."); }
  if(kind==="outcome" && (values.baselineFrom>values.baselineTo||values.followupFrom>values.followupTo||values.followupFrom<=values.baselineTo))throw Error("Use ordered, non-overlapping baseline and follow-up periods.");
  return record;
}
export function invoiceReferences(record: BusinessWorkflow) { const refs=(record.values.invoiceRefs??"").split(",").map(s=>s.trim()).filter(Boolean);if(refs.some(s=>!/^[A-Za-z0-9_.:-]{1,200}$/.test(s)))throw Error("Choose valid invoice references.");if(new Set(refs).size!==refs.length)throw Error("Link each invoice only once.");return refs; }
function minor(value: string|undefined,currency:string){return value ? foodAmountToMinor(value,currency) : null;}
function sum(values:(number|null)[]) {if(values.some(x=>x===null))return null;const total=values.reduce<number>((a,b)=>a+b!,0);if(!Number.isSafeInteger(total))throw Error("The total exceeds the supported calculation range.");return total;}
function money(value:number|null,currency:string){return value===null?"Needs cost evidence":`${currency} ${foodAmountText(value,currency)}`;}
function multiplyMinutes(rate:number|null,minutes:string) { if(rate===null)return null;const numerator=BigInt(rate)*BigInt(Number(minutes));const rounded=(numerator+BigInt(30))/BigInt(60);const result=Number(rounded);if(!Number.isSafeInteger(result))throw Error("Time cost exceeds the supported calculation range.");return result; }
function number(value:string){return value===""?null:Number(value);}
export function businessWorkflowReport(record: BusinessWorkflow, invoices: LinkedInvoice[] = [], today = new Date().toISOString().slice(0,10)): WorkflowReport {
  const {kind,values:v,groups:g,currency:c}=record, metrics:WorkflowMetric[]=[],attention:string[]=[];
  let canComplete=true;
  const m=(label:string,value:string,needs=false)=>metrics.push({label,value,attention:needs});
  const requiredCosts=()=>{if(!record.costCoverage){attention.push("Confirm that all relevant costs are included before relying on contribution.");canComplete=false;}};
  if(kind==="job"){
    const actual=g.work.filter(x=>x.status!=="planned"),labour=sum(actual.map(x=>multiplyMinutes(minor(x.hourlyCost,c),x.minutes))),expenses=sum(g.costs.map(x=>minor(x.amount,c))),direct=labour===null||expenses===null?null:sum([labour,expenses]);
    const unbilled=g.work.filter(x=>x.status==="completed"),unbilledValue=sum(unbilled.map(x=>multiplyMinutes(minor(x.hourlyRate,c),x.minutes)));
    const recognized=minor(v.recognizedRevenue,c),quote=minor(v.quote,c),variations=minor(v.variations,c);
    const refs=invoiceReferences(record), linked=refs.map(ref=>invoices.find(i=>i.id===ref));
    const outstanding=linked.some(x=>!x||x.currency!==c)?null:sum(linked.map(x=>x!.outstandingMinor));
    m("Actual work",`${actual.reduce((n,x)=>n+Number(x.minutes),0)} min`);m("Direct cost",money(direct,c));m("Completed, not invoiced",money(unbilledValue,c),unbilled.length>0);m("Linked invoice balance",refs.length?money(outstanding,c):"No invoices linked");
    m("Job contribution",money(record.costCoverage&&recognized!==null&&direct!==null?recognized-direct:null,c));m("Approved quote less direct costs",money(quote!==null&&variations!==null&&direct!==null?quote+variations-direct:null,c));
    if(unbilled.length)attention.push(`${unbilled.length} completed work entries still need invoicing review.`);
    if(g.milestones.some(x=>x.status==="planned"&&x.date<today))attention.push("A planned milestone is overdue.");
    if(v.dueDate&&v.dueDate<today&&g.milestones.some(x=>x.status==="planned"))attention.push("Review the client delivery promise.");
    if(refs.length&&outstanding===null)attention.push("Linked invoice evidence is unavailable or uses a different currency.");
    if(direct===null||recognized===null)attention.push("Confirm direct costs and recognised revenue before closing the job.");
    requiredCosts();canComplete=canComplete&&direct!==null&&recognized!==null&&unbilled.length===0&&!g.work.some(x=>x.status==="planned")&&!g.milestones.some(x=>x.status==="planned")&&(!refs.length||outstanding===0);
  }else if(kind==="settlement"){
    const expected=sum(g.entries.map(x=>minor(x.amount,c))),bank=minor(v.bankAmount,c),difference=bank===null||expected===null?null:bank-expected;
    m("Components",String(g.entries.length));m("Expected settlement",money(expected,c));m("Bank received",bank===null?"Not recorded":money(bank,c));m("Unmatched difference",difference===null?"Awaiting bank evidence":money(difference,c),difference!==null&&difference!==0);
    if(!g.entries.length)attention.push("Add the provider's mapped settlement components.");
    if(bank===null||!v.bankReference)attention.push("Record the actual bank amount and transaction reference.");
    if(difference!==null&&difference!==0)attention.push("Resolve the difference before completing reconciliation.");
    if(g.entries.some(x=>["sale","refund"].includes(x.type)&&!x.orderReference))attention.push("Link sales and refunds to their original order references.");
    canComplete=g.entries.length>0&&difference===0&&Boolean(v.bankReference)&&!g.entries.some(x=>["sale","refund"].includes(x.type)&&!x.orderReference);
  }else if(kind==="order_margin"){
    const sale=minor(v.grossSales,c),refund=minor(v.refunds,c),shipping=minor(v.shippingCharged,c),cogs=minor(v.cogs,c),recovered=minor(v.recoveredCost,c),costs=sum(g.costs.map(x=>minor(x.amount,c)));
    const revenue=sale===null||refund===null||shipping===null?null:sale-refund+shipping;
    const contribution=!record.costCoverage||revenue===null||cogs===null||recovered===null||costs===null?null:revenue-cogs+recovered-costs;
    m("Net order revenue",money(revenue,c));m("Recorded variable costs",money(costs,c));m("Contribution",money(contribution,c),contribution!==null&&contribution<0);m("Contribution margin",contribution!==null&&revenue!==null&&revenue>0?`${(contribution/revenue*100).toFixed(1)}%`:"Not comparable");
    requiredCosts(); if([refund,shipping,cogs,recovered].some(x=>x===null))attention.push("Enter missing amounts, including confirmed zeros, before evaluating this order.");
    if(v.returnDisposition==="awaiting-inspection")attention.push("Inspect the return before recording stock recovery.");
    canComplete=canComplete&&contribution!==null&&v.returnDisposition!=="awaiting-inspection";
  }else if(kind==="outcome"){
    const before=number(v.baseline),after=number(v.followup),target=number(v.target),gb=number(v.guardrailBefore),ga=number(v.guardrailAfter);
    const days=(from:string,to:string)=>(Date.parse(to)-Date.parse(from))/86400000+1;
    const comparable=v.coverage==="confirmed"&&days(v.baselineFrom,v.baselineTo)===days(v.followupFrom,v.followupTo)&&v.followupTo<=today;
    m("Observed change",comparable&&before!==null&&after!==null?`${Number((after-before).toFixed(4))} ${v.unit}`:"Cannot assess yet");
    m("Versus expected result",comparable&&after!==null&&target!==null?`${Number((after-target).toFixed(4))} ${v.unit}`:"Not available");
    m("Trade-off change",comparable&&gb!==null&&ga!==null?String(Number((ga-gb).toFixed(4))):"Not assessed");m("Intervention cost",money(minor(v.actualCost,c),c));
    if(!comparable)attention.push("Use complete, comparable periods of equal length, ending no later than today.");
    if(gb===null||ga===null)attention.push("Record the trade-off before deciding whether to keep the change.");
    canComplete=comparable&&before!==null&&after!==null&&gb!==null&&ga!==null&&v.decision!=="review"&&Boolean(record.note);
  }else{
    const checks=g.checks,complete=checks.filter(x=>x.status!=="pending"),missing=checks.filter(x=>x.status==="complete"&&!x.evidence);
    m("Evidence checks",`${complete.length} of ${checks.length}`);m("Responsible",v.owner);m("Next action date",v.dueDate);m("Next action",v.nextAction);
    if(v.dueDate<today)attention.push("The next action date has passed.");
    if(missing.length)attention.push("Attach an evidence reference to each completed check.");
    canComplete=checks.length>0&&complete.length===checks.length&&!missing.length&&Boolean(v.outcome);
  }
  return {metrics,attention,canComplete,boundary:BUSINESS_WORKFLOW_DEFINITIONS[kind].boundary};
}
export function workflowTransition(state: WorkflowState, action: string, report: WorkflowReport, reason:string):WorkflowState{
  if(action==="save") {if(state!=="draft")throw Error("Reopen the record before changing reviewed evidence.");return "draft";}
  if(action==="review") {if(state!=="draft")throw Error("Only a draft can be reviewed.");return "reviewed";}
  if(action==="complete") {if(state!=="reviewed"||!report.canComplete)throw Error("Resolve the required evidence and review the record before completing it.");return "completed";}
  if(action==="reopen") {if(state==="draft"||reason.trim().length<5)throw Error("Add a reason before reopening reviewed work.");return "draft";}
  throw Error("Choose a supported workflow action.");
}
