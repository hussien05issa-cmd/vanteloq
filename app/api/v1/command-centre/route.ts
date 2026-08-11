import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { dailyBusinessMetrics, integrationConnections, integrationLocationMappings, organizationProfiles } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import { buildCommandCentre } from "../../../../server/intelligence";
import { buildOperatingSystem } from "../../../../server/operating-system";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { buildLightspeedRLiveSalesSnapshot, LIGHTSPEED_R_PROVIDER, type LightspeedRLiveSale } from "../../../../server/integrations/lightspeed-r";
import { accessibleLocations, requireAccessibleLocation } from "../../../../server/location-access";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

type LiveSaleRow = LightspeedRLiveSale;

type PaymentMixRow = {
  category: "cash" | "card" | "gift_card" | "store_credit" | "other";
  paymentTypeName: string;
  amountCents: number;
  transactionCount: number;
  outletRef: string | null;
};

function dateOffset(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function percentageChange(current: number, previous: number) {
  return previous === 0 ? null : (current - previous) / Math.abs(previous);
}

function buildDailySourceSnapshot(
  rows: Array<{
    businessDate: string;
    netSalesCents: number;
    costOfGoodsCents: number;
    transactionCount: number;
    unitsSold: number;
    refundsCents: number;
    discountsCents: number;
    updatedAt: Date;
  }>,
  timeZone: string,
) {
  const latestDate = rows.at(-1)?.businessDate;
  if (!latestDate) {
    return {
      ...buildLightspeedRLiveSalesSnapshot([], timeZone),
      sourceGranularity: "daily" as const,
    };
  }
  const latestRows = rows.filter((row) => row.businessDate === latestDate);
  const netSalesCents = latestRows.reduce((sum, row) => sum + row.netSalesCents, 0);
  const costOfGoodsCents = latestRows.reduce((sum, row) => sum + row.costOfGoodsCents, 0);
  const transactionCount = latestRows.reduce((sum, row) => sum + row.transactionCount, 0);
  return {
    businessDate: latestDate,
    netSalesCents,
    grossProfitCents: Math.max(0, netSalesCents - costOfGoodsCents),
    averageTransactionCents: transactionCount ? Math.round(netSalesCents / transactionCount) : null,
    transactionCount,
    unitsSold: latestRows.reduce((sum, row) => sum + row.unitsSold, 0),
    refundsCents: latestRows.reduce((sum, row) => sum + row.refundsCents, 0),
    discountsCents: latestRows.reduce((sum, row) => sum + row.discountsCents, 0),
    lastSaleAt: [...latestRows].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0]?.updatedAt.toISOString() ?? null,
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: new Intl.DateTimeFormat("en-CA", { hour: "numeric", hour12: true, timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, hour))),
      netSalesCents: 0,
      grossProfitCents: 0,
      transactionCount: 0,
    })),
    sourceGranularity: "daily" as const,
  };
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
    const requestedLocationId = new URL(request.url).searchParams.get("location");
    const availableLocations = await accessibleLocations(context);
    const selectedLocation = requestedLocationId
      ? await requireAccessibleLocation(context, requestedLocationId)
      : null;
    const selectedMappings = selectedLocation
      ? await getDb().select({
          provider: integrationLocationMappings.provider,
          externalLocationRef: integrationLocationMappings.externalLocationRef,
        }).from(integrationLocationMappings).where(and(
          eq(integrationLocationMappings.organizationId, context.organizationId),
          eq(integrationLocationMappings.localLocationId, selectedLocation.id),
          eq(integrationLocationMappings.status, "mapped"),
        ))
      : [];
    const selectedExternalRefs = new Set(selectedMappings.map((mapping) => mapping.externalLocationRef));
    const selectedMetricRefs = new Set(selectedLocation ? [selectedLocation.id, selectedLocation.name] : []);
    for (const mapping of selectedMappings) {
      selectedMetricRefs.add(mapping.externalLocationRef);
      selectedMetricRefs.add(`${mapping.provider}:${mapping.externalLocationRef}`);
    }
    const recentRows = await getDb()
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
      .orderBy(desc(dailyBusinessMetrics.businessDate))
      .limit(730);
    const rows = [...recentRows].reverse();
    const [branding] = await getDb().select({ displayName: organizationProfiles.displayName, logoObjectKey: organizationProfiles.logoObjectKey, logoVersion: organizationProfiles.logoVersion })
      .from(organizationProfiles).where(eq(organizationProfiles.organizationId, context.organizationId)).limit(1);
    const connectionRows = await getDb().select({
      provider: integrationConnections.provider,
      lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
      externalAccountRef: integrationConnections.externalAccountRef,
      externalAccountName: integrationConnections.externalAccountName,
      lastErrorCode: integrationConnections.lastErrorCode,
    })
      .from(integrationConnections).where(and(
        eq(integrationConnections.organizationId, context.organizationId),
        eq(integrationConnections.status, "connected"),
      ));
    const supportedPosProviders = new Set(["lightspeed", "lightspeed-r", "shopify", "shopify-pos", "square", "clover", "moneris"]);
    const sourceConnections = connectionRows.filter((row) => supportedPosProviders.has(row.provider));
    const sourceConnection = sourceConnections[0] ?? null;
    const connection = sourceConnections.length === 1 && sourceConnection?.provider === LIGHTSPEED_R_PROVIDER ? sourceConnection : null;
    const connectedPosProviders = new Set(sourceConnections.map((row) => row.provider));
    const ignoredRows = await getDb().select({ externalLocationRef: integrationLocationMappings.externalLocationRef })
      .from(integrationLocationMappings).where(and(
        eq(integrationLocationMappings.organizationId, context.organizationId),
        eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationLocationMappings.status, "ignored"),
      ));
    const ignored = new Set(ignoredRows.map((row) => row.externalLocationRef));
    const recentThreshold = new Date(Date.now() - 72 * 60 * 60 * 1_000).toISOString();
    const staged = connection ? await getD1().prepare(`
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
    `).bind(context.organizationId, LIGHTSPEED_R_PROVIDER, recentThreshold).all<LiveSaleRow>() : { results: [] as LiveSaleRow[] };
    const hasProviderMetrics = rows.some((row) => connectedPosProviders.has(row.locationRef.split(":", 1)[0]));
    const providerTrustedRows = connectedPosProviders.size && hasProviderMetrics
      ? rows.filter((row) => connectedPosProviders.has(row.locationRef.split(":", 1)[0]))
      : rows;
    const trustedRows = selectedLocation
      ? providerTrustedRows.filter((row) => selectedMetricRefs.has(row.locationRef))
      : providerTrustedRows;
    const today = connection
      ? {
          ...buildLightspeedRLiveSalesSnapshot(
            (staged.results ?? []).filter((sale) =>
              (!sale.outletRef || !ignored.has(sale.outletRef)) &&
              (!selectedLocation || Boolean(sale.outletRef && selectedExternalRefs.has(sale.outletRef))),
            ),
            context.organization.timezone,
          ),
          sourceGranularity: "intraday" as const,
        }
      : buildDailySourceSnapshot(trustedRows, context.organization.timezone);
    const baseCommandCentre = buildCommandCentre(trustedRows, context.organization.currency);
    const comparisonDate = dateOffset(today.businessDate, -7);
    const comparisonRows = trustedRows.filter((row) => row.businessDate === comparisonDate);
    const comparisonBaseline = comparisonRows.reduce((total, row) => ({
      netSalesCents: total.netSalesCents + row.netSalesCents,
      grossProfitCents: total.grossProfitCents + row.netSalesCents - row.costOfGoodsCents,
      transactionCount: total.transactionCount + row.transactionCount,
    }), { netSalesCents: 0, grossProfitCents: 0, transactionCount: 0 });
    const paymentRows = sourceConnections.length ? await getD1().prepare(`
      SELECT provider, category, payment_type_name AS paymentTypeName, outlet_ref AS outletRef,
             SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS amountCents,
             COUNT(DISTINCT CASE WHEN amount_cents > 0 THEN external_sale_id END) AS transactionCount
      FROM commerce_payments
      WHERE organization_id = ? AND paid_at IS NOT NULL
        AND substr(paid_at, 1, 10) >= ? AND substr(paid_at, 1, 10) <= ?
      GROUP BY provider, category, payment_type_name, outlet_ref
      ORDER BY amountCents DESC
    `).bind(
      context.organizationId,
      dateOffset(today.businessDate, -(paymentDays - 1)),
      today.businessDate,
    ).all<PaymentMixRow & { provider: string }>() : { results: [] as Array<PaymentMixRow & { provider: string }> };
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
        rows: (paymentRows.results ?? [])
          .filter((row) => connectedPosProviders.has(row.provider))
          .filter((row) => !selectedLocation || Boolean(row.outletRef && selectedExternalRefs.has(row.outletRef)))
          .reduce<Array<Omit<PaymentMixRow, "outletRef">>>((combined, row) => {
            const existing = combined.find((item) => item.category === row.category && item.paymentTypeName === row.paymentTypeName);
            if (existing) {
              existing.amountCents += row.amountCents;
              existing.transactionCount += row.transactionCount;
            } else {
              combined.push({ category: row.category, paymentTypeName: row.paymentTypeName, amountCents: row.amountCents, transactionCount: row.transactionCount });
            }
            return combined;
          }, []),
        sourceAvailable: Boolean((paymentRows.results ?? []).some((row) => !selectedLocation || Boolean(row.outletRef && selectedExternalRefs.has(row.outletRef)))),
      },
      liveSource: {
        provider: sourceConnections.length === 1 ? sourceConnection?.provider ?? null : sourceConnections.length ? "multiple" : null,
        accountName: sourceConnections.length === 1 ? sourceConnection?.externalAccountName ?? null : sourceConnections.length ? `${sourceConnections.length} connected POS accounts` : null,
        lastErrorCode: sourceConnections.find((item) => item.lastErrorCode)?.lastErrorCode ?? null,
        lastSuccessfulSyncAt: sourceConnections
          .map((item) => item.lastSuccessfulSyncAt)
          .filter((value): value is Date => Boolean(value))
          .sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() ?? null,
        refreshIntervalSeconds: sourceConnections.length ? 300 : null,
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
      organization: {
        name: branding?.displayName ?? context.organization.businessName,
        currency: context.organization.currency,
        role: context.role,
        logoAvailable: Boolean(branding?.logoObjectKey),
        logoVersion: branding?.logoVersion ?? 0,
        selectedLocation: selectedLocation ? { id: selectedLocation.id, name: selectedLocation.name } : null,
        locations: availableLocations.map((location) => ({ id: location.id, name: location.name })),
        scopeLabel: selectedLocation?.name ?? "All locations",
        permissions,
      },
      commandCentre,
      operatingSystem,
    });
  });
}
