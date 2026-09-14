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
import { requirePermission } from "../../../../server/permissions";
import { requireOrganizationWideLocationAccess } from "../../../../server/location-access";
import { filterReadableOpportunityTasks, requireReadableReview } from "../../../../server/opportunity-reviews";
import { ApiError } from "../../../../server/api";

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
    const context = await requireAccess(request, taskReaders, "operations.basic");
    await requirePermission(context, "operations.tasks");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("tasks:read", `${context.userId}:${clientSource(request)}`, 120, 60);
    const rows = await getDb()
      .select()
      .from(workspaceTasks)
      .where(eq(workspaceTasks.organizationId, context.organizationId))
      .orderBy(desc(workspaceTasks.createdAt))
      .limit(200);
    return jsonResponse({ tasks: (await filterReadableOpportunityTasks(context, rows)).map(taskDto) });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, taskWriters, "operations.basic");
    await enforceRateLimit("tasks:create", context.userId, 60, 60);
    const key = idempotencyKey(request);
    const input = taskCreateInput(await readJsonObject(request));
    await requirePermission(context, input.sourceType === "manual" ? "operations.manage" : "insights.create_task");
    await requireOrganizationWideLocationAccess(context);

    const reviewId = input.sourceRef?.startsWith("opportunity:") ? input.sourceRef.slice(12) : null;
    if (reviewId) {
      if (input.sourceType !== "decision") throw new ApiError(400, "INVALID_TASK_SOURCE", "Use a decision action for a saved opportunity.");
      await requireReadableReview(context, reviewId);
      const [linked] = await getDb().select().from(workspaceTasks).where(and(eq(workspaceTasks.organizationId, context.organizationId), eq(workspaceTasks.sourceType, "decision"), eq(workspaceTasks.sourceRef, input.sourceRef!))).limit(1);
      if (linked) return jsonResponse({ task: taskDto(linked), replayed: true });
    }
    const [existing] = await getDb()
      .select()
      .from(workspaceTasks)
      .where(and(
        eq(workspaceTasks.organizationId, context.organizationId),
        eq(workspaceTasks.idempotencyKey, key),
      ))
      .limit(1);
    if (existing) {
      if (existing.sourceRef?.startsWith("opportunity:")) await requireReadableReview(context, existing.sourceRef.slice(12));
      return jsonResponse({ task: taskDto(existing), replayed: true });
    }

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
    }).onConflictDoNothing().returning();

    if (!task) {
      const [existing] = await getDb().select().from(workspaceTasks).where(and(eq(workspaceTasks.organizationId, context.organizationId), reviewId ? and(eq(workspaceTasks.sourceType, "decision"), eq(workspaceTasks.sourceRef, input.sourceRef!)) : eq(workspaceTasks.idempotencyKey, key))).limit(1);
      if (!existing) throw new ApiError(409, "TASK_CONFLICT", "Refresh the action list and retry.");
      return jsonResponse({ task: taskDto(existing), replayed: true });
    }

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
    const context = await requireAccess(request, taskWriters, "operations.basic");
    await requirePermission(context, "operations.tasks");
    await requireOrganizationWideLocationAccess(context);
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

    if (before.sourceRef?.startsWith("opportunity:")) await requireReadableReview(context, before.sourceRef.slice(12));

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
