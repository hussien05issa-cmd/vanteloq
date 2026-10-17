import { getD1 } from "../db";
import { canReadReview } from "../domain/opportunity-review";
import { businessClock } from "../domain/intraday-sales";
import { outcomeSalesValues, outcomeWindows, recordedOutcomeSales, type OutcomeSalesPreview } from "../domain/workflow-outcomes";
import type { BusinessWorkflow } from "../domain/business-workflows";
import { validateBusinessWorkflow } from "../domain/business-workflows";
import { ApiError, hashIdentifier } from "./api";
import type { AccessContext } from "./authorization";
import { requireCollaborationTask } from "./collaboration";
import { requireReadableReview } from "./opportunity-reviews";
import { authorizedLocationScope, requireAccessibleLocation } from "./location-access";
import { effectivePermissions, requirePermission } from "./permissions";
import { loadForecast } from "./forecasting";

export type OutcomeLinks = { task: null | {id:number;title:string;status:string}; opportunity: null | {id:string;title:string;status:string;from:string;to:string} };
export async function readableOutcomeLinks(context:AccessContext,locationId:string,records:BusinessWorkflow[]):Promise<(OutcomeLinks|null)[]>{
  const permissions=await effectivePermissions(context),scope=await authorizedLocationScope(context,locationId),db=getD1();
  const taskIds=[...new Set(records.filter(r=>r.kind==='outcome'&&r.values.taskId).map(r=>taskId(r.values.taskId)))];
  type Task={id:number;title:string;status:string;locationId:string|null;sourceRef:string|null};
  type Review={id:string;title:string;status:string;scopeKey:string;required:string;from:string;to:string};
  const batches=<T,>(ids:T[])=>Array.from({length:Math.ceil(ids.length/80)},(_,i)=>ids.slice(i*80,(i+1)*80));
  const tasks=(await Promise.all(batches(taskIds).map(ids=>db.prepare(`SELECT id,title,status,location_id locationId,source_ref sourceRef FROM workspace_tasks WHERE organization_id=? AND id IN (${ids.map(()=>'?').join(',')})`).bind(context.organizationId,...ids).all<Task>()))).flatMap(r=>r.results??[]);
  const reviewIds=[...new Set([...records.filter(r=>r.kind==='outcome'&&r.values.opportunityId).map(r=>opportunityId(r.values.opportunityId)),...tasks.flatMap(t=>t.sourceRef?.startsWith('opportunity:')?[t.sourceRef.slice(12)]:[])])];
  const reviews=scope.organizationWide&&permissions.includes('insights.view')?(await Promise.all(batches(reviewIds).map(ids=>db.prepare(`SELECT id,rule_id title,status,scope_key scopeKey,required_permissions_json required,period_start 'from',period_end 'to' FROM opportunity_reviews WHERE organization_id=? AND scope_key=? AND id IN (${ids.map(()=>'?').join(',')})`).bind(context.organizationId,locationId,...ids).all<Review>()))).flatMap(r=>r.results??[]):[];
  return records.map(record=>{
    if(record.kind!=='outcome')return {task:null,opportunity:null};
    if(!permissions.includes('operations.tasks')||(record.values.measurementMode==='recorded-net-sales'||record.outcomeSnapshot)&&(!permissions.includes('sales.view')||!permissions.includes('metrics.revenue')||record.outcomeSnapshot&&record.outcomeSnapshot.locationId!==locationId))return null;
    const task=record.values.taskId?tasks.find(t=>t.id===Number(record.values.taskId)):null;
    if(record.values.taskId&&(!task||task.locationId!==locationId&&!(task.locationId===null&&scope.organizationWide)))return null;
    const inferred=task?.sourceRef?.startsWith('opportunity:')?task.sourceRef.slice(12):null;
    if(inferred&&record.values.opportunityId&&inferred!==record.values.opportunityId)return null;
    const ref=record.values.opportunityId||inferred,opportunity=ref?reviews.find(r=>r.id===ref):null;
    if(ref&&(!opportunity||!canReadReview(JSON.parse(opportunity.required),permissions)))return null;
    return {task:task?{id:task.id,title:task.title,status:task.status}:null,opportunity:opportunity?{id:opportunity.id,title:opportunity.title,status:opportunity.status,from:opportunity.from,to:opportunity.to}:null};
  });
}
function taskId(value:string){if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))throw new ApiError(400,"OUTCOME_TASK","Choose a saved task.");return Number(value);}
function opportunityId(value:string){if(!/^[A-Za-z0-9_.:-]{1,200}$/.test(value))throw new ApiError(400,"OUTCOME_FINDING","Choose a saved finding.");return value;}
export async function requireOutcomeLinks(context:AccessContext,locationId:string,record:BusinessWorkflow):Promise<OutcomeLinks>{
  if(record.kind!=="outcome")return {task:null,opportunity:null};
  await requirePermission(context,"operations.tasks");await requireAccessibleLocation(context,locationId);
  const values=record.values,scope=await authorizedLocationScope(context,locationId);
  const task=values.taskId?await requireCollaborationTask(context,taskId(values.taskId)):null;
  if(task&&task.locationId!==locationId&&!(task.locationId===null&&scope.organizationWide))throw new ApiError(404,"OUTCOME_TASK","This task is not available for the selected location.");
  const inferred=task?.sourceRef?.startsWith("opportunity:")?task.sourceRef.slice(12):null;
  if(inferred&&values.opportunityId&&inferred!==values.opportunityId)throw new ApiError(400,"OUTCOME_LINK_MISMATCH","The selected task belongs to a different saved finding.");
  const ref=values.opportunityId||inferred,opportunity=ref?await requireReadableReview(context,opportunityId(ref)):null;
  if(opportunity&&(!scope.organizationWide||opportunity.scopeKey!==locationId))throw new ApiError(404,"OUTCOME_FINDING","Choose a saved finding for this location. Company-wide findings need a company-wide outcome review.");
  if(record.values.measurementMode==="recorded-net-sales"||record.outcomeSnapshot){await requirePermission(context,"sales.view");await requirePermission(context,"metrics.revenue");if(record.outcomeSnapshot&&record.outcomeSnapshot.locationId!==locationId)throw new ApiError(400,"OUTCOME_SCOPE","The retained source snapshot belongs to a different location.");}
  return {task:task?{id:task.id,title:task.title,status:task.status}:null,opportunity:opportunity?{id:opportunity.id,title:JSON.parse(opportunity.snapshotJson).title||opportunity.ruleId,status:opportunity.status,from:opportunity.periodStart,to:opportunity.periodEnd}:null};
}
export async function outcomeLinkChoices(context:AccessContext,locationId:string){
  await requirePermission(context,"operations.tasks");const scope=await authorizedLocationScope(context,locationId),permissions=await effectivePermissions(context),db=getD1();
  const [taskRows,reviewRows]=await Promise.all([
    db.prepare(`SELECT t.id,t.title,t.status,t.source_ref sourceRef,r.scope_key scopeKey,r.required_permissions_json required FROM workspace_tasks t LEFT JOIN opportunity_reviews r ON r.organization_id=t.organization_id AND t.source_ref='opportunity:'||r.id WHERE t.organization_id=? AND (t.location_id=? ${scope.organizationWide?'OR t.location_id IS NULL':''}) ORDER BY t.id DESC LIMIT 101`).bind(context.organizationId,locationId).all<{id:number;title:string;status:string;sourceRef:string|null;scopeKey:string|null;required:string|null}>(),
    scope.organizationWide&&permissions.includes("insights.view")?db.prepare("SELECT id,rule_id title,status,period_start fromDate,period_end toDate,required_permissions_json required FROM opportunity_reviews WHERE organization_id=? AND scope_key=? ORDER BY updated_at DESC,id DESC LIMIT 101").bind(context.organizationId,locationId).all<{id:string;title:string;status:string;fromDate:string;toDate:string;required:string}>():Promise.resolve({results:[]}),
  ]);
  return {tasks:(taskRows.results??[]).slice(0,100).filter(t=>!t.sourceRef?.startsWith("opportunity:")||t.scopeKey===locationId&&scope.organizationWide&&permissions.includes("insights.view")&&t.required&&canReadReview(JSON.parse(t.required),permissions)).map(({id,title,status,sourceRef})=>({id,title,status,opportunityId:sourceRef?.startsWith("opportunity:")?sourceRef.slice(12):null})),opportunities:(reviewRows.results??[]).slice(0,100).filter(r=>canReadReview(JSON.parse(r.required),permissions)).map(({id,title,status,fromDate,toDate})=>({id,title,status,from:fromDate,to:toDate})),truncated:(taskRows.results??[]).length>100||(reviewRows.results??[]).length>100};
}
export async function previewOutcomeSales(context:AccessContext,locationId:string,record:BusinessWorkflow,now=new Date()):Promise<OutcomeSalesPreview>{
  const links=await requireOutcomeLinks(context,locationId,record);
  await requirePermission(context,"sales.view");await requirePermission(context,"metrics.revenue");
  const location=await requireAccessibleLocation(context,locationId);
  if(record.kind!=="outcome"||record.values.measurementMode!=="recorded-net-sales")throw new ApiError(400,"OUTCOME_METRIC","Choose recorded net sales for this comparison.");
  if(!links.task&&!links.opportunity)throw new ApiError(400,"OUTCOME_LINK_REQUIRED","Link the task or saved finding being reviewed first.");
  if(record.currency!==location.currency)throw new ApiError(400,"OUTCOME_CURRENCY","Use the selected location's currency.");
  let windows;try{windows=outcomeWindows(record.values,businessClock(now,location.timezone)!.date);}catch(error){throw new ApiError(400,"OUTCOME_PERIOD",error instanceof Error?error.message:"Review both periods.");}
  const loaded=await loadForecast(context,locationId,7,now),input=loaded.inputs.find(l=>l.id===locationId);
  if(!input)return {available:false,reason:"This location's recorded sales are unavailable.",snapshot:null,baseline:null,followup:null};
  const result=recordedOutcomeSales(input,windows,now.toISOString());
  if('reason'in result)return {available:false,reason:result.reason,snapshot:null,baseline:null,followup:null};
  const {capturedAt,...source}=result,fingerprint=await hashIdentifier(JSON.stringify(source)),snapshot={...source,capturedAt,fingerprint};
  return {available:true,reason:"Both exact periods have reviewed, authoritative coverage. This is an observed change, not proof of causation.",snapshot,...outcomeSalesValues(snapshot)};
}
export async function captureOutcomeSales(context:AccessContext,locationId:string,record:BusinessWorkflow,refresh:boolean):Promise<BusinessWorkflow>{
  await requireOutcomeLinks(context,locationId,record);
  if(record.kind!=="outcome")return record;
  if(record.values.measurementMode!=="recorded-net-sales")return {...record,outcomeSnapshot:null};
  const current=await previewOutcomeSales(context,locationId,record);
  if(!current.available||!current.snapshot)throw new ApiError(409,"OUTCOME_SOURCE_INCOMPLETE",current.reason);
  if(!refresh&&record.outcomeSnapshot?.fingerprint!==current.snapshot.fingerprint)throw new ApiError(409,"OUTCOME_SOURCE_CHANGED","Recorded sales or source coverage changed. Reopen this outcome, refresh its recorded comparison and review it again.");
  return refresh?{...record,values:{...record.values,metric:"Net sales",unit:record.currency,baseline:current.baseline!,followup:current.followup!,coverage:"confirmed"},outcomeSnapshot:current.snapshot}:record;
}
export async function previewOutcomeRequest(context:AccessContext,body:Record<string,unknown>){
  const allowed=['action','locationId','taskId','opportunityId','baselineFrom','baselineTo','followupFrom','followupTo'];
  if(Object.keys(body).some(k=>!allowed.includes(k))||typeof body.locationId!=='string')throw new ApiError(400,'OUTCOME_INPUT','Choose a location and valid comparison fields.');
  const location=await requireAccessibleLocation(context,body.locationId);
  let record:BusinessWorkflow;
  try{record=validateBusinessWorkflow({kind:'outcome',name:'Recorded outcome preview',source:'Authoritative reviewed sales',asOfDate:businessClock(new Date(),location.timezone)!.date,currency:location.currency,values:{taskId:body.taskId??'',opportunityId:body.opportunityId??'',measurementMode:'recorded-net-sales',metric:'Net sales',unit:location.currency,baselineFrom:body.baselineFrom,baselineTo:body.baselineTo,followupFrom:body.followupFrom,followupTo:body.followupTo,coverage:'not-yet',guardrail:'Review trade-offs',decision:'review'},groups:{},costCoverage:false,note:''});}catch(error){throw new ApiError(400,'OUTCOME_INPUT',error instanceof Error?error.message:'Review the comparison inputs.');}
  return previewOutcomeSales(context,location.id,record);
}
