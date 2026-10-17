import { getD1 } from "../db";
import { SECTOR_KINDS, SectorInputError, sectorDate, sectorKindsFor, sectorNextState, sectorReport, sectorText, validateSectorContent, type SectorAction, type SectorContent, type SectorKind, type SectorState } from "../domain/sector-operations";
import { businessClock } from "../domain/intraday-sales";
import { ApiError, hashIdentifier } from "./api";
import { requireAccess } from "./authorization";
import { effectivePermissions, requirePermission, type PermissionKey } from "./permissions";
import { accessibleLocations, requireAccessibleLocation } from "./location-access";
import { getWorkspaceIndustry } from "./industry-configuration";
import { prepareManagedInventoryChanges } from "./workflow-inventory";
import { InventoryWorkflowError } from "../domain/workflow-inventory";
import { getTenantEntitlements } from "./entitlements/engine";
import type { FeatureKey } from "./entitlements/catalog";

const roles=["owner","admin","manager","employee","read_only"] as const;
const featureMap:Partial<Record<SectorKind,FeatureKey>>={prep_plan:"inventory.lots",prep_batch:"inventory.lots",supplier_check:"invoice.matching",service_period:"analytics.sales.basic",delivery_order:"analytics.sales.basic",furniture_order:"inventory.lots",dealer_funding:"inventory.lots"};
const permissionMap:Record<SectorKind,{read:PermissionKey[];write:PermissionKey[]}>={
  prep_plan:{read:["inventory.view","inventory.value"],write:["inventory.adjust"]},prep_batch:{read:["inventory.view","inventory.value"],write:["inventory.adjust"]},
  supplier_check:{read:["purchasing.view","finance.costs"],write:["purchasing.match"]},service_period:{read:["metrics.revenue","payroll.totals"],write:["payroll.edit"]},
  delivery_order:{read:["sales.transactions","finance.costs","finance.bank_transactions"],write:["finance.reconcile"]},
  furniture_order:{read:["purchasing.view","finance.costs","finance.ap_ar"],write:["purchasing.create"]},dealer_funding:{read:["inventory.view","finance.ap_ar","finance.costs"],write:["finance.reconcile"]},
  room:{read:[],write:[]},reservation:{read:["finance.ap_ar"],write:["finance.reconcile"]},
};
export async function sectorAccess(request:Request){
  const context=await requireAccess(request,roles,"operations.basic");await requirePermission(context,"operations.tasks");
  const [permissions,industry,entitlements]=await Promise.all([effectivePermissions(context),getWorkspaceIndustry(context),getTenantEntitlements(context)]);
  const kinds=sectorKindsFor(industry.configuration).filter(k=>(!featureMap[k]||entitlements.features.includes(featureMap[k]!))&&permissionMap[k].read.every(p=>permissions.includes(p)));
  const writable=kinds.filter(k=>permissions.includes("operations.manage")&&permissionMap[k].write.every(p=>permissions.includes(p)));
  return {context,permissions,kinds,writable};
}
type Access=Awaited<ReturnType<typeof sectorAccess>>;
type Row={id:string;locationId:string;kind:SectorKind;state:SectorState;version:number;contentJson:string;linkedJson:string;updatedAt:number};
type Link={id:string;label:string;type:string;version:number|null};
const columns="id,location_id locationId,kind,state,version,content_json contentJson,linked_json linkedJson,updated_at updatedAt";
const dto=(r:Row)=>({...validateSectorContent(JSON.parse(r.contentJson)),id:r.id,locationId:r.locationId,state:r.state,version:r.version,updatedAt:r.updatedAt,links:JSON.parse(r.linkedJson) as Link[]});
const id=(v:unknown)=>sectorText(v,"record identifier",200);
const json=(value:unknown)=>JSON.stringify(value);
function available(access:Access,kind:SectorKind,write=false){if(!(write?access.writable:access.kinds).includes(kind))throw new ApiError(403,"SECTOR_PERMISSION","This workflow is not available for your business type or permissions.");}
async function loadRecord(access:Access,recordId:unknown){const row=await getD1().prepare(`SELECT ${columns} FROM sector_operation_records WHERE organization_id=? AND id=?`).bind(access.context.organizationId,id(recordId)).first<Row>();if(!row)throw new ApiError(404,"SECTOR_MISSING","The operational record was not found.");available(access,row.kind);await requireAccessibleLocation(access.context,row.locationId);return row;}
export async function readSectorOperations(access:Access,params:URLSearchParams){
  const locations=await accessibleLocations(access.context), requested=params.get("locationId");
  const location=requested?await requireAccessibleLocation(access.context,id(requested)):locations.length===1?locations[0]:null;
  const requestedKind=params.get("kind");if(requestedKind&&!SECTOR_KINDS.includes(requestedKind as SectorKind))throw new ApiError(400,"SECTOR_KIND","Choose a supported workflow.");if(requestedKind)available(access,requestedKind as SectorKind);
  const kinds=requestedKind?[requestedKind]:access.kinds,db=getD1(),org=access.context.organizationId;
  const rows=location?(await db.prepare(`SELECT ${columns} FROM sector_operation_records WHERE organization_id=? AND location_id=? AND kind IN (SELECT value FROM json_each(?)) AND id>? ORDER BY id LIMIT 101`).bind(org,location.id,json(kinds),params.get("after")?id(params.get("after")):"").all<Row>()).results??[]:[];
  const records=rows.slice(0,100).map(dto);
  const picker=async(sql:string,allowed:boolean)=>location&&allowed?(await db.prepare(sql).bind(org,location.id).all<{id:string;label:string}>()).results??[]:[];
  const [recipes,stocks,purchases,rooms]=await Promise.all([
    picker("SELECT id,name label FROM foodservice_records WHERE organization_id=? AND location_id=? AND kind='recipe' ORDER BY name LIMIT 200",access.kinds.includes("prep_plan")||access.kinds.includes("prep_batch")),
    picker("SELECT id,stock_number||' · '||currency label FROM dealership_stock_episodes WHERE organization_id=? AND location_id=? ORDER BY acquired_date DESC LIMIT 200",access.kinds.includes("dealer_funding")),
    picker("SELECT id,order_number||' · '||supplier_name label FROM purchase_orders WHERE organization_id=? AND delivery_location_id=? ORDER BY order_date DESC LIMIT 200",access.kinds.includes("supplier_check")||access.kinds.includes("furniture_order")),
    picker("SELECT id,json_extract(content_json,'$.title') label FROM sector_operation_records WHERE organization_id=? AND location_id=? AND kind='room' AND state<>'cancelled' ORDER BY record_key LIMIT 200",access.kinds.includes("reservation")),
  ]);
  return {locationId:location?.id??null,locations:locations.map(({id,name,currency,timezone})=>({id,name,currency,timezone})),kinds:access.kinds,writable:access.writable,records:records.map(record=>({...record,report:sectorReport(record)})),references:{recipe:recipes,stock:stocks,purchase:purchases,room:rooms},referenceLimit:200,nextCursor:rows.length>100?rows[99].id:null};
}
export async function readSectorHistory(access:Access,recordId:string){const row=await loadRecord(access,recordId);const result=await getD1().prepare("SELECT version,action,reason,state,content_json contentJson,linked_json linkedJson,created_at createdAt FROM sector_operation_revisions WHERE organization_id=? AND record_id=? ORDER BY version DESC LIMIT 101").bind(access.context.organizationId,row.id).all<{version:number;action:string;reason:string;state:SectorState;contentJson:string;linkedJson:string;createdAt:number}>();return {recordId:row.id,truncated:(result.results??[]).length>100,revisions:(result.results??[]).slice(0,100).map(r=>({version:r.version,action:r.action,reason:r.reason,state:r.state,createdAt:r.createdAt,content:validateSectorContent(JSON.parse(r.contentJson)),links:JSON.parse(r.linkedJson)}))};}
async function linksFor(access:Access,content:SectorContent,locationId:string){
  const links:Link[]=[],db=getD1(),org=access.context.organizationId;
  for(const [key,sql,type] of [
    ["recipeId","SELECT id,name label,version FROM foodservice_records WHERE organization_id=? AND location_id=? AND id=? AND kind='recipe'","recipe"],
    ["stockId","SELECT id,stock_number label,version FROM dealership_stock_episodes WHERE organization_id=? AND location_id=? AND id=?","vehicle"],
    ["purchaseId","SELECT id,order_number label,NULL version FROM purchase_orders WHERE organization_id=? AND delivery_location_id=? AND id=?","purchase order"],
    ["roomId","SELECT id,json_extract(content_json,'$.title') label,version FROM sector_operation_records WHERE organization_id=? AND location_id=? AND id=? AND kind='room' AND state<>'cancelled'","room"],
  ] as const){
    if(content.values[key]===undefined||content.values[key]===null)continue;
    const ref=await db.prepare(sql).bind(org,locationId,id(content.values[key])).first<{id:string;label:string;version:number|null}>();if(!ref)throw new ApiError(400,"SECTOR_REFERENCE",`Select an accessible saved ${type} at this location.`);links.push({...ref,type});
  }
  return links;
}
function recordKey(content:SectorContent){const v=content.values;switch(content.kind){case"prep_batch":return String(v.batchRef??content.title).toLowerCase();case"delivery_order":return `${v.provider??""}:${v.orderRef??content.title}`.toLowerCase();case"room":return String(v.roomRef??content.title).toLowerCase();case"reservation":return String(v.reservationRef??content.title).toLowerCase();case"dealer_funding":return String(v.dealRef??content.title).toLowerCase();case"furniture_order":return String(v.orderRef??content.title).toLowerCase();default:return content.title.toLowerCase();}}
export async function writeSectorOperation(access:Access,body:Record<string,unknown>){
  const action=body.action as SectorAction;if(!["save","amend","review","start","complete","reopen","cancel"].includes(action))throw new ApiError(400,"SECTOR_ACTION","Choose an available workflow action.");
  const requestKey=id(body.requestKey),org=access.context.organizationId,actor=access.context.userId,db=getD1();
  if(!/^[a-zA-Z0-9:_-]{12,160}$/.test(requestKey))throw new ApiError(400,"SECTOR_REQUEST","Use a valid retry identifier.");
  const requestHash=await hashIdentifier(json({...body,requestKey:undefined}));
  const replay=async()=>{const r=await db.prepare("SELECT request_hash requestHash,result_json resultJson,record_id recordId FROM sector_operation_requests WHERE organization_id=? AND actor_id=? AND request_key=?").bind(org,actor,requestKey).first<{requestHash:string;resultJson:string;recordId:string}>();if(!r)return null;const current=await loadRecord(access,r.recordId);available(access,current.kind,true);if(r.requestHash!==requestHash)throw new ApiError(409,"SECTOR_RETRY_CHANGED","This retry identifier belongs to a different action. Reload before making changes.");return {...JSON.parse(r.resultJson),replayed:true};};
  const priorResponse=await replay();if(priorResponse)return priorResponse;
  const prior=body.id==null?null:await loadRecord(access,body.id);
  if(!prior&&action!=="save")throw new ApiError(400,"SECTOR_SAVE_FIRST","Save this record before reviewing it.");
  if(body.expectedVersion!==(prior?.version??null))throw new ApiError(409,"SECTOR_CONFLICT","The record changed. Reload and review the latest version.");
  if(prior&&action==="save"&&prior.state!=="draft")throw new ApiError(409,"SECTOR_LOCKED","Reopen the record before editing reviewed evidence.");
  const content=validateSectorContent(action==="save"||action==="amend"?body.record:dto(prior!));
  if(action==="amend"&&(!prior||prior.kind!=="reservation"||prior.state!=="active"))throw new ApiError(409,"SECTOR_LOCKED","Only an active stay supports a reviewed folio update.");
  if(action==="amend"){const before=dto(prior!);if(content.values.roomId!==before.values.roomId||content.values.arrival!==before.values.arrival||content.values.reservationRef!==before.values.reservationRef)throw new ApiError(400,"SECTOR_STAY_IDENTITY","An active stay must keep its room, arrival and reservation reference.");}
  available(access,content.kind,true);
  const locationId=prior?.locationId??id(body.locationId),location=await requireAccessibleLocation(access.context,locationId);
  if(body.locationId!==locationId||content.currency!==location.currency||prior&&content.kind!==prior.kind)throw new ApiError(400,"SECTOR_SCOPE","The record must keep its original location, workflow and currency.");
  const today=businessClock(new Date(),location.timezone)?.date;if(!today)throw new ApiError(503,"SECTOR_DATE","The location date is unavailable.");
  if(content.sourceDate>today)throw new ApiError(400,"SECTOR_DATE","The source evidence date cannot be in the future.");
  if(content.kind==="prep_batch"&&content.values.preparedDate&&String(content.values.preparedDate)>today)throw new ApiError(400,"SECTOR_DATE","A completed preparation batch cannot be dated in the future.");
  if(action!=="save"&&content.kind==="service_period"&&String(content.values.serviceDate)>today)throw new ApiError(400,"SECTOR_DATE","Review actual service figures only after their business date has arrived.");
  if(action==="complete"&&content.kind==="furniture_order"&&String(content.values.deliveryDate)>today)throw new ApiError(400,"SECTOR_DATE","Record the actual delivery date before completing the order.");
  if(action!=="save"&&body.confirmed!==true)throw new ApiError(400,"SECTOR_CONFIRM","Confirm the reviewed action before continuing.");
  if(action==="reopen")sectorText(body.reason,"reason for reopening",300);
  const state=action==="save"?"draft":sectorNextState({...dto(prior!),...content},action);
  const retainedLinks=prior?dto(prior).links:[];
  const currentLinks=["save","amend","review","start"].includes(action)?await linksFor(access,content,locationId):retainedLinks;
  if(action==="review"&&currentLinks.some(link=>link.version!==null&&retainedLinks.find(old=>old.id===link.id)?.version!==link.version))throw new ApiError(409,"SECTOR_SOURCE_CHANGED","A linked source changed after this draft was saved. Review that source and save the draft again before approval.");
  const links=["save","amend","start"].includes(action)?currentLinks:retainedLinks,now=Date.now(),recordId=prior?.id??crypto.randomUUID(),version=(prior?.version??0)+1,requestId=crypto.randomUUID();
  const result={record:{...content,id:recordId,locationId,state,version,updatedAt:now,links,report:sectorReport(content)},replayed:false};
  const writes:D1PreparedStatement[]=[];
  const guards:{sql:string;values:unknown[]}[]=[];
  if(action==="review")for(const link of links){const table=link.type==="recipe"?"foodservice_records":link.type==="vehicle"?"dealership_stock_episodes":link.type==="room"?"sector_operation_records":null;if(table&&link.version!==null)guards.push({sql:`EXISTS(SELECT 1 FROM ${table} source WHERE source.organization_id=? AND source.location_id=? AND source.id=? AND source.version=?)`,values:[org,locationId,link.id,link.version]});}
  if(content.kind==="reservation"){
    const v=content.values;
    if(action==="review"||action==="amend"){
      if(action==="amend")writes.push(db.prepare("DELETE FROM sector_room_nights WHERE organization_id=? AND record_id=?").bind(org,recordId));
      const arrival=sectorDate(v.arrival,"arrival"),departure=sectorDate(v.departure,"departure"),nights=(Date.parse(departure+"T00:00:00Z")-Date.parse(arrival+"T00:00:00Z"))/86400000;
      if(nights>366)throw new ApiError(400,"SECTOR_STAY_RANGE","Review stays of no more than 366 nights.");
      for(let n=0;n<nights;n++){const stayDate=new Date(Date.parse(arrival+"T00:00:00Z")+n*86400000).toISOString().slice(0,10);writes.push(db.prepare("INSERT INTO sector_room_nights(id,organization_id,record_id,room_id,stay_date) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),org,recordId,v.roomId,stayDate));}
    }
    if(action==="start"){
      if(String(v.arrival)>today||String(v.departure)<=today)throw new ApiError(409,"SECTOR_STAY_DATE","Check in only during the recorded stay dates.");
      guards.push({sql:"NOT EXISTS(SELECT 1 FROM sector_operation_records stay WHERE stay.organization_id=? AND stay.location_id=? AND stay.kind='reservation' AND stay.state='active' AND stay.id<>? AND json_extract(stay.content_json,'$.values.roomId')=?)",values:[org,locationId,recordId,v.roomId]});
    }
    if(action==="complete"&&String(v.departure)>today)throw new ApiError(409,"SECTOR_STAY_DATE","Record the actual departure date before closing the stay.");
    if(action==="reopen"||action==="cancel")writes.push(db.prepare("DELETE FROM sector_room_nights WHERE organization_id=? AND record_id=?").bind(org,recordId));
    if(action==="start"||action==="complete"||action==="reopen"&&prior?.state==="active"){
      const room=await db.prepare(`SELECT ${columns} FROM sector_operation_records WHERE organization_id=? AND location_id=? AND id=? AND kind='room'`).bind(org,locationId,v.roomId).first<Row>();
      if(!room)throw new ApiError(409,"SECTOR_ROOM","The room is no longer available.");
      const before=dto(room),rv=before.values;
      if(action==="start"&&(!["reviewed","completed"].includes(room.state)||before.sourceDate!==today||rv.condition!=="inspected"||rv.blocked!==false||rv.occupied!==false))throw new ApiError(409,"SECTOR_ROOM_READINESS","The room needs today's inspected, unblocked and unoccupied readiness review.");
      const roomContent=validateSectorContent({...before,source:`Stay ${v.reservationRef}: ${action==="start"?"checked in":"departure / reopened stay"}`,sourceDate:today,values:{...rv,occupied:action==="start",condition:action==="start"?rv.condition:"dirty"}}),roomVersion=room.version+1;
      writes.push(db.prepare("UPDATE sector_operation_records SET state='draft',version=?,content_json=?,last_request_id=?,updated_by=?,updated_at=? WHERE organization_id=? AND id=? AND version=?").bind(roomVersion,json(roomContent),requestId,actor,now,org,room.id,room.version));
      writes.push(db.prepare("INSERT INTO sector_operation_revisions(id,organization_id,record_id,version,action,reason,state,content_json,linked_json,actor_id,created_at) SELECT ?,organization_id,id,version,?,?,'draft',content_json,linked_json,?,? FROM sector_operation_records WHERE organization_id=? AND id=? AND last_request_id=?").bind(crypto.randomUUID(),action==="start"?"stay_checkin":"stay_departure",`Linked stay ${recordId}`,actor,now,org,room.id,requestId));
      guards.push({sql:"EXISTS(SELECT 1 FROM sector_operation_records room WHERE room.organization_id=? AND room.id=? AND room.version=? AND room.last_request_id=?)",values:[org,room.id,roomVersion,requestId]});
    }
  }
  if(content.kind==="prep_batch"&&(action==="review"||["reopen","cancel"].includes(action)&&["reviewed","active","completed"].includes(prior!.state))){
    if(!content.batch)throw new ApiError(400,"SECTOR_BATCH","Include the batch stock lines.");
    const direction=action==="review"?1:-1,sourceReference=`sector:${recordId}:v${version}:${action}`;
    const changes=[...content.batch.inputs.map(line=>({...line,quantityMilli:-line.quantityMilli*direction})),{...content.batch.output,quantityMilli:content.batch.output.quantityMilli*direction}].map(line=>({...line,reason:action==="review"?"Preparation batch":"Reversed preparation batch",sourceReference,occurredDate:today}));
    writes.push(...await prepareManagedInventoryChanges(db,{organizationId:org,userId:actor,locationIds:[locationId],permissions:access.permissions},locationId,changes));
  }
  const update=prior?db.prepare("UPDATE sector_operation_records SET record_key=?,state=?,version=?,content_json=?,linked_json=?,last_request_id=?,updated_by=?,updated_at=? WHERE organization_id=? AND location_id=? AND id=? AND version=?")
    .bind(recordKey(content),state,version,json(content),json(links),requestId,actor,now,org,locationId,recordId,prior.version)
    :db.prepare("INSERT INTO sector_operation_records(id,organization_id,location_id,kind,record_key,currency,state,version,content_json,linked_json,last_request_id,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?,?)")
      .bind(recordId,org,locationId,content.kind,recordKey(content),content.currency,state,json(content),json(links),requestId,actor,now,now);
  const guardSql=guards.length?" AND "+guards.map(g=>g.sql).join(" AND "):"";
  try{
    await db.batch([update,...writes,
      db.prepare("INSERT INTO sector_operation_revisions(id,organization_id,record_id,version,action,reason,state,content_json,linked_json,actor_id,created_at) SELECT ?,organization_id,id,version,?,?,state,content_json,linked_json,?,? FROM sector_operation_records WHERE organization_id=? AND id=? AND last_request_id=?").bind(crypto.randomUUID(),action,action==="reopen"?String(body.reason):"",actor,now,org,recordId,requestId),
      // This CHECK constraint rolls back every statement, including movements and room-night claims, if CAS or readiness loses a race.
      db.prepare(`INSERT INTO sector_operation_requests(id,organization_id,record_id,actor_id,request_key,request_hash,result_json,success,created_at) VALUES(?,?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM sector_operation_records WHERE organization_id=? AND location_id=? AND id=? AND last_request_id=? AND version=?)${guardSql} THEN 1 ELSE 0 END,?)`).bind(requestId,org,recordId,actor,requestKey,requestHash,json(result),org,locationId,recordId,requestId,version,...guards.flatMap(g=>g.values),now),
    ]);
  }catch(error){const existing=await replay();if(existing)return existing;if(/constraint|sector_request_committed/i.test(String(error)))throw new ApiError(409,"SECTOR_CONFLICT","The record, room readiness or stock changed, or this reference/stay already exists. Reload and review before retrying.");throw error;}
  return result;
}
export function sectorInputError(error:unknown):never{if(error instanceof SectorInputError||error instanceof InventoryWorkflowError)throw new ApiError(400,"SECTOR_INPUT",error.message);throw error;}
