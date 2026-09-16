import { getD1, getR2, getRuntimeEnv, type VanteloqRuntimeEnv } from "../db/index.ts";
import { ApiError, readRequestBytes } from "./api.ts";
import { requirePermission } from "./permissions.ts";
import { internalAccessEnabled } from "./internal-access.ts";
import { subscriptionSnapshot, resolveSubscriptionEntitlements, requireTenantServiceAccess, requireFeatureEntitlement, requireAddonEntitlement } from "./entitlements/engine.ts";
import { hasUnrestrictedLocationRole, parsePermittedLocationIds } from "../domain/location-scope.ts";
import { cleanupDocumentIngests, quarantineDocument, verifiedType } from "./document-ingest.ts";
import { DOCUMENT_EMAIL_NOTICE_VERSION, DOCUMENT_EMAIL_DOMAIN, DOCUMENT_EMAIL_MAX_BODY, DOCUMENT_EMAIL_MAX_BYTES, DOCUMENT_EMAIL_MAX_FILES, documentDigest, emailSignature } from "../shared/document-email.ts";

export function documentEmailConfigured(env: VanteloqRuntimeEnv = getRuntimeEnv(),organizationId?:string) {
  const global=env.DOCUMENT_EMAIL_ENABLED === "true" && env.DOCUMENT_EMAIL_VERIFIED === "true";
  const validation=Boolean(organizationId&&env.DOCUMENT_EMAIL_VALIDATION_ORGANIZATION_ID===organizationId);
  return (global||validation) && /^[A-Za-z0-9_-]{43,128}$/.test(env.DOCUMENT_EMAIL_SECRET ?? "");
}
export type EmailAlias = { organization_id:string; alias:string; enabled:number; authorized_by_user_id:string; auth_subject:string; consent_version:string; generation:string };
type Actor = { id:string; role:"owner"|"admin"; auth_subject:string; auth_provider:string };

/** A saved MFA-authorized inbox is a narrow background grant, not a fabricated user session. */
export async function authorizeEmailDelivery(database: D1Database, alias: EmailAlias) {
  if (!alias.enabled || alias.consent_version !== DOCUMENT_EMAIL_NOTICE_VERSION) throw new ApiError(403,"EMAIL_INBOX_DISABLED","This forwarding address is unavailable.");
  const actor = await database.prepare(`SELECT u.id,u.auth_subject,u.auth_provider,m.role FROM users u
    JOIN memberships m ON m.user_id=u.id AND m.organization_id=? AND m.status='active'
    WHERE u.id=? AND u.status='active' AND u.auth_provider='supabase' AND u.auth_subject=? AND m.role IN('owner','admin')`)
    .bind(alias.organization_id,alias.authorized_by_user_id,alias.auth_subject).first<Actor>();
  if (!actor) throw new ApiError(403,"EMAIL_AUTHORIZATION_REVOKED","Forwarding authorization is no longer active.");
  const deletion = await database.prepare("SELECT 1 FROM account_deletion_jobs WHERE stage IN('confirmed','local_deleted') AND (user_id=? OR (scope='workspace' AND organization_id=?)) LIMIT 1")
    .bind(actor.id,alias.organization_id).first();
  if (deletion) throw new ApiError(403,"EMAIL_AUTHORIZATION_REVOKED","This workspace is being deleted.");
  const profile = await database.prepare(`SELECT t.status,t.role_id roleId,r.system_key systemKey,r.location_scope_json roleLocationScopeJson,r.permissions_json permissionsJson
    FROM team_members t LEFT JOIN access_roles r ON r.id=t.role_id AND r.organization_id=t.organization_id
    WHERE t.organization_id=? AND t.user_id=? LIMIT 1`).bind(alias.organization_id,actor.id)
    .first<{status:string;roleId:string|null;systemKey:string|null;roleLocationScopeJson:string|null;permissionsJson:string|null}>();
  if (actor.role !== "owner" && ((profile && profile.status !== "active") || !hasUnrestrictedLocationRole(actor.role,profile) || parsePermittedLocationIds(profile?.roleLocationScopeJson).length))
    throw new ApiError(403,"EMAIL_AUTHORIZATION_REVOKED","Organization-wide forwarding permission is required.");
  const context = {userId:actor.id,organizationId:alias.organization_id,role:actor.role};
  for (const permission of ["documents.upload","documents.view","documents.review","organization.settings"] as const) await requirePermission(context,permission);
  const internal = internalAccessEnabled() ? await database.prepare("SELECT id FROM internal_access WHERE user_id=? AND organization_id=? AND active=1 AND access_level='founder' AND mfa_required=1")
    .bind(actor.id,alias.organization_id).first<{id:string}>() : null;
  let billingSql: string, billingValues:(string|number)[];
  if (internal) { billingSql="EXISTS(SELECT 1 FROM internal_access WHERE id=? AND active=1 AND mfa_required=1)"; billingValues=[internal.id]; }
  else {
    const snapshot = await subscriptionSnapshot(alias.organization_id), entitlement = resolveSubscriptionEntitlements(snapshot);
    requireTenantServiceAccess(entitlement); requireFeatureEntitlement(entitlement,"invoice.basic"); requireAddonEntitlement(entitlement,"bookloq");
    billingSql="EXISTS(SELECT 1 FROM tenant_subscriptions WHERE organization_id=? AND version=? AND status IN('active','trialing')) AND EXISTS(SELECT 1 FROM tenant_addons WHERE organization_id=? AND addon_key='bookloq' AND status IN('active','trialing','scheduled_for_removal'))";
    billingValues=[alias.organization_id,snapshot.version,alias.organization_id];
  }
  return {
    actor,
    guard:{sql:`EXISTS(SELECT 1 FROM document_email_aliases a JOIN users u ON u.id=a.authorized_by_user_id
      JOIN memberships m ON m.user_id=u.id AND m.organization_id=a.organization_id
      WHERE a.organization_id=? AND a.alias=? AND a.generation=? AND a.enabled=1 AND a.consent_version=?
      AND u.status='active' AND u.auth_subject=a.auth_subject AND u.auth_provider='supabase' AND m.status='active' AND m.role=?)
      AND COALESCE((SELECT json_array(t.status,t.role_id,r.system_key,r.location_scope_json,r.permissions_json) FROM team_members t LEFT JOIN access_roles r ON r.id=t.role_id AND r.organization_id=t.organization_id WHERE t.organization_id=? AND t.user_id=? LIMIT 1),'null')=?
      AND NOT EXISTS(SELECT 1 FROM account_deletion_jobs WHERE stage IN('confirmed','local_deleted') AND (user_id=? OR (scope='workspace' AND organization_id=?))) AND ${billingSql}`,
      values:[alias.organization_id,alias.alias,alias.generation,DOCUMENT_EMAIL_NOTICE_VERSION,actor.role,alias.organization_id,actor.id,profile?JSON.stringify([profile.status,profile.roleId,profile.systemKey,profile.roleLocationScopeJson,profile.permissionsJson]):"null",actor.id,alias.organization_id,...billingValues] as (string|number|null)[]},
  };
}

function fixedTimeEquals(a:string,b:string) { if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0; }
type Attachment = {fileName:string;contentType:string;content:string};
type Payload = {version:1;recipient:string;sender:string;attachments:Attachment[]};

export async function verifiedEmailPayload(request:Request, secret:string, now=Date.now()) {
  const timestamp=request.headers.get("x-vanteloq-email-time")??"", id=request.headers.get("x-vanteloq-email-id")??"", signature=request.headers.get("x-vanteloq-email-signature")??"";
  if(!/^\d{10}$/.test(timestamp)||Math.abs(Number(timestamp)*1000-now)>300_000||!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{64}$/.test(signature)) throw new ApiError(401,"EMAIL_SIGNATURE_INVALID","Email delivery authentication failed.");
  const bytes=await readRequestBytes(request,DOCUMENT_EMAIL_MAX_BODY,"EMAIL_TOO_LARGE","Email attachments exceed the size limit.");
  const digest=await documentDigest(bytes),expected=await emailSignature(secret,timestamp,id,digest);
  if(!fixedTimeEquals(signature,expected))throw new ApiError(401,"EMAIL_SIGNATURE_INVALID","Email delivery authentication failed.");
  let parsed:unknown;try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ApiError(400,"EMAIL_PAYLOAD_INVALID","Email delivery could not be read.");}
  const payload=parsed as Payload;
  if(!payload||payload.version!==1||Object.keys(payload).some(key=>!["version","recipient","sender","attachments"].includes(key))
    ||typeof payload.recipient!=="string"||!new RegExp(`^inbox-[a-f0-9]{48}@${DOCUMENT_EMAIL_DOMAIN.replaceAll(".","\\.")}$`).test(payload.recipient)
    ||typeof payload.sender!=="string"||payload.sender.length>254||!/^[-A-Za-z0-9.!#$%&'*+/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(payload.sender)
    ||!Array.isArray(payload.attachments)||!payload.attachments.length||payload.attachments.length>DOCUMENT_EMAIL_MAX_FILES)throw new ApiError(400,"EMAIL_PAYLOAD_INVALID","Use the exact forwarding address and supported attachments.");
  let total=0;
  const files=payload.attachments.map(file=>{
    if(!file||Object.keys(file).some(key=>!["fileName","contentType","content"].includes(key))||typeof file.fileName!=="string"||file.fileName.length>160||typeof file.contentType!=="string"||typeof file.content!=="string"
      ||!file.content.length||file.content.length>Math.ceil(DOCUMENT_EMAIL_MAX_BYTES/3)*4||file.content.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content))throw new ApiError(400,"EMAIL_ATTACHMENT_INVALID","An email attachment is invalid.");
    let decoded:Uint8Array;try{decoded=Uint8Array.from(atob(file.content),character=>character.charCodeAt(0));}catch{throw new ApiError(400,"EMAIL_ATTACHMENT_INVALID","An email attachment is invalid.");}
    total+=decoded.length;if(!decoded.length||total>DOCUMENT_EMAIL_MAX_BYTES)throw new ApiError(413,"EMAIL_TOO_LARGE","Email attachments must total 10 MB or less.");
    verifiedType(decoded,file.contentType);return {...file,bytes:decoded};
  });
  return {id,digest,payload,files};
}

export async function receiveDocumentEmail(request:Request) {
  const env=getRuntimeEnv();if(!documentEmailConfigured(env)&&!documentEmailConfigured(env,env.DOCUMENT_EMAIL_VALIDATION_ORGANIZATION_ID))throw new ApiError(503,"EMAIL_NOT_CONFIGURED","Email forwarding is not available yet.");
  const delivery=await verifiedEmailPayload(request,env.DOCUMENT_EMAIL_SECRET!), database=getD1();
  const alias=await database.prepare("SELECT * FROM document_email_aliases WHERE alias=?").bind(delivery.payload.recipient).first<EmailAlias>();
  if(!alias)throw new ApiError(403,"EMAIL_INBOX_DISABLED","This forwarding address is unavailable.");
  if(!documentEmailConfigured(env,alias.organization_id))throw new ApiError(403,"EMAIL_INBOX_DISABLED","This forwarding address is unavailable.");
  await authorizeEmailDelivery(database,alias);
  const previous=await database.prepare("SELECT * FROM document_email_deliveries WHERE id=?").bind(delivery.id)
    .first<{organization_id:string;alias_generation:string;body_sha256:string;status:string;lease_until:number}>();
  if(previous&&(previous.organization_id!==alias.organization_id||previous.alias_generation!==alias.generation||previous.body_sha256!==delivery.digest))throw new ApiError(409,"EMAIL_REPLAY_CONFLICT","This email delivery changed. No new documents were accepted.");
  if(previous?.status==="complete")return {received:true,replayed:true};
  const now=Math.floor(Date.now()/1000),lease=crypto.randomUUID();
  const claim=await database.prepare(`INSERT INTO document_email_deliveries(id,organization_id,alias_generation,body_sha256,status,lease_token,lease_until,created_at,updated_at)
    SELECT ?,?,?,?,'processing',?,?,?,? WHERE EXISTS(SELECT 1 FROM document_email_deliveries WHERE id=?) OR (SELECT count(*) FROM document_email_deliveries WHERE organization_id=? AND created_at>?)<30
    ON CONFLICT(id) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,updated_at=excluded.updated_at
    WHERE document_email_deliveries.status='processing' AND document_email_deliveries.lease_until<? AND document_email_deliveries.body_sha256=excluded.body_sha256`)
    .bind(delivery.id,alias.organization_id,alias.generation,delivery.digest,lease,now+120,now,now,delivery.id,alias.organization_id,now-3600,now).run();
  if(claim.meta.changes!==1)throw new ApiError(429,"EMAIL_BUSY","The inbox is busy. Try forwarding again later.");
  try {
    await cleanupDocumentIngests(database,getR2(),alias.organization_id);
    for(let index=0;index<delivery.files.length;index++){
      const source=await database.prepare("SELECT document_id FROM document_email_sources WHERE delivery_id=? AND attachment_index=? AND organization_id=?").bind(delivery.id,index,alias.organization_id).first();
      // A deleted original is intentionally not recreated by a replay.
      if(source)continue;
      const authorization=await authorizeEmailDelivery(database,alias);
      const leaseGuard={sql:`${authorization.guard.sql} AND EXISTS(SELECT 1 FROM document_email_deliveries WHERE id=? AND organization_id=? AND lease_token=? AND lease_until>CAST(strftime('%s','now') AS INTEGER))`,values:[...authorization.guard.values,delivery.id,alias.organization_id,lease]};
      const file=delivery.files[index];
      const stored=await quarantineDocument({database,bucket:getR2(),organizationId:alias.organization_id,authorizedByUserId:alias.authorized_by_user_id,bytes:file.bytes,fileName:file.fileName,contentType:file.contentType,documentType:"other",
        beforeCommit:async()=>{await authorizeEmailDelivery(database,alias);},guard:leaseGuard,source:{deliveryId:delivery.id,index,sender:delivery.payload.sender}});
      if(stored.status==="deletion_pending")throw new ApiError(409,"DOCUMENT_DELETION_PENDING","A matching original is being deleted. It was not recreated.");
    }
    const authorization=await authorizeEmailDelivery(database,alias);
    const finished=await database.prepare(`UPDATE document_email_deliveries SET status='complete',lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND organization_id=? AND lease_token=? AND lease_until>CAST(strftime('%s','now') AS INTEGER) AND ${authorization.guard.sql}`)
      .bind(Math.floor(Date.now()/1000),delivery.id,alias.organization_id,lease,...authorization.guard.values).run();
    if(finished.meta.changes!==1)throw new ApiError(409,"EMAIL_AUTHORIZATION_CHANGED","Receipt has not been confirmed. Refresh Documents to check what arrived.");
    return {received:true,replayed:false};
  } finally {await database.prepare("UPDATE document_email_deliveries SET lease_token=NULL,lease_until=0 WHERE id=? AND organization_id=? AND lease_token=?").bind(delivery.id,alias.organization_id,lease).run();}
}
