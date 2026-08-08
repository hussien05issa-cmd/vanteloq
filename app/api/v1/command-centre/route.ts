import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dailyBusinessMetrics, organizationProfiles } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { clientSource, enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import { buildCommandCentre } from "../../../../server/intelligence";
import { buildOperatingSystem } from "../../../../server/operating-system";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const context = await requireAccess(request, readers);
    await requirePermission(context, "dashboard.view");
    await enforceRateLimit("command-centre:read", `${context.userId}:${clientSource(request)}`, 120, 60);
    const permissions = await effectivePermissions(context);
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
    const [branding] = await getDb().select({ displayName: organizationProfiles.displayName, logoObjectKey: organizationProfiles.logoObjectKey, logoVersion: organizationProfiles.logoVersion })
      .from(organizationProfiles).where(eq(organizationProfiles.organizationId, context.organizationId)).limit(1);
    const commandCentre = buildCommandCentre(rows, context.organization.currency);
    if (commandCentre.current && !permissions.includes("metrics.profit")) {
      Object.assign(commandCentre.current, { costOfGoodsCents: null, grossProfitCents: null, contributionCents: null, grossMarginRate: null });
      if (commandCentre.previous) Object.assign(commandCentre.previous, { costOfGoodsCents: null, grossProfitCents: null, contributionCents: null, grossMarginRate: null });
      if (commandCentre.comparisons) Object.assign(commandCentre.comparisons, { grossProfitRate: null, marginPointChange: null });
      commandCentre.trend = [];
      commandCentre.insights = commandCentre.insights.filter((insight) => insight.id !== "margin-trend" && insight.id !== "labour-pressure");
    }
    if (commandCentre.current && !permissions.includes("metrics.revenue")) {
      Object.assign(commandCentre.current, { grossSalesCents: null, netSalesCents: null, transactionCount: null, unitsSold: null, refundsCents: null, discountsCents: null, averageTransactionCents: null, unitsPerTransaction: null, discountRate: null });
      if (commandCentre.previous) Object.assign(commandCentre.previous, { grossSalesCents: null, netSalesCents: null, transactionCount: null, unitsSold: null, refundsCents: null, discountsCents: null, averageTransactionCents: null, unitsPerTransaction: null, discountRate: null });
      commandCentre.trend = [];
      commandCentre.insights = [];
    }
    if (commandCentre.balances && !permissions.includes("metrics.cash")) Object.assign(commandCentre.balances, { cashBalanceCents: null, accountsPayableCents: null });
    const operatingSystem = buildOperatingSystem({
      ready: commandCentre.ready,
      currency: context.organization.currency,
      source: commandCentre.source,
      balances: commandCentre.balances,
      insights: commandCentre.insights,
      dataQuality: commandCentre.dataQuality,
    });
    return jsonResponse({
      organization: { name: branding?.displayName ?? context.organization.businessName, currency: context.organization.currency, role: context.role, logoAvailable: Boolean(branding?.logoObjectKey), logoVersion: branding?.logoVersion ?? 0, permissions },
      commandCentre,
      operatingSystem,
    });
  });
}
