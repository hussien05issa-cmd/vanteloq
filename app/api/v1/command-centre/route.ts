import { and, asc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { dailyBusinessMetrics, integrationConnections, integrationLocationMappings, organizationProfiles } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import { buildCommandCentre } from "../../../../server/intelligence";
import { buildOperatingSystem } from "../../../../server/operating-system";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { buildLightspeedRLiveSalesSnapshot, LIGHTSPEED_R_PROVIDER, type LightspeedRLiveSale } from "../../../../server/integrations/lightspeed-r";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

type LiveSaleRow = LightspeedRLiveSale;

type PaymentMixRow = {
  category: "cash" | "card" | "gift_card" | "store_credit" | "other";
  paymentTypeName: string;
  amountCents: number;
  transactionCount: number;
};

function dateOffset(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function percentageChange(current: number, previous: number) {
  return previous === 0 ? null : (current - previous) / Math.abs(previous);
}

export async function GET(request: Request) {
  return handleApi(request, async () => {
    const paymentDaysValue = new URL(request.url).searchParams.get("payment_days") ?? "1";
    if (!["1", "7", "30"].includes(paymentDaysValue)) {
      throw new ApiError(400, "PAYMENT_PERIOD_INVALID", "Choose today, the last 7 days, or the last 30 days.");
    }
    const paymentDays = Number(paymentDaysValue);
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
        sourceImportId: dailyBusinessMetrics.sourceImportId,
        locationRef: dailyBusinessMetrics.locationRef,
        updatedAt: dailyBusinessMetrics.updatedAt,
      })
      .from(dailyBusinessMetrics)
      .where(eq(dailyBusinessMetrics.organizationId, context.organizationId))
      .orderBy(asc(dailyBusinessMetrics.businessDate))
      .limit(730);
    const [branding] = await getDb().select({ displayName: organizationProfiles.displayName, logoObjectKey: organizationProfiles.logoObjectKey, logoVersion: organizationProfiles.logoVersion })
      .from(organizationProfiles).where(eq(organizationProfiles.organizationId, context.organizationId)).limit(1);
    const [connection] = await getDb().select({
      lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
      externalAccountRef: integrationConnections.externalAccountRef,
      externalAccountName: integrationConnections.externalAccountName,
      lastErrorCode: integrationConnections.lastErrorCode,
    })
      .from(integrationConnections).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationConnections.status, "connected"),
      )).limit(1);
    const ignoredRows = await getDb().select({ externalLocationRef: integrationLocationMappings.externalLocationRef })
      .from(integrationLocationMappings).where(and(
        eq(integrationLocationMappings.organizationId, context.organizationId),
        eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationLocationMappings.status, "ignored"),
      ));
    const ignored = new Set(ignoredRows.map((row) => row.externalLocationRef));
    const recentThreshold = new Date(Date.now() - 72 * 60 * 60 * 1_000).toISOString();
    const staged = await getD1().prepare(`
      SELECT external_sale_id AS externalSaleId, outlet_ref AS outletRef, sold_at AS soldAt, state,
             total_cents AS totalCents, tax_cents AS taxCents, cost_cents AS costCents,
             discount_cents AS discountCents, line_count AS lineCount
      FROM (
        SELECT *, row_number() OVER (
          PARTITION BY external_sale_id ORDER BY staged_at DESC, id DESC
        ) AS version_rank
        FROM integration_staged_sales
        WHERE organization_id = ? AND provider = ? AND sold_at >= ?
      )
      WHERE version_rank = 1
      ORDER BY sold_at ASC
      LIMIT 5000
    `).bind(context.organizationId, LIGHTSPEED_R_PROVIDER, recentThreshold).all<LiveSaleRow>();
    const today = buildLightspeedRLiveSalesSnapshot(
      (staged.results ?? []).filter((sale) => !sale.outletRef || !ignored.has(sale.outletRef)),
      context.organization.timezone,
    );
    const hasLightspeedMetrics = rows.some((row) => row.locationRef.startsWith(`${LIGHTSPEED_R_PROVIDER}:`));
    const trustedRows = connection && hasLightspeedMetrics
      ? rows.filter((row) => row.locationRef.startsWith(`${LIGHTSPEED_R_PROVIDER}:`))
      : rows;
    const baseCommandCentre = buildCommandCentre(trustedRows, context.organization.currency);
    const comparisonDate = dateOffset(today.businessDate, -7);
    const comparisonRows = trustedRows.filter((row) => row.businessDate === comparisonDate);
    const comparisonBaseline = comparisonRows.reduce((total, row) => ({
      netSalesCents: total.netSalesCents + row.netSalesCents,
      grossProfitCents: total.grossProfitCents + row.netSalesCents - row.costOfGoodsCents,
      transactionCount: total.transactionCount + row.transactionCount,
    }), { netSalesCents: 0, grossProfitCents: 0, transactionCount: 0 });
    const paymentRows = connection ? await getD1().prepare(`
      SELECT category, payment_type_name AS paymentTypeName,
             SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS amountCents,
             COUNT(DISTINCT CASE WHEN amount_cents > 0 THEN external_sale_id END) AS transactionCount
      FROM commerce_payments
      WHERE organization_id = ? AND provider = ? AND paid_at IS NOT NULL
        AND substr(paid_at, 1, 10) >= ? AND substr(paid_at, 1, 10) <= ?
      GROUP BY category, payment_type_name
      ORDER BY amountCents DESC
    `).bind(
      context.organizationId,
      LIGHTSPEED_R_PROVIDER,
      dateOffset(today.businessDate, -(paymentDays - 1)),
      today.businessDate,
    ).all<PaymentMixRow>() : { results: [] as PaymentMixRow[] };
    const commandCentre = {
      ...baseCommandCentre,
      today: {
        ...today,
        grossProfitCents: permissions.includes("metrics.profit") ? today.grossProfitCents : null,
      },
      todayComparison: comparisonRows.length ? {
        baselineDate: comparisonDate,
        currentDate: today.businessDate,
        baseline: comparisonBaseline,
        changes: {
          netSalesRate: percentageChange(today.netSalesCents, comparisonBaseline.netSalesCents),
          grossProfitRate: permissions.includes("metrics.profit")
            ? percentageChange(today.grossProfitCents, comparisonBaseline.grossProfitCents)
            : null,
          transactionRate: percentageChange(today.transactionCount, comparisonBaseline.transactionCount),
        },
      } : null,
      paymentMix: {
        period: paymentDays === 1 ? "Today" : `Last ${paymentDays} days`,
        rows: paymentRows.results ?? [],
        sourceAvailable: Boolean((paymentRows.results ?? []).length),
      },
      liveSource: {
        provider: connection ? LIGHTSPEED_R_PROVIDER : null,
        accountName: connection?.externalAccountName ?? null,
        lastErrorCode: connection?.lastErrorCode ?? null,
        lastSuccessfulSyncAt: connection?.lastSuccessfulSyncAt?.toISOString() ?? null,
        refreshIntervalSeconds: connection ? 300 : null,
      },
    };
    if (commandCentre.current && !permissions.includes("metrics.profit")) {
      Object.assign(commandCentre.current, { costOfGoodsCents: null, grossProfitCents: null, contributionCents: null, grossMarginRate: null });
      if (commandCentre.previous) Object.assign(commandCentre.previous, { costOfGoodsCents: null, grossProfitCents: null, contributionCents: null, grossMarginRate: null });
      if (commandCentre.comparisons) Object.assign(commandCentre.comparisons, { grossProfitRate: null, marginPointChange: null });
      commandCentre.trend = [];
      for (const key of ["cost_of_goods", "gross_profit", "gross_margin", "contribution_after_labour", "labour_cost", "labour_rate"]) delete commandCentre.metrics[key];
      commandCentre.insights = commandCentre.insights.filter((insight) => insight.id !== "margin-trend" && insight.id !== "labour-pressure");
    }
    if (commandCentre.current && !permissions.includes("metrics.revenue")) {
      Object.assign(commandCentre.current, { grossSalesCents: null, netSalesCents: null, transactionCount: null, unitsSold: null, refundsCents: null, discountsCents: null, averageTransactionCents: null, unitsPerTransaction: null, discountRate: null });
      if (commandCentre.previous) Object.assign(commandCentre.previous, { grossSalesCents: null, netSalesCents: null, transactionCount: null, unitsSold: null, refundsCents: null, discountsCents: null, averageTransactionCents: null, unitsPerTransaction: null, discountRate: null });
      commandCentre.trend = [];
      commandCentre.insights = [];
      for (const key of ["gross_sales", "net_sales", "transactions", "average_transaction", "units", "units_per_transaction", "discounts", "refunds"]) delete commandCentre.metrics[key];
    }
    if (commandCentre.balances && !permissions.includes("metrics.cash")) {
      Object.assign(commandCentre.balances, { cashBalanceCents: null, accountsPayableCents: null });
      delete commandCentre.metrics.operating_cash;
      delete commandCentre.metrics.accounts_payable;
    }
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
