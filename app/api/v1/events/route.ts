import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { businessEvents, dailyBusinessMetrics } from "../../../../db/schema";
import { recordAudit } from "../../../../server/audit";
import { requireAccess } from "../../../../server/authorization";
import { enforceRateLimit, handleApi, jsonResponse, readJsonObject, requireSameOrigin } from "../../../../server/api";
import { measureEventImpact } from "../../../../server/intelligence";
import { businessEventCreateInput } from "../../../../server/validation";
import { requireOrganizationWideLocationAccess } from "../../../../server/location-access";
import { requirePermission } from "../../../../server/permissions";
import { approvedFactSource } from "../../../../server/integrations/trusted-data";

const readers = ["owner", "admin", "manager", "read_only"] as const;
const writers = ["owner", "admin", "manager"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers, "growth.strategy");
    await requirePermission(context, "insights.view");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("events:read", context.userId, 60, 60);
    const [events, metricRows] = await Promise.all([
      getDb().select().from(businessEvents).where(eq(businessEvents.organizationId, context.organizationId)).orderBy(asc(businessEvents.eventDate)).limit(200),
      getDb().select({
        businessDate: dailyBusinessMetrics.businessDate,
        grossSalesCents: dailyBusinessMetrics.grossSalesCents,
        netSalesCents: dailyBusinessMetrics.netSalesCents,
        costOfGoodsCents: dailyBusinessMetrics.costOfGoodsCents,
        transactionCount: dailyBusinessMetrics.transactionCount,
        unitsSold: dailyBusinessMetrics.unitsSold,
        refundsCents: dailyBusinessMetrics.refundsCents,
        discountsCents: dailyBusinessMetrics.discountsCents,
        labourCostCents: dailyBusinessMetrics.labourCostCents,
        inventoryValueCents: dailyBusinessMetrics.inventoryValueCents,
        cashBalanceCents: dailyBusinessMetrics.cashBalanceCents,
        accountsPayableCents: dailyBusinessMetrics.accountsPayableCents,
      }).from(dailyBusinessMetrics).where(and(
        eq(dailyBusinessMetrics.organizationId, context.organizationId),
        approvedFactSource(dailyBusinessMetrics.organizationId, dailyBusinessMetrics.sourceProvider, dailyBusinessMetrics.sourceConnectionId),
      )).limit(730),
    ]);
    return jsonResponse({ events: events.map((event) => ({ ...event, measuredImpact: measureEventImpact(metricRows, event.eventDate) })) });
  });
}

export async function POST(request: Request) {
  return handleApi(request, async ({ requestId }) => {
    requireSameOrigin(request);
    const context = await requireAccess(request, writers, "growth.strategy");
    await requirePermission(context, "insights.view");
    await requireOrganizationWideLocationAccess(context);
    await enforceRateLimit("events:create", context.userId, 30, 3_600);
    const input = businessEventCreateInput(await readJsonObject(request));
    const now = new Date();
    const id = crypto.randomUUID();
    const [event] = await getDb().insert(businessEvents).values({
      id,
      organizationId: context.organizationId,
      ...input,
      status: "active",
      createdByUserId: context.userId,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await recordAudit({ request, requestId, organizationId: context.organizationId, actorUserId: context.userId, action: "business_event.created", resourceType: "business_event", resourceId: id, details: { eventType: input.eventType, eventDate: input.eventDate } });
    return jsonResponse({ event }, { status: 201 });
  });
}
