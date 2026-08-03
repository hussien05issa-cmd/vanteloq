import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { workspaceTasks } from "../../../../db/schema";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import {
  clientSource,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
} from "../../../../server/api";
import { idempotencyKey, taskCreateInput, taskUpdateInput } from "../../../../server/validation";

const taskReaders = ["owner", "admin", "manager", "employee", "read_only"] as const;
const taskWriters = ["owner", "admin", "manager", "employee"] as const;

function taskDto(task: typeof workspaceTasks.$inferSelect) {
  return {
    id: task.id,
    title: task.title,
    detail: task.detail,
    priority: task.priority,
    status: task.status,
    assignee: task.assignee,
    dueDate: task.dueDate,
    sourceType: task.sourceType,
    sourceRef: task.sourceRef,
    expectedImpact: task.expectedImpact,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, taskReaders);
    await enforceRateLimit("tasks:read", `${context.userId}:${clientSource(request)}`, 120, 60);
    const rows = await getDb()
      .select()
      .from(workspaceTasks)
      .where(eq(workspaceTasks.organizationId, context.organizationId))
      .orderBy(desc(workspaceTasks.createdAt))
      .limit(200);
    return jsonResponse({ tasks: rows.map(taskDto) });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, taskWriters);
    await enforceRateLimit("tasks:create", context.userId, 60, 60);
    const key = idempotencyKey(request);
    const input = taskCreateInput(await readJsonObject(request));

    const [existing] = await getDb()
      .select()
      .from(workspaceTasks)
      .where(and(
        eq(workspaceTasks.organizationId, context.organizationId),
        eq(workspaceTasks.idempotencyKey, key),
      ))
      .limit(1);
    if (existing) return jsonResponse({ task: taskDto(existing), replayed: true });

    const now = new Date();
    const [task] = await getDb().insert(workspaceTasks).values({
      organizationId: context.organizationId,
      title: input.title,
      detail: input.detail,
      priority: input.priority,
      status: "open",
      assignee: input.assignee,
      dueDate: input.dueDate,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      expectedImpact: input.expectedImpact,
      createdByUserId: context.userId,
      idempotencyKey: key,
      createdAt: now,
      updatedAt: now,
    }).returning();

    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "task.created",
      resourceType: "task",
      resourceId: String(task.id),
      details: { priority: task.priority, assignee: task.assignee },
    });
    return jsonResponse({ task: taskDto(task) }, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, taskWriters);
    await enforceRateLimit("tasks:update", context.userId, 120, 60);
    const input = taskUpdateInput(await readJsonObject(request));

    const [before] = await getDb()
      .select()
      .from(workspaceTasks)
      .where(and(eq(workspaceTasks.id, input.id), eq(workspaceTasks.organizationId, context.organizationId)))
      .limit(1);
    if (!before) {
      return jsonResponse({ error: { code: "TASK_NOT_FOUND", message: "Task not found." }, requestId }, { status: 404 });
    }

    const [task] = await getDb()
      .update(workspaceTasks)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(workspaceTasks.id, input.id), eq(workspaceTasks.organizationId, context.organizationId)))
      .returning();

    await recordAudit({
      request,
      requestId,
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "task.status_changed",
      resourceType: "task",
      resourceId: String(task.id),
      details: { before: before.status, after: task.status },
    });
    return jsonResponse({ task: taskDto(task) });
  });
}
