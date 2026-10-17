import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { collaborationMessages, users } from "../../../../../db/schema";
import { collaborationMessageInput } from "../../../../../domain/collaboration";
import { ApiError, clientSource, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../../server/api";
import { requireAccess } from "../../../../../server/authorization";
import { collaborationCapabilities, collaborationReaders, collaborationWriters, requireCollaborationChannel } from "../../../../../server/collaboration";
import { requirePermission } from "../../../../../server/permissions";
import { recordAudit } from "../../../../../server/audit";
import { idempotencyKey } from "../../../../../server/validation";

const dto = (row: typeof collaborationMessages.$inferSelect) => ({ id: row.id, body: row.body, authorName: row.authorName, authorUserId: row.authorUserId, createdAt: row.createdAt, taskId: row.taskId, locationId: row.locationId });
function positiveId(value: string | null) {
  if (value === null) return null;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError(400, "INVALID_DISCUSSION", "Choose a valid discussion.");
  return Number(value);
}
export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, collaborationReaders, "operations.basic");
    await requirePermission(context, "operations.tasks");
    await enforceRateLimit("collaboration:read", `${context.userId}:${clientSource(request)}`, 120, 60);
    const params = new URL(request.url).searchParams;
    const channel = await requireCollaborationChannel(context, params.get("location"), positiveId(params.get("task")));
    const before = positiveId(params.get("before"));
    const rows = await getDb().select().from(collaborationMessages).where(and(
      eq(collaborationMessages.organizationId, context.organizationId),
      channel.taskId === null ? isNull(collaborationMessages.taskId) : eq(collaborationMessages.taskId, channel.taskId),
      channel.locationId === null ? isNull(collaborationMessages.locationId) : eq(collaborationMessages.locationId, channel.locationId),
      before === null ? undefined : lt(collaborationMessages.id, before),
    )).orderBy(desc(collaborationMessages.id)).limit(61);
    return jsonResponse({ messages: rows.slice(0, 60).reverse().map(dto), hasEarlier: rows.length > 60, channel, ...await collaborationCapabilities(context) });
  });
}
export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, collaborationWriters, "operations.basic");
    await requirePermission(context, "operations.tasks");
    await enforceRateLimit("collaboration:send", context.userId, 60, 60);
    const key = idempotencyKey(request);
    let input: ReturnType<typeof collaborationMessageInput>;
    try { input = collaborationMessageInput(await readJsonObject(request)); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "INVALID_MESSAGE", error instanceof Error ? error.message : "Write a valid message."); }
    const channel = await requireCollaborationChannel(context, input.locationId, input.taskId);
    const replay = async () => {
      const [existing] = await getDb().select().from(collaborationMessages).where(and(eq(collaborationMessages.organizationId, context.organizationId), eq(collaborationMessages.idempotencyKey, key))).limit(1);
      if (!existing || existing.authorUserId !== context.userId || existing.body !== input.body || existing.taskId !== channel.taskId || existing.locationId !== channel.locationId) throw new ApiError(409, "MESSAGE_ATTEMPT_CHANGED", "This send attempt belongs to another message. Refresh and try again.");
      return jsonResponse({ message: dto(existing), replayed: true });
    };
    const [author] = await getDb().select({ name: users.displayName }).from(users).where(eq(users.id, context.userId)).limit(1);
    const [message] = await getDb().insert(collaborationMessages).values({ organizationId: context.organizationId, ...channel, authorUserId: context.userId, authorName: author?.name || "Team member", body: input.body, idempotencyKey: key, createdAt: new Date() }).onConflictDoNothing().returning();
    if (!message) return replay();
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "collaboration.message_created", resourceType: "message", resourceId: String(message.id), details: { taskId: message.taskId, locationId: message.locationId, length: input.body.length } });
    return jsonResponse({ message: dto(message) }, { status: 201 });
  });
}
