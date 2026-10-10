import { and, desc, eq, lt } from "drizzle-orm";
import { taskArchiveCursor } from "../../../../domain/collaboration";
import { getDb } from "../../../../db";
import { workspaceTasks } from "../../../../db/schema";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import {
  ApiError,
  clientSource,
  enforceRateLimit,
  handleApi,
  jsonResponse,
  readJsonObject,
  requireSameOrigin,
} from "../../../../server/api";
import { idempotencyKey, taskCreateInput, taskUpdateInput } from "../../../../server/validation";
import { requirePermission } from "../../../../server/permissions";
import { collaborationCapabilities, collaborationMember, collaborationScope, requireCollaborationChannel, requireCollaborationTask, taskScopeWhere } from "../../../../server/collaboration";
import { requireOrganizationWideLocationAccess } from "../../../../server/location-access";
import { filterReadableOpportunityTasks, requireReadableReview } from "../../../../server/opportunity-reviews";

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
    assigneeUserId: task.assigneeUserId,
    locationId: task.locationId,
    version: task.version,
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
    const params = new URL(request.url).searchParams;
    const scope = await collaborationScope(context, params.get("location"));
    let before: number | null;
    try { before = taskArchiveCursor(params.get("before")); }
    catch { throw new ApiError(400, "INVALID_TASK_PAGE", "Choose a valid task archive page."); }
    await enforceRateLimit("tasks:read", `${context.userId}:${clientSource(request)}`, 120, 60);
    const rows = await getDb()
      .select()
      .from(workspaceTasks)
      .where(and(eq(workspaceTasks.organizationId, context.organizationId), taskScopeWhere(scope), before === null ? undefined : lt(workspaceTasks.id, before)))
      .orderBy(desc(workspaceTasks.id))
      .limit(201);
    const page = rows.slice(0, 200), hasEarlier = rows.length > 200;
    return jsonResponse({ tasks: (await filterReadableOpportunityTasks(context, page)).map(taskDto), hasEarlier, nextCursor: hasEarlier ? page.at(-1)?.id ?? null : null, ...await collaborationCapabilities(context) });
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
    if (input.sourceType !== "manual") await requireOrganizationWideLocationAccess(context);
    await requireCollaborationChannel(context, input.locationId, null);
    const assignee = input.assigneeUserId ? await collaborationMember(context, input.assigneeUserId, input.locationId, input.sourceRef) : null;

    const reviewId = input.sourceRef?.startsWith("opportunity:") ? input.sourceRef.slice(12) : null;
    if (reviewId) {
      if (input.sourceType !== "decision") throw new ApiError(400, "INVALID_TASK_SOURCE", "Use a decision action for a saved opportunity.");
      await requireReadableReview(context, reviewId);
      const [linked] = await getDb().select().from(workspaceTasks).where(and(eq(workspaceTasks.organizationId, context.organizationId), eq(workspaceTasks.sourceType, "decision"), eq(workspaceTasks.sourceRef, input.sourceRef!))).limit(1);
      if (linked) { await requireCollaborationTask(context, linked.id); return jsonResponse({ task: taskDto(linked), replayed: true }); }
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
      await requireCollaborationTask(context, existing.id);
      if (existing.createdByUserId !== context.userId || existing.title !== input.title || existing.detail !== input.detail || existing.priority !== input.priority || existing.locationId !== input.locationId || existing.assigneeUserId !== input.assigneeUserId || existing.dueDate !== input.dueDate || existing.sourceType !== input.sourceType || existing.sourceRef !== input.sourceRef || existing.expectedImpact !== input.expectedImpact) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "This save attempt belongs to a different task. Refresh and try again.");
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
      assignee: assignee?.name ?? input.assignee,
      assigneeUserId: assignee?.id ?? null,
      locationId: input.locationId,
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
      await requireCollaborationTask(context, existing.id);
      if (!reviewId && (existing.createdByUserId !== context.userId || existing.title !== input.title || existing.detail !== input.detail || existing.priority !== input.priority || existing.locationId !== input.locationId || existing.assigneeUserId !== input.assigneeUserId || existing.dueDate !== input.dueDate || existing.sourceType !== input.sourceType || existing.sourceRef !== input.sourceRef || existing.expectedImpact !== input.expectedImpact)) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "This save attempt belongs to a different task. Refresh and try again.");
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
    await enforceRateLimit("tasks:update", context.userId, 120, 60);
    const input = taskUpdateInput(await readJsonObject(request));

    const before = await requireCollaborationTask(context, input.id);
    if (!before) {
      return jsonResponse({ error: { code: "TASK_NOT_FOUND", message: "Task not found." }, requestId }, { status: 404 });
    }

    if (input.expectedVersion !== null && input.expectedVersion !== before.version) {
      throw new ApiError(409, "TASK_CHANGED", "A teammate updated this task. Refresh to see the current status before trying again.");
    }
    if (before.sourceRef?.startsWith("opportunity:")) await requireReadableReview(context, before.sourceRef.slice(12));
    if (before.sourceRef?.startsWith("shopify-privacy:")) {
      throw new ApiError(409, "PRIVACY_FULFILMENT_REQUIRED", "Complete this request in Integrations > Shopify privacy requests after reviewing and securely delivering the customer response.");
    }

    const [task] = await getDb()
      .update(workspaceTasks)
      .set({ status: input.status, version: before.version + 1, updatedAt: new Date() })
      .where(and(eq(workspaceTasks.id, input.id), eq(workspaceTasks.organizationId, context.organizationId), eq(workspaceTasks.version, before.version)))
      .returning();

    if (!task) throw new ApiError(409, "TASK_CHANGED", "A teammate updated this task. Refresh to see the current status before trying again.");

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
