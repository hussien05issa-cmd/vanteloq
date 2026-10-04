import { getD1 } from "../db";
import { ApiError, hashIdentifier } from "./api";
import { requireAccess, type AccessContext } from "./authorization";
import { effectivePermissions, requirePermission } from "./permissions";
import { requireFeatureEntitlement as checkFeatureEntitlement, getTenantEntitlements, requireAddon } from "./entitlements/engine";
import { accessibleLocations, requireAccessibleLocation, requireOrganizationWideLocationAccess } from "./location-access";
import { getWorkspaceIndustry } from "./industry-configuration";
import { businessClock } from "../domain/intraday-sales";
import { businessWorkflowKinds, businessWorkflowReport, invoiceReferences, validateBusinessWorkflow, workflowTransition, type BusinessWorkflow, type BusinessWorkflowKind, type LinkedInvoice, type SavedBusinessWorkflow, type WorkflowState } from "../domain/business-workflows";

export async function businessWorkflowAccess(request:Request){
  const context=await requireAccess(request,["owner","admin","manager","employee","read_only"],"operations.basic");
  await requirePermission(context,"operations.tasks");
  const permissions=await effectivePermissions(context),industry=await getWorkspaceIndustry(context);
  const kinds=businessWorkflowKinds(industry.configuration).filter(k=>k==="custom"||permissions.includes("finance.costs")&&permissions.includes("metrics.profit")&&(k!=="settlement"||permissions.includes("finance.bank_transactions")));
  return {context,kinds,canWrite:["owner","admin","manager"].includes(context.role)&&permissions.includes("operations.manage"),canReopen:["owner","admin"].includes(context.role),canApproveOwnerReview:context.role==="owner",canExport:permissions.includes("finance.export")};
}
type Access=Awaited<ReturnType<typeof businessWorkflowAccess>>;
async function requireFeatureEntitlement(context:AccessContext,feature:"bookloq.ar"){checkFeatureEntitlement(await getTenantEntitlements(context),feature);}
type Row={id:string;locationId:string;kind:BusinessWorkflowKind;name:string;currency:string;state:WorkflowState;contentJson:string;version:number;updatedAt:number};
const columns="id,location_id locationId,kind,name,currency,state,content_json contentJson,version,updated_at updatedAt";
export function workflowId(value:unknown){if(typeof value!=="string"||!/^[A-Za-z0-9_.:-]{1,200}$/.test(value))throw new ApiError(400,"WORKFLOW_ID","Choose a valid saved record.");return value;}
function content(row:Row):SavedBusinessWorkflow{return {...validateBusinessWorkflow(JSON.parse(row.contentJson)),id:row.id,locationId:row.locationId,version:row.version,state:row.state,updatedAt:row.updatedAt};}
async function linkedInvoices(context:AccessContext,refs:string[]):Promise<LinkedInvoice[]>{
  if(!refs.length)return [];
  await requireFeatureEntitlement(context,"bookloq.ar");await requireAddon(context,"bookloq");await requirePermission(context,"finance.ap_ar");await requireOrganizationWideLocationAccess(context);
  const rows=await getD1().prepare(`SELECT id,invoice_number number,currency,total_cents totalMinor,CASE WHEN status IN ('void','cancelled','written_off') THEN 0 ELSE MAX(0,total_cents-paid_cents) END outstandingMinor,status FROM customer_invoices WHERE organization_id=? AND demo_record=0 AND id IN (${refs.map(()=>"?").join(",")})`).bind(context.organizationId,...refs).all<LinkedInvoice>();
  if((rows.results??[]).length!==refs.length||(rows.results??[]).some(row=>row.status==="draft"))throw new ApiError(400,"WORKFLOW_INVOICE","One of the linked invoices is unavailable in this workspace.");
  return rows.results??[];
}
async function allowedRow(access:Access,id:string){
  const row=await getD1().prepare(`SELECT ${columns} FROM business_workflow_records WHERE organization_id=? AND id=?`).bind(access.context.organizationId,id).first<Row>();
  if(!row)throw new ApiError(404,"WORKFLOW_MISSING","This saved workflow was not found.");
  await requireAccessibleLocation(access.context,row.locationId);
  if(!access.kinds.includes(row.kind))throw new ApiError(403,"WORKFLOW_PERMISSION","Your current business tools or permissions do not include this workflow.");
  return row;
}
export async function readBusinessWorkflows(access:Access,locationId:string|null,history:string|null){
  if(history){const row=await allowedRow(access,workflowId(history));await linkedInvoices(access.context,invoiceReferences(content(row)));
    const rows=await getD1().prepare("SELECT version,action,reason,snapshot_json snapshot,recorded_at recordedAt FROM business_workflow_revisions WHERE organization_id=? AND record_id=? ORDER BY version DESC LIMIT 101").bind(access.context.organizationId,row.id).all<{version:number;action:string;reason:string;snapshot:string;recordedAt:number}>();
    return {id:row.id,revisions:(rows.results??[]).slice(0,100).map(r=>({...r,snapshot:JSON.parse(r.snapshot)})),truncated:(rows.results??[]).length>100};}
  const locations=await accessibleLocations(access.context),location=locationId?await requireAccessibleLocation(access.context,workflowId(locationId)):locations.length===1?locations[0]:null;
  const rows=location?await getD1().prepare(`SELECT ${columns} FROM business_workflow_records WHERE organization_id=? AND location_id=? ORDER BY updated_at DESC,id DESC LIMIT 501`).bind(access.context.organizationId,location.id).all<Row>():{results:[]};
  const scoped=(rows.results??[]).filter(r=>access.kinds.includes(r.kind)).slice(0,200);
  const records=[];for(const r of scoped){const item=content(r);try{const invoices=await linkedInvoices(access.context,invoiceReferences(item));records.push({...item,report:businessWorkflowReport(item,invoices,businessClock(new Date(),location!.timezone)?.date),invoices});}catch(error){if(error instanceof ApiError&&[400,403].includes(error.status))continue;throw error;}}
  let invoices:LinkedInvoice[]=[];
  if(location&&access.kinds.includes("job")){try{await requireFeatureEntitlement(access.context,"bookloq.ar");await requireAddon(access.context,"bookloq");await requirePermission(access.context,"finance.ap_ar");await requireOrganizationWideLocationAccess(access.context);
    const list=await getD1().prepare("SELECT id,invoice_number number,currency,total_cents totalMinor,MAX(0,total_cents-paid_cents) outstandingMinor,status FROM customer_invoices WHERE organization_id=? AND currency=? AND demo_record=0 AND status NOT IN ('draft','void','cancelled') ORDER BY updated_at DESC LIMIT 100").bind(access.context.organizationId,location.currency).all<LinkedInvoice>();invoices=list.results??[];
  }catch(error){if(!(error instanceof ApiError&&error.status===403))throw error;}}
  return {locationId:location?.id??null,locations:locations.map(l=>({id:l.id,name:l.name,currency:l.currency,timezone:l.timezone})),records,kinds:access.kinds,canWrite:access.canWrite,canReopen:access.canReopen,canApproveOwnerReview:access.canApproveOwnerReview,canExport:access.canExport,invoices,truncated:(rows.results??[]).length>200};
}
export async function mutateBusinessWorkflow(access:Access,body:Record<string,unknown>){
  if(!access.canWrite)throw new ApiError(403,"WORKFLOW_WRITE","An authorised manager must save or review these workflows.");
  if(Object.keys(body).some(k=>!["id","locationId","requestId","expectedVersion","action","record","reason","reviewed"].includes(k)))throw new ApiError(400,"WORKFLOW_FIELD","Remove unsupported request fields.");
  const id=workflowId(body.id),requestId=workflowId(body.requestId),locationId=workflowId(body.locationId),location=await requireAccessibleLocation(access.context,locationId),db=getD1();
  const action=typeof body.action==="string"?body.action:"",reason=typeof body.reason==="string"?body.reason.trim():"";
  if(reason.length>1000)throw new ApiError(400,"WORKFLOW_REASON","Keep the reason under 1,000 characters.");
  const hash=await hashIdentifier(JSON.stringify(body));
  const priorRequest=await db.prepare("SELECT request_hash hash,actor_id actorId,record_id recordId FROM business_workflow_revisions WHERE organization_id=? AND request_id=?").bind(access.context.organizationId,requestId).first<{hash:string;actorId:string;recordId:string}>();
  if(priorRequest){if(priorRequest.hash!==hash||priorRequest.actorId!==access.context.userId||priorRequest.recordId!==id)throw new ApiError(409,"WORKFLOW_REQUEST","This request identifier was already used. Reload before retrying.");const saved=content(await allowedRow(access,id));await linkedInvoices(access.context,invoiceReferences(saved));return {saved:true,id,replayed:true};}
  const row=await db.prepare(`SELECT ${columns} FROM business_workflow_records WHERE organization_id=? AND id=?`).bind(access.context.organizationId,id).first<Row>();
  if(row){await allowedRow(access,id);if(row.locationId!==locationId)throw new ApiError(409,"WORKFLOW_SCOPE","A saved workflow cannot move between locations.");}
  if(body.expectedVersion!==(row?.version??null))throw new ApiError(409,"WORKFLOW_CONFLICT","This record changed. Reload the latest version before saving.");
  let record:BusinessWorkflow,state:WorkflowState;
  try{record=action==="save"?validateBusinessWorkflow(body.record):row?validateBusinessWorkflow(JSON.parse(row.contentJson)):(()=>{throw Error("Save a draft first.");})();
    if(row&&(row.kind!==record.kind||row.currency!==record.currency))throw Error("A saved workflow's type and currency cannot change.");
    if(!access.kinds.includes(record.kind))throw new ApiError(403,"WORKFLOW_KIND","This workflow is not enabled for your business and permissions.");
    if(record.currency!==location.currency)throw Error("Use the selected location's currency.");
    const today=businessClock(new Date(),location.timezone)?.date;if(!today)throw Error("The location date is unavailable.");if(record.asOfDate>today)throw Error("The source date cannot be in the future.");
    const invoices=await linkedInvoices(access.context,invoiceReferences(record));if(invoices.some(i=>i.currency!==record.currency))throw Error("Linked invoices must use this location's currency.");
    if(["review","complete"].includes(action)&&record.kind==="custom"&&record.values.approval==="owner-review"&&access.context.role!=="owner")throw new ApiError(403,"WORKFLOW_OWNER_REVIEW","This workflow requires the workspace owner to approve it.");
    if(["review","complete"].includes(action)&&body.reviewed!==true)throw Error("Review the source evidence before confirming this action.");
    if(action==="reopen"&&!["owner","admin"].includes(access.context.role))throw new ApiError(403,"WORKFLOW_REOPEN","An owner or administrator must reopen reviewed work.");
    state=workflowTransition(row?.state??"draft",action,businessWorkflowReport(record,invoices,today),reason);
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,"WORKFLOW_INPUT",error instanceof Error?error.message:"Review the workflow inputs.");}
  const now=Date.now(),version=(row?.version??0)+1,json=JSON.stringify(record);
  const mutation=row?db.prepare("UPDATE business_workflow_records SET name=?,content_json=?,state=?,version=version+1,mutation_id=?,updated_by=?,updated_at=? WHERE organization_id=? AND id=? AND version=?").bind(record.name,json,state,requestId,access.context.userId,now,access.context.organizationId,id,row.version):db.prepare("INSERT INTO business_workflow_records(id,organization_id,location_id,kind,name,currency,state,content_json,version,mutation_id,updated_by,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?)").bind(id,access.context.organizationId,locationId,record.kind,record.name,record.currency,state,json,requestId,access.context.userId,now,now);
  const retain=db.prepare("INSERT INTO business_workflow_revisions(id,organization_id,record_id,version,request_id,request_hash,actor_id,action,reason,snapshot_json,recorded_at) SELECT ?,organization_id,id,version,?,?,?,?,?,json_object('record',json(content_json),'state',state,'version',version),? FROM business_workflow_records WHERE organization_id=? AND id=? AND version=? AND mutation_id=?").bind(crypto.randomUUID(),requestId,hash,access.context.userId,action,reason,now,access.context.organizationId,id,version,requestId);
  try{const result=await db.batch([mutation,retain]);if(result[0].meta.changes!==1)throw new ApiError(409,"WORKFLOW_CONFLICT","This record changed. Reload before saving.");}
  catch(error){if(/unique constraint/i.test(String(error))){const repeat=await db.prepare("SELECT request_hash hash,actor_id actorId,record_id recordId FROM business_workflow_revisions WHERE organization_id=? AND request_id=?").bind(access.context.organizationId,requestId).first<{hash:string;actorId:string;recordId:string}>();if(repeat?.hash===hash&&repeat.actorId===access.context.userId&&repeat.recordId===id)return {saved:true,id,replayed:true};throw new ApiError(409,"WORKFLOW_CONFLICT","This record was already saved or changed. Reload before retrying.");}throw error;}
  return {saved:true,id,version,state,replayed:false};
}
