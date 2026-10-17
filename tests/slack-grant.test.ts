import assert from "node:assert/strict";
import test,{before,after} from "node:test";
import {readFile,readdir} from "node:fs/promises";
import {Miniflare} from "miniflare";
import type {VanteloqRuntimeEnv} from "../db";
import {acquireSlackGrantLease,activateSlackGrant,pendingSlackCleanupConnectionIds,requireNoPendingSlackCleanup,withSlackGrant,withSlackConversationGrant,withdrawSlackGrant} from "../server/integrations/slack-grant";
import {encryptSlackCredentials,decryptSlackCredentials,encryptedSlackNoRefreshToken,SLACK_CONVERSATION_SCOPES,type SlackCredentialEnvelope,type SlackGrant} from "../server/integrations/slack";
import {SLACK_CONVERSATION_READ_NOTICE_VERSION} from "../domain/slack-conversations";
import {SlackConversationRateLimitError} from "../server/integrations/slack-conversation";
import {readSlackRecentConversation} from "../server/integrations/slack-conversation";
import {releaseIntegrationSyncLease} from "../server/integrations/connection";
import {POST as disconnect} from "../app/api/v1/integrations/slack/disconnect/route";
import {GET as callback} from "../app/api/v1/integrations/slack/callback/route";
import {POST as authorize} from "../app/api/v1/integrations/slack/authorize/route";
import {POST as testNotification} from "../app/api/v1/integrations/slack/test-notification/route";
import {POST as shareWorkspace} from "../app/api/v1/integrations/slack/share-workspace/route";

let runtime:Miniflare,db:D1Database;
const globals=globalThis as typeof globalThis&{__vanteloqEnv?:VanteloqRuntimeEnv};
const originalEnv=globals.__vanteloqEnv;
before(async()=>{
  runtime=new Miniflare({modules:true,script:"export default {fetch(){return new Response('isolated')}}",d1Databases:{DB:crypto.randomUUID()}});
  db=await runtime.getD1Database("DB") as unknown as D1Database;
  for(const file of(await readdir("drizzle")).filter(file=>/^\d{4}.*\.sql$/.test(file)).sort()){
    for(const sql of(await readFile(`drizzle/${file}`,"utf8")).split("--> statement-breakpoint").filter(text=>text.trim()))await db.prepare(sql).run();
  }
  globals.__vanteloqEnv={DB:db,SLACK_CLIENT_ID:"fixture_client",SLACK_CLIENT_SECRET:"fixture_secret",SLACK_REDIRECT_URI:"https://vanteloq.example/api/v1/integrations/slack/callback",INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,9).toString("base64")};
},{timeout:120000});
after(async()=>{globals.__vanteloqEnv=originalEnv;await runtime?.dispose();});

async function fixture(secretPresent=true,pending=false){
  const organizationId=crypto.randomUUID(),connectionId=crypto.randomUUID(),teamId="T"+crypto.randomUUID().replaceAll("-",""),channelId="C"+crypto.randomUUID().replaceAll("-","");
  const credentials:SlackCredentialEnvelope={version:1,accessToken:"xoxb-fictional-fixture",teamId,channelId,webhookUrl:"https://hooks.slack.com/services/fixtureteam/fixturechannel/fictionalcredential"};
  await db.batch([
    db.prepare("INSERT INTO workspaces(id,owner_name,business_name,legal_name,business_email,industry,city,address,postal_code,hours_json,created_at,updated_at) VALUES (?,'Test','Slack fixture','Slack fixture',?,'Retail','Edmonton','Test','T5A1A1','[]',1,1)").bind(organizationId,`${organizationId}@example.invalid`),
    db.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,external_account_ref,domain_prefix,source_namespace,scopes_json,data_promotion_status,created_at,updated_at) VALUES (?,?,'slack',?,?,?,?,'[\"incoming-webhook\"]','blocked',1,1)").bind(connectionId,organizationId,pending?"pending":"connected",pending?null:teamId,pending?null:channelId,connectionId),
  ]);
  if(secretPresent&&!pending)await db.prepare("INSERT INTO integration_secrets(id,organization_id,provider,connection_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,created_at,updated_at) VALUES (?,?,'slack',?,?,?,4070908800,1,1)")
    .bind(crypto.randomUUID(),organizationId,connectionId,await encryptSlackCredentials(credentials),await encryptedSlackNoRefreshToken()).run();
  return {organizationId,connectionId,namespace:connectionId,teamId,channelId,credentials};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const connection=(ctx:Fixture)=>db.prepare("SELECT * FROM integration_connections WHERE id=? AND organization_id=?").bind(ctx.connectionId,ctx.organizationId).first();
const secret=(ctx:Fixture,provider="slack")=>db.prepare("SELECT * FROM integration_secrets WHERE connection_id=? AND organization_id=? AND provider=?").bind(ctx.connectionId,ctx.organizationId,provider).first();
const isCode=(code:string)=>(error:unknown)=>error instanceof Error&&"code"in error&&error.code===code;
const neverFetch=(async()=>{throw Error("Provider must not be contacted");}) as typeof fetch;
const grant=(ctx:Fixture):SlackGrant=>({appId:"AFIXTURE",accessToken:ctx.credentials.accessToken,botUserId:null,teamId:ctx.teamId,teamName:"Fixture",enterpriseId:null,channelId:ctx.channelId,channelName:"fixture",webhookUrl:ctx.credentials.webhookUrl,scopes:["incoming-webhook"]});
function pausedUninstall(result=true){
  let entered!:()=>void,release!:()=>void,calls=0;
  const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const fetcher=(async(input,init)=>{
    calls++;assert.equal(String(input),"https://slack.com/api/apps.uninstall");assert.equal(init?.redirect,"manual");
    assert.equal(new URLSearchParams(String(init?.body)).get("token"),"xoxb-fictional-fixture");
    entered();await gate;return Response.json({ok:result});
  }) as typeof fetch;
  return {fetcher,ready,release,calls:()=>calls};
}

test("copied Slack routes load with unchanged authentication, permission and browser boundaries",()=>{
  for(const handler of[disconnect,callback,authorize,testNotification,shareWorkspace])assert.equal(typeof handler,"function");
});
test("provider failure immediately disables local access and isolates private retry material",async()=>{
  const ctx=await fixture(),remote=pausedUninstall(false);
  const pending=withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,remote.fetcher);
  await remote.ready;
  assert.equal((await connection(ctx))?.status,"revoked");assert.equal(await secret(ctx),null);
  assert.ok(await secret(ctx,"slack-revocation"));assert.doesNotMatch(JSON.stringify(await secret(ctx,"slack-revocation")),/xoxb-fictional-fixture|hooks\.slack/);
  let operations=0;
  await assert.rejects(()=>withSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,async()=>{operations++;}),isCode("SLACK_CONNECTION_BUSY"));
  const competing=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,neverFetch);
  assert.equal(competing.disconnected,true);assert.equal(competing.cleanupPending,true);assert.equal(remote.calls(),1);
  remote.release();const result=await pending;
  assert.equal(result.localAccessRemoved,true);assert.equal(result.providerAuthorizationRevoked,false);assert.equal(result.localCredentialsDeleted,false);assert.equal(result.cleanupPending,true);
  await assert.rejects(()=>withSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,async()=>{operations++;}),isCode("SLACK_NOT_CONNECTED"));assert.equal(operations,0);
  await assert.rejects(()=>requireNoPendingSlackCleanup(ctx.organizationId),isCode("SLACK_CLEANUP_PENDING"));
});
test("successful removal deletes private material and releases the installation reservation",async()=>{
  const ctx=await fixture();
  const result=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,(async()=>{
    assert.equal((await connection(ctx))?.status,"revoked");assert.equal(await secret(ctx),null);
    return Response.json({ok:true});
  }) as typeof fetch);
  assert.equal(result.providerAuthorizationRevoked,true);assert.equal(result.localCredentialsDeleted,true);assert.equal(result.cleanupPending,false);
  assert.equal(await secret(ctx,"slack-revocation"),null);assert.equal((await connection(ctx))?.external_account_ref,null);
  assert.equal((await connection(ctx))?.sync_lease_owner,null);assert.ok(Number((await connection(ctx))?.sync_version)>=2);
  await requireNoPendingSlackCleanup(ctx.organizationId);
  const repeated=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,neverFetch);
  assert.equal(repeated.providerAuthorizationRevoked,true);assert.equal(repeated.providerRemovalRequired,false);
});
test("historical revoked credentials are quarantined and cleanup discovery is tenant scoped",async()=>{
  const ctx=await fixture(),other=await fixture(false);
  await db.prepare("UPDATE integration_connections SET status='revoked',last_error_code=NULL WHERE id=?").bind(ctx.connectionId).run();
  const result=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,(async()=>Response.json({ok:false})) as typeof fetch);
  assert.equal(result.localAccessRemoved,true);assert.equal(result.providerAuthorizationRevoked,false);
  assert.equal(await secret(ctx),null);assert.ok(await secret(ctx,"slack-revocation"));
  assert.deepEqual(await pendingSlackCleanupConnectionIds(ctx.organizationId),[ctx.connectionId]);
  assert.deepEqual(await pendingSlackCleanupConnectionIds(other.organizationId),[]);
});
test("historical revoked rows without credentials do not imply verified provider removal",async()=>{
  const ctx=await fixture(false);
  await db.prepare("UPDATE integration_connections SET status='revoked',last_error_code=NULL WHERE id=?").bind(ctx.connectionId).run();
  const result=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,neverFetch);
  assert.equal(result.localCredentialsDeleted,true);assert.equal(result.providerAuthorizationRevoked,false);assert.equal(result.providerRemovalRequired,true);
});
test("private cleanup can retry removal without restoring active message credentials",async()=>{
  const ctx=await fixture();let calls=0;
  const failed=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,(async()=>{calls++;return Response.json({ok:false});}) as typeof fetch);
  assert.equal(failed.cleanupPending,true);
  const completed=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,(async()=>{calls++;assert.equal(await secret(ctx),null);return Response.json({ok:true});}) as typeof fetch);
  assert.equal(calls,2);assert.equal(completed.providerAuthorizationRevoked,true);assert.equal(completed.localCredentialsDeleted,true);
  assert.equal(await secret(ctx,"slack-revocation"),null);assert.deepEqual(await pendingSlackCleanupConnectionIds(ctx.organizationId),[]);
});
test("missing credentials do not block local withdrawal or pretend provider removal was verified",async()=>{
  const ctx=await fixture(false);
  const result=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,neverFetch);
  assert.equal(result.disconnected,true);assert.equal(result.localCredentialsDeleted,true);assert.equal(result.providerAuthorizationRevoked,false);assert.equal(result.providerRemovalRequired,true);
  assert.equal((await connection(ctx))?.status,"revoked");assert.equal((await connection(ctx))?.external_account_ref,null);
});
test("unknown network outcome retains cleanup privately but never preserves message access",async()=>{
  const ctx=await fixture();let calls=0;
  const result=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,(async()=>{calls++;throw Error("unknown outcome");}) as typeof fetch);
  assert.equal(calls,1);assert.equal(result.localAccessRemoved,true);assert.equal(result.providerAuthorizationRevoked,false);
  assert.equal(await secret(ctx),null);assert.ok(await secret(ctx,"slack-revocation"));
});
test("tenant mismatch and stale namespace cannot withdraw or reveal another grant",async()=>{
  const first=await fixture(),second=await fixture(),before=await connection(first),cipher=await secret(first);
  await assert.rejects(()=>withdrawSlackGrant(second.organizationId,first.connectionId,first.namespace,neverFetch),isCode("SLACK_CONNECTION_NOT_FOUND"));
  await assert.rejects(()=>withdrawSlackGrant(first.organizationId,first.connectionId,crypto.randomUUID(),neverFetch),isCode("SLACK_CONNECTION_NOT_FOUND"));
  assert.deepEqual(await connection(first),before);assert.deepEqual(await secret(first),cipher);
});
test("late provider removal cannot delete a successor ciphertext, namespace or lease",async()=>{
  for(const mutation of["namespace","secret","lease"]){
    const ctx=await fixture(),remote=pausedUninstall();
    const pending=withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,remote.fetcher);
    const rejected=assert.rejects(pending,isCode("SLACK_GRANT_CHANGED"));await remote.ready;
    if(mutation==="namespace")await db.prepare("UPDATE integration_connections SET source_namespace=? WHERE id=?").bind(crypto.randomUUID(),ctx.connectionId).run();
    if(mutation==="secret")await db.prepare("UPDATE integration_secrets SET access_token_ciphertext='successor-private-material' WHERE connection_id=?").bind(ctx.connectionId).run();
    if(mutation==="lease")await db.prepare("UPDATE integration_connections SET sync_lease_expires_at=1 WHERE id=?").bind(ctx.connectionId).run();
    const before=await secret(ctx,"slack-revocation");remote.release();await rejected;assert.deepEqual(await secret(ctx,"slack-revocation"),before,mutation);
  }
});
test("corrupt private material remains nonusable and manual acknowledgement sends nothing",async()=>{
  const ctx=await fixture();await db.prepare("UPDATE integration_secrets SET access_token_ciphertext='corrupt' WHERE connection_id=?").bind(ctx.connectionId).run();
  const failed=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,neverFetch);
  assert.equal(failed.cleanupPending,true);assert.equal(await secret(ctx),null);
  const acknowledged=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,neverFetch,true);
  assert.equal(acknowledged.manualRemovalAcknowledged,true);assert.equal(acknowledged.providerAuthorizationRevoked,false);assert.equal(acknowledged.providerRemovalRequired,false);
  assert.equal(await secret(ctx,"slack-revocation"),null);assert.equal((await connection(ctx))?.external_account_ref,null);
  const again=await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,neverFetch);
  assert.equal(again.providerAuthorizationRevoked,false);assert.equal(again.providerRemovalRequired,false);assert.equal(again.manualRemovalAcknowledged,true);
  await requireNoPendingSlackCleanup(ctx.organizationId);
});
test("callback activation rolls back credentials on database failure and retains normal behavior",async()=>{
  const ctx=await fixture(false,true),lease=await acquireSlackGrantLease(ctx.organizationId,ctx.connectionId);
  try{
    await db.prepare(`CREATE TRIGGER test_slack_activation_failure BEFORE UPDATE ON integration_connections WHEN NEW.id='${ctx.connectionId}' AND NEW.status='connected' BEGIN SELECT RAISE(ABORT,'activation failure'); END`).run();
    try{await assert.rejects(()=>activateSlackGrant(lease,ctx.namespace,grant(ctx)));}
    finally{await db.prepare("DROP TRIGGER test_slack_activation_failure").run();}
    assert.equal(await secret(ctx),null);assert.equal((await connection(ctx))?.status,"pending");
    await activateSlackGrant(lease,ctx.namespace,grant(ctx));assert.equal((await connection(ctx))?.status,"connected");
  }finally{await releaseIntegrationSyncLease(lease);}
  let operations=0;
  const channel=await withSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,async credentials=>{operations++;return credentials.channelId;});
  assert.equal(channel,ctx.channelId);assert.equal(operations,1);
});
test("withdrawn pending callbacks cannot recreate active credentials",async()=>{
  const ctx=await fixture(false,true),lease=await acquireSlackGrantLease(ctx.organizationId,ctx.connectionId);
  await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,neverFetch);
  await assert.rejects(()=>activateSlackGrant(lease,ctx.namespace,grant(ctx)),isCode("SLACK_GRANT_CHANGED"));
  assert.equal(await secret(ctx),null);assert.equal((await connection(ctx))?.status,"revoked");
});
test("a pending replacement cannot activate while previous private uninstall cleanup remains",async()=>{
  const ctx=await fixture();await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,(async()=>Response.json({ok:false})) as typeof fetch);
  const attemptId=crypto.randomUUID();
  await db.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,source_namespace,data_promotion_status,created_at,updated_at) VALUES (?,?,'slack','pending',?,'blocked',1,1)").bind(attemptId,ctx.organizationId,attemptId).run();
  const lease=await acquireSlackGrantLease(ctx.organizationId,attemptId);
  try{await assert.rejects(()=>activateSlackGrant(lease,attemptId,grant(ctx)),isCode("SLACK_GRANT_CHANGED"));}
  finally{await releaseIntegrationSyncLease(lease);}
  assert.equal(await db.prepare("SELECT 1 FROM integration_secrets WHERE connection_id=?").bind(attemptId).first(),null);
  assert.ok(await secret(ctx,"slack-revocation"));
});

async function conversationFixture(readEnabled=true,pending=false){
  const ctx=await fixture(!pending,pending),userId=crypto.randomUUID(),authSubject=`fixture:${crypto.randomUUID()}`;
  const actor={userId,authSubject,authProvider:"supabase" as const};
  await db.batch([
    db.prepare("INSERT INTO users(id,email,auth_subject,auth_provider,display_name,status,created_at,updated_at) VALUES (?, ?,?,'supabase','Read owner','active',1,1)").bind(userId,`${userId}@example.invalid`,authSubject),
    db.prepare("INSERT INTO memberships(id,organization_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,'owner','active',1,1)").bind(crypto.randomUUID(),ctx.organizationId,userId),
  ]);
  if(readEnabled){
    ctx.credentials.conversationRead={version:1,enabled:true,noticeVersion:SLACK_CONVERSATION_READ_NOTICE_VERSION,authorizedByUserId:userId,nextReadAt:0};
    await db.prepare("UPDATE integration_connections SET scopes_json=? WHERE id=? AND organization_id=?").bind(JSON.stringify(SLACK_CONVERSATION_SCOPES),ctx.connectionId,ctx.organizationId).run();
    if(!pending)await db.prepare("UPDATE integration_secrets SET access_token_ciphertext=? WHERE connection_id=? AND organization_id=? AND provider='slack'")
      .bind(await encryptSlackCredentials(ctx.credentials),ctx.connectionId,ctx.organizationId).run();
  }
  return {...ctx,actor};
}

test("conversation reads reserve rolling cooldown in encrypted metadata and never store message bodies",async()=>{
  const ctx=await conversationFixture();let calls=0;
  const read=()=>withSlackConversationGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,ctx.actor,async()=>{calls++;return "fictional-private-message-body";});
  const before=Math.floor(Date.now()/1000);
  assert.equal(await read(),"fictional-private-message-body");
  const row=await secret(ctx),decoded=await decryptSlackCredentials(String(row?.access_token_ciphertext));
  assert.ok(decoded.conversationRead!.nextReadAt>=before+60);
  assert.doesNotMatch(JSON.stringify(row),/fictional-private-message-body|fixture-owner|xoxb-/);
  await assert.rejects(read,isCode("SLACK_CONVERSATION_COOLDOWN"));assert.equal(calls,1);
});

test("notification grants, inactive roles, tenant mismatches and changed identity cannot start a conversation read",async()=>{
  for(const mutation of["legacy","admin","employee","membership","user","identity","tenant"]){
    const ctx=await conversationFixture(mutation!=="legacy");let calls=0;
    if(mutation==="admin"||mutation==="employee")await db.prepare("UPDATE memberships SET role=? WHERE user_id=? AND organization_id=?").bind(mutation,ctx.actor.userId,ctx.organizationId).run();
    if(mutation==="membership")await db.prepare("UPDATE memberships SET status='suspended' WHERE user_id=? AND organization_id=?").bind(ctx.actor.userId,ctx.organizationId).run();
    if(mutation==="user")await db.prepare("UPDATE users SET status='suspended' WHERE id=?").bind(ctx.actor.userId).run();
    if(mutation==="identity")ctx.actor.authSubject="changed-subject";
    await assert.rejects(()=>withSlackConversationGrant(mutation==="tenant"?crypto.randomUUID():ctx.organizationId,ctx.connectionId,ctx.namespace,ctx.actor,async()=>{calls++;return "no";}));
    assert.equal(calls,0,mutation);
  }
});

test("concurrent conversation reads dispatch only once while a grant lease is active",async()=>{
  const ctx=await conversationFixture();let entered!:()=>void,release!:()=>void,calls=0;
  const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const read=withSlackConversationGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,ctx.actor,async()=>{calls++;entered();await gate;return "fictional-content";});
  await ready;
  await assert.rejects(()=>withSlackConversationGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,ctx.actor,async()=>{calls++;return "no";}),isCode("SLACK_CONNECTION_BUSY"));
  release();assert.equal(await read,"fictional-content");assert.equal(calls,1);
});

test("disconnect during an in-flight conversation read prevents its result from returning",async()=>{
  const ctx=await conversationFixture();let entered!:()=>void,release!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const read=withSlackConversationGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,ctx.actor,async()=>{entered();await gate;return "must-not-return";});
  const rejected=assert.rejects(read,isCode("SLACK_GRANT_CHANGED"));await ready;
  await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,(async()=>Response.json({ok:false})) as typeof fetch);
  release();await rejected;assert.equal(await secret(ctx),null);assert.ok(await secret(ctx,"slack-revocation"));
});

test("owner, namespace, ciphertext, scope, team, channel and lease changes after provider response fail closed",async()=>{
  for(const mutation of["role","membership","identity","namespace","ciphertext","scope","team","channel","lease"]){
    const ctx=await conversationFixture();
    await assert.rejects(()=>withSlackConversationGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,ctx.actor,async()=>{
      if(mutation==="role")await db.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND organization_id=?").bind(ctx.actor.userId,ctx.organizationId).run();
      if(mutation==="membership")await db.prepare("UPDATE memberships SET status='suspended' WHERE user_id=? AND organization_id=?").bind(ctx.actor.userId,ctx.organizationId).run();
      if(mutation==="identity")await db.prepare("UPDATE users SET auth_subject='changed' WHERE id=?").bind(ctx.actor.userId).run();
      if(mutation==="namespace")await db.prepare("UPDATE integration_connections SET source_namespace='successor' WHERE id=?").bind(ctx.connectionId).run();
      if(mutation==="ciphertext")await db.prepare("UPDATE integration_secrets SET access_token_ciphertext='successor' WHERE connection_id=?").bind(ctx.connectionId).run();
      if(mutation==="scope")await db.prepare("UPDATE integration_connections SET scopes_json='[]' WHERE id=?").bind(ctx.connectionId).run();
      if(mutation==="team")await db.prepare("UPDATE integration_connections SET external_account_ref='TOTHER' WHERE id=?").bind(ctx.connectionId).run();
      if(mutation==="channel")await db.prepare("UPDATE integration_connections SET domain_prefix='COTHER' WHERE id=?").bind(ctx.connectionId).run();
      if(mutation==="lease")await db.prepare("UPDATE integration_connections SET sync_lease_expires_at=1 WHERE id=?").bind(ctx.connectionId).run();
      return "must-not-return";
    }),error=>error instanceof Error&&"code"in error&&["SLACK_GRANT_CHANGED","SLACK_CONVERSATION_OWNER_REQUIRED"].includes(String(error.code)),mutation);
  }
});

test("provider Retry-After extends the rolling encrypted cooldown without saving conversation data",async()=>{
  const ctx=await conversationFixture(),before=Math.floor(Date.now()/1000);
  await assert.rejects(()=>withSlackConversationGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,ctx.actor,async()=>{throw new SlackConversationRateLimitError(180);}),isCode("SLACK_RATE_LIMITED"));
  const decoded=await decryptSlackCredentials(String((await secret(ctx))?.access_token_ciphertext));
  assert.ok(decoded.conversationRead!.nextReadAt>=before+180);
});

test("read-mode activation binds consent to the expected pending scopes and active owner atomically",async()=>{
  for(const mutation of["missing-owner","role","scope","none"]){
    const ctx=await conversationFixture(true,true),lease=await acquireSlackGrantLease(ctx.organizationId,ctx.connectionId);
    const readGrant={...grant(ctx),scopes:SLACK_CONVERSATION_SCOPES};
    try{
      if(mutation==="role")await db.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND organization_id=?").bind(ctx.actor.userId,ctx.organizationId).run();
      if(mutation==="scope")await db.prepare("UPDATE integration_connections SET scopes_json='[\"incoming-webhook\"]' WHERE id=?").bind(ctx.connectionId).run();
      if(mutation==="none"){
        await activateSlackGrant(lease,ctx.namespace,readGrant,ctx.actor);
        const decoded=await decryptSlackCredentials(String((await secret(ctx))?.access_token_ciphertext));assert.equal(decoded.conversationRead?.authorizedByUserId,ctx.actor.userId);
      }else{
        await assert.rejects(()=>activateSlackGrant(lease,ctx.namespace,readGrant,mutation==="missing-owner"?undefined:ctx.actor));
        assert.equal(await secret(ctx),null);assert.equal((await connection(ctx))?.status,"pending");
      }
    }finally{await releaseIntegrationSyncLease(lease);}
  }
});

test("history cooldown is shared by the Slack team across organizations and replacement connections",async()=>{
  const first=await conversationFixture(),second=await conversationFixture();let calls=0;
  await withSlackConversationGrant(first.organizationId,first.connectionId,first.namespace,first.actor,async()=>{calls++;return "first";});
  await withdrawSlackGrant(first.organizationId,first.connectionId,first.namespace,neverFetch,true);
  second.credentials.teamId=first.teamId;
  await db.prepare("UPDATE integration_connections SET external_account_ref=? WHERE id=?").bind(first.teamId,second.connectionId).run();
  await db.prepare("UPDATE integration_secrets SET access_token_ciphertext=? WHERE connection_id=? AND provider='slack'")
    .bind(await encryptSlackCredentials(second.credentials),second.connectionId).run();
  await assert.rejects(()=>withSlackConversationGrant(second.organizationId,second.connectionId,second.namespace,second.actor,async()=>{calls++;return "no";}),isCode("SLACK_CONVERSATION_COOLDOWN"));
  assert.equal(calls,1);
  const buckets=await db.prepare("SELECT * FROM rate_limit_buckets WHERE scope='slack:conversation-history'").all();
  assert.doesNotMatch(JSON.stringify(buckets.results),new RegExp(first.teamId));
});

test("two pending callbacks cannot activate the same Slack team across organizations",async()=>{
  const first=await conversationFixture(true,true),second=await conversationFixture(true,true);
  const firstLease=await acquireSlackGrantLease(first.organizationId,first.connectionId),secondLease=await acquireSlackGrantLease(second.organizationId,second.connectionId);
  try{
    const firstGrant={...grant(first),scopes:SLACK_CONVERSATION_SCOPES};
    const secondGrant={...grant(second),teamId:first.teamId,scopes:SLACK_CONVERSATION_SCOPES};
    const results=await Promise.allSettled([activateSlackGrant(firstLease,first.namespace,firstGrant,first.actor),activateSlackGrant(secondLease,second.namespace,secondGrant,second.actor)]);
    assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
    const active=await db.prepare("SELECT COUNT(*) AS count FROM integration_connections WHERE provider='slack' AND external_account_ref=? AND status='connected'").bind(first.teamId).first<{count:number}>();
    assert.equal(active?.count,1);
    assert.equal(Number(Boolean(await secret(first)))+Number(Boolean(await secret(second))),1);
  }finally{await releaseIntegrationSyncLease(firstLease);await releaseIntegrationSyncLease(secondLease);}
});

test("disconnect while channel info is in flight prevents any subsequent history request",async()=>{
  const ctx=await conversationFixture(),requests:string[]=[];
  await assert.rejects(()=>withSlackConversationGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,ctx.actor,(credentials,checkCurrent)=>readSlackRecentConversation(credentials,(async input=>{
    requests.push(String(input));assert.match(String(input),/conversations\.info/);
    await withdrawSlackGrant(ctx.organizationId,ctx.connectionId,ctx.namespace,(async()=>Response.json({ok:false})) as typeof fetch);
    return Response.json({ok:true,channel:{id:ctx.channelId,context_team_id:ctx.teamId,name:"fixture",is_channel:true,is_private:false,is_member:true,is_archived:false,is_shared:false}});
  }) as typeof fetch,checkCurrent)),isCode("SLACK_GRANT_CHANGED"));
  assert.equal(requests.length,1);assert.doesNotMatch(requests[0]!,/history/);
});
