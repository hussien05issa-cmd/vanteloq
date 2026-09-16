import { getD1,getR2 } from "../../../../../db";
import { ApiError, handleApi, jsonResponse, readJsonObject, requireSameOrigin, enforceRateLimit } from "../../../../../server/api";
import { requireBillingAccess, type AccessContext } from "../../../../../server/authorization";
import { getTenantEntitlements, requireTenantServiceAccess, requireAddonEntitlement } from "../../../../../server/entitlements/engine";
import { requirePermission } from "../../../../../server/permissions";
import { requireOrganizationWideLocationAccess } from "../../../../../server/location-access";
import { recordAudit } from "../../../../../server/audit";
import { documentEmailConfigured } from "../../../../../server/document-email";
import { cleanupDocumentIngests } from "../../../../../server/document-ingest";
import { DOCUMENT_EMAIL_DOMAIN, DOCUMENT_EMAIL_NOTICE_VERSION } from "../../../../../shared/document-email";

async function access(request:Request) {
  const context=await requireBillingAccess(request,["owner","admin"]);
  for(const permission of ["documents.upload","documents.view","documents.review","organization.settings"] as const)await requirePermission(context,permission);
  await requireOrganizationWideLocationAccess(context);
  return context;
}
async function view(context:AccessContext) {
  const configured=documentEmailConfigured(undefined,context.organizationId),database=getD1();
  const row=await database.prepare("SELECT alias,enabled,consent_version,consented_at FROM document_email_aliases WHERE organization_id=?").bind(context.organizationId)
    .first<{alias:string;enabled:number;consent_version:string;consented_at:number}>();
  const recent=await database.prepare(`SELECT s.document_id documentId,d.file_name fileName,s.sender_unverified sender,s.created_at receivedAt
    FROM document_email_sources s JOIN workspace_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id
    WHERE s.organization_id=? AND d.status<>'deletion_pending' ORDER BY s.created_at DESC LIMIT 10`).bind(context.organizationId).all();
  const pending=await database.prepare("SELECT sum(CASE WHEN state='cleanup' THEN 1 ELSE 0 END) cleanup,sum(CASE WHEN state='writing' AND created_at<? THEN 1 ELSE 0 END) review FROM document_ingest_intents WHERE organization_id=?").bind(Math.floor(Date.now()/1000)-600,context.organizationId).first<{cleanup:number|null;review:number|null}>();
  return {configured,validationOnly:configured&&!documentEmailConfigured(),enabled:configured&&row?.enabled===1&&row.consent_version===DOCUMENT_EMAIL_NOTICE_VERSION,address:configured&&row?.enabled===1?row.alias:null,recent:recent.results??[],pendingCleanup:pending?.cleanup??0,pendingReview:pending?.review??0};
}
export async function GET(request:Request){return handleApi(request,async()=>jsonResponse(await view(await access(request))));}
export async function POST(request:Request){return handleApi(request,async({requestId})=>{
  requireSameOrigin(request);const context=await access(request),database=getD1();
  await enforceRateLimit("document-email:settings",context.userId,12,3600);
  const body=await readJsonObject(request,2048);
  if(!["enable","rotate","disable","cleanup"].includes(String(body.action)))throw new ApiError(400,"EMAIL_ACTION_INVALID","Choose Enable, Replace Address, Disable or Retry Cleanup.");
  if(body.action==="cleanup"){
    await cleanupDocumentIngests(database,getR2(),context.organizationId);
  }else if(body.action==="disable"){
    await database.prepare("UPDATE document_email_aliases SET enabled=0,updated_at=? WHERE organization_id=?").bind(Math.floor(Date.now()/1000),context.organizationId).run();
  }else{
    if(!documentEmailConfigured(undefined,context.organizationId))throw new ApiError(503,"EMAIL_NOT_CONFIGURED","Email forwarding is not available yet. Upload documents directly for now.");
    const entitlement=await getTenantEntitlements(context);requireTenantServiceAccess(entitlement);requireAddonEntitlement(entitlement,"bookloq");
    if(context.identity.provider!=="supabase"||!context.identity.emailVerified||!context.authSubject||context.authSubject!==context.identity.subject)
      throw new ApiError(403,"EMAIL_IDENTITY_REQUIRED","Use your verified Vanteloq account to enable forwarding.");
    if(body.consent!==true||body.noticeVersion!==DOCUMENT_EMAIL_NOTICE_VERSION)throw new ApiError(400,"EMAIL_CONSENT_REQUIRED","Review and accept the email storage notice before enabling forwarding.");
    const token=Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,"0")).join("");
    const now=Math.floor(Date.now()/1000);
    await database.prepare(`INSERT INTO document_email_aliases(organization_id,alias,enabled,authorized_by_user_id,auth_subject,consent_version,consented_at,generation,created_at,updated_at)
      VALUES(?,?,1,?,?,?,?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET alias=excluded.alias,enabled=1,authorized_by_user_id=excluded.authorized_by_user_id,auth_subject=excluded.auth_subject,
      consent_version=excluded.consent_version,consented_at=excluded.consented_at,generation=excluded.generation,updated_at=excluded.updated_at`)
      .bind(context.organizationId,`inbox-${token}@${DOCUMENT_EMAIL_DOMAIN}`,context.userId,context.authSubject,DOCUMENT_EMAIL_NOTICE_VERSION,now,crypto.randomUUID(),now,now).run();
  }
  await recordAudit({request,requestId,organizationId:context.organizationId,actorUserId:context.userId,action:`document_email.${body.action}`,resourceType:"document_email_inbox",resourceId:context.organizationId,details:{noticeVersion:DOCUMENT_EMAIL_NOTICE_VERSION,scanAuthorized:false,postedToLedger:false}});
  return jsonResponse(await view(context));
});}
