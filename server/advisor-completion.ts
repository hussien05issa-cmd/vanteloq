import { ApiError } from "./api";
import { SESSION_IDLE_MS } from "../shared/session-policy";

export type AdvisorAuthorityActor = { organizationId: string; userId: string; sessionId: string; role: string; subject: string };
export type AdvisorSavedTurn = { conversationId: string; existing: boolean; question: string; answer: string; model: string; userEvidence: string; answerEvidence: string };

// The fixed schema identifiers below are code, never user input. Ordered arrays
// make this opaque authorization stamp deterministic without saving its content.
const rows = (table: string, fields: string, where: string, order = "id") =>
  `(SELECT json_group_array(item) FROM (SELECT json_array(${fields}) item FROM ${table} WHERE ${where} ORDER BY ${order}))`;
const organization = "organization_id = a.organization_id";
const person = `${organization} AND user_id = a.user_id`;
const authoritySql = `SELECT json_object(
  'user', (SELECT json_array(status,auth_provider,auth_subject) FROM users WHERE id=a.user_id),
  'workspace', (SELECT json_array(currency,timezone) FROM workspaces WHERE id=a.organization_id),
  'membership', ${rows("memberships", "id,role,status", person)},
  'team', ${rows("team_members", "id,role_id,status,remote_login,require_mfa,primary_location_id,permitted_locations_json", person)},
  'roles', ${rows("access_roles", "id,system_key,permissions_json,location_scope_json,archived", `${organization} AND id IN (SELECT role_id FROM team_members WHERE ${person})`)},
  'locations', ${rows("organization_locations", "id,status", organization)},
  'consent', ${rows("integration_consents", "id,notice_version,privacy_policy_version,data_categories_json,purposes_json", `${organization} AND actor_user_id=a.user_id AND provider='openai' AND status='accepted'`)},
  'subscription', ${rows("tenant_subscriptions", "base_plan,status,version", organization, "organization_id")},
  'addons', ${rows("tenant_addons", "id,addon_key,status", organization)},
  'internal', ${rows("internal_access", "id,access_level,active,mfa_required", person)},
  'connections', ${rows("integration_connections", "id,provider,status,source_namespace,data_promotion_status,resource_selection_version", organization)},
  'mappings', ${rows("integration_location_mappings", "id,connection_id,local_location_id,external_location_ref,status", organization)},
  'sourceAuthority', ${rows("integration_source_authorities", "id,connection_id,local_location_id,channel,fact_family,version", organization)},
  'deletion', ${rows("account_deletion_jobs", "id,scope,stage", "stage IN ('confirmed','local_deleted') AND (user_id=a.user_id OR (scope='workspace' AND organization_id=a.organization_id))")}
) stamp
FROM (SELECT ? organization_id, ? user_id, ? session_id, ? role, ? subject) a
WHERE EXISTS (SELECT 1 FROM users WHERE id=a.user_id AND status='active' AND auth_provider='supabase' AND auth_subject=a.subject)
AND EXISTS (SELECT 1 FROM memberships WHERE ${person} AND status='active' AND role=a.role)
AND EXISTS (SELECT 1 FROM workspace_sessions WHERE id=a.session_id AND ${person} AND revoked=0
  AND expires_at > CAST(strftime('%s','now') AS INTEGER)*1000
  AND last_seen_at > CAST(strftime('%s','now') AS INTEGER)*1000 - ${SESSION_IDLE_MS})`;

const bindings = (actor: AdvisorAuthorityActor) => [actor.organizationId, actor.userId, actor.sessionId, actor.role, actor.subject];
function changed(): never {
  throw new ApiError(409, "ADVISOR_CONTEXT_CHANGED", "Your access, source selection or privacy settings changed while this reply was being prepared. Refresh the workspace before trying again.");
}

/** Call after identity validation and before collecting permission-scoped evidence. */
export async function captureAdvisorAuthority(database: D1Database, actor: AdvisorAuthorityActor) {
  const row = await database.prepare(authoritySql).bind(...bindings(actor)).first<{ stamp: string }>();
  if (!row?.stamp) changed();
  return row.stamp;
}

/** A read fence is also used before transmitting the already-collected evidence. */
export async function assertAdvisorAuthority(database: D1Database, actor: AdvisorAuthorityActor, stamp: string) {
  const row = await database.prepare(`SELECT 1 allowed FROM (${authoritySql}) WHERE stamp=?`).bind(...bindings(actor), stamp).first();
  if (!row) changed();
}

/** The guarded D1 batch is the completion point. A withdrawal or suspension
 * committed first makes every insert a no-op. No model answer is returned then.
 * A completed authorized turn wins before a later withdrawal, not after it. */
export async function completeAdvisorTurn(database: D1Database, actor: AdvisorAuthorityActor, stamp: string, turn: AdvisorSavedTurn | null) {
  if (!turn) { await assertAdvisorAuthority(database, actor, stamp); return; }
  const now = Date.now();
  const prefix = `WITH authority AS (${authoritySql})`;
  const authorized = "EXISTS (SELECT 1 FROM authority WHERE stamp=?)";
  const conversation = turn.existing
    ? database.prepare(`${prefix} UPDATE assistant_conversations SET updated_at=MAX(updated_at,?)
        WHERE id=? AND organization_id=? AND user_id=? AND ${authorized}`)
      .bind(...bindings(actor), now, turn.conversationId, actor.organizationId, actor.userId, stamp)
    : database.prepare(`${prefix} INSERT INTO assistant_conversations (id,organization_id,user_id,title,created_at,updated_at)
        SELECT ?,?,?,'Vanteloq AI conversation',?,? WHERE ${authorized}`)
      .bind(...bindings(actor), turn.conversationId, actor.organizationId, actor.userId, now, now, stamp);
  const messages = database.prepare(`${prefix}, messages(id,role,content,evidence_json) AS (
      SELECT ?,'user',?,? UNION ALL SELECT ?,'assistant',?,?
    ) INSERT INTO assistant_messages (id,conversation_id,organization_id,user_id,role,content,evidence_json,model,created_at)
    SELECT id,?,?,?,role,content,evidence_json,?,? FROM messages
    WHERE ${authorized} AND EXISTS (SELECT 1 FROM assistant_conversations WHERE id=? AND organization_id=? AND user_id=?)`)
    .bind(...bindings(actor), crypto.randomUUID(), turn.question, turn.userEvidence, crypto.randomUUID(), turn.answer, turn.answerEvidence,
      turn.conversationId, actor.organizationId, actor.userId, turn.model, now, stamp, turn.conversationId, actor.organizationId, actor.userId);
  const [savedConversation, savedMessages] = await database.batch([conversation, messages]);
  if (Number(savedConversation.meta.changes ?? 0) !== 1 || Number(savedMessages.meta.changes ?? 0) !== 2) changed();
}
