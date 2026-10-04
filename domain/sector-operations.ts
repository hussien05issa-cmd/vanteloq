import type { IndustryConfiguration } from "./industry-templates";

export const SECTOR_KINDS = ["prep_plan", "prep_batch", "supplier_check", "service_period", "delivery_order", "furniture_order", "dealer_funding", "room", "reservation"] as const;
export type SectorKind = typeof SECTOR_KINDS[number];
export type SectorState = "draft" | "reviewed" | "active" | "completed" | "cancelled";
export type SectorAction = "save" | "amend" | "review" | "start" | "complete" | "reopen" | "cancel";
export type SectorField = { key: string; label: string; type: "text" | "date" | "money" | "quantity" | "integer" | "choice" | "boolean" | "recipe" | "stock" | "room" | "purchase"; options?: readonly string[]; optional?: boolean; help?: string };
export type SectorValue = string | number | boolean | null;
export type SectorStockLine = { sku: string; unit: "each" | "g" | "ml"; quantityMilli: number };
export type SectorBatch = { output: SectorStockLine; inputs: SectorStockLine[] };
export type SectorContent = { kind: SectorKind; title: string; source: string; sourceDate: string; dueDate: string; currency: string; notes: string; values: Record<string, SectorValue>; batch: SectorBatch | null };
export type SectorRecord = SectorContent & { id: string; locationId: string; version: number; state: SectorState; updatedAt: number };
export type SectorMetric = { label: string; value: number | null; unit: "money" | "quantity" | "integer" | "percent"; detail?: string };
export type SectorReport = { metrics: SectorMetric[]; missing: string[]; attention: string[]; canComplete: boolean; boundary: string };
const field = (key: string, label: string, type: SectorField["type"], extra: Partial<SectorField> = {}): SectorField => ({ key, label, type, ...extra });
export const SECTOR_DEFINITIONS: Record<SectorKind, { title: string; description: string; fields: readonly SectorField[] }> = {
  prep_plan: { title: "Prep plan", description: "Turn reviewed demand into a batch-sized preparation plan.", fields: [field("recipeId", "Saved recipe", "recipe"), field("station", "Prep station", "text"), field("demand", "Expected portions", "quantity"), field("buffer", "Additional portions buffer", "quantity"), field("usable", "Usable prepared portions", "quantity"), field("planned", "Portions already planned", "quantity"), field("batch", "Portions per batch", "quantity"), field("shelfLifeDays", "Reviewed shelf life, days", "integer", { help: "Use your documented handling and food-safety process. This tool does not determine safe shelf life." })] },
  prep_batch: { title: "Production batch", description: "Retain the recipe version, completed quantity and measured ingredient usage.", fields: [field("recipeId", "Saved recipe", "recipe"), field("batchRef", "Batch reference", "text"), field("portions", "Prepared portions", "quantity"), field("wastePortions", "Unusable portions", "quantity"), field("preparedDate", "Preparation date", "date"), field("useByDate", "Reviewed use-by date", "date"), field("ingredientSource", "Ingredient count / batch sheet reference", "text"), field("actualCost", "Reviewed total ingredient cost", "money")] },
  supplier_check: { title: "Supplier receipt check", description: "Compare an existing purchase order with received and invoiced evidence.", fields: [field("purchaseId", "Purchase order", "purchase"), field("item", "Item / pack description", "text"), field("ordered", "Ordered base units", "quantity"), field("received", "Received base units", "quantity"), field("invoiced", "Invoiced base units", "quantity"), field("invoiceAmount", "Invoice amount before tax", "money"), field("creditExpected", "Expected supplier credit", "money"), field("creditReceived", "Confirmed supplier credit", "money"), field("disposition", "Resolution", "choice", { options: ["needs_review", "matched", "credit_pending", "resolved"] })] },
  service_period: { title: "Service-period review", description: "Compare the staffing plan with actual demand and paid time.", fields: [field("serviceDate", "Business date", "date"), field("daypart", "Service period", "text"), field("projectedSales", "Expected net sales", "money"), field("netSales", "Recorded net sales, excluding tax", "money"), field("plannedMinutes", "Planned paid minutes, all staff", "integer"), field("paidMinutes", "Actual paid minutes, all staff", "integer"), field("labourCost", "Reviewed wage and employer cost", "money"), field("orders", "Completed orders", "integer"), field("lateOrders", "Orders after promised time", "integer"), field("coverageComplete", "Sales, time and cost coverage is complete", "boolean")] },
  delivery_order: { title: "Delivery reconciliation", description: "Separate order contribution from the payout deposited by a delivery provider.", fields: [field("provider", "Delivery provider", "text"), field("orderRef", "Provider order ID", "text"), field("settlementRef", "Settlement reference", "text"), field("netSales", "Net food sales after discounts and refunds", "money"), field("taxTips", "Taxes and tips remitted to you", "money"), field("fees", "Platform, promotion and other withheld fees", "money"), field("adjustments", "Other amounts withheld", "money"), field("payout", "Received bank payout allocated to this order", "money"), field("foodCost", "Supported food cost", "money"), field("packaging", "Packaging cost", "money"), field("incrementalLabour", "Additional labour cost, if attributable", "money"), field("resolved", "Any settlement difference has a documented resolution", "boolean")] },
  furniture_order: { title: "Special order & delivery", description: "Follow the customer balance and supplier delivery through completion.", fields: [field("orderRef", "Customer invoice / order reference", "text"), field("purchaseId", "Supplier purchase order", "purchase"), field("item", "Furniture / appliance specification", "text"), field("orderTotal", "Customer order total, including tax", "money"), field("deposit", "Received deposit", "money"), field("otherPayments", "Other received payments", "money"), field("supplierCost", "Supported supplier cost, before tax", "money"), field("deliveryDate", "Agreed delivery date", "date"), field("deliveryStatus", "Delivery status", "choice", { options: ["awaiting_supplier", "received", "scheduled", "delivered"] }), field("accepted", "Delivery acceptance recorded", "boolean"), field("creditTerms", "Outstanding balance is covered by approved credit terms", "boolean")] },
  dealer_funding: { title: "Deal funding & release", description: "Track funding, payoff, reviewed holding costs and release evidence against a vehicle stock record.", fields: [field("stockId", "Vehicle stock record", "stock"), field("dealRef", "Deal / lender reference", "text"), field("fundingExpected", "Lender funding expected", "money"), field("fundingReceived", "Lender funding received", "money"), field("payoffDue", "Trade / floorplan payoff due", "money"), field("payoffPaid", "Payoff confirmed", "money"), field("customerDue", "Customer contribution due", "money"), field("customerReceived", "Customer contribution received", "money"), field("documentsReady", "Required deal documents reviewed", "boolean"), field("releaseReady", "Authorised release confirmed", "boolean"), field("holdingDailyCost", "Reviewed daily holding cost", "money", { optional: true, help: "Use a supported daily amount for this vehicle, such as financing, insurance or storage. This rate-based estimate does not post or replace actual expenses." }), field("holdingFrom", "Holding period starts", "date", { optional: true, help: "Start date is included. Complete the daily amount and both dates together, or leave all three blank." }), field("holdingTo", "Holding period ends", "date", { optional: true, help: "End date is excluded. Use a date no later than the source as-of date." })] },
  room: { title: "Room readiness", description: "Keep cleaning, inspection and service blocks visible to the front desk.", fields: [field("roomRef", "Room number / PMS identifier", "text"), field("roomType", "Room type", "text"), field("condition", "Housekeeping condition", "choice", { options: ["dirty", "clean", "inspected"] }), field("occupied", "Currently occupied", "boolean"), field("blocked", "Out of service / blocked", "boolean"), field("assignee", "Responsible person or team", "text"), field("blockReason", "Block / follow-up reason", "text", { optional: true })] },
  reservation: { title: "Stay & departure balance", description: "Connect a booking to a room, readiness review and source folio balance.", fields: [field("roomId", "Room readiness record", "room"), field("reservationRef", "PMS reservation / folio ID", "text"), field("arrival", "Arrival date", "date"), field("departure", "Departure date", "date"), field("roomRevenue", "Room revenue for the stay, excluding tax", "money"), field("folioTotal", "Folio charges including tax", "money"), field("payments", "Payments and deposits applied", "money"), field("arTransferred", "Outstanding balance transferred to an AR ledger", "money"), field("arRef", "AR transfer reference, if applicable", "text", { optional: true })] },
};
export function sectorKindsFor(configuration: Pick<IndustryConfiguration, "templateId" | "capabilities">): SectorKind[] {
  const result: SectorKind[] = [];
  if (configuration.capabilities.includes("food_costing")) result.push("prep_plan", "prep_batch", "supplier_check", "service_period", "delivery_order");
  if (configuration.templateId === "furniture") result.push("furniture_order", "supplier_check");
  if (configuration.templateId === "dealership") result.push("dealer_funding");
  if (configuration.templateId === "hospitality") result.push("room", "reservation");
  return [...new Set(result)];
}
export class SectorInputError extends Error {}
function fail(message: string): never { throw new SectorInputError(message); }
export function sectorText(value: unknown, label: string, max = 160, optional = false): string { if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (!optional && !value.trim())) fail(`Enter a valid ${label}.`); return value.trim(); }
export function sectorDate(value: unknown, label: string, optional = false): string { if (optional && (value === "" || value == null)) return ""; if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value+"T00:00:00Z")) || new Date(value+"T00:00:00Z").toISOString().slice(0,10) !== value) fail(`Enter a valid ${label}.`); return value; }
export function sectorScaled(value: string, digits: number): number | null { if (value === "") return null; if (!Number.isInteger(digits)||digits<0||digits>3||!new RegExp(digits===0?"^(?:0|[1-9]\\d*)$":`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${digits}})?$`).test(value)) fail(`Use a nonnegative amount with at most ${digits} decimal places.`); const [whole, part=""] = value.split("."); const n=BigInt(whole+part.padEnd(digits,"0")); if (n>BigInt(Number.MAX_SAFE_INTEGER)) fail("The amount is too large."); return Number(n); }
export function sectorDecimal(value: number | null, digits: number): string { if(value===null)return ""; const n=BigInt(value), scale=BigInt(10)**BigInt(digits); return `${n/scale}${digits?"."+(n%scale).toString().padStart(digits,"0"):""}`; }
export function validateSectorContent(input: unknown): SectorContent {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Enter a valid operational record.");
  const row=input as Record<string,unknown>, kind=row.kind as SectorKind;
  if (!SECTOR_KINDS.includes(kind)) fail("Choose a supported workflow.");
  const currency=sectorText(row.currency,"currency",3); if(!/^[A-Z]{3}$/.test(currency))fail("Choose a valid currency.");
  const raw=row.values; if(!raw||typeof raw!=="object"||Array.isArray(raw))fail("Enter the workflow fields.");
  const values: Record<string,SectorValue>={};
  for(const f of SECTOR_DEFINITIONS[kind].fields){ const v=(raw as Record<string,unknown>)[f.key];
    if(v==null||v===""){values[f.key]=null;continue;}
    if(["money","quantity","integer"].includes(f.type)){if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0||v>1_000_000_000_000)fail(`${f.label} must be a supported nonnegative value.`);values[f.key]=v;}
    else if(f.type==="boolean"){if(typeof v!=="boolean")fail(`Review ${f.label}.`);values[f.key]=v;}
    else if(f.type==="date")values[f.key]=sectorDate(v,f.label);
    else if(f.type==="choice"){if(typeof v!=="string"||!f.options?.includes(v))fail(`Choose ${f.label}.`);values[f.key]=v;}
    else values[f.key]=sectorText(v,f.label,200);
  }
  let batch:SectorBatch|null=null;
  if(kind==="prep_batch"&&row.batch!=null){
    const rawBatch=row.batch as Record<string,unknown>;
    const line=(input:unknown):SectorStockLine=>{if(!input||typeof input!=="object"||Array.isArray(input))fail("Enter a valid batch stock line.");const b=input as Record<string,unknown>;if(!["each","g","ml"].includes(String(b.unit))||typeof b.quantityMilli!=="number"||!Number.isSafeInteger(b.quantityMilli)||b.quantityMilli<=0||b.quantityMilli>1_000_000_000_000)fail("Batch stock quantities must be positive and use each, g or ml.");return {sku:sectorText(b.sku,"SKU",100).toUpperCase(),unit:b.unit as SectorStockLine["unit"],quantityMilli:b.quantityMilli};};
    if(!Array.isArray(rawBatch.inputs)||rawBatch.inputs.length<1||rawBatch.inputs.length>40)fail("Include 1 to 40 batch ingredient stock lines.");
    batch={output:line(rawBatch.output),inputs:rawBatch.inputs.map(line)};
    const skus=[batch.output.sku,...batch.inputs.map(i=>i.sku)];if(new Set(skus).size!==skus.length)fail("Combine repeated ingredient SKUs; the output must use a separate prepared-stock SKU.");
  }
  const content={kind,title:sectorText(row.title,"title",120),source:sectorText(row.source,"source reference",240),sourceDate:sectorDate(row.sourceDate,"source date"),dueDate:sectorDate(row.dueDate,"due date",true),currency,notes:sectorText(row.notes??"","notes",1000,true),values,batch};
  const n=(key:string)=>values[key] as number|null;
  if(kind==="prep_plan"&&n("batch")===0)fail("Portions per batch must be greater than zero.");
  if(kind==="prep_plan"&&n("shelfLifeDays")===0)fail("Enter a documented positive shelf life.");
  if(kind==="prep_batch"&&n("portions")===0)fail("Prepared portions must be greater than zero.");
  if(kind==="prep_batch"&&n("portions")!==null&&n("wastePortions")!==null&&n("wastePortions")!>n("portions")!)fail("Unusable portions cannot exceed produced portions.");
  if(kind==="prep_batch"&&values.preparedDate&&values.useByDate&&values.useByDate<values.preparedDate)fail("Use-by date must follow preparation.");
  if(kind==="service_period"&&n("orders")!==null&&n("lateOrders")!==null&&n("lateOrders")!>n("orders")!)fail("Late orders cannot exceed completed orders.");
  if(kind==="reservation"&&values.arrival&&values.departure&&values.departure<=values.arrival)fail("Departure must be after arrival.");
  if(kind==="reservation"&&Number(values.arTransferred??0)>0&&!values.arRef)fail("Include the AR transfer reference.");
  if(kind==="room"&&values.blocked===true&&!values.blockReason)fail("Explain the room service block.");
  if(kind==="dealer_funding"&&values.holdingFrom&&values.holdingTo&&values.holdingTo<values.holdingFrom)fail("The holding period end cannot precede its start.");
  if(kind==="dealer_funding"&&values.holdingTo&&values.holdingTo>content.sourceDate)fail("The holding period cannot extend beyond the source as-of date.");
  return content;
}
function exact(n:bigint):number{if(n>BigInt(Number.MAX_SAFE_INTEGER)||n< -BigInt(Number.MAX_SAFE_INTEGER))fail("Calculated amount exceeds the supported range.");return Number(n);}
export function sectorReport(record: SectorContent): SectorReport {
  const v=record.values, metrics:SectorMetric[]=[], attention:string[]=[];
  const missing=SECTOR_DEFINITIONS[record.kind].fields.filter(f=>!f.optional&&v[f.key]===null).map(f=>f.label);
  if(record.kind==="dealer_funding"&&["holdingDailyCost","holdingFrom","holdingTo"].some(key=>v[key]!=null))for(const field of SECTOR_DEFINITIONS.dealer_funding.fields.filter(field=>field.key.startsWith("holding")))if(v[field.key]==null)missing.push(field.label);
  if(record.kind==="prep_batch"&&!record.batch)missing.push("Ingredient and output stock lines");
  const calc=(keys:string[],fn:(x:bigint[])=>bigint)=>keys.some(k=>typeof v[k]!=="number")?null:exact(fn(keys.map(k=>BigInt(v[k] as number))));
  const difference=(positive:string[],negative:string[])=>calc([...positive,...negative],xs=>xs.reduce((sum,n,i)=>sum+(i<positive.length?n:-n),BigInt(0)));
  const metric=(label:string,value:number|null,unit:SectorMetric["unit"],detail?:string)=>metrics.push({label,value,unit,detail});
  const ratio=(a:string,b:string,multiplier:number)=>calc([a,b],([n,d])=>d===BigInt(0)?BigInt(0):(n*BigInt(multiplier)+d/BigInt(2))/d);
  let canComplete=missing.length===0;
  let boundary="Reviewed operational evidence. No payment is collected, external system changed or BookLoQ journal posted.";
  if(record.kind==="prep_plan"){
    const need=difference(["demand","buffer"],["usable","planned"]); const batch=typeof v.batch==="number"?v.batch:null;
    const suggested=need===null||!batch?null:exact(((BigInt(Math.max(0,need))+BigInt(batch)-BigInt(1))/BigInt(batch))*BigInt(batch));
    metric("Suggested portions",suggested,"quantity");metric("Usable portions on hand",v.usable as number|null,"quantity");
    if(suggested&&suggested>0)attention.push("Review ingredient availability and capacity before approving this prep quantity.");
    boundary="Owner-entered demand and buffer, rounded up to complete batches. Validate demand, usable stock and safe shelf life; this is not an automatic forecast or stock movement.";
  }else if(record.kind==="prep_batch"){
    metric("Usable output portions",difference(["portions"],["wastePortions"]),"quantity");metric("Reviewed ingredient cost",v.actualCost as number|null,"money");
    boundary="Approval consumes and produces explicitly opened Vanteloq-managed stock positions. It does not change imported POS balances, certify food safety or post financial journals. Reopening reverses those stock movements.";
  }else if(record.kind==="supplier_check"){
    const short=difference(["ordered"],["received"]),over=difference(["invoiced"],["received"]),credit=difference(["creditExpected"],["creditReceived"]);
    metric("Ordered less received",short,"quantity");metric("Invoiced less received",over,"quantity");metric("Supplier credit outstanding",credit,"money");
    if(short!==null&&short!==0)attention.push("Received quantity differs from the order.");if(over!==null&&over!==0)attention.push("Invoice and received quantities differ.");if(credit!==null&&credit>0)attention.push("Follow up the outstanding supplier credit.");
    canComplete=canComplete&&(v.disposition==="matched"&&short===0&&over===0||v.disposition==="resolved"&&record.notes.length>0)&&credit===0;
  }else if(record.kind==="service_period"){
    const covered=v.coverageComplete===true;
    metric("Sales versus plan",covered?difference(["netSales"],["projectedSales"]):null,"money");metric("Paid minutes versus plan",difference(["paidMinutes"],["plannedMinutes"]),"integer");
    metric("Sales per paid hour",covered&&Number(v.paidMinutes)>0?ratio("netSales","paidMinutes",60):null,"money");
    metric("Labour cost / net sales",covered&&Number(v.netSales)>0?ratio("labourCost","netSales",10000):null,"percent");
    metric("Late order rate",covered&&Number(v.orders)>0?ratio("lateOrders","orders",10000):null,"percent");
    if(!covered)attention.push("Complete the sales, time and cost coverage before interpreting ratios.");canComplete=canComplete&&covered;
  }else if(record.kind==="delivery_order"){
    const expected=difference(["netSales","taxTips"],["fees","adjustments"]),gap=difference(["netSales","taxTips"],["fees","adjustments","payout"]);
    metric("Expected settlement",expected,"money");metric("Unreconciled settlement",gap,"money");metric("Order contribution",difference(["netSales"],["fees","adjustments","foodCost","packaging","incrementalLabour"]),"money");
    if(gap!==null&&gap!==0)attention.push("Reconcile the settlement difference against the provider and bank records.");canComplete=canComplete&&(gap===0||v.resolved===true&&record.notes.length>0);
    boundary="Contribution excludes rent, fixed overhead and tax. Net sales already exclude discounts/refunds; do not deduct them twice. Allocate each payout once. Tax and tips are not food revenue.";
  }else if(record.kind==="furniture_order"){
    const balance=difference(["orderTotal"],["deposit","otherPayments"]);metric("Customer balance",balance,"money");metric("Supplier cost",v.supplierCost as number|null,"money");
    if(balance!==null&&balance>0)attention.push("Collect the customer balance or confirm approved credit terms.");if(v.deliveryStatus!=="delivered")attention.push("Confirm supplier receipt and delivery progress.");
    canComplete=canComplete&&v.deliveryStatus==="delivered"&&v.accepted===true&&(balance===0||balance!==null&&balance>0&&v.creditTerms===true);
  }else if(record.kind==="dealer_funding"){
    const lender=difference(["fundingExpected"],["fundingReceived"]),payoff=difference(["payoffDue"],["payoffPaid"]),customer=difference(["customerDue"],["customerReceived"]);
    metric("Lender funding outstanding",lender,"money");metric("Payoff outstanding",payoff,"money");metric("Customer contribution outstanding",customer,"money");
    if([lender,payoff,customer].some(n=>n!==null&&n!==0))attention.push("Resolve funding and payoff differences before release.");if(v.documentsReady!==true||v.releaseReady!==true)attention.push("Complete the document and release checklist.");
    canComplete=canComplete&&lender===0&&payoff===0&&customer===0&&v.documentsReady===true&&v.releaseReady===true;
    const holdingDays=v.holdingFrom&&v.holdingTo?(Date.parse(String(v.holdingTo)+"T00:00:00Z")-Date.parse(String(v.holdingFrom)+"T00:00:00Z"))/86400000:null;
    const holdingCost=holdingDays!==null&&typeof v.holdingDailyCost==="number"?exact(BigInt(holdingDays)*BigInt(v.holdingDailyCost)):null;
    metric("Holding days",holdingDays,"integer","Calendar days; start included, end excluded.");metric("Reviewed daily holding cost",typeof v.holdingDailyCost==="number"?v.holdingDailyCost:null,"money");metric("Holding-cost estimate",holdingCost,"money","Reviewed daily amount × calendar days. Separate from posted actual expenses.");
    if(holdingCost===null)attention.push("Holding cost is not established. Add a supported daily amount and complete period to estimate it.");
    boundary="Funding and payoff evidence plus an optional constant-rate holding-cost estimate. Verify rate coverage and avoid double-counting costs already included in the deal. No payment, external update or financial journal is created.";
  }else if(record.kind==="room"){
    canComplete=canComplete&&v.condition==="inspected"&&v.blocked===false&&!v.occupied;
    if(v.blocked)attention.push("Room is blocked for service.");if(v.condition!=="inspected")attention.push("Inspection is required before arrival.");if(v.occupied)attention.push("Room is occupied.");
  }else if(record.kind==="reservation"){
    const nights=v.arrival&&v.departure?Math.round((Date.parse(String(v.departure)+"T00:00:00Z")-Date.parse(String(v.arrival)+"T00:00:00Z"))/86400000):null;
    const balance=difference(["folioTotal"],["payments","arTransferred"]);metric("Room nights",nights,"integer");metric("Departure balance",balance,"money");
    metric("Average room rate",nights&&typeof v.roomRevenue==="number"?exact((BigInt(v.roomRevenue)+BigInt(nights)/BigInt(2))/BigInt(nights)):null,"money");
    if(balance!==null&&balance!==0)attention.push("Resolve the folio balance before closing this stay.");canComplete=canComplete&&balance===0;
    boundary="A manual stay and folio review, not a live PMS feed. Applied deposits and AR transfers are balance movements, not additional revenue. Room rate uses this stay's room revenue and nights only.";
  }
  if(missing.length)attention.unshift("Complete the missing source fields before approval.");
  return {metrics,missing,attention,canComplete,boundary};
}
export function sectorNextState(record:SectorRecord, action:Exclude<SectorAction,"save">):SectorState{
  const report=sectorReport(record);
  if(action==="reopen"&&["reviewed","active","completed","cancelled"].includes(record.state))return "draft";
  if(action==="cancel"&&["draft","reviewed"].includes(record.state))return "cancelled";
  if(action==="review"&&record.state==="draft"){if(report.missing.length)fail("Complete the required evidence before review.");return "reviewed";}
  if(action==="start"&&record.kind==="reservation"&&record.state==="reviewed")return "active";
  if(action==="amend"&&record.kind==="reservation"&&record.state==="active"){if(report.missing.length)fail("Complete the required stay evidence before saving a reviewed update.");return "active";}
  if(action==="complete"&&(record.state==="reviewed"||record.state==="active")){if(record.kind==="reservation"&&record.state!=="active")fail("Check in the stay before completing departure.");if(!report.canComplete)fail("Resolve the outstanding checklist or balance before completion.");return "completed";}
  fail("This action is not available in the current state. Reload the record.");
}
