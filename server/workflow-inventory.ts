import { getD1 } from "../db";
import { ApiError, hashIdentifier } from "./api";
import { requireAccess } from "./authorization";
import { effectivePermissions, requirePermission } from "./permissions";
import { accessibleLocations } from "./location-access";
import { getWorkspaceIndustry } from "./industry-configuration";
import { getTenantEntitlements } from "./entitlements/engine";
import { businessClock } from "../domain/intraday-sales";
import { InventoryWorkflowError, inventoryText, inventoryInteger, inventoryDate, inventorySku, managedUnit, validateInventoryContent, inventoryRecordKey, supplierProposal, variantReturnReport, invoiceExceptions, type InventoryRecordKind, type SupplierPolicy, type VariantReturns, type InvoiceReview, type LotCase, type ManagedUnit, type ReceiptLine } from "../domain/workflow-inventory";

export type InventoryWorkflowActor = { organizationId:string; userId:string; locationIds:string[]; permissions:readonly string[]; features?:readonly string[]; capabilities?:readonly string[] };
export async function inventoryWorkflowAccess(request:Request) {
  const context=await requireAccess(request,["owner","admin","manager","employee","read_only"],"inventory.lots");
  await requirePermission(context,"inventory.view"); await requirePermission(context,"inventory.value");
  const [permissions,locations,industry,entitlements]=await Promise.all([effectivePermissions(context),accessibleLocations(context),getWorkspaceIndustry(context),getTenantEntitlements(context)]);
  if(!industry.configuration.capabilities.includes("products")) throw new ApiError(403,"INVENTORY_WORKFLOW_ACTIVITY","Enable Product inventory in your business tools before using inventory workflows.");
  return {context,locations,actor:{organizationId:context.organizationId,userId:context.userId,locationIds:locations.map(l=>l.id),permissions,features:entitlements.features,capabilities:industry.configuration.capabilities} satisfies InventoryWorkflowActor};
}
function allow(actor:InventoryWorkflowActor,...permissions:string[]) { if(!permissions.every(p=>actor.permissions.includes(p))) throw new ApiError(403,"INVENTORY_WORKFLOW_PERMISSION","Your permissions do not allow this inventory action."); }
const sql=(database:D1Database,query:string,values:unknown[]=[])=>database.prepare(query).bind(...values);
async function rows<T>(database:D1Database,query:string,values:unknown[]=[]) { return (await sql(database,query,values).all<T>()).results??[]; }
async function location(database:D1Database,actor:InventoryWorkflowActor,id:string) {
  if(!actor.locationIds.includes(id)) throw new ApiError(403,"LOCATION_ACCESS_DENIED","Choose a location available to your account.");
  const row=await sql(database,"SELECT id,name,currency,timezone FROM organization_locations WHERE organization_id=? AND id=? AND status='active'",[actor.organizationId,id]).first<{id:string;name:string;currency:string;timezone:string}>();
  if(!row) throw new ApiError(404,"LOCATION_UNAVAILABLE","This location is unavailable.");
  return row;
}
function dayLimit(date:string,timezone:string) { const today=businessClock(new Date(),timezone)?.date; if(!today || date>today) throw new InventoryWorkflowError("Recorded activity cannot be dated in the future for this location."); }
function guard(database:D1Database,org:string,condition:string,values:unknown[]):D1PreparedStatement[] {
  const id=crypto.randomUUID();
  return [sql(database,`INSERT INTO workflow_inventory_guards(id,organization_id,permitted) SELECT ?,?,CASE WHEN ${condition} THEN 1 ELSE 0 END`,[id,org,...values]),sql(database,"DELETE FROM workflow_inventory_guards WHERE id=? AND organization_id=?",[id,org])];
}
export type ManagedInventoryChange = {sku:string;unit:ManagedUnit;quantityMilli:number;reason:string;sourceReference:string;occurredDate:string};
/** Add these statements to the caller's SAME atomic batch as its business writes. Never execute a subset. */
export async function prepareManagedInventoryChanges(database:D1Database,actor:InventoryWorkflowActor,locationId:string,changes:ManagedInventoryChange[]):Promise<D1PreparedStatement[]> {
  allow(actor,"inventory.adjust"); const site=await location(database,actor,locationId),org=actor.organizationId;
  if(!changes.length || changes.length>100) throw new InventoryWorkflowError("An inventory operation must contain between 1 and 100 stock movements.");
  const groups=new Map<string,ManagedInventoryChange[]>();
  for(const raw of changes) {
    const entry={sku:inventorySku(raw.sku),unit:managedUnit(raw.unit),quantityMilli:inventoryInteger(raw.quantityMilli,"stock movement",-1_000_000_000_000,1_000_000_000_000),reason:inventoryText(raw.reason,"movement reason",300),sourceReference:inventoryText(raw.sourceReference,"source reference",300),occurredDate:inventoryDate(raw.occurredDate)};
    dayLimit(entry.occurredDate,site.timezone); if(!entry.quantityMilli) throw new InventoryWorkflowError("A stock movement must change the quantity.");
    const group=groups.get(entry.sku)??[]; if(group.some(c=>c.sourceReference===entry.sourceReference)) throw new InventoryWorkflowError("Combine repeated movements for the same SKU and source before posting."); group.push(entry);groups.set(entry.sku,group);
  }
  const statements:D1PreparedStatement[]=[];
  for(const [sku,entries] of groups) {
    const position=await sql(database,"SELECT p.id,p.unit,p.currency,p.quantity_milli AS quantityMilli,p.version,(SELECT max(occurred_date) FROM workflow_inventory_movements m WHERE m.organization_id=p.organization_id AND m.position_id=p.id) AS latestDate FROM workflow_inventory_positions p WHERE p.organization_id=? AND p.location_id=? AND p.sku=?",[org,locationId,sku]).first<{id:string;unit:ManagedUnit;currency:string;quantityMilli:number;version:number;latestDate:string|null}>();
    if(!position) throw new InventoryWorkflowError(`Record a reviewed opening count for ${sku} before posting movements. Imported POS balances are not managed stock.`);
    if(position.currency!==site.currency) throw new InventoryWorkflowError(`The location currency changed after ${sku} was recorded. Reconcile its currency before posting stock movements.`);
    if(entries.some(e=>e.unit!==position.unit)) throw new InventoryWorkflowError(`Convert ${sku} to its recorded base unit (${position.unit}) before posting.`);
    if(position.latestDate && entries.some(e=>e.occurredDate<position.latestDate!)) throw new InventoryWorkflowError(`Date the ${sku} adjustment on or after its latest recorded movement (${position.latestDate}). Historical activity needs a current reviewed correction.`);
    const total=entries.reduce((sum,e)=>sum+e.quantityMilli,0),next=inventoryInteger(position.quantityMilli+total,"resulting stock",0,1_000_000_000_000);
    statements.push(...guard(database,org,"EXISTS(SELECT 1 FROM workflow_inventory_positions WHERE organization_id=? AND id=? AND version=?)",[org,position.id,position.version]));
    statements.push(sql(database,"UPDATE workflow_inventory_positions SET quantity_milli=?,version=version+1,updated_at=? WHERE organization_id=? AND id=?",[next,Date.now(),org,position.id]));
    for(const entry of entries) statements.push(sql(database,"INSERT INTO workflow_inventory_movements(id,organization_id,position_id,quantity_delta,reason,source_reference,occurred_date,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",[crypto.randomUUID(),org,position.id,entry.quantityMilli,entry.reason,entry.sourceReference,entry.occurredDate,actor.userId,Date.now()]));
  }
  return statements;
}
const recordColumns="id,location_id AS locationId,kind,currency,payload_json AS payloadJson,version,updated_at AS updatedAt";
type RecordRow={id:string;locationId:string;kind:InventoryRecordKind;currency:string;payloadJson:string;version:number;updatedAt:number};
const report=(row:RecordRow)=> { const payload=validateInventoryContent(row.kind,JSON.parse(row.payloadJson)); return {...row,payloadJson:undefined,payload,report:row.kind==="supplier"?supplierProposal(payload as SupplierPolicy):row.kind==="returns"?variantReturnReport(payload as VariantReturns):row.kind==="invoice_review"?invoiceExceptions(payload as InvoiceReview):null}; };
function kindAllowed(actor:InventoryWorkflowActor,kind:InventoryRecordKind,write=false) {
  if(kind==="supplier" && !actor.features?.includes("inventory.reorder_ai")) return false;
  if(kind==="returns" && (!actor.capabilities?.includes("variants") || !actor.permissions.includes("sales.transactions"))) return false;
  if(kind==="lot_case" && !actor.capabilities?.includes("lots")) return false;
  if(kind==="invoice_review" && (!actor.permissions.includes("purchasing.view") || !actor.features?.includes("invoice.matching"))) return false;
  return !write || actor.permissions.includes(kind==="invoice_review"?"purchasing.match":"inventory.adjust");
}
export async function readInventoryWorkflows(actor:InventoryWorkflowActor,locationId:string,database=getD1()) {
  const site=await location(database,actor,locationId),org=actor.organizationId,scoped=[org,locationId];
  const canPurchase=actor.permissions.includes("purchasing.view"),allowedKinds=(["supplier","lot_case","returns","invoice_review"] as const).filter(kind=>kindAllowed(actor,kind));
  const [positions,records,receipts,orders,lots,movements]=await Promise.all([
    rows(database,"SELECT id,sku,product_name AS productName,unit,currency,quantity_milli AS quantityMilli,version,updated_at AS updatedAt FROM workflow_inventory_positions WHERE organization_id=? AND location_id=? ORDER BY sku LIMIT 501",scoped),
    rows<RecordRow>(database,`SELECT ${recordColumns} FROM workflow_inventory_records WHERE organization_id=? AND location_id=? AND kind IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC LIMIT 501`,[...scoped,JSON.stringify(allowedKinds)]),
    canPurchase?rows<{id:string;purchaseOrderId:string;source:string;occurredDate:string;linesJson:string;reversedAt:number|null;reversalReason:string|null}>(database,"SELECT id,purchase_order_id AS purchaseOrderId,source,occurred_date AS occurredDate,lines_json AS linesJson,reversed_at AS reversedAt,reversal_reason AS reversalReason FROM workflow_inventory_receipts WHERE organization_id=? AND location_id=? ORDER BY created_at DESC LIMIT 101",scoped):[],
    canPurchase?rows(database,"SELECT p.id,p.order_number AS orderNumber,p.currency,p.supplier_name AS supplierName,p.status,l.id AS lineId,l.sku,l.description,l.quantity,l.received_quantity AS receivedQuantity,l.unit_cost_cents AS unitCostCents FROM purchase_orders p JOIN purchase_order_lines l ON l.purchase_order_id=p.id AND l.organization_id=p.organization_id WHERE p.organization_id=? AND p.delivery_location_id=? AND p.status NOT IN ('cancelled','closed') ORDER BY p.order_date DESC,p.id,l.line_number LIMIT 501",scoped):[],
    actor.capabilities?.includes("lots")?rows(database,"SELECT id,sku,product_name AS productName,lot_number AS lotNumber,quantity_remaining AS quantityRemaining,status,version FROM inventory_lots WHERE organization_id=? AND location_ref=? ORDER BY product_name LIMIT 501",scoped):[],
    rows(database,"SELECT m.id,p.sku,p.unit,m.quantity_delta AS quantityDelta,m.reason,m.source_reference AS sourceReference,m.occurred_date AS occurredDate FROM workflow_inventory_movements m JOIN workflow_inventory_positions p ON p.id=m.position_id AND p.organization_id=m.organization_id WHERE m.organization_id=? AND p.location_id=? ORDER BY m.created_at DESC LIMIT 101",scoped),
  ]);
  return {location:site,positions:positions.slice(0,500),records:records.slice(0,500).map(report),receipts:receipts.slice(0,100).map(r=>({...r,linesJson:undefined,lines:JSON.parse(r.linesJson)})),orders:orders.slice(0,500),lots:lots.slice(0,500),movements:movements.slice(0,100),truncated:positions.length>500||records.length>500||receipts.length>100||orders.length>500||lots.length>500||movements.length>100,
    permissions:{stockWrite:actor.permissions.includes("inventory.adjust"),receive:canPurchase&&actor.permissions.includes("purchasing.receive")&&actor.permissions.includes("inventory.adjust"),kinds:allowedKinds,editableKinds:allowedKinds.filter(k=>kindAllowed(actor,k,true))},boundary:"Vanteloq-managed stock starts from your reviewed count. It is separate from POS balances and does not update a provider or post accounting entries. Every movement is retained."};
}
export async function readInventoryWorkflowHistory(actor:InventoryWorkflowActor,id:string,database=getD1()) {
  const row=await sql(database,`SELECT ${recordColumns} FROM workflow_inventory_records WHERE organization_id=? AND id=?`,[actor.organizationId,id]).first<RecordRow>();
  if(!row || !kindAllowed(actor,row.kind)) throw new ApiError(404,"INVENTORY_RECORD_UNAVAILABLE","This record is unavailable.");
  await location(database,actor,row.locationId);
  return {entries:await rows(database,"SELECT version,payload_json AS payloadJson,created_at AS createdAt FROM workflow_inventory_history WHERE organization_id=? AND record_id=? ORDER BY version DESC LIMIT 100",[actor.organizationId,id]),limit:100};
}
export async function mutateInventoryWorkflow(actor:InventoryWorkflowActor,body:Record<string,unknown>,database=getD1()) {
  const action=inventoryText(body.action,"action",30),org=actor.organizationId,locationId=inventoryText(body.locationId,"location"),site=await location(database,actor,locationId),now=Date.now();
  const key=inventoryText(body.mutationKey,"save key",180),hash=await hashIdentifier(JSON.stringify([actor.userId,body]));
  const prior=()=>sql(database,"SELECT request_hash AS hash,result_json AS result FROM workflow_inventory_mutations WHERE organization_id=? AND mutation_key=?",[org,key]).first<{hash:string;result:string}>();
  const previous=await prior(); if(previous) { if(previous.hash!==hash) throw new ApiError(409,"INVENTORY_SAVE_KEY_REUSED","This save key belongs to different data. Start a new action."); return {...JSON.parse(previous.result),replayed:true}; }
  if(body.reviewed!==true) throw new InventoryWorkflowError("Review the source and quantities before saving.");
  const writes:D1PreparedStatement[]=[],result={saved:true,id:crypto.randomUUID()},date=inventoryDate(body.date??(body.record as Record<string,unknown>|undefined)?.asOf);
  dayLimit(date,site.timezone);
  if(action==="open_stock") {
    allow(actor,"inventory.adjust"); const sku=inventorySku(body.sku),unit=managedUnit(body.unit),quantity=inventoryInteger(body.quantityMilli,"opening quantity",0,1_000_000_000_000),source=inventoryText(body.source,"count reference",300);
    writes.push(sql(database,"INSERT INTO workflow_inventory_positions(id,organization_id,location_id,sku,product_name,unit,currency,quantity_milli,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)",[result.id,org,locationId,sku,inventoryText(body.productName,"product name"),unit,site.currency,quantity,now,now]));
    writes.push(sql(database,"INSERT INTO workflow_inventory_movements(id,organization_id,position_id,quantity_delta,reason,source_reference,occurred_date,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",[crypto.randomUUID(),org,result.id,quantity,"Reviewed opening count",`opening:${result.id}:${source}`,date,actor.userId,now]));
  } else if(action==="count_stock") {
    allow(actor,"inventory.adjust"); const sku=inventorySku(body.sku),version=inventoryInteger(body.expectedVersion,"stock version",1),quantity=inventoryInteger(body.quantityMilli,"counted quantity",0,1_000_000_000_000),reason=inventoryText(body.source,"count evidence and reason",300);
    const position=await sql(database,"SELECT p.id,p.quantity_milli AS quantity,p.version,p.unit,p.currency,(SELECT max(occurred_date) FROM workflow_inventory_movements m WHERE m.organization_id=p.organization_id AND m.position_id=p.id) AS latestDate FROM workflow_inventory_positions p WHERE p.organization_id=? AND p.location_id=? AND p.sku=?",[org,locationId,sku]).first<{id:string;quantity:number;version:number;unit:ManagedUnit;currency:string;latestDate:string|null}>();
    if(!position || position.version!==version) throw new ApiError(409,"INVENTORY_COUNT_CHANGED","The stock changed after this count opened. Reload and recount.");
    if(position.currency!==site.currency) throw new InventoryWorkflowError("The location currency changed after this stock was recorded. Reconcile its currency before confirming a count.");
    if(position.latestDate && date<position.latestDate) throw new InventoryWorkflowError("The count date cannot precede the latest recorded stock movement.");
    result.id=position.id; const delta=quantity-position.quantity;
    if(!delta) { writes.push(...guard(database,org,"EXISTS(SELECT 1 FROM workflow_inventory_positions WHERE organization_id=? AND id=? AND version=?)",[org,position.id,version])); writes.push(sql(database,"UPDATE workflow_inventory_positions SET version=version+1,updated_at=? WHERE organization_id=? AND id=?",[now,org,position.id])); writes.push(sql(database,"INSERT INTO workflow_inventory_movements(id,organization_id,position_id,quantity_delta,reason,source_reference,occurred_date,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",[crypto.randomUUID(),org,position.id,0,`Count confirmed: ${reason}`,`count:${key}`,date,actor.userId,now])); }
    else { writes.push(...guard(database,org,"EXISTS(SELECT 1 FROM workflow_inventory_positions WHERE organization_id=? AND id=? AND version=?)",[org,position.id,version])); writes.push(...await prepareManagedInventoryChanges(database,actor,locationId,[{sku,unit:position.unit,quantityMilli:delta,reason:`Count correction: ${reason}`,sourceReference:`count:${key}`,occurredDate:date}])); }
  } else if(action==="receive") {
    allow(actor,"purchasing.view","purchasing.receive","inventory.adjust");
    const orderId=inventoryText(body.purchaseOrderId,"purchase order"),order=await sql(database,"SELECT status,currency,order_date AS orderDate FROM purchase_orders WHERE id=? AND organization_id=? AND delivery_location_id=?",[orderId,org,locationId]).first<{status:string;currency:string;orderDate:string}>();
    if(!order || !["sent","acknowledged","partially_received"].includes(order.status) || order.currency!==site.currency) throw new InventoryWorkflowError("Choose a sent purchase order with this delivery location and currency.");
    if(date<order.orderDate) throw new InventoryWorkflowError("The receipt date cannot precede the purchase order date.");
    if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100) throw new InventoryWorkflowError("Review between 1 and 100 receiving lines.");
    const lines:ReceiptLine[]=[],seen=new Set<string>();
    for(const raw of body.lines) {
      const r=raw as Record<string,unknown>,lineId=inventoryText(r.lineId,"order line"),accepted=inventoryInteger(r.accepted,"accepted units",0,1_000_000),rejected=inventoryInteger(r.rejected,"rejected units",0,1_000_000);
      if(seen.has(lineId) || !(accepted+rejected)) throw new InventoryWorkflowError("Each receipt line must be distinct and contain an accepted or rejected quantity."); seen.add(lineId);
      const line=await sql(database,"SELECT sku,quantity,received_quantity AS received,unit_cost_cents AS cost FROM purchase_order_lines WHERE organization_id=? AND purchase_order_id=? AND id=?",[org,orderId,lineId]).first<{sku:string;quantity:number;received:number;cost:number}>();
      if(!line || accepted>line.quantity-line.received) throw new InventoryWorkflowError("Accepted units cannot exceed the unreceived order quantity. Amend the order before accepting an over-delivery.");
      const sku=inventorySku(line.sku);lines.push({lineId,sku,accepted,rejected,unitCostCents:line.cost});
      writes.push(...guard(database,org,"EXISTS(SELECT 1 FROM purchase_order_lines WHERE organization_id=? AND id=? AND purchase_order_id=? AND received_quantity=? AND quantity=? AND unit_cost_cents=? AND sku=?)",[org,lineId,orderId,line.received,line.quantity,line.cost,line.sku]));
      writes.push(sql(database,"UPDATE purchase_order_lines SET received_quantity=received_quantity+?,updated_at=? WHERE organization_id=? AND id=?",[accepted,now,org,lineId]));
    }
    writes.push(...guard(database,org,"EXISTS(SELECT 1 FROM purchase_orders WHERE organization_id=? AND id=? AND status=?)",[org,orderId,order.status]));
    const quantities=new Map<string,number>(); for(const line of lines) if(line.accepted) quantities.set(line.sku,(quantities.get(line.sku)??0)+line.accepted*1000);
    if(quantities.size) writes.push(...await prepareManagedInventoryChanges(database,actor,locationId,[...quantities].map(([sku,quantityMilli])=>({sku,unit:"each",quantityMilli,reason:"Accepted purchase receipt",sourceReference:`receipt:${result.id}`,occurredDate:date}))));
    writes.push(sql(database,"INSERT INTO workflow_inventory_receipts(id,organization_id,location_id,purchase_order_id,source,occurred_date,lines_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",[result.id,org,locationId,orderId,inventoryText(body.source,"delivery note reference",300),date,JSON.stringify(lines),actor.userId,now]));
    writes.push(sql(database,"UPDATE purchase_orders SET status=CASE WHEN EXISTS(SELECT 1 FROM purchase_order_lines WHERE organization_id=? AND purchase_order_id=? AND received_quantity<quantity) THEN 'partially_received' ELSE 'received' END,updated_at=? WHERE organization_id=? AND id=?",[org,orderId,now,org,orderId]));
  } else if(action==="reverse_receipt") {
    allow(actor,"purchasing.view","purchasing.receive","inventory.adjust"); result.id=inventoryText(body.id,"receipt");
    const receipt=await sql(database,"SELECT purchase_order_id AS orderId,lines_json AS linesJson,occurred_date AS occurredDate,reversed_at AS reversedAt FROM workflow_inventory_receipts WHERE organization_id=? AND location_id=? AND id=?",[org,locationId,result.id]).first<{orderId:string;linesJson:string;occurredDate:string;reversedAt:number|null}>();
    if(!receipt || receipt.reversedAt!==null || date<receipt.occurredDate) throw new InventoryWorkflowError("Choose an unreversed receipt and a reversal date on or after its receiving date.");
    const reason=inventoryText(body.source,"reversal reason",300),lines=JSON.parse(receipt.linesJson) as ReceiptLine[],quantities=new Map<string,number>();
    writes.push(...guard(database,org,"EXISTS(SELECT 1 FROM workflow_inventory_receipts WHERE organization_id=? AND id=? AND reversed_at IS NULL) AND EXISTS(SELECT 1 FROM purchase_orders WHERE organization_id=? AND id=? AND status IN ('sent','acknowledged','partially_received','received'))",[org,result.id,org,receipt.orderId]));
    for(const line of lines) { writes.push(...guard(database,org,"EXISTS(SELECT 1 FROM purchase_order_lines WHERE organization_id=? AND id=? AND received_quantity>=?)",[org,line.lineId,line.accepted]));writes.push(sql(database,"UPDATE purchase_order_lines SET received_quantity=received_quantity-?,updated_at=? WHERE organization_id=? AND id=?",[line.accepted,now,org,line.lineId]));if(line.accepted) quantities.set(line.sku,(quantities.get(line.sku)??0)-line.accepted*1000); }
    if(quantities.size) writes.push(...await prepareManagedInventoryChanges(database,actor,locationId,[...quantities].map(([sku,quantityMilli])=>({sku,quantityMilli,unit:"each",reason:`Receipt reversal: ${reason}`,sourceReference:`receipt-reversal:${result.id}`,occurredDate:date}))));
    writes.push(sql(database,"UPDATE workflow_inventory_receipts SET reversed_at=?,reversal_reason=? WHERE organization_id=? AND id=?",[now,reason,org,result.id]));
    writes.push(sql(database,"UPDATE purchase_orders SET status='partially_received',updated_at=? WHERE organization_id=? AND id=?",[now,org,receipt.orderId]));
  } else if(action==="save_record") {
    const kind=inventoryText(body.kind,"record type",40) as InventoryRecordKind;
    if(!["supplier","lot_case","returns","invoice_review"].includes(kind) || !kindAllowed(actor,kind,true)) throw new ApiError(403,"INVENTORY_RECORD_PERMISSION","This record type is unavailable under your current tools, plan or permissions.");
    const content=validateInventoryContent(kind,body.record);
    dayLimit(content.asOf,site.timezone);
    if(new Intl.NumberFormat("en-CA",{style:"currency",currency:site.currency}).resolvedOptions().maximumFractionDigits!==2) throw new InventoryWorkflowError("These reviewed monetary records currently support currencies with two decimal places.");
    if(kind==="lot_case") {
      const c=content as LotCase,lot=await sql(database,"SELECT id,quantity_remaining AS quantity,version,status FROM inventory_lots WHERE organization_id=? AND location_ref=? AND id=?",[org,locationId,c.lotId]).first<{id:string;quantity:number;version:number;status:string}>();
      if(!lot || c.units>lot.quantity && c.status!=="resolved") throw new InventoryWorkflowError("Choose a lot in this location and no more than its recorded quantity.");
      if(c.status==="quarantined" && lot.status!=="quarantined") { writes.push(...guard(database,org,"EXISTS(SELECT 1 FROM inventory_lots WHERE organization_id=? AND id=? AND version=?)",[org,lot.id,lot.version]));writes.push(sql(database,"UPDATE inventory_lots SET status='quarantined',version=version+1,updated_by_user_id=?,updated_at=? WHERE organization_id=? AND id=?",[actor.userId,now,org,lot.id])); }
    }
    if(kind==="invoice_review") {
      const review=content as InvoiceReview;
      const order=await sql(database,"SELECT id,currency FROM purchase_orders WHERE organization_id=? AND delivery_location_id=? AND id=?",[org,locationId,review.purchaseOrderId]).first<{id:string;currency:string}>();
      if(!order||order.currency!==site.currency) throw new InventoryWorkflowError("Choose a purchase order in this location and currency.");
      for(const line of review.lines) { const actual=await sql(database,"SELECT quantity,received_quantity AS received,unit_cost_cents AS cost FROM purchase_order_lines WHERE organization_id=? AND purchase_order_id=? AND id=?",[org,order.id,line.lineId]).first<{quantity:number;received:number;cost:number}>();if(!actual) throw new InventoryWorkflowError("Each reviewed invoice line must belong to this purchase order.");line.ordered=actual.quantity;line.accepted=actual.received;line.agreedUnitCostCents=actual.cost; writes.push(...guard(database,org,"EXISTS(SELECT 1 FROM purchase_order_lines WHERE organization_id=? AND id=? AND quantity=? AND received_quantity=? AND unit_cost_cents=?)",[org,line.lineId,actual.quantity,actual.received,actual.cost])); }
    }
    let version=1;
    if(body.id) { result.id=inventoryText(body.id,"record");const expected=inventoryInteger(body.expectedVersion,"record version",1);version=expected+1;writes.push(...guard(database,org,"EXISTS(SELECT 1 FROM workflow_inventory_records WHERE organization_id=? AND location_id=? AND id=? AND kind=? AND version=?)",[org,locationId,result.id,kind,expected]));writes.push(sql(database,"UPDATE workflow_inventory_records SET record_key=?,payload_json=?,version=?,actor_id=?,updated_at=? WHERE organization_id=? AND id=?",[inventoryRecordKey(kind,content),JSON.stringify(content),version,actor.userId,now,org,result.id])); }
    else writes.push(sql(database,"INSERT INTO workflow_inventory_records(id,organization_id,location_id,kind,record_key,currency,payload_json,version,actor_id,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)",[result.id,org,locationId,kind,inventoryRecordKey(kind,content),site.currency,JSON.stringify(content),actor.userId,now]));
    writes.push(sql(database,"INSERT INTO workflow_inventory_history(id,organization_id,record_id,version,payload_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?)",[crypto.randomUUID(),org,result.id,version,JSON.stringify(content),actor.userId,now]));
  } else throw new InventoryWorkflowError("Choose a supported inventory workflow action.");
  try { await database.batch([sql(database,"INSERT INTO workflow_inventory_mutations(id,organization_id,mutation_key,request_hash,result_json,created_at) VALUES(?,?,?,?,?,?)",[crypto.randomUUID(),org,key,hash,JSON.stringify(result),now]),...writes]); }
  catch(error) {const raced=await prior();if(raced?.hash===hash)return {...JSON.parse(raced.result),replayed:true};if(/constraint|unique/i.test(String(error)))throw new ApiError(409,"INVENTORY_WORKFLOW_CONFLICT","This record changed, already exists, or would duplicate stock. Reload and review before retrying.");throw error;}
  return result;
}
