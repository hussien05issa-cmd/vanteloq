import { and, asc, eq, gte } from "drizzle-orm";
import { getDb } from "../../../../db";
import { growthTouchpoints, growthTransactions, searchVisibilityObservations } from "../../../../db/schema";
import { buildGrowthIntelligence } from "../../../../domain/growth-intelligence";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { requirePermission } from "../../../../server/permissions";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;
const writers = ["owner", "admin"] as const;
const stages = new Set(["discovery", "website", "phone_call", "lead", "customer"]);
const isoDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/;
const textValue = (value: unknown, name: string, max = 160) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ApiError(400, "INVALID_GROWTH_RECORD", `${name} is required and must be at most ${max} characters.`);
  return value.trim();
};
const integerValue = (value: unknown, name: string, nullable = false) => {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ApiError(400, "INVALID_GROWTH_RECORD", `${name} must be a non-negative integer.`);
  return value as number;
};

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "marketing.view");
    await enforceRateLimit("growth:read", context.userId, 60, 60);
    const since = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10);
    const [touchpoints, transactions, visibility] = await Promise.all([
      getDb().select({ id: growthTouchpoints.id, occurredAt: growthTouchpoints.occurredAt, source: growthTouchpoints.source, stage: growthTouchpoints.stage, journeyRef: growthTouchpoints.journeyRef }).from(growthTouchpoints).where(and(eq(growthTouchpoints.organizationId, context.organizationId), gte(growthTouchpoints.occurredAt, since))).orderBy(asc(growthTouchpoints.occurredAt)).limit(10_000),
      getDb().select({ id: growthTransactions.id, occurredAt: growthTransactions.occurredAt, journeyRef: growthTransactions.journeyRef, revenueCents: growthTransactions.revenueCents, grossProfitCents: growthTransactions.grossProfitCents }).from(growthTransactions).where(and(eq(growthTransactions.organizationId, context.organizationId), gte(growthTransactions.occurredAt, since))).orderBy(asc(growthTransactions.occurredAt)).limit(10_000),
      getDb().select({ query: searchVisibilityObservations.query, observedDate: searchVisibilityObservations.observedDate, positionMilli: searchVisibilityObservations.positionMilli, discoveryActions: searchVisibilityObservations.discoveryActions }).from(searchVisibilityObservations).where(and(eq(searchVisibilityObservations.organizationId, context.organizationId), gte(searchVisibilityObservations.observedDate, since))).orderBy(asc(searchVisibilityObservations.observedDate)).limit(2_000),
    ]);
    return jsonResponse({ growth: buildGrowthIntelligence({ touchpoints, transactions, searchVisibility: visibility.map((row) => ({ ...row, position: row.positionMilli / 1000 })) }), period: { since, through: new Date().toISOString().slice(0, 10) }, sourceBoundary: "First-touch attribution requires a shared pseudonymous journey reference across discovery, website/call, customer and POS events." });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers);
    await requirePermission(context, "marketing.manage");
    await enforceRateLimit("growth:ingest", context.userId, 120, 60);
    const body = await readJsonObject(request, 65_536);
    const type = textValue(body.type, "type", 24);
    const sourceSystem = textValue(body.sourceSystem, "sourceSystem", 80);
    const sourceEventId = textValue(body.sourceEventId, "sourceEventId", 160);
    const now = new Date();
    const id = crypto.randomUUID();
    if (type === "touchpoint") {
      const stage = textValue(body.stage, "stage", 24);
      if (!stages.has(stage)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "stage is not supported.");
      const occurredAt = textValue(body.occurredAt, "occurredAt", 32);
      if (!isoDate.test(occurredAt)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "occurredAt must be an ISO date or UTC timestamp.");
      await getDb().insert(growthTouchpoints).values({ id, organizationId: context.organizationId, occurredAt, source: textValue(body.source, "source", 80), stage: stage as "discovery" | "website" | "phone_call" | "lead" | "customer", journeyRef: textValue(body.journeyRef, "journeyRef", 160), sourceSystem, sourceEventId, createdAt: now }).onConflictDoNothing();
    } else if (type === "transaction") {
      const occurredAt = textValue(body.occurredAt, "occurredAt", 32);
      if (!isoDate.test(occurredAt)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "occurredAt must be an ISO date or UTC timestamp.");
      await getDb().insert(growthTransactions).values({ id, organizationId: context.organizationId, occurredAt, journeyRef: textValue(body.journeyRef, "journeyRef", 160), revenueCents: integerValue(body.revenueCents, "revenueCents")!, grossProfitCents: integerValue(body.grossProfitCents ?? null, "grossProfitCents", true), sourceSystem, sourceEventId, createdAt: now }).onConflictDoNothing();
    } else if (type === "search_visibility") {
      const observedDate = textValue(body.observedDate, "observedDate", 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(observedDate)) throw new ApiError(400, "INVALID_GROWTH_RECORD", "observedDate must be YYYY-MM-DD.");
      const position = Number(body.position);
      if (!Number.isFinite(position) || position <= 0) throw new ApiError(400, "INVALID_GROWTH_RECORD", "position must be greater than zero.");
      await getDb().insert(searchVisibilityObservations).values({ id, organizationId: context.organizationId, query: textValue(body.query, "query", 180), observedDate, positionMilli: Math.round(position * 1000), discoveryActions: integerValue(body.discoveryActions ?? null, "discoveryActions", true), sourceSystem, sourceEventId, createdAt: now }).onConflictDoNothing();
    } else throw new ApiError(400, "INVALID_GROWTH_RECORD", "type must be touchpoint, transaction, or search_visibility.");
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "growth.record_ingested", resourceType: "growth_record", resourceId: id, details: { type, sourceSystem } });
    return jsonResponse({ accepted: true, id }, { status: 202 });
  });
}
