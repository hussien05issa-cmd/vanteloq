import { ApiError } from "./api.ts";
import { documentFileType, documentFileName, documentDigest } from "../shared/document-email.ts";

export const safeName = documentFileName;
export const sha256 = documentDigest;
export function verifiedType(bytes: Uint8Array, declared: string) {
  const result = documentFileType(bytes, declared);
  if (!result) throw new ApiError(400, "UNSUPPORTED_DOCUMENT", "Upload a verified PDF, JPEG, PNG or WEBP file. HEIC and TIFF remain disabled until their conversion and malware-scanning pipeline is configured.");
  return result;
}
type IngestInput = {
  database: D1Database; bucket: R2Bucket; organizationId: string; authorizedByUserId: string;
  bytes: Uint8Array; fileName: string; contentType: string; documentType: string;
  beforeCommit?: () => Promise<void>; guard?: { sql: string; values: (string | number | null)[] };
  source?: {deliveryId:string;index:number;sender:string};
};
type Existing = {id:string;fileName:string;status:string};

/** Only cleans failed writes known to have returned. Interrupted writes require operator review. */
export async function cleanupDocumentIngests(database:D1Database,bucket:R2Bucket,organizationId?:string,limit=3) {
  const now=Math.floor(Date.now()/1000);
  const rows=await database.prepare(`SELECT id,organization_id,object_key FROM document_ingest_intents WHERE state='cleanup' AND lease_until<=? ${organizationId?"AND organization_id=?":""} ORDER BY created_at,id LIMIT ?`)
    .bind(now,...(organizationId?[organizationId]:[]),Math.max(0,Math.min(3,limit))).all<{id:string;organization_id:string;object_key:string}>();
  const counts={complete:0,retrying:0,attention:0};
  for(const row of rows.results??[]){
    const prefix=`${row.organization_id}/documents/quarantine/${row.id}.`;
    if(!row.object_key.startsWith(prefix)||!["pdf","jpg","png","webp"].includes(row.object_key.slice(prefix.length))){counts.attention++;continue;}
    const lease=crypto.randomUUID();
    const claim=await database.prepare("UPDATE document_ingest_intents SET lease_token=?,lease_until=? WHERE id=? AND state='cleanup' AND lease_until<=?").bind(lease,now+120,row.id,now).run();
    if(claim.meta.changes!==1)continue;
    try{
      // Never delete an original whose transaction committed but response was interrupted.
      const committed=await database.prepare("SELECT 1 FROM workspace_documents WHERE id=? AND organization_id=? AND object_key=?").bind(row.id,row.organization_id,row.object_key).first();
      if(committed){counts.attention++;continue;}
      await bucket.delete(row.object_key);
      await database.prepare("DELETE FROM document_ingest_intents WHERE id=? AND state='cleanup' AND lease_token=?").bind(row.id,lease).run();
      counts.complete++;
    }catch{counts.retrying++;}
    finally{await database.prepare("UPDATE document_ingest_intents SET lease_token=NULL,lease_until=? WHERE id=? AND lease_token=?").bind(now+300,row.id,lease).run();}
  }
  return {processed:(rows.results??[]).length,counts};
}

function sourceStatement(input:IngestInput,documentId:string,now:number,duplicate:boolean){
  const source=input.source!;
  const documentSql="SELECT id FROM workspace_documents WHERE id=? AND organization_id=? AND status<>'deletion_pending'";
  // A duplicate deleted concurrently leaves a receipt tombstone, never a resurrected original.
  return input.database.prepare(`INSERT INTO document_email_sources(delivery_id,attachment_index,organization_id,document_id,sender_unverified,authorized_by_user_id,created_at)
    SELECT ?,?,?,(${documentSql}),CASE WHEN EXISTS(${documentSql}) THEN ? ELSE '' END,?,?
    WHERE ${input.guard?.sql??"1"} ${duplicate?"ON CONFLICT(delivery_id,attachment_index) DO NOTHING":""}`)
    .bind(source.deliveryId,source.index,input.organizationId,documentId,input.organizationId,documentId,input.organizationId,source.sender,input.authorizedByUserId,now,...(input.guard?.values??[]));
}
async function recordDuplicate(input:IngestInput,existing:Existing,digest:string){
  await input.beforeCommit?.();
  if(input.source){
    const result=await sourceStatement(input,existing.id,Math.floor(Date.now()/1000),true).run();
    if(result.meta.changes!==1){
      const receipt=await input.database.prepare("SELECT 1 FROM document_email_sources WHERE delivery_id=? AND attachment_index=? AND organization_id=?").bind(input.source.deliveryId,input.source.index,input.organizationId).first();
      if(!receipt)throw new ApiError(409,"EMAIL_AUTHORIZATION_CHANGED","The forwarding authorization changed. This attachment was not accepted.");
    }
  }
  return {...existing,duplicate:true,sha256:digest};
}

/** Workspace erasure must not declare completion while a late writer can still create an object. */
export async function assertDocumentIngestsDisposed(database:D1Database,bucket:R2Bucket,organizationId:string){
  await cleanupDocumentIngests(database,bucket,organizationId);
  const pending=await database.prepare("SELECT 1 FROM document_ingest_intents WHERE organization_id=? LIMIT 1").bind(organizationId).first();
  if(pending)throw new ApiError(409,"DELETION_FILES_PENDING","An incomplete upload still needs storage cleanup or support review. Workspace deletion is not complete.");
}

/** Reserve disposal authority before R2, then atomically commit document and email provenance. */
export async function quarantineDocument(input:IngestInput){
  input={...input,guard:{sql:`NOT EXISTS(SELECT 1 FROM account_deletion_jobs WHERE stage IN('confirmed','local_deleted') AND (user_id=? OR (scope='workspace' AND organization_id=?))) AND (${input.guard?.sql??"1"})`,values:[input.authorizedByUserId,input.organizationId,...(input.guard?.values??[])]}};
  if(!input.bytes.length||input.bytes.length>10*1024*1024)throw new ApiError(400,"INVALID_FILE","Choose a document up to 10 MB.");
  const verified=verifiedType(input.bytes,input.contentType),digest=await sha256(input.bytes);
  const findExisting=()=>input.database.prepare("SELECT id,file_name fileName,status FROM workspace_documents WHERE organization_id=? AND sha256_hex=?").bind(input.organizationId,digest).first<Existing>();
  const existing=await findExisting();if(existing)return recordDuplicate(input,existing,digest);
  const pending=await input.database.prepare("SELECT 1 FROM document_ingest_intents WHERE organization_id=? AND sha256_hex=?").bind(input.organizationId,digest).first();
  if(pending)throw new ApiError(409,"DOCUMENT_INGEST_PENDING","An earlier upload needs cleanup or review. Refresh Documents before retrying.");
  const id=crypto.randomUUID(),objectKey=`${input.organizationId}/documents/quarantine/${id}.${verified.extension}`,now=Math.floor(Date.now()/1000);
  await input.beforeCommit?.();
  const reserved=await input.database.prepare(`INSERT INTO document_ingest_intents(id,organization_id,object_key,sha256_hex,state,created_at,lease_until) SELECT ?,?,?,?,'writing',?,0 WHERE ${input.guard?.sql??"1"}`)
    .bind(id,input.organizationId,objectKey,digest,now,...(input.guard?.values??[])).run();
  if(reserved.meta.changes!==1)throw new ApiError(409,"EMAIL_AUTHORIZATION_CHANGED","The forwarding authorization changed. This attachment was not accepted.");
  try{
    await input.bucket.put(objectKey,new Uint8Array(input.bytes).buffer,{httpMetadata:{contentType:verified.type,cacheControl:"private, no-store"},customMetadata:{organizationId:input.organizationId,uploadedBy:input.authorizedByUserId,securityState:"awaiting-malware-provider"}});
    await input.beforeCommit?.();
    const insert=input.database.prepare(`INSERT INTO workspace_documents
      (id,organization_id,document_type,file_name,object_key,content_type,size_bytes,sha256_hex,security_state,status,scan_status,extraction_status,extracted_json,uploaded_by_user_id,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,'quarantined','review_required','pending','not_configured','{}',?,?,?
      WHERE EXISTS(SELECT 1 FROM document_ingest_intents WHERE id=? AND state='writing') AND ${input.guard?.sql??"1"}`)
      .bind(id,input.organizationId,input.documentType,safeName(input.fileName),objectKey,verified.type,input.bytes.length,digest,input.authorizedByUserId,now,now,id,...(input.guard?.values??[]));
    const remove=input.database.prepare(`DELETE FROM document_ingest_intents WHERE id=? AND EXISTS(SELECT 1 FROM workspace_documents WHERE id=? AND organization_id=?) ${input.source?"AND EXISTS(SELECT 1 FROM document_email_sources WHERE delivery_id=? AND attachment_index=? AND document_id=?)":""}`)
      .bind(id,id,input.organizationId,...(input.source?[input.source.deliveryId,input.source.index,id]:[]));
    const batch=await input.database.batch([insert,...(input.source?[sourceStatement(input,id,now,false)]:[]),remove]);
    if(batch[0].meta.changes!==1||batch.at(-1)!.meta.changes!==1)throw new ApiError(409,"EMAIL_AUTHORIZATION_CHANGED","The forwarding authorization changed. This attachment was not accepted.");
    return {id,fileName:safeName(input.fileName),status:"review_required",duplicate:false,sha256:digest};
  }catch(error){
    // A database outage still leaves the pre-write reference intact. Unknown writes are not aged out.
    try{await input.database.prepare("UPDATE document_ingest_intents SET state='cleanup' WHERE id=? AND state='writing'").bind(id).run();await cleanupDocumentIngests(input.database,input.bucket,input.organizationId);}catch{}
    const duplicate=await findExisting().catch(()=>null);
    if(duplicate&&duplicate.id!==id)return recordDuplicate(input,duplicate,digest);
    throw error;
  }
}
