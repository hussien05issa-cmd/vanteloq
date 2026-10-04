export type ManagedUnit = "each" | "g" | "ml";
export type InventoryRecordKind = "supplier" | "lot_case" | "returns" | "invoice_review";
export class InventoryWorkflowError extends Error {}
export function inventoryText(value: unknown, label: string, max = 180, optional = false): string {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new InventoryWorkflowError(`Enter a valid ${label}.`);
  return value.trim().normalize("NFC");
}
export function inventoryInteger(value: unknown, label: string, min = 0, max = 1_000_000_000): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new InventoryWorkflowError(`Enter a valid ${label} between ${min} and ${max}.`);
  return Number(value);
}
export function inventoryDate(value: unknown, label = "date"): string {
  const date = inventoryText(value,label,10), parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) throw new InventoryWorkflowError(`Enter a valid ${label}.`);
  return date;
}
export function managedUnit(value: unknown): ManagedUnit {
  if (value !== "each" && value !== "g" && value !== "ml") throw new InventoryWorkflowError("Choose each, grams or millilitres as the base unit.");
  return value;
}
export function inventorySku(value: unknown) { return inventoryText(value,"SKU",96).toUpperCase(); }
const optionalInt = (v: unknown, label: string) => v === null || v === undefined || v === "" ? null : inventoryInteger(v,label);
const checked = (v: bigint) => { const number=Number(v); if (!Number.isSafeInteger(number)) throw new InventoryWorkflowError("The calculation exceeds supported precision."); return number; };
const ceilDivide = (a: bigint,b: bigint) => checked((a+b-BigInt(1))/b);
export function parseQuantityMilli(value: string) {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value.trim())) throw new InventoryWorkflowError("Enter a nonnegative quantity with at most three decimal places.");
  const [whole, decimals=""] = value.trim().split(".");
  return inventoryInteger(checked(BigInt(whole)*BigInt(1000)+BigInt(decimals.padEnd(3,"0"))),"quantity",0,1_000_000_000_000);
}
export function parseMinorAmount(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw new InventoryWorkflowError("Enter a nonnegative amount with at most two decimal places.");
  const [whole, decimals=""] = value.trim().split(".");
  return inventoryInteger(checked(BigInt(whole)*BigInt(100)+BigInt(decimals.padEnd(2,"0"))),"amount");
}
export type SupplierPolicy = { sku:string; supplier:string; source:string; asOf:string; soldUnits:number; sellingDays:number; leadDays:number; reviewDays:number; safetyUnits:number; packSize:number; minimumOrder:number; onHand:number; inbound:number; committed:number; unitCostCents:number; cashBudgetCents:number|null; storageLimit:number|null; shelfDays:number|null };
export type LotCase = { lotId:string; issue:"quality"|"expiry"|"recall"|"damage"; units:number; status:"open"|"quarantined"|"resolved"; source:string; asOf:string; nextAction:string; resolution:string; evidenceUrl:string; creditCents:number|null };
export type VariantReturns = { style:string; variant:string; size:string; colour:string; source:string; asOf:string; from:string; to:string; returnWindowDays:number; soldUnits:number; returnedUnits:number; fitReturns:number; defectReturns:number; otherReturns:number; restockableUnits:number; refundCents:number|null };
export type ReceiptLine = { lineId:string; sku:string; accepted:number; rejected:number; unitCostCents:number };
export type InvoiceReviewLine = { lineId:string; ordered:number; accepted:number; billed:number; agreedUnitCostCents:number; billedUnitCostCents:number };
export type InvoiceReview = { purchaseOrderId:string; invoiceReference:string; source:string; asOf:string; lines:InvoiceReviewLine[] };
export type InventoryContent = SupplierPolicy|LotCase|VariantReturns|InvoiceReview;
export function validateInventoryContent(kind: InventoryRecordKind, value: unknown): InventoryContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryWorkflowError("Review the record fields.");
  const p=value as Record<string,unknown>, source=inventoryText(p.source,"source or supporting document reference",300), asOf=inventoryDate(p.asOf,"evidence date");
  if (kind === "supplier") return { sku:inventorySku(p.sku),supplier:inventoryText(p.supplier,"supplier"),source,asOf,
    ...Object.fromEntries(["soldUnits","leadDays","reviewDays","safetyUnits","minimumOrder","onHand","inbound","committed","unitCostCents"].map(key => [key, inventoryInteger(p[key], key)])),
    sellingDays:inventoryInteger(p.sellingDays,"in-stock selling days",1,366), packSize:inventoryInteger(p.packSize,"case pack",1,1_000_000), cashBudgetCents:optionalInt(p.cashBudgetCents,"cash budget"),storageLimit:optionalInt(p.storageLimit,"storage capacity"),shelfDays:optionalInt(p.shelfDays,"usable shelf life") } as SupplierPolicy;
  if (kind === "lot_case") {
    if (!["quality","expiry","recall","damage"].includes(String(p.issue)) || !["open","quarantined","resolved"].includes(String(p.status))) throw new InventoryWorkflowError("Choose a supported lot issue and status.");
    const evidenceUrl=inventoryText(p.evidenceUrl,"evidence link",700,true);
    if (evidenceUrl) { let url:URL; try { url=new URL(evidenceUrl); } catch { throw new InventoryWorkflowError("Use a complete HTTPS evidence link."); } if(url.protocol!=="https:" || url.username || url.password) throw new InventoryWorkflowError("Use a public HTTPS evidence link without credentials."); }
    return { lotId:inventoryText(p.lotId,"lot",180), issue:p.issue as LotCase["issue"],units:inventoryInteger(p.units,"affected units",1),status:p.status as LotCase["status"],source,asOf,nextAction:inventoryText(p.nextAction,"next action",600),resolution:inventoryText(p.resolution,"resolution evidence",600,p.status!=="resolved"),evidenceUrl,creditCents:optionalInt(p.creditCents,"recorded supplier credit") };
  }
  if(kind === "returns") {
    const from=inventoryDate(p.from,"sale-cohort start"),to=inventoryDate(p.to,"sale-cohort end");
    if(from>to || to>asOf) throw new InventoryWorkflowError("The sale cohort must end on or before the evidence date.");
    const numbers=Object.fromEntries(["soldUnits","returnedUnits","fitReturns","defectReturns","otherReturns","restockableUnits"].map(key => [key,inventoryInteger(p[key],key)])) as Pick<VariantReturns,"soldUnits"|"returnedUnits"|"fitReturns"|"defectReturns"|"otherReturns"|"restockableUnits">;
    if(numbers.returnedUnits>numbers.soldUnits || numbers.restockableUnits>numbers.returnedUnits || numbers.fitReturns+numbers.defectReturns+numbers.otherReturns>numbers.returnedUnits) throw new InventoryWorkflowError("Returns must belong to the selected sale cohort; reasons and restockable units cannot exceed its returned units.");
    return { ...numbers,from,to,asOf,source,style:inventoryText(p.style,"style"),variant:inventoryText(p.variant,"variant / SKU"),size:inventoryText(p.size,"size",60,true),colour:inventoryText(p.colour,"colour",60,true),returnWindowDays:inventoryInteger(p.returnWindowDays,"return window",0,365),refundCents:optionalInt(p.refundCents,"refund amount") };
  }
  if(kind === "invoice_review") {
    if(!Array.isArray(p.lines) || !p.lines.length || p.lines.length>100) throw new InventoryWorkflowError("Add between 1 and 100 invoice lines.");
    const seen=new Set<string>();
    const lines=p.lines.map(value=> { const line=value as Record<string,unknown>; if(!line || typeof line!=="object") throw new InventoryWorkflowError("Review the invoice lines."); const lineId=inventoryText(line.lineId,"purchase order line",180); if(seen.has(lineId)) throw new InventoryWorkflowError("An order line can occur only once in an invoice review."); seen.add(lineId); return {lineId,...Object.fromEntries(["ordered","accepted","billed","agreedUnitCostCents","billedUnitCostCents"].map(key=>[key,inventoryInteger(line[key],key)]))} as InvoiceReviewLine; });
    return {purchaseOrderId:inventoryText(p.purchaseOrderId,"purchase order",180),invoiceReference:inventoryText(p.invoiceReference,"invoice reference"),source,asOf,lines};
  }
  throw new InventoryWorkflowError("Choose a supported inventory record.");
}
export function supplierProposal(p: SupplierPolicy) {
  const horizon=p.leadDays+p.reviewDays;
  const expected=ceilDivide(BigInt(p.soldUnits)*BigInt(horizon),BigInt(p.sellingDays));
  const inventoryPosition=p.onHand+p.inbound-p.committed;
  const need=Math.max(0,expected+p.safetyUnits-inventoryPosition);
  const raw=need ? Math.max(need,p.minimumOrder) : 0;
  const rounded=ceilDivide(BigInt(raw),BigInt(p.packSize))*p.packSize;
  const limits:[string,number][]=[];
  if(p.storageLimit!==null) limits.push(["Storage capacity",Math.max(0,p.storageLimit-p.onHand-p.inbound)]);
  if(p.cashBudgetCents!==null && p.unitCostCents>0) limits.push(["Reviewed cash budget",Math.floor(p.cashBudgetCents/p.unitCostCents)]);
  if(p.shelfDays!==null) limits.push(["Usable shelf life",Math.max(0,checked(BigInt(p.soldUnits)*BigInt(p.shelfDays)/BigInt(p.sellingDays))-p.onHand-p.inbound)]);
  const capacity=Math.min(rounded,...limits.map(([,n])=>n));
  const feasible=Math.floor(capacity/p.packSize)*p.packSize;
  const quantity=feasible>=p.minimumOrder || !need ? feasible : 0;
  return {inventoryPosition,targetUnits:expected+p.safetyUnits,unconstrainedUnits:rounded,proposedUnits:quantity,costCents:checked(BigInt(quantity)*BigInt(p.unitCostCents)),status:need && quantity===0?"blocked":quantity<rounded?"constrained":"review",constraints:limits.filter(([,n])=>n<rounded).map(([label])=>label), missingLimits:[p.cashBudgetCents===null?"Cash budget":null,p.storageLimit===null?"Storage capacity":null,p.shelfDays===null?"Shelf life":null].filter(Boolean),basis:"Reviewed units sold per in-stock selling day, multiplied by lead time plus review interval. Proposals exclude tax/freight and do not place orders or assume lost sales."};
}
export function variantReturnReport(p:VariantReturns) {
  const elapsed=Math.floor((Date.parse(`${p.asOf}T00:00:00Z`)-Date.parse(`${p.to}T00:00:00Z`))/86400000),mature=elapsed>=p.returnWindowDays;
  return {cohortMature:mature,daysUntilMature:Math.max(0,p.returnWindowDays-elapsed),returnRate:p.soldUnits?p.returnedUnits/p.soldUnits:null,reasonCoverage:p.returnedUnits?(p.fitReturns+p.defectReturns+p.otherReturns)/p.returnedUnits:null,unclassified:p.returnedUnits-p.fitReturns-p.defectReturns-p.otherReturns,unrestockableUnits:p.returnedUnits-p.restockableUnits,attention:p.defectReturns>0?"Review defect evidence and supplier recovery.":p.fitReturns>0?"Review size guidance against the original sale and return records.":"Review this cohort when its return window is complete.",basis:"Observed returns matched to this sale cohort. Refunded amounts are not profit losses; missing resale, cost and handling evidence is excluded."};
}
export function invoiceExceptions(p:InvoiceReview) {
  return p.lines.map(line=>({...line,quantityDifference:line.billed-line.accepted,priceDifferenceCents:checked((BigInt(line.billedUnitCostCents)-BigInt(line.agreedUnitCostCents))*BigInt(line.billed)),status:line.billed>line.accepted?"quantity_exception":line.billedUnitCostCents!==line.agreedUnitCostCents?"price_exception":"matched"}));
}
export function inventoryRecordKey(kind:InventoryRecordKind,p:InventoryContent) {
  if(kind==="supplier") { const s=p as SupplierPolicy; return JSON.stringify([s.supplier.toLowerCase(),s.sku]); }
  if(kind==="lot_case") { const c=p as LotCase; return JSON.stringify([c.lotId,c.issue,c.asOf]); }
  if(kind==="returns") { const r=p as VariantReturns; return JSON.stringify([r.style,r.variant,r.from,r.to]); }
  const i=p as InvoiceReview; return JSON.stringify([i.purchaseOrderId,i.invoiceReference]);
}
