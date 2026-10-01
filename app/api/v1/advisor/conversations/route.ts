import { getD1 } from "../../../../../db";
import { requireAccess, requirePrivacyAccess } from "../../../../../server/authorization";
import { requirePermission } from "../../../../../server/permissions";
import { requireAdvisorConsent } from "../../../../../server/privacy";
import { authorizedLocationDataScope } from "../../../../../server/location-access";
import { assertAdvisorAuthority, captureAdvisorAuthority } from "../../../../../server/advisor-completion";
import { sessionLeaseId } from "../../../../../server/session-policy";
import { advisorHistoryFingerprint, type AdvisorHistoryScope } from "../../../../../domain/advisor-memory";
import { ADVISOR_CONSENT_NOTICE_VERSION, PRIVACY_POLICY_VERSION } from "../../../../../domain/privacy-controls";
import { ApiError, clientSource, enforceRateLimit, handleApi, hashIdentifier, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";

function pageCursor(request: Request, messages = false) {
  const raw = new URL(request.url).searchParams.get("before");
  if (!raw) return null;
  const match = /^(\d{1,16})[.]([a-zA-Z0-9-]{1,100})$/.exec(raw);
  if (!match || !Number.isSafeInteger(Number(match[1])) || (messages && (!/^\d{1,16}$/.test(match[2]) || !Number.isSafeInteger(Number(match[2]))))) throw new ApiError(400, "HISTORY_CURSOR_INVALID", "Refresh saved chats and try again.");
  return { time: Number(match[1]), id: match[2] };
}

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

/** Privacy controls remain available without an AI subscription or insights permission. */
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const id = new URL(request.url).searchParams.get("id");
    if (id !== null) return readConversation(request, id);
    const context = await requirePrivacyAccess(request, readers);
    await enforceRateLimit("advisor:history", `${context.userId}:${clientSource(request)}`, 30, 60);
    const database = getD1();
    await database.prepare("DELETE FROM assistant_conversations WHERE organization_id = ? AND user_id = ? AND updated_at < ?").bind(context.organizationId, context.userId, Date.now() - 90 * 86400000).run();
    // Never return old question/answer text: permissions may have changed since it was saved.
    const cursor = pageCursor(request);
    const rows = await database.prepare("SELECT id, created_at AS createdAt, updated_at AS updatedAt FROM assistant_conversations WHERE organization_id = ? AND user_id = ?" + (cursor ? " AND (updated_at < ? OR (updated_at = ? AND id < ?))" : "") + " ORDER BY updated_at DESC, id DESC LIMIT 51").bind(context.organizationId, context.userId, ...(cursor ? [cursor.time, cursor.time, cursor.id] : [])).all<{ id: string; createdAt: number; updatedAt: number }>();
    const conversations: Array<{id:string;createdAt:number;updatedAt:number;title?:string}> = rows.results ?? [];
    if(new URL(request.url).searchParams.get("titles")==="true") {
      try {
        const access=await requireAccess(request,readers,"ai.basic");await requirePermission(access,"insights.view");
        const actor={organizationId:context.organizationId,userId:context.userId,role:context.role,subject:context.identity.subject!,sessionId:await sessionLeaseId(context)};
        const stamp=await captureAdvisorAuthority(database,actor);
        const titles=await database.prepare("SELECT c.id,c.title,(SELECT evidence_json FROM assistant_messages m WHERE m.conversation_id=c.id AND m.organization_id=c.organization_id AND m.user_id=c.user_id ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1) proof FROM assistant_conversations c WHERE c.organization_id=? AND c.user_id=? AND c.id IN ("+conversations.slice(0,50).map(()=>"?").join(",")+")").bind(context.organizationId,context.userId,...conversations.slice(0,50).map(c=>c.id)).all<{id:string;title:string;proof:string}>();
        const scopes=new Map<string,string>();
        for(const chat of conversations.slice(0,50)) {
          const title=(titles.results ?? []).find(t=>t.id===chat.id);if(!title)continue;
          try {
            const proof=JSON.parse(title.proof),scope=proof.historyScope as AdvisorHistoryScope;
            if(!scope || !["help","analysis"].includes(scope.purpose))continue;
            const key=JSON.stringify(scope);
            if(!scopes.has(key)) {
              await authorizedLocationDataScope(access,scope.locationId);
              await requireAdvisorConsent({organizationId:context.organizationId,actorUserId:context.userId,purpose:scope.purpose,noticeVersion:ADVISOR_CONSENT_NOTICE_VERSION,privacyPolicyVersion:PRIVACY_POLICY_VERSION});
              scopes.set(key,await advisorHistoryFingerprint(stamp,scope));
            }
            if(scopes.get(key)===proof.authorityFingerprint)chat.title=title.title;
          }catch{/* A stale or inaccessible title stays private. */}
        }
        await assertAdvisorAuthority(database,actor,stamp);
      }catch{for(const chat of conversations)delete chat.title;}
    }
    return jsonResponse({ conversations: conversations.slice(0, 50), hasMore: conversations.length > 50, nextCursor: conversations.length > 50 ? `${conversations[49].updatedAt}.${conversations[49].id}` : null });
  });
}

async function readConversation(request: Request, id: string, limited = true) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new ApiError(400, "CONVERSATION_INVALID", "Choose a saved chat.");
  const context = await requireAccess(request, readers, "ai.basic");
  await requirePermission(context, "insights.view");
  if(limited) await enforceRateLimit("advisor:history-read", context.userId, 30, 60);
  const database = getD1();
  const actor = { organizationId: context.organizationId, userId: context.userId, role: context.role, subject: context.identity.subject!, sessionId: await sessionLeaseId(context) };
  const stamp = await captureAdvisorAuthority(database, actor);
  const conversation = await database.prepare("SELECT id FROM assistant_conversations WHERE id=? AND organization_id=? AND user_id=? AND updated_at>=?").bind(id, context.organizationId, context.userId, Date.now() - 90 * 86400000).first();
  if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "This saved chat is unavailable.");
  const cursor = pageCursor(request, true);
  const latest = await database.prepare("SELECT evidence_json FROM assistant_messages WHERE conversation_id=? AND organization_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(id, context.organizationId, context.userId).first<{evidence_json:string}>();
  let scope: AdvisorHistoryScope | undefined;
  try { scope = JSON.parse(latest?.evidence_json ?? "{}").historyScope; } catch { /* Legacy messages have no current authority proof. */ }
  if (!scope || !["analysis", "help"].includes(scope.purpose) || !(scope.locationId === null || typeof scope.locationId === "string") || !(scope.from === null || /^\d{4}-\d{2}-\d{2}$/.test(scope.from)) || !(scope.to === null || /^\d{4}-\d{2}-\d{2}$/.test(scope.to)))
    throw new ApiError(409, "CONVERSATION_LEGACY", "This older chat cannot be reopened safely with the current access checks. You can still delete it and start a new chat.");
  await authorizedLocationDataScope(context, scope.locationId);
  await requireAdvisorConsent({ organizationId: context.organizationId, actorUserId: context.userId, purpose: scope.purpose, noticeVersion: ADVISOR_CONSENT_NOTICE_VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION });
  const fingerprint = await advisorHistoryFingerprint(stamp, scope);
  const result = await database.prepare("SELECT role,content,evidence_json,created_at,rowid AS position FROM assistant_messages WHERE conversation_id=? AND organization_id=? AND user_id=? AND json_valid(evidence_json) AND json_extract(evidence_json,'$.authorityFingerprint')=?" + (cursor ? " AND (created_at < ? OR (created_at = ? AND rowid < ?))" : "") + " ORDER BY created_at DESC,rowid DESC LIMIT 41").bind(id, context.organizationId, context.userId, fingerprint, ...(cursor ? [cursor.time, cursor.time, Number(cursor.id)] : [])).all<{role:string;content:string;evidence_json:string;created_at:number;position:number}>();
  const rows = result.results ?? [];
  const messages = rows.slice(0, 40).filter(row => {
    try { return ["user", "assistant"].includes(row.role) && JSON.parse(row.evidence_json).authorityFingerprint === fingerprint; } catch { return false; }
  }).reverse().map(({role,content}) => ({role,content}));
  if (!messages.length) throw new ApiError(409, "CONVERSATION_ACCESS_CHANGED", "Your access or connected sources have changed since this chat. Start a new chat using your current permitted records.");
  await assertAdvisorAuthority(database, actor, stamp);
  return jsonResponse({ conversationId:id, messages, scope, hasMore:rows.length>40, nextCursor:rows.length>40 ? `${rows[39].created_at}.${rows[39].position}` : null });
}

export async function DELETE(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requirePrivacyAccess(request, readers);
    await enforceRateLimit("advisor:delete-all", `${context.userId}:${clientSource(request)}`, 6, 60);
    const body = await readJsonObject(request, 1000);
    if (body.confirmDeleteAll !== true) throw new ApiError(400, "DELETE_CONFIRMATION_REQUIRED", "Confirm deletion of all your saved AI chats in this workspace.");
    const database = getD1();
    const [, deleted] = await database.batch([
      database.prepare("DELETE FROM assistant_messages WHERE organization_id = ? AND user_id = ?").bind(context.organizationId, context.userId),
      database.prepare("DELETE FROM assistant_conversations WHERE organization_id = ? AND user_id = ?").bind(context.organizationId, context.userId),
      // The generation changes even when no conversation existed at deletion.
      // Keep it atomic with deletion so an in-flight first turn cannot recreate it.
      database.prepare("INSERT INTO audit_events (id,organization_id,actor_user_id,action,resource_type,resource_id,outcome,request_id,source_hash,details_json,created_at) VALUES (?,?,?,'privacy.advisor_history_deleted','assistant_conversation',?,'success',?,?,json_object('contentDeleted',json('true'),'count',changes()),?)")
        .bind(crypto.randomUUID(), context.organizationId, context.userId, context.userId, requestId, await hashIdentifier(clientSource(request)), Math.floor(Date.now() / 1000)),
    ]);
    return jsonResponse({ deleted: true, count: Number(deleted.meta.changes ?? 0) });
  });
}

export async function PATCH(request: Request) {
  return handleApi(request, async () => {
    requireSameOrigin(request);
    const body=await readJsonObject(request,1000);
    if(typeof body.id!=="string" || typeof body.title!=="string" || !body.title.trim() || body.title.trim().length>80 || /[\u0000-\u001f\u007f]/.test(body.title)) throw new ApiError(400,"CONVERSATION_TITLE_INVALID","Use a chat name between 1 and 80 characters.");
    await readConversation(request,body.id);
    const c=await requireAccess(request,readers,"ai.basic");
    const result=await getD1().prepare("UPDATE assistant_conversations SET title=? WHERE id=? AND organization_id=? AND user_id=?").bind(body.title.trim(),body.id,c.organizationId,c.userId).run();
    if(!result.meta.changes)throw new ApiError(404,"CONVERSATION_NOT_FOUND","This chat is no longer available.");
    return jsonResponse({renamed:true});
  });
}
