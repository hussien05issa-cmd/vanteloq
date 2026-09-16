import assert from "node:assert/strict";
import test from "node:test";
import { readFile,readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { receiveDocumentEmail } from "../server/document-email.ts";
import { deleteDocument } from "../server/document-deletion.ts";
import { cleanupDocumentIngests,quarantineDocument,assertDocumentIngestsDisposed } from "../server/document-ingest.ts";
import { runDocumentCleanupTick } from "../server/document-cleanup-scheduler.ts";
import { DOCUMENT_EMAIL_NOTICE_VERSION,DOCUMENT_EMAIL_PATH,documentDigest,emailSignature } from "../shared/document-email.ts";
const secret="fictional-test-secret-"+"a".repeat(44);
async function signed(recipient,sequence,content="%PDF-1.4\nFictional fixture\n%%EOF"){
  const body=JSON.stringify({version:1,recipient,sender:"unverified@example.invalid",attachments:[{fileName:"statement.pdf",contentType:"application/pdf",content:btoa(content)}]});
  const time=String(Math.floor(Date.now()/1000)),id=String(sequence).padStart(64,"0"),digest=await documentDigest(new TextEncoder().encode(body));
  return new Request(`https://vanteloq.com${DOCUMENT_EMAIL_PATH}`,{method:"POST",headers:{"X-Vanteloq-Email-Time":time,"X-Vanteloq-Email-Id":id,"X-Vanteloq-Email-Signature":await emailSignature(secret,time,id,digest)},body});
}
test("real D1 inbox delivery enforces tenant, consent, live plan, revocation, durable dedup and original deletion",{timeout:180000},async()=>{
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",d1Databases:{DB:`email-${crypto.randomUUID()}`}});
  const database=await mf.getD1Database("DB"),objects=new Map();let writes=0,onPut=null,failDelete=false;
  const bucket={put:async(key,bytes,metadata)=>{writes++;objects.set(key,{bytes,metadata});await onPut?.();},delete:async key=>{if(failDelete)throw new Error("fictional storage outage");objects.delete(key);},get:async key=>objects.get(key)};
  const old=globalThis.__vanteloqEnv;globalThis.__vanteloqEnv={DB:database,BUCKET:bucket,DOCUMENT_EMAIL_ENABLED:"true",DOCUMENT_EMAIL_VERIFIED:"true",DOCUMENT_EMAIL_SECRET:secret};
  try{
    for(const file of (await readdir(new URL("../drizzle/",import.meta.url))).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort())for(const statement of (await readFile(new URL(`../drizzle/${file}`,import.meta.url),"utf8")).split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean))await database.prepare(statement).run();
    async function seed(org,token){
      const now=Math.floor(Date.now()/1000),alias=`inbox-${token.repeat(48)}@documents.vanteloq.com`;
      await database.batch([
        database.prepare("INSERT INTO users(id,email,display_name,status,auth_subject,auth_provider,created_at,updated_at) VALUES(?,?,?,'active',?,'supabase',?,?)").bind(org,`${org}@example.invalid`,org,`subject-${org}`,now,now),
        database.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES(?,?,?,?,?,'Retail','Edmonton','Fictional','T5A1A1','[]',?,?)").bind(org,org,org,org,`${org}@example.invalid`,now,now),
        database.prepare("INSERT INTO memberships(id,user_id,organization_id,role,status,created_at,updated_at) VALUES(?,?,?,'owner','active',?,?)").bind(org,org,org,now,now),
        database.prepare("INSERT INTO tenant_subscriptions(organization_id,base_plan,billing_interval,status,version,created_at,updated_at) VALUES(?,'pro','month','active',1,?,?)").bind(org,now,now),
        database.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES(?,?,'bookloq','active',?,?)").bind(`addon-${org}`,org,now,now),
        database.prepare("INSERT INTO document_email_aliases(organization_id,alias,enabled,authorized_by_user_id,auth_subject,consent_version,consented_at,generation,created_at,updated_at) VALUES(?,?,1,?,?,?,?,?,?,?)").bind(org,alias,org,`subject-${org}`,DOCUMENT_EMAIL_NOTICE_VERSION,now,`generation-${org}`,now,now),
      ]);return alias;
    }
    const a=await seed("a","a"),b=await seed("b","b");
    const deliver=async(alias,id,content)=>receiveDocumentEmail(await signed(alias,id,content));
    globalThis.__vanteloqEnv.DOCUMENT_EMAIL_ENABLED="false";globalThis.__vanteloqEnv.DOCUMENT_EMAIL_VERIFIED="false";globalThis.__vanteloqEnv.DOCUMENT_EMAIL_VALIDATION_ORGANIZATION_ID="a";
    await assert.rejects(()=>deliver(b,19),/unavailable/);assert.equal(writes,0);
    assert.deepEqual(await deliver(a,1),{received:true,replayed:false});assert.equal(writes,1);
    globalThis.__vanteloqEnv.DOCUMENT_EMAIL_ENABLED="true";globalThis.__vanteloqEnv.DOCUMENT_EMAIL_VERIFIED="true";delete globalThis.__vanteloqEnv.DOCUMENT_EMAIL_VALIDATION_ORGANIZATION_ID;
    const original=await database.prepare("SELECT * FROM workspace_documents WHERE organization_id='a'").first();
    assert.equal(original.security_state,"quarantined");assert.equal(original.scan_status,"pending");assert.equal(original.extraction_status,"not_configured");assert.equal(original.extracted_json,"{}");assert.equal(original.uploaded_by_user_id,"a");
    assert.equal(objects.get(original.object_key).metadata.customMetadata.securityState,"awaiting-malware-provider");
    assert.deepEqual(await deliver(a,1),{received:true,replayed:true});assert.equal(writes,1);
    await assert.rejects(()=>deliver(a,1,"%PDF changed"),/delivery changed/);assert.equal(writes,1);
    await assert.rejects(()=>deliver(b,1),/delivery changed/);assert.equal(writes,1);
    await deliver(a,2);assert.equal(writes,1,"same tenant hash deduplicates a separately forwarded email");
    await deliver(b,3);assert.equal(writes,2,"identical files in distinct tenants remain separately scoped");
    await assert.rejects(()=>database.prepare("INSERT INTO document_email_sources(delivery_id,attachment_index,organization_id,document_id,sender_unverified,authorized_by_user_id,created_at) VALUES(?,1,'b',?,'fake','b',1)").bind("1".padStart(64,"0"),original.id).run(),/EMAIL_SOURCE_TENANT_MISMATCH/);
    for(const [sql,undo] of [
      ["UPDATE document_email_aliases SET enabled=0 WHERE organization_id='a'","UPDATE document_email_aliases SET enabled=1 WHERE organization_id='a'"],
      ["UPDATE document_email_aliases SET consent_version='outdated' WHERE organization_id='a'",`UPDATE document_email_aliases SET consent_version='${DOCUMENT_EMAIL_NOTICE_VERSION}' WHERE organization_id='a'`],
      ["UPDATE users SET status='suspended' WHERE id='a'","UPDATE users SET status='active' WHERE id='a'"],
      ["UPDATE users SET auth_subject='replaced-identity' WHERE id='a'","UPDATE users SET auth_subject='subject-a' WHERE id='a'"],
      ["UPDATE memberships SET role='employee' WHERE user_id='a'","UPDATE memberships SET role='owner' WHERE user_id='a'"],
      ["UPDATE tenant_subscriptions SET status='canceled' WHERE organization_id='a'","UPDATE tenant_subscriptions SET status='active' WHERE organization_id='a'"],
      ["UPDATE tenant_addons SET status='inactive' WHERE organization_id='a'","UPDATE tenant_addons SET status='active' WHERE organization_id='a'"],
    ]){await database.prepare(sql).run();await assert.rejects(()=>deliver(a,4,"%PDF should not arrive"));await database.prepare(undo).run();assert.equal(writes,2);}
    await database.prepare("UPDATE document_email_aliases SET alias=? WHERE organization_id='a'").bind(`inbox-${"c".repeat(48)}@documents.vanteloq.com`).run();await assert.rejects(()=>deliver(a,4),/unavailable/);await database.prepare("UPDATE document_email_aliases SET alias=? WHERE organization_id='a'").bind(a).run();
    onPut=async()=>{await database.prepare("UPDATE document_email_aliases SET enabled=0 WHERE organization_id='a'").run();};
    await assert.rejects(()=>deliver(a,5,"%PDF revoked while storing"));onPut=null;assert.equal(objects.size,2,"rejected commit removes its newly staged object");
    await database.prepare("UPDATE document_email_aliases SET enabled=1 WHERE organization_id='a'").run();
    const deleted=await deleteDocument({database,bucket,env:globalThis.__vanteloqEnv,organizationId:"a",documentId:original.id,actorUserId:"a"});assert.equal(deleted.deleted,true);
    assert.equal((await database.prepare("SELECT document_id FROM document_email_sources WHERE organization_id='a' LIMIT 1").first()).document_id,null);
    await deliver(a,1);assert.equal((await database.prepare("SELECT count(*) n FROM workspace_documents WHERE organization_id='a'").first()).n,0,"replayed receipt never resurrects deleted original");
    assert.equal((await database.prepare("SELECT count(*) n FROM document_email_sources WHERE organization_id='a' AND sender_unverified<>''").first()).n,0,"deletion also removes sender metadata");
    // Failure after R2 put keeps pre-reserved disposal authority even if compensating removal fails.
    failDelete=true;onPut=()=>database.prepare("UPDATE document_email_aliases SET enabled=0 WHERE organization_id='a'").run();
    await assert.rejects(()=>deliver(a,6,"%PDF failed storage disposal"));onPut=null;
    const intent=await database.prepare("SELECT * FROM document_ingest_intents WHERE organization_id='a'").first();assert.equal(intent.state,"cleanup");assert.ok(objects.has(intent.object_key));
    assert.equal((await database.prepare("SELECT count(*) n FROM workspace_documents WHERE organization_id='a'").first()).n,0);
    failDelete=false;await database.prepare("UPDATE document_ingest_intents SET lease_until=0").run();
    const tick=await runDocumentCleanupTick({database,bucket,env:globalThis.__vanteloqEnv,audit:async()=>{}});assert.equal(tick.processed,1);assert.equal(tick.counts.ingest_complete,1);assert.ok(!objects.has(intent.object_key));
    assert.equal((await database.prepare("SELECT count(*) n FROM document_ingest_intents").first()).n,0);
    await database.prepare("UPDATE document_email_aliases SET enabled=1 WHERE organization_id='a'").run();
    // Real D1 trigger failure must roll back the original and its receipt together.
    await database.prepare("CREATE TRIGGER fixture_receipt_failure BEFORE INSERT ON document_email_sources WHEN NEW.delivery_id='0000000000000000000000000000000000000000000000000000000000000007' BEGIN SELECT RAISE(ABORT,'FICTIONAL_RECEIPT_FAILURE'); END").run();
    await assert.rejects(()=>deliver(a,7,"%PDF atomic receipt fixture"),/FICTIONAL_RECEIPT_FAILURE/);
    assert.equal((await database.prepare("SELECT count(*) n FROM workspace_documents WHERE organization_id='a'").first()).n,0);assert.equal(objects.size,1);
    await database.prepare("DROP TRIGGER fixture_receipt_failure").run();await deliver(a,7,"%PDF atomic receipt fixture");
    const atomic=await database.prepare("SELECT id FROM workspace_documents WHERE organization_id='a'").first();await deleteDocument({database,bucket,env:globalThis.__vanteloqEnv,organizationId:"a",documentId:atomic.id,actorUserId:"a"});
    await deliver(a,7,"%PDF atomic receipt fixture");assert.equal((await database.prepare("SELECT count(*) n FROM workspace_documents WHERE organization_id='a'").first()).n,0);
    // Expiring a lease after storage but before the transaction cannot commit a receipt or original.
    onPut=()=>database.prepare("UPDATE document_email_deliveries SET lease_until=0 WHERE id=?").bind("11".padStart(64,"0")).run();
    await assert.rejects(()=>deliver(a,11,"%PDF expired lease fixture"),/authorization changed/);onPut=null;
    assert.equal((await database.prepare("SELECT count(*) n FROM workspace_documents WHERE organization_id='a'").first()).n,0);
    // Unknown interrupted writes never become safe to delete solely because they are old.
    const heldId=crypto.randomUUID(),heldKey=`a/documents/quarantine/${heldId}.pdf`;objects.set(heldKey,{});
    await database.prepare("INSERT INTO document_ingest_intents(id,organization_id,object_key,sha256_hex,state,created_at) VALUES(?,?,?,?,'writing',1)").bind(heldId,"a",heldKey,"f".repeat(64)).run();
    assert.equal((await cleanupDocumentIngests(database,bucket,"a")).processed,0);assert.ok(objects.has(heldKey));
    await assert.rejects(()=>assertDocumentIngestsDisposed(database,bucket,"a"),/Workspace deletion is not complete/);assert.ok(objects.has(heldKey));
    // An operator can release an interrupted hold only after confirming the writer stopped.
    await database.prepare("UPDATE document_ingest_intents SET state='cleanup' WHERE id=?").bind(heldId).run();
    await cleanupDocumentIngests(database,bucket,"a");assert.ok(!objects.has(heldKey));
    // If D1 disappears after storage, the reference reserved before R2 still survives.
    let outage=false;
    const offline=new Proxy(database,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==="function"?(...args)=>{if(outage)throw new Error("FICTIONAL_D1_OUTAGE");return value.apply(target,args);}:value;}});
    globalThis.__vanteloqEnv.DB=offline;onPut=()=>{outage=true;};
    await assert.rejects(()=>deliver(a,12,"%PDF database outage fixture"));outage=false;onPut=null;globalThis.__vanteloqEnv.DB=database;
    const interrupted=await database.prepare("SELECT * FROM document_ingest_intents WHERE organization_id='a'").first();assert.equal(interrupted.state,"writing");assert.ok(objects.has(interrupted.object_key));
    await assert.rejects(()=>assertDocumentIngestsDisposed(database,bucket,"a"),/not complete/);
    await database.prepare("UPDATE document_ingest_intents SET state='cleanup' WHERE id=?").bind(interrupted.id).run();await cleanupDocumentIngests(database,bucket,"a");assert.ok(!objects.has(interrupted.object_key));
    await database.prepare("INSERT INTO account_deletion_jobs(id,account_hash,organization_id,user_id,scope,token_hash,plan_encrypted,stage,created_at,expires_at) VALUES('fixture-delete','fixture-hash','a','a','workspace','fixture-token','fixture-plan','confirmed',1,9999999999)").run();
    const beforeDeleteGuard=writes;
    await assert.rejects(()=>quarantineDocument({database,bucket,organizationId:"a",authorizedByUserId:"a",bytes:new TextEncoder().encode("%PDF cannot arrive after deletion"),fileName:"manual.pdf",contentType:"application/pdf",documentType:"other"}),/authorization changed/);
    assert.equal(writes,beforeDeleteGuard);assert.equal((await database.prepare("SELECT count(*) n FROM document_ingest_intents").first()).n,0);
    await database.prepare("DELETE FROM account_deletion_jobs WHERE id='fixture-delete'").run();
    // Lease excludes simultaneous delivery; an expired same delivery can retry at the quota ceiling.
    let unblock;const pause=new Promise(resolve=>{unblock=resolve;});let entered;const started=new Promise(resolve=>{entered=resolve;});
    onPut=async()=>{entered();await pause;};const first=deliver(a,8,"%PDF concurrent fixture");await started;
    await assert.rejects(()=>deliver(a,8,"%PDF concurrent fixture"),/busy/);unblock();await first;onPut=null;
    const request=await signed(a,9,"%PDF retry quota fixture"),body=await request.clone().text(),now=Math.floor(Date.now()/1000);
    await database.prepare("INSERT INTO document_email_deliveries(id,organization_id,alias_generation,body_sha256,status,lease_until,created_at,updated_at) VALUES(?,'a','generation-a',?,'processing',0,?,?)").bind("9".padStart(64,"0"),await documentDigest(new TextEncoder().encode(body)),now,now).run();
    for(let n=100;n<130;n++)await database.prepare("INSERT INTO document_email_deliveries(id,organization_id,alias_generation,body_sha256,status,created_at,updated_at) VALUES(?,'a','generation-a','f','complete',?,?)").bind(String(n).padStart(64,"0"),now,now).run();
    assert.equal((await receiveDocumentEmail(request)).received,true);await assert.rejects(()=>deliver(a,10,"%PDF quota exceeded"),/busy/);
    // Tenant removal must not erase the only reference to a failed private object.
    const orphanId=crypto.randomUUID(),orphanKey=`b/documents/quarantine/${orphanId}.pdf`;objects.set(orphanKey,{});
    await database.prepare("INSERT INTO document_ingest_intents(id,organization_id,object_key,sha256_hex,state,created_at) VALUES(?,'b',?,?,'cleanup',1)").bind(orphanId,orphanKey,"e".repeat(64)).run();
    await database.prepare("DELETE FROM workspaces WHERE id='b'").run();assert.ok(await database.prepare("SELECT 1 FROM document_ingest_intents WHERE id=?").bind(orphanId).first());
    await cleanupDocumentIngests(database,bucket);assert.ok(!objects.has(orphanKey));assert.equal((await database.prepare("SELECT count(*) n FROM document_ingest_intents").first()).n,0);
  }finally{globalThis.__vanteloqEnv=old;await mf.dispose();}
});
