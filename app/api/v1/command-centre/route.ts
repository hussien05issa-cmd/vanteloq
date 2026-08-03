import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dailyBusinessMetrics } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { clientSource, enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import { buildCommandCentre } from "../../../../server/intelligence";

const readers = ["owner", "admin", "manager", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await enforceRateLimit("command-centre:read", `${context.userId}:${clientSource(request)}`, 120, 60);
    const rows = await getDb()
      .select({
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
      })
      .from(dailyBusinessMetrics)
      .where(eq(dailyBusinessMetrics.organizationId, context.organizationId))
      .orderBy(asc(dailyBusinessMetrics.businessDate))
      .limit(730);
    return jsonResponse({
      organization: { name: context.organization.businessName, currency: context.organization.currency, role: context.role },
      commandCentre: buildCommandCentre(rows, context.organization.currency),
    });
  });
}
