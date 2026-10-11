import {getD1} from "../../db";
import {ApiError,hashIdentifier} from "../api";
import {acquireIntegrationSyncLease,releaseIntegrationSyncLease,sqliteTimestampSeconds,type IntegrationSyncLease} from "./connection";
import {decryptSlackCredentials,encryptSlackCredentials,encryptedSlackNoRefreshToken,revokeSlackInstallation,slackCredentialEnvelope,SLACK_API_VERSION,SLACK_PROVIDER,type SlackCredentialEnvelope,type SlackGrant} from "./slack";
import {slackModeForStoredScopes} from "./slack";
import type {AccessContext} from "../authorization";
import {SlackConversationCooldownError,SlackConversationRateLimitError} from "./slack-conversation";

// Internal cleanup material is never returned by status routes or selected by
// the active Slack send path. It is encrypted with the existing Slack envelope.
const CLEANUP_PROVIDER="slack-revocation";
const CLEANUP_REQUIRED="SLACK_PROVIDER_REMOVAL_REQUIRED";
const REMOVAL_ACKNOWLEDGED="SLACK_PROVIDER_REMOVAL_ACKNOWLEDGED";
const REMOVAL_CONFIRMED="SLACK_PROVIDER_REMOVAL_CONFIRMED";

function grantChanged() {return new ApiError(409,"SLACK_GRANT_CHANGED","The Slack connection changed. Try again from Integrations.");}
function guard(lease:IntegrationSyncLease,namespace:string,status:"pending"|"connected"|"revoked",prefix="") {
  if(lease.provider!==SLACK_PROVIDER)throw grantChanged();
  return {sql:`${prefix}id=? AND ${prefix}organization_id=? AND ${prefix}provider=? AND ${prefix}source_namespace=? AND ${prefix}status=?
    AND ${prefix}sync_lease_owner=? AND ${prefix}sync_version=? AND ${prefix}sync_lease_expires_at>?`,
    bindings:[lease.connectionId,lease.organizationId,SLACK_PROVIDER,namespace,status,lease.owner,lease.version,sqliteTimestampSeconds()] as (string|number|null)[]};
}
export async function acquireSlackGrantLease(organizationId:string,connectionId:string,ttlMs=60_000) {
  const lease=await acquireIntegrationSyncLease(organizationId,SLACK_PROVIDER,connectionId,ttlMs);
  if(!lease)throw new ApiError(409,"SLACK_CONNECTION_BUSY","Slack is updating this connection. Try again shortly.");
  return lease;
}

export async function pendingSlackCleanupConnectionIds(organizationId:string) {
  const pending=await getD1().prepare(`SELECT c.id FROM integration_secrets s JOIN integration_connections c
    ON c.id=s.connection_id AND c.organization_id=s.organization_id
    WHERE s.organization_id=? AND s.provider=? AND c.provider=? AND c.status='revoked' ORDER BY c.id`)
    .bind(organizationId,CLEANUP_PROVIDER,SLACK_PROVIDER).all<{id:string}>();
  return (pending.results??[]).map(row=>row.id);
}
export async function requireNoPendingSlackCleanup(organizationId:string) {
  if((await pendingSlackCleanupConnectionIds(organizationId)).length)throw new ApiError(409,"SLACK_CLEANUP_PENDING","Slack access is removed locally. Retry Disconnect or confirm removal in Slack before reconnecting.");
}

export async function activateSlackGrant(lease:IntegrationSyncLease,namespace:string,grant:SlackGrant,conversationActor?:SlackConversationActor) {
  const access=await encryptSlackCredentials(slackCredentialEnvelope(grant,conversationActor?.userId)), refresh=await encryptedSlackNoRefreshToken();
  const selected=guard(lease,namespace,"pending"), now=sqliteTimestampSeconds(), database=getD1();
  selected.sql+=" AND scopes_json=?";selected.bindings.push(JSON.stringify(grant.scopes));
  // The callback's earlier lookup is informative; this transactional condition
  // also prevents two pending callbacks from activating the same installation.
  selected.sql+=` AND NOT EXISTS(SELECT 1 FROM integration_connections replacement
    WHERE replacement.provider=? AND replacement.external_account_ref=? AND replacement.id<>integration_connections.id)`;
  selected.bindings.push(SLACK_PROVIDER,grant.teamId);
  if(conversationActor){
    const actorFence=conversationOwnerGuard(lease.organizationId,conversationActor);
    selected.sql+=` AND EXISTS(${actorFence.sql})`;selected.bindings.push(...actorFence.bindings);
  }
  selected.sql+=` AND NOT EXISTS(SELECT 1 FROM integration_secrets cleanup JOIN integration_connections old
    ON old.id=cleanup.connection_id AND old.organization_id=cleanup.organization_id
    WHERE cleanup.organization_id=integration_connections.organization_id AND cleanup.provider='slack-revocation'
      AND old.provider='slack' AND old.status='revoked')`;
  const results=await database.batch([
    database.prepare(`INSERT INTO integration_secrets(id,organization_id,provider,connection_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,created_at,updated_at)
      SELECT ?,organization_id,provider,id,?,?,4070908800,?,? FROM integration_connections WHERE ${selected.sql}`)
      .bind(crypto.randomUUID(),access,refresh,now,now,...selected.bindings),
    database.prepare(`UPDATE integration_connections SET status='connected',external_account_ref=?,external_account_name=?,domain_prefix=?,api_version=?,
      scopes_json=?,data_promotion_status='blocked',connected_at=?,last_successful_sync_at=NULL,last_sync_cursor=NULL,last_error_code=NULL,updated_at=?
      WHERE ${selected.sql} AND EXISTS(SELECT 1 FROM integration_secrets s WHERE s.connection_id=integration_connections.id
        AND s.organization_id=integration_connections.organization_id AND s.provider=integration_connections.provider AND s.access_token_ciphertext=?)`)
      .bind(grant.teamId,`${grant.teamName} · #${grant.channelName}`,grant.channelId,SLACK_API_VERSION,JSON.stringify(grant.scopes),now,now,...selected.bindings,access),
  ]);
  if(results.some(result=>Number(result.meta.changes??0)!==1))throw grantChanged();
}

// Credential selection and the final pre-send check both require connected
// status and the same generation. Already dispatched provider requests cannot
// be cancelled by a later local disconnect, but no new send starts afterwards.
export async function withSlackGrant<T>(organizationId:string,connectionId:string,namespace:string,
  operation:(credentials:SlackCredentialEnvelope)=>Promise<T>) {
  const lease=await acquireSlackGrantLease(organizationId,connectionId);
  try{
    const current=guard(lease,namespace,"connected","c.");
    const row=await getD1().prepare(`SELECT s.access_token_ciphertext AS ciphertext,c.external_account_ref AS team,c.domain_prefix AS channel
      FROM integration_secrets s JOIN integration_connections c ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.provider=s.provider
      WHERE s.organization_id=? AND s.connection_id=? AND s.provider=? AND ${current.sql}`)
      .bind(organizationId,connectionId,SLACK_PROVIDER,...current.bindings).first<{ciphertext:string;team:string;channel:string}>();
    if(!row)throw new ApiError(409,"SLACK_NOT_CONNECTED","Reconnect Slack before sending a message.");
    const credentials=await decryptSlackCredentials(row.ciphertext);
    if(credentials.teamId!==row.team||credentials.channelId!==row.channel)throw new ApiError(409,"SLACK_DESTINATION_CHANGED","Reconnect Slack before sending another notification.");
    const valid=await getD1().prepare(`SELECT 1 FROM integration_secrets s JOIN integration_connections c
      ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.provider=s.provider
      WHERE s.access_token_ciphertext=? AND s.provider=? AND ${current.sql}`)
      .bind(row.ciphertext,SLACK_PROVIDER,...guard(lease,namespace,"connected","c.").bindings).first();
    if(!valid)throw grantChanged();
    return await operation(credentials);
  }finally{await releaseIntegrationSyncLease(lease);}
}

type SlackConversationActor=Pick<AccessContext,"userId"|"authSubject"|"authProvider">;
function conversationOwnerGuard(organizationId:string,actor:SlackConversationActor) {
  return {sql:`SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id
    WHERE u.id=? AND u.status='active' AND u.auth_subject IS ? AND u.auth_provider IS ?
      AND m.organization_id=? AND m.status='active' AND m.role='owner'
      AND NOT EXISTS(SELECT 1 FROM account_deletion_jobs deletion WHERE deletion.stage IN('confirmed','local_deleted')
        AND (deletion.user_id=u.id OR (deletion.scope='workspace' AND deletion.organization_id=m.organization_id)))`,
    bindings:[actor.userId,actor.authSubject,actor.authProvider,organizationId]};
}
async function requireActiveConversationOwner(organizationId:string,actor:SlackConversationActor) {
  const current=conversationOwnerGuard(organizationId,actor);
  const active=await getD1().prepare(current.sql).bind(...current.bindings).first();
  if(!active)throw new ApiError(403,"SLACK_CONVERSATION_OWNER_REQUIRED","Only an active workspace owner can read this Slack conversation.");
}

/** Reserve the read window durably; never store message bodies or publish a stale response. */
export async function withSlackConversationGrant<T>(organizationId:string,connectionId:string,namespace:string,
  actor:SlackConversationActor,operation:(credentials:SlackCredentialEnvelope,checkCurrent:()=>Promise<void>)=>Promise<T>) {
  const lease=await acquireSlackGrantLease(organizationId,connectionId),database=getD1();
  try{
    const current=guard(lease,namespace,"connected","c.");
    const row=await database.prepare(`SELECT s.access_token_ciphertext AS ciphertext,c.external_account_ref AS team,
      c.domain_prefix AS channel,c.scopes_json AS scopes FROM integration_secrets s JOIN integration_connections c
      ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.provider=s.provider
      WHERE s.organization_id=? AND s.connection_id=? AND s.provider=? AND ${current.sql}`)
      .bind(organizationId,connectionId,SLACK_PROVIDER,...current.bindings).first<{ciphertext:string;team:string;channel:string;scopes:string}>();
    if(!row)throw new ApiError(409,"SLACK_NOT_CONNECTED","Reconnect Slack before reading a conversation.");
    const credentials=await decryptSlackCredentials(row.ciphertext);
    if(credentials.teamId!==row.team||credentials.channelId!==row.channel)throw grantChanged();
    if(slackModeForStoredScopes(row.scopes)!=="single_channel_conversations"||!credentials.conversationRead?.enabled)
      throw new ApiError(409,"SLACK_CONVERSATION_CONSENT_REQUIRED","Disconnect Slack and reconnect after approving conversation access.");
    await requireActiveConversationOwner(organizationId,actor);
    const now=sqliteTimestampSeconds();
    if(credentials.conversationRead.nextReadAt>now)throw new SlackConversationCooldownError(credentials.conversationRead.nextReadAt);
    let ciphertext=row.ciphertext;
    const updateCooldown=async(nextReadAt:number)=>{
      const replacement={...credentials,conversationRead:{...credentials.conversationRead!,nextReadAt}};
      const encrypted=await encryptSlackCredentials(replacement);
      await requireActiveConversationOwner(organizationId,actor);
      const fence=guard(lease,namespace,"connected","c.");
      const actorFence=conversationOwnerGuard(organizationId,actor);
      const changed=await database.prepare(`UPDATE integration_secrets SET access_token_ciphertext=?,updated_at=?
        WHERE organization_id=? AND connection_id=? AND provider=? AND access_token_ciphertext=?
          AND EXISTS(SELECT 1 FROM integration_connections c WHERE ${fence.sql} AND c.scopes_json=?) AND EXISTS(${actorFence.sql})`)
        .bind(encrypted,sqliteTimestampSeconds(),organizationId,connectionId,SLACK_PROVIDER,ciphertext,...fence.bindings,row.scopes,...actorFence.bindings).run();
      if(Number(changed.meta.changes??0)!==1)throw grantChanged();
      ciphertext=encrypted;credentials.conversationRead=replacement.conversationRead;
    };
    await updateCooldown(now+60);
    // A stable hashed team/method bucket survives replacement connections and
    // protects historical duplicate rows as well as simultaneous callers.
    const teamHash=await hashIdentifier(credentials.teamId),bucket=`slack:conversation-history:rolling:${teamHash}`;
    const reserved=await database.prepare(`INSERT INTO rate_limit_buckets(bucket_key,scope,actor_hash,window_start,request_count,expires_at)
      VALUES (?,'slack:conversation-history',?,?,1,?) ON CONFLICT(bucket_key) DO UPDATE
      SET window_start=excluded.window_start,request_count=1,expires_at=excluded.expires_at
      WHERE rate_limit_buckets.window_start<=excluded.window_start-60 RETURNING window_start`)
      .bind(bucket,teamHash,now,now+120).first<{window_start:number}>();
    if(!reserved){
      const existing=await database.prepare("SELECT window_start FROM rate_limit_buckets WHERE bucket_key=?").bind(bucket).first<{window_start:number}>();
      const nextReadAt=Math.max(now+60,(existing?.window_start??now)+60);
      await updateCooldown(nextReadAt);throw new SlackConversationCooldownError(nextReadAt);
    }
    const checkCurrent=async()=>{
      await requireActiveConversationOwner(organizationId,actor);
      const currentFence=guard(lease,namespace,"connected","c."),actorFence=conversationOwnerGuard(organizationId,actor);
      const valid=await database.prepare(`SELECT 1 FROM integration_secrets s JOIN integration_connections c
        ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.provider=s.provider
        WHERE s.organization_id=? AND s.connection_id=? AND s.provider=? AND s.access_token_ciphertext=?
          AND ${currentFence.sql} AND c.scopes_json=? AND c.external_account_ref=? AND c.domain_prefix=? AND EXISTS(${actorFence.sql})`)
        .bind(organizationId,connectionId,SLACK_PROVIDER,ciphertext,...currentFence.bindings,row.scopes,credentials.teamId,credentials.channelId,...actorFence.bindings).first();
      if(!valid)throw grantChanged();
    };
    let result:T;
    try{await checkCurrent();result=await operation(credentials,checkCurrent);}
    catch(error){
      if(error instanceof SlackConversationRateLimitError){
        await updateCooldown(Math.max(credentials.conversationRead.nextReadAt,sqliteTimestampSeconds()+error.retryAfterSeconds));
        error.nextReadAt=credentials.conversationRead.nextReadAt;
        await database.prepare(`UPDATE rate_limit_buckets SET window_start=MAX(window_start,?),expires_at=MAX(expires_at,?) WHERE bucket_key=?`)
          .bind(error.nextReadAt-60,error.nextReadAt+60,bucket).run();
      }
      throw error;
    }
    await checkCurrent();
    return result;
  }finally{await releaseIntegrationSyncLease(lease);}
}

// Local withdrawal takes precedence over provider availability. The internal
// encrypted cleanup key cannot be used by normal Slack send/status queries.
export async function withdrawSlackGrant(organizationId:string,connectionId:string,namespace:string,fetcher:typeof fetch=fetch,confirmedProviderRemoval=false) {
  const database=getD1(), now=sqliteTimestampSeconds();
  const before=await database.prepare(`SELECT status,EXISTS(SELECT 1 FROM integration_secrets s
    WHERE s.connection_id=integration_connections.id AND s.organization_id=integration_connections.organization_id AND s.provider='slack') AS hasActiveSecret
    FROM integration_connections WHERE id=? AND organization_id=? AND provider=? AND source_namespace=?`)
    .bind(connectionId,organizationId,SLACK_PROVIDER,namespace).first<{status:string;hasActiveSecret:number}>();
  if(!before)throw new ApiError(404,"SLACK_CONNECTION_NOT_FOUND","The selected Slack connection is unavailable.");
  if(before.status!=="revoked"||before.hasActiveSecret){
    const revoked=`EXISTS(SELECT 1 FROM integration_connections c WHERE c.id=? AND c.organization_id=? AND c.provider=?
      AND c.source_namespace=? AND c.status='revoked' AND c.last_error_code=?)`;
    const bindings=[connectionId,organizationId,SLACK_PROVIDER,namespace,CLEANUP_REQUIRED];
    const results=await database.batch([
      database.prepare(`UPDATE integration_connections SET status='revoked',data_promotion_status='blocked',scopes_json='[]',connected_at=NULL,
        last_successful_sync_at=NULL,last_sync_cursor=NULL,sync_version=sync_version+1,sync_lease_owner=NULL,sync_lease_expires_at=NULL,
        last_error_code=?,updated_at=? WHERE id=? AND organization_id=? AND provider=? AND source_namespace=?
        AND (status<>'revoked' OR EXISTS(SELECT 1 FROM integration_secrets s WHERE s.connection_id=integration_connections.id
          AND s.organization_id=integration_connections.organization_id AND s.provider='slack'))`)
        .bind(CLEANUP_REQUIRED,now,connectionId,organizationId,SLACK_PROVIDER,namespace),
      database.prepare(`UPDATE integration_secrets SET provider=?,updated_at=? WHERE organization_id=? AND connection_id=? AND provider=? AND ${revoked}`)
        .bind(CLEANUP_PROVIDER,now,organizationId,connectionId,SLACK_PROVIDER,...bindings),
      database.prepare(`DELETE FROM integration_oauth_states WHERE organization_id=? AND connection_id=? AND provider=? AND ${revoked}`)
        .bind(organizationId,connectionId,SLACK_PROVIDER,...bindings),
      // No credential means there is no automatic uninstall retry. Do not
      // reserve a workspace forever or require restoring a missing secret.
      database.prepare(`UPDATE integration_connections SET external_account_ref=NULL,external_account_name=NULL,domain_prefix=NULL
        WHERE id=? AND organization_id=? AND provider=? AND source_namespace=? AND status='revoked'
        AND NOT EXISTS(SELECT 1 FROM integration_secrets s WHERE s.connection_id=integration_connections.id AND s.organization_id=integration_connections.organization_id AND s.provider=?)`)
        .bind(connectionId,organizationId,SLACK_PROVIDER,namespace,CLEANUP_PROVIDER),
    ]);
    if(Number(results[0].meta.changes??0)!==1){
      const current=await database.prepare("SELECT status FROM integration_connections WHERE id=? AND organization_id=? AND provider=? AND source_namespace=?")
        .bind(connectionId,organizationId,SLACK_PROVIDER,namespace).first<{status:string}>();
      if(current?.status!=="revoked")throw grantChanged();
    }
  }
  // Competing cleanup attempts never invalidate one another's lease. Local
  // access is already off, so a busy cleanup is a successful local disconnect.
  const lease=await acquireIntegrationSyncLease(organizationId,SLACK_PROVIDER,connectionId,60_000);
  if(!lease)return {disconnected:true,localAccessRemoved:true,localCredentialsDeleted:false,providerAuthorizationRevoked:false,providerRemovalRequired:true,cleanupPending:true};
  try{
    const current=guard(lease,namespace,"revoked","c.");
    const row=await database.prepare(`SELECT s.access_token_ciphertext AS ciphertext FROM integration_secrets s
      WHERE s.organization_id=? AND s.connection_id=? AND s.provider=? AND EXISTS(SELECT 1 FROM integration_connections c WHERE ${current.sql})`)
      .bind(organizationId,connectionId,CLEANUP_PROVIDER,...current.bindings).first<{ciphertext:string}>();
    if(confirmedProviderRemoval){
      const fenced=guard(lease,namespace,"revoked","c."), direct=guard(lease,namespace,"revoked");
      const results=await database.batch([
        database.prepare(`DELETE FROM integration_secrets WHERE organization_id=? AND connection_id=? AND provider=?
          AND EXISTS(SELECT 1 FROM integration_connections c WHERE ${fenced.sql})`)
          .bind(organizationId,connectionId,CLEANUP_PROVIDER,...fenced.bindings),
        database.prepare(`UPDATE integration_connections SET external_account_ref=NULL,external_account_name=NULL,domain_prefix=NULL,last_error_code=?,updated_at=?
          WHERE ${direct.sql}`).bind(REMOVAL_ACKNOWLEDGED,sqliteTimestampSeconds(),...direct.bindings),
      ]);
      if(Number(results[1].meta.changes??0)!==1)throw grantChanged();
      return {disconnected:true,localAccessRemoved:true,localCredentialsDeleted:true,providerAuthorizationRevoked:false,
        providerRemovalRequired:false,cleanupPending:false,manualRemovalAcknowledged:true};
    }
    if(!row){
      const valid=await database.prepare(`SELECT last_error_code AS error FROM integration_connections WHERE ${guard(lease,namespace,"revoked").sql}`)
        .bind(...guard(lease,namespace,"revoked").bindings).first<{error:string|null}>();
      if(!valid)throw grantChanged();
      return {disconnected:true,localAccessRemoved:true,localCredentialsDeleted:true,providerAuthorizationRevoked:valid.error===REMOVAL_CONFIRMED,
        providerRemovalRequired:valid.error!==REMOVAL_CONFIRMED&&valid.error!==REMOVAL_ACKNOWLEDGED,cleanupPending:false,
        manualRemovalAcknowledged:valid.error===REMOVAL_ACKNOWLEDGED};
    }
    let providerAuthorizationRevoked=false;
    try{
      const credentials=await decryptSlackCredentials(row.ciphertext);
      const noReplacement=await database.prepare(`SELECT 1 FROM integration_connections c WHERE ${current.sql}
        AND c.external_account_ref=? AND NOT EXISTS(SELECT 1 FROM integration_connections replacement
          WHERE replacement.provider=? AND replacement.external_account_ref=? AND replacement.id<>c.id AND replacement.status IN('connected','pending'))`)
        .bind(...guard(lease,namespace,"revoked","c.").bindings,credentials.teamId,SLACK_PROVIDER,credentials.teamId).first();
      if(noReplacement)providerAuthorizationRevoked=await revokeSlackInstallation(credentials,fetcher);
    }catch{/* Report unconfirmed provider cleanup while leaving local use disabled. */}
    if(providerAuthorizationRevoked){
      const fenced=guard(lease,namespace,"revoked","c."), direct=guard(lease,namespace,"revoked");
      const results=await database.batch([
        database.prepare(`DELETE FROM integration_secrets WHERE organization_id=? AND connection_id=? AND provider=? AND access_token_ciphertext=?
          AND EXISTS(SELECT 1 FROM integration_connections c WHERE ${fenced.sql})`)
          .bind(organizationId,connectionId,CLEANUP_PROVIDER,row.ciphertext,...fenced.bindings),
        database.prepare(`UPDATE integration_connections SET external_account_ref=NULL,external_account_name=NULL,domain_prefix=NULL,last_error_code=?,updated_at=?
          WHERE ${direct.sql} AND NOT EXISTS(SELECT 1 FROM integration_secrets s WHERE s.connection_id=integration_connections.id AND s.organization_id=integration_connections.organization_id AND s.provider=?)`)
          .bind(REMOVAL_CONFIRMED,sqliteTimestampSeconds(),...direct.bindings,CLEANUP_PROVIDER),
      ]);
      if(results.some(result=>Number(result.meta.changes??0)!==1))throw grantChanged();
    }
    return {disconnected:true,localAccessRemoved:true,localCredentialsDeleted:providerAuthorizationRevoked,providerAuthorizationRevoked,
      providerRemovalRequired:!providerAuthorizationRevoked,cleanupPending:!providerAuthorizationRevoked};
  }finally{await releaseIntegrationSyncLease(lease);}
}
