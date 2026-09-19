import { getD1 } from "../../../../../db";
import { requireAccess, requirePrivacyAccess } from "../../../../../server/authorization";
import { requirePermission } from "../../../../../server/permissions";
import { requireAdvisorConsent } from "../../../../../server/privacy";
import { authorizedLocationDataScope } from "../../../../../server/location-access";
import { assertAdvisorAuthority, captureAdvisorAuthority } from "../../../../../server/advisor-completion";
import { sessionLeaseId } from "../../../../../server/session-policy";
import { advisorHistoryFingerprint, type AdvisorHistoryScope } from "../../../../../domain/advisor-memory";
import { ADVISOR_CONSENT_NOTICE_VERSION, PRIVACY_POLICY_VERSION } from "../../../../../domain/privacy-controls";
import { ApiError, clientSource, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { recordAudit } from "../../../../../server/audit";

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
    const rows = await database.prepare("SELECT id, created_at AS createdAt, updated_at AS updatedAt FROM assistant_conversations WHERE organization_id = ? AND user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 51").bind(context.organizationId, context.userId).all<{ id: string; createdAt: number; updatedAt: number }>();
    const conversations = rows.results ?? [];
    return jsonResponse({ conversations: conversations.slice(0, 50), hasMore: conversations.length > 50 });
  });
}

async function readConversation(request: Request, id: string) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new ApiError(400, "CONVERSATION_INVALID", "Choose a saved chat.");
  const context = await requireAccess(request, readers, "ai.basic");
  await requirePermission(context, "insights.view");
  await enforceRateLimit("advisor:history-read", context.userId, 30, 60);
  const database = getD1();
  const actor = { organizationId: context.organizationId, userId: context.userId, role: context.role, subject: context.identity.subject!, sessionId: await sessionLeaseId(context) };
  const stamp = await captureAdvisorAuthority(database, actor);
  const conversation = await database.prepare("SELECT id FROM assistant_conversations WHERE id=? AND organization_id=? AND user_id=? AND updated_at>=?").bind(id, context.organizationId, context.userId, Date.now() - 90 * 86400000).first();
  if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "This saved chat is unavailable.");
  const result = await database.prepare("SELECT role,content,evidence_json FROM assistant_messages WHERE conversation_id=? AND organization_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 41").bind(id, context.organizationId, context.userId).all<{role:string;content:string;evidence_json:string}>();
  const rows = result.results ?? [];
  let scope: AdvisorHistoryScope | undefined;
  try { scope = JSON.parse(rows[0]?.evidence_json ?? "{}").historyScope; } catch { /* Legacy messages have no current authority proof. */ }
  if (!scope || !["analysis", "help"].includes(scope.purpose) || !(scope.locationId === null || typeof scope.locationId === "string") || !(scope.from === null || /^\d{4}-\d{2}-\d{2}$/.test(scope.from)) || !(scope.to === null || /^\d{4}-\d{2}-\d{2}$/.test(scope.to)))
    throw new ApiError(409, "CONVERSATION_LEGACY", "This older chat cannot be reopened safely with the current access checks. You can still delete it and start a new chat.");
  await authorizedLocationDataScope(context, scope.locationId);
  await requireAdvisorConsent({ organizationId: context.organizationId, actorUserId: context.userId, purpose: scope.purpose, noticeVersion: ADVISOR_CONSENT_NOTICE_VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION });
  const fingerprint = await advisorHistoryFingerprint(stamp, scope);
  const messages = rows.slice(0, 40).filter(row => {
    try { return ["user", "assistant"].includes(row.role) && JSON.parse(row.evidence_json).authorityFingerprint === fingerprint; } catch { return false; }
  }).reverse().map(({role,content}) => ({role,content}));
  if (!messages.length) throw new ApiError(409, "CONVERSATION_ACCESS_CHANGED", "Your access or connected sources have changed since this chat. Start a new chat using your current permitted records.");
  await assertAdvisorAuthority(database, actor, stamp);
  return jsonResponse({ conversationId:id, messages, scope, hasMore:rows.length>40 });
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
    ]);
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "privacy.advisor_history_deleted", resourceType: "assistant_conversation", resourceId: context.userId, details: { contentDeleted: true, count: Number(deleted.meta.changes ?? 0) } });
    return jsonResponse({ deleted: true, count: Number(deleted.meta.changes ?? 0) });
  });
}
