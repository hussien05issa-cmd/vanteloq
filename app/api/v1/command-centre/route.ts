import { hasAddon } from "../../../../server/entitlements/engine";
import { loadExecutiveFinance } from "../../../../server/executive-finance";
import { buildExecutiveReport } from "../../../../server/executive-report";
import { executivePeriod } from "../../../../domain/executive-metrics";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { bankAccounts, dailyBusinessMetrics, integrationConnections, integrationLocationMappings, organizationProfiles } from "../../../../db/schema";
import { requireAccess } from "../../../../server/authorization";
import { ApiError, clientSource, enforceRateLimit, handleApi, jsonResponse } from "../../../../server/api";
import { buildCommandCentre } from "../../../../server/intelligence";
import { buildOperatingSystem } from "../../../../server/operating-system";
import { effectivePermissions, requirePermission } from "../../../../server/permissions";
import { buildLightspeedRLiveSalesSnapshot, LIGHTSPEED_R_PROVIDER, type LightspeedRLiveSale } from "../../../../server/integrations/lightspeed-r";
import { authorizedLocationDataScope } from "../../../../server/location-access";
import { scopeExternalRef } from "../../../../domain/integration-source";
import { approvedBankSource, approvedFactSource, noActiveIntegrationLease } from "../../../../server/integrations/trusted-data";
import { calculateVerifiedPurchasingCapacity } from "../../../../domain/purchasing-intelligence";
import { businessClock, salesDay, sameWeekdayComparison, salesChange } from "../../../../domain/intraday-sales";
import { businessTimestampRange } from "../../../../domain/business-period";

const readers = ["owner", "admin", "manager", "employee", "read_only"] as const;

type LiveSaleRow = LightspeedRLiveSale & { connectionId: string };

type PaymentMixRow = {
  connectionId: string;
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
    grossProfitCents: netSalesCents - costOfGoodsCents,
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

// Shared by opportunity capture so saved evidence uses the exact same source and
// permission filtering as the dashboard, without an internal HTTP request.
export async function loadCommandCentre(request: Request) {
    const paymentDaysValue = new URL(request.url).searchParams.get("payment_days") ?? "1";
    if (!["1", "7", "30"].includes(paymentDaysValue)) {
      throw new ApiError(400, "PAYMENT_PERIOD_INVALID", "Choose today, the last 7 days, or the last 30 days.");
    }
    const paymentDays = Number(paymentDaysValue);
    const context = await requireAccess(request, readers, "dashboard.core");
    await requirePermission(context, "dashboard.view");
    await enforceRateLimit("command-centre:read", `${context.userId}:${clientSource(request)}`, 120, 60);
    const permissions = await effectivePermissions(context);
    const executive = new URL(request.url).searchParams.get("executive") === "1";
    let period: ReturnType<typeof executivePeriod> | undefined;
    if (executive) { try { period = executivePeriod(new URL(request.url).searchParams,businessClock(new Date(),context.organization.timezone)!.date); } catch(error) { throw new ApiError(400,"REPORT_PERIOD_INVALID",error instanceof Error ? error.message : "Invalid reporting period."); } }
    const requestedLocationId = new URL(request.url).searchParams.get("location");
    const locationAccess = await authorizedLocationDataScope(context, requestedLocationId);
    const availableLocations = locationAccess.locations;
    const selectedLocation = locationAccess.selectedLocation;
    const selectedCommerceLocationKeys = new Set(
      (locationAccess.providerLocations ?? []).map(
        (mapping) => `${mapping.connectionId}\u0000${mapping.externalLocationRef}`,
      ),
    );
    const selectedMetricRefs = new Set(locationAccess.locationRefs ?? []);
    const locationRestricted = locationAccess.locationRefs !== null;
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
        labourCostReported: dailyBusinessMetrics.labourCostReported,
        sourceProvider: dailyBusinessMetrics.sourceProvider,
        inventoryValueCents: dailyBusinessMetrics.inventoryValueCents,
        cashBalanceCents: dailyBusinessMetrics.cashBalanceCents,
        accountsPayableCents: dailyBusinessMetrics.accountsPayableCents,
        sourceImportId: dailyBusinessMetrics.sourceImportId,
        locationRef: dailyBusinessMetrics.locationRef,
        updatedAt: dailyBusinessMetrics.updatedAt,
      })
      .from(dailyBusinessMetrics)
      .where(and(
        eq(dailyBusinessMetrics.organizationId, context.organizationId),
        ...(period ? [gte(dailyBusinessMetrics.businessDate, period.comparisonFrom < period.from ? period.comparisonFrom : period.from), lte(dailyBusinessMetrics.businessDate, period.to)] : []),
        approvedFactSource(dailyBusinessMetrics.organizationId, dailyBusinessMetrics.sourceProvider, dailyBusinessMetrics.sourceConnectionId),
      ))
      .orderBy(desc(dailyBusinessMetrics.businessDate))
      .limit(period ? 20001 : 730);
    if (period && recentRows.length > 20000) throw new ApiError(422,"REPORT_TOO_LARGE","Choose a shorter period or one location. No partial totals are shown.");
    const rows = [...recentRows].reverse();
    const [branding] = await getDb().select({ displayName: organizationProfiles.displayName, logoObjectKey: organizationProfiles.logoObjectKey, logoVersion: organizationProfiles.logoVersion })
      .from(organizationProfiles).where(eq(organizationProfiles.organizationId, context.organizationId)).limit(1);
    const connectionRows = await getDb().select({
      id: integrationConnections.id,
      provider: integrationConnections.provider,
      sourceNamespace: integrationConnections.sourceNamespace,
      status: integrationConnections.status,
      dataPromotionStatus: integrationConnections.dataPromotionStatus,
      lastSuccessfulSyncAt: integrationConnections.lastSuccessfulSyncAt,
      externalAccountRef: integrationConnections.externalAccountRef,
      externalAccountName: integrationConnections.externalAccountName,
      lastErrorCode: integrationConnections.lastErrorCode,
      syncLeaseOwner: integrationConnections.syncLeaseOwner,
      syncLeaseExpiresAt: integrationConnections.syncLeaseExpiresAt,
    })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, context.organizationId));
    const plaidAccountRows = await getDb().select({
      accountType: bankAccounts.accountType,
      currency: bankAccounts.currency,
      connectionStatus: bankAccounts.connectionStatus,
      availableBalanceCents: bankAccounts.availableBalanceCents,
      liveBalanceCents: bankAccounts.liveBalanceCents,
      lastSyncAt: bankAccounts.lastSyncAt,
    }).from(bankAccounts).where(and(
      eq(bankAccounts.organizationId, context.organizationId),
      eq(bankAccounts.provider, "plaid"),
      approvedBankSource(bankAccounts.organizationId, bankAccounts.provider, bankAccounts.externalItemRef),
    ));
    // Only providers that produce canonical sale facts belong in the live sales
    // source set. Payment-only connectors such as Moneris are reconciled in
    // BookLoQ and must never make the dashboard claim another POS is live.
    const supportedPosProviders = new Set(["lightspeed", "lightspeed-r", "shopify", "shopify-pos", "square", "clover"]);
    const posConnectionRows = connectionRows.filter((row) => supportedPosProviders.has(row.provider));
    const connectedSourceConnections = posConnectionRows.filter((row) => row.status === "connected");
    const now = Date.now();
    const sourceConnections = connectedSourceConnections.filter((row) => row.dataPromotionStatus === "approved"
      && (!row.syncLeaseOwner || !row.syncLeaseExpiresAt || row.syncLeaseExpiresAt.getTime() <= now));
    const canViewVerifiedProfit = permissions.includes("metrics.revenue") && permissions.includes("metrics.profit") && !sourceConnections.some((row) =>
      row.provider === "square" && row.lastErrorCode === "SQUARE_PRODUCT_COST_UNAVAILABLE"
    );
    const sourceConnection = sourceConnections[0] ?? null;
    const rSeriesConnections = sourceConnections.filter((row) => row.provider === LIGHTSPEED_R_PROVIDER);
    const rSeriesOnly = rSeriesConnections.length > 0 && rSeriesConnections.length === sourceConnections.length;
    const commonSyncMs = Math.min(...rSeriesConnections.map((row) => row.lastSuccessfulSyncAt?.getTime() ?? 0));
    const commonSync = Number.isFinite(commonSyncMs) && commonSyncMs > 0 && commonSyncMs <= now ? new Date(commonSyncMs) : null;
    const currentBusinessDate = businessClock(new Date(now), context.organization.timezone)!.date;
    const rSeriesCurrent = rSeriesOnly && commonSync !== null && businessClock(commonSync, context.organization.timezone)!.date === currentBusinessDate;
    const connectedPosProviders = new Set(sourceConnections.map((row) => row.provider));
    const connectedSourceIds = new Set(sourceConnections.map((row) => row.id));
    const ignoredRows = await getDb().select({
      externalLocationRef: integrationLocationMappings.externalLocationRef,
      sourceNamespace: integrationConnections.sourceNamespace,
    })
      .from(integrationLocationMappings)
      .innerJoin(integrationConnections, and(
        eq(integrationConnections.id, integrationLocationMappings.connectionId),
        eq(integrationConnections.organizationId, integrationLocationMappings.organizationId),
      ))
      .where(and(
        eq(integrationLocationMappings.organizationId, context.organizationId),
        eq(integrationLocationMappings.provider, LIGHTSPEED_R_PROVIDER),
        eq(integrationLocationMappings.status, "ignored"),
        eq(integrationConnections.status, "connected"),
        eq(integrationConnections.dataPromotionStatus, "approved"),
        noActiveIntegrationLease(integrationConnections.syncLeaseOwner, integrationConnections.syncLeaseExpiresAt),
      ));
    const ignored = new Set(ignoredRows.map((row) => scopeExternalRef(row.sourceNamespace, row.externalLocationRef)).filter((value): value is string => Boolean(value)));
    const recentThreshold = dateOffset(currentBusinessDate, -8);
    const rSeriesPlaceholders = rSeriesConnections.map(() => "?").join(", ");
    const staged = rSeriesCurrent ? await getD1().prepare(`
      SELECT connection_id AS connectionId, external_sale_id AS externalSaleId, outlet_ref AS outletRef, sold_at AS soldAt, state,
             total_cents AS totalCents, tax_cents AS taxCents, cost_cents AS costCents,
             discount_cents AS discountCents, line_count AS lineCount
      FROM (
        SELECT *, row_number() OVER (
          PARTITION BY connection_id, external_sale_id ORDER BY staged_at DESC, id DESC
        ) AS version_rank
        FROM integration_staged_sales
        WHERE organization_id = ? AND provider = ? AND connection_id IN (${rSeriesPlaceholders})
      )
      WHERE version_rank = 1 AND sold_at >= ?
      ORDER BY sold_at ASC
      LIMIT 20001
    `).bind(context.organizationId, LIGHTSPEED_R_PROVIDER, ...rSeriesConnections.map((row) => row.id), recentThreshold).all<LiveSaleRow>() : { results: [] as LiveSaleRow[] };
    const trustedRows = locationRestricted
      ? rows.filter((row) => selectedMetricRefs.has(row.locationRef))
      : rows;
    const intradayTruncated = (staged.results?.length ?? 0) > 20000;
    const rSeriesIntraday = rSeriesCurrent && !intradayTruncated;
    const approvedSales = (staged.results ?? []).filter((sale) =>
      (!sale.outletRef || !ignored.has(sale.outletRef)) &&
      (!locationRestricted || Boolean(sale.outletRef && selectedCommerceLocationKeys.has(`${sale.connectionId}\u0000${sale.outletRef}`))),
    ).map((sale) => ({ ...sale,
      // Legacy staging defaults missing costs to zero. Without explicit zero-cost
      // provenance, withhold profit for a nonzero sale or refund with zero cost.
      costVerified: sale.costCents !== 0 || sale.totalCents === sale.taxCents,
    }));
    const today = rSeriesIntraday
      ? {
          ...salesDay(approvedSales, context.organization.timezone, commonSync!),
          sourceGranularity: "intraday" as const,
        }
      : buildDailySourceSnapshot(trustedRows, context.organization.timezone);
    const baseCommandCentre = buildCommandCentre(trustedRows, context.organization.currency, new Date(), period);
    const plaidConnections = connectionRows.filter((row) => row.provider === "plaid"
      && row.status === "connected"
      && row.dataPromotionStatus === "approved"
      && (!row.syncLeaseOwner || !row.syncLeaseExpiresAt || row.syncLeaseExpiresAt.getTime() <= now));
    const plaidCash = calculateVerifiedPurchasingCapacity({
      connectionVerified: plaidConnections.length > 0,
      nowMs: now,
      maximumAgeMs: 48 * 60 * 60 * 1000,
      baseCurrency: context.organization.currency,
      cashSafetyReserveCents: 0,
      outstandingBillsCents: 0,
      openPurchaseCommitmentsCents: 0,
      accounts: plaidAccountRows.map((account) => ({
        ...account,
        lastSyncAtMs: account.lastSyncAt?.getTime() ?? null,
      })),
    });
    if (!period && !locationRestricted && plaidCash.status === "available" && plaidCash.verifiedCashCents !== null) {
      const latestBankSync = plaidAccountRows
        .map((account) => account.lastSyncAt)
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
      const balanceDate = (latestBankSync ?? new Date()).toISOString().slice(0, 10);
      baseCommandCentre.balances = {
        inventoryValueCents: baseCommandCentre.balances?.inventoryValueCents ?? null,
        cashBalanceCents: plaidCash.verifiedCashCents,
        accountsPayableCents: baseCommandCentre.balances?.accountsPayableCents ?? null,
      };
      Object.assign(baseCommandCentre.metrics, { operating_cash: {
        metricId: "operating_cash",
        metricName: "Operating cash",
        value: plaidCash.verifiedCashCents,
        unit: "minor_currency",
        currency: context.organization.currency,
        actuality: "actual",
        periodStart: balanceDate,
        periodEnd: balanceDate,
        comparisonPeriodStart: null,
        comparisonPeriodEnd: null,
        sourceSystem: "Plaid read-only bank feed",
        sourceAccount: `${plaidCash.accountsUsed} organization-wide depository account${plaidCash.accountsUsed === 1 ? "" : "s"}`,
        sourceRecords: plaidCash.accountsUsed,
        sourceTimestamp: latestBankSync?.toISOString() ?? null,
        calculationMethod: "Sum fresh base-currency depository available balances, falling back to current balance. Credit availability is excluded.",
        calculationVersion: "plaid-cash.v1",
        freshnessStatus: "current",
        confidenceLevel: "high",
        confidenceBasis: [
          `${plaidCash.accountsUsed} healthy owner-authorized account${plaidCash.accountsUsed === 1 ? "" : "s"}`,
          "Balances synchronized within 48 hours",
          "Provider connection and token exchange verified",
        ],
        limitations: ["Organization-wide balance; no unverified location allocation", "Pending bank transactions do not post to the ledger automatically"],
        generatedAt: new Date().toISOString(),
      }});
    }
    const comparisonDate = dateOffset(today.businessDate, -7);
    const comparisonRows = trustedRows.filter((row) => row.businessDate === comparisonDate);
    const comparisonBaseline = comparisonRows.reduce((total, row) => ({
      netSalesCents: total.netSalesCents + row.netSalesCents,
      grossProfitCents: total.grossProfitCents + row.netSalesCents - row.costOfGoodsCents,
      transactionCount: total.transactionCount + row.transactionCount,
    }), { netSalesCents: 0, grossProfitCents: 0, transactionCount: 0 });
    const intradayComparison = rSeriesIntraday ? sameWeekdayComparison(
      approvedSales, context.organization.timezone, commonSync!,
      rSeriesConnections.filter((connection) => !locationRestricted || (locationAccess.providerLocations ?? []).some((location) => location.connectionId === connection.id)).map((connection) => connection.id),
    ) : null;
    const paymentWindow = businessTimestampRange("paid_at", dateOffset(today.businessDate, -(paymentDays - 1)), today.businessDate, context.organization.timezone);
    const paymentRows = sourceConnections.length ? await getD1().prepare(`
      SELECT provider, connection_id AS connectionId, category, payment_type_name AS paymentTypeName, outlet_ref AS outletRef,
             SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS amountCents,
             COUNT(DISTINCT CASE WHEN amount_cents > 0 THEN external_sale_id END) AS transactionCount
      FROM commerce_payments
      WHERE organization_id = ? AND paid_at IS NOT NULL
        AND ${paymentWindow.sql}
      GROUP BY provider, connection_id, category, payment_type_name, outlet_ref
      ORDER BY amountCents DESC
    `).bind(
      context.organizationId,
      ...paymentWindow.bindings,
    ).all<PaymentMixRow & { provider: string }>() : { results: [] as Array<PaymentMixRow & { provider: string }> };
    const commandCentre = {
      ...baseCommandCentre,
      today: {
        ...today,
        grossProfitCents: canViewVerifiedProfit ? today.grossProfitCents : null,
        asOf: rSeriesIntraday ? commonSync!.toISOString() : null,
        timeZone: context.organization.timezone,
        hourlyUnavailableReason: intradayTruncated ? "Hourly history exceeds the safe review limit. Daily summaries are shown; no partial hourly total is presented." : rSeriesOnly && !rSeriesCurrent ? "The POS has not completed a synchronization for the current business day. The latest daily summary is shown." : null,
      },
      todayComparison: rSeriesIntraday ? intradayComparison : comparisonRows.length ? {
        baselineDate: comparisonDate,
        currentDate: today.businessDate,
        basis: "full_day" as const,
        baseline: comparisonBaseline,
        changes: {
          netSalesRate: percentageChange(today.netSalesCents, comparisonBaseline.netSalesCents),
          grossProfitRate: canViewVerifiedProfit
            ? salesChange(today.grossProfitCents, comparisonBaseline.grossProfitCents)
            : null,
          transactionRate: percentageChange(today.transactionCount, comparisonBaseline.transactionCount),
        },
      } : null,
      paymentMix: {
        period: paymentDays === 1 ? `Business date: ${today.businessDate}` : `${dateOffset(today.businessDate, -(paymentDays - 1))} to ${today.businessDate}`,
        rows: (paymentRows.results ?? [])
          .filter((row) => connectedSourceIds.has(row.connectionId))
          .filter((row) => !locationRestricted || Boolean(row.outletRef && selectedCommerceLocationKeys.has(`${row.connectionId}\u0000${row.outletRef}`)))
          .reduce<Array<Omit<PaymentMixRow, "outletRef" | "connectionId">>>((combined, row) => {
            const existing = combined.find((item) => item.category === row.category && item.paymentTypeName === row.paymentTypeName);
            if (existing) {
              existing.amountCents += row.amountCents;
              existing.transactionCount += row.transactionCount;
            } else {
              combined.push({ category: row.category, paymentTypeName: row.paymentTypeName, amountCents: row.amountCents, transactionCount: row.transactionCount });
            }
            return combined;
          }, []),
        sourceAvailable: Boolean((paymentRows.results ?? []).some((row) => connectedSourceIds.has(row.connectionId) && (!locationRestricted || Boolean(row.outletRef && selectedCommerceLocationKeys.has(`${row.connectionId}\u0000${row.outletRef}`))))),
      },
      liveSource: {
        provider: sourceConnections.length === 1 ? sourceConnection?.provider ?? null : sourceConnections.length ? "multiple" : null,
        providers: [...connectedPosProviders],
        accountName: sourceConnections.length === 1 ? sourceConnection?.externalAccountName ?? null : sourceConnections.length ? `${sourceConnections.length} connected POS accounts` : null,
        lastErrorCode: sourceConnections.find((item) => item.lastErrorCode)?.lastErrorCode ?? null,
        lastSuccessfulSyncAt: sourceConnections
          .map((item) => item.lastSuccessfulSyncAt)
          .filter((value): value is Date => Boolean(value))
          .sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() ?? null,
        refreshIntervalSeconds: sourceConnections.length ? 300 : null,
      },
    };
    if (!canViewVerifiedProfit) {
      if (commandCentre.current) Object.assign(commandCentre.current, { costOfGoodsCents: null, grossProfitCents: null, contributionCents: null, grossMarginRate: null });
      if (commandCentre.previous) Object.assign(commandCentre.previous, { costOfGoodsCents: null, grossProfitCents: null, contributionCents: null, grossMarginRate: null });
      if (commandCentre.comparisons) Object.assign(commandCentre.comparisons, { grossProfitRate: null, marginPointChange: null });
      // Missing costs do not erase verified revenue. The chart already supports gaps in profit.
      for (const point of commandCentre.trend) Object.assign(point, { grossProfitCents: null });
      for (const key of ["cost_of_goods", "gross_profit", "gross_margin", "contribution_after_labour", "labour_cost", "labour_rate"]) delete (commandCentre.metrics as Record<string, unknown>)[key];
      commandCentre.insights = commandCentre.insights.filter((insight) => insight.id !== "margin-trend" && insight.id !== "labour-pressure");
      for (const hour of commandCentre.today.hourly) Object.assign(hour, { grossProfitCents: null });
      if (commandCentre.todayComparison) {
        Object.assign(commandCentre.todayComparison.baseline, { grossProfitCents: null });
        Object.assign(commandCentre.todayComparison.changes, { grossProfitRate: null });
      }
      if (commandCentre.todayComparison && "hourly" in commandCentre.todayComparison.baseline) {
        for (const hour of commandCentre.todayComparison.baseline.hourly) hour.grossProfitCents = null;
      }
      if (commandCentre.periodComparisons) {
        for (const comparison of [commandCentre.periodComparisons.sevenDays, commandCentre.periodComparisons.thirtyDays]) {
          Object.assign(comparison.current, { costOfGoodsCents: null, grossProfitCents: null, contributionCents: null, grossMarginRate: null, labourCostCents: null, labourRate: null });
          Object.assign(comparison.previous, { costOfGoodsCents: null, grossProfitCents: null, contributionCents: null, grossMarginRate: null, labourCostCents: null, labourRate: null });
          Object.assign(comparison.changes, { grossProfitRate: null });
        }
      }
      for (const point of commandCentre.forecast.points) Object.assign(point, { grossProfitCents: null });
    }
    if (!permissions.includes("metrics.revenue")) {
      for (const totals of [commandCentre.current, commandCentre.previous]) {
        if (totals) Object.assign(totals, { labourRate: null, contributionCents: null, grossMarginRate: null });
      }
      commandCentre.comparisons = null;
      for (const key of ["labour_rate", "gross_margin", "contribution_after_labour"]) delete (commandCentre.metrics as Record<string, unknown>)[key];
      if (commandCentre.current) Object.assign(commandCentre.current, { grossSalesCents: null, netSalesCents: null, transactionCount: null, unitsSold: null, refundsCents: null, discountsCents: null, averageTransactionCents: null, unitsPerTransaction: null, discountRate: null });
      if (commandCentre.previous) Object.assign(commandCentre.previous, { grossSalesCents: null, netSalesCents: null, transactionCount: null, unitsSold: null, refundsCents: null, discountsCents: null, averageTransactionCents: null, unitsPerTransaction: null, discountRate: null });
      commandCentre.trend = [];
      commandCentre.insights = [];
      for (const key of ["gross_sales", "net_sales", "transactions", "average_transaction", "units", "units_per_transaction", "discounts", "refunds"]) delete (commandCentre.metrics as Record<string, unknown>)[key];
      Object.assign(commandCentre.today, {
        netSalesCents: null,
        grossProfitCents: null,
        averageTransactionCents: null,
        transactionCount: null,
        unitsSold: null,
        refundsCents: null,
        discountsCents: null,
        hourly: [],
      });
      commandCentre.todayComparison = null;
      commandCentre.periodComparisons = null;
      Object.assign(commandCentre.forecast, {
        available: false,
        verifiedDays: 0,
        totalNetSalesCents: null,
        lowCents: null,
        highCents: null,
        confidence: "unavailable",
        points: [],
      });
      commandCentre.paymentMix.rows = [];
      commandCentre.paymentMix.sourceAvailable = false;
    }
    if (commandCentre.balances && !permissions.includes("metrics.cash")) {
      Object.assign(commandCentre.balances, { cashBalanceCents: null, accountsPayableCents: null });
      delete commandCentre.metrics.operating_cash;
      delete commandCentre.metrics.accounts_payable;
    }
    if (!permissions.includes("payroll.totals")) {
      for (const totals of [commandCentre.current, commandCentre.previous]) {
        if (totals) Object.assign(totals, { labourCostCents: null, labourRate: null, contributionCents: null });
      }
      if (commandCentre.periodComparisons) {
        for (const comparison of [commandCentre.periodComparisons.sevenDays, commandCentre.periodComparisons.thirtyDays]) {
          Object.assign(comparison.current, { labourCostCents: null, labourRate: null, contributionCents: null });
          Object.assign(comparison.previous, { labourCostCents: null, labourRate: null, contributionCents: null });
        }
      }
      for (const key of ["labour_cost", "labour_rate", "contribution_after_labour"]) delete (commandCentre.metrics as Record<string, unknown>)[key];
      commandCentre.insights = commandCentre.insights.filter((insight) => insight.id !== "labour-pressure");
    }
    if (!permissions.includes("inventory.value")) {
      if ("reportingPeriod" in commandCentre && commandCentre.reportingPeriod) commandCentre.reportingPeriod.previousInventoryValueCents = null;
      for(const point of commandCentre.trend) if("inventoryValueCents" in point) Object.assign(point,{inventoryValueCents:null});
      if (commandCentre.balances) Object.assign(commandCentre.balances, { inventoryValueCents: null });
      delete (commandCentre.metrics as Record<string, unknown>).inventory_value;
    }
    const operatingSystem = buildOperatingSystem({
      ready: commandCentre.ready,
      currency: context.organization.currency,
      source: commandCentre.source,
      balances: commandCentre.balances,
      insights: commandCentre.insights,
      dataQuality: commandCentre.dataQuality,
    });
    let executiveReport;
    if(period){
      const hasBookloq=await hasAddon(context,"bookloq");
      const fullFinance=["finance.statements","finance.bank_balances","finance.ap_ar","payroll.totals","finance.costs","metrics.profit","metrics.revenue","metrics.cash","inventory.value"].every(p=>permissions.includes(p as typeof permissions[number]));
      const financeReason=!hasBookloq?"BookLoQ access is required for ledger metrics.":!locationAccess.organizationWide||selectedLocation?"Select All locations to review company financial statements.":!fullFinance?"Your role does not include the full financial permissions required for these totals.":null;
      const finance=financeReason?null:await loadExecutiveFinance(context.organizationId,context.organization.currency,period,businessClock(new Date(),context.organization.timezone)!.date,permissions.includes("customers.identity"));
      executiveReport=buildExecutiveReport(period,commandCentre,finance,financeReason,new URL(request.url).searchParams.get("basis")==="ledger"?"ledger":"commerce");
    }
    return {
      ...(executiveReport?{executiveReport}:{}),
      organization: {
        name: branding?.displayName ?? context.organization.businessName,
        currency: context.organization.currency,
        role: context.role,
        logoAvailable: Boolean(branding?.logoObjectKey),
        logoVersion: branding?.logoVersion ?? 0,
        selectedLocation: selectedLocation ? { id: selectedLocation.id, name: selectedLocation.name } : null,
        locations: availableLocations.map((location) => ({ id: location.id, name: location.name })),
        scopeLabel: selectedLocation?.name ?? (locationRestricted ? "Accessible locations" : "All locations"),
        permissions,
      },
      commandCentre,
      operatingSystem,
    };
}

export async function GET(request: Request) {
  return handleApi(request, async () => jsonResponse(await loadCommandCentre(request)));
}
