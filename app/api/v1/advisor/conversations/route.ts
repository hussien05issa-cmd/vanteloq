import { getD1 } from "../../../../../db";
import { requirePrivacyAccess } from "../../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { recordAudit } from "../../../../../server/audit";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

/** Privacy controls remain available without an AI subscription or insights permission. */
export async function GET(request: Request) {
  return handleApi(request, async () => {
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
