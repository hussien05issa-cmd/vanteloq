import { buildMetricResults, type FreshnessStatus } from "./data-trust.ts";

export type MetricRow = {
  businessDate: string;
  grossSalesCents: number;
  netSalesCents: number;
  costOfGoodsCents: number;
  transactionCount: number;
  unitsSold: number;
  refundsCents: number;
  discountsCents: number;
  labourCostCents: number;
  inventoryValueCents: number | null;
  cashBalanceCents: number | null;
  accountsPayableCents: number | null;
  sourceImportId?: string | null;
  locationRef?: string;
  updatedAt?: Date | number | string | null;
};

type Totals = {
  days: number;
  grossSalesCents: number;
  netSalesCents: number;
  costOfGoodsCents: number;
  transactionCount: number;
  unitsSold: number;
  refundsCents: number;
  discountsCents: number;
  labourCostCents: number;
  grossProfitCents: number;
  contributionCents: number;
  grossMarginRate: number | null;
  averageTransactionCents: number | null;
  unitsPerTransaction: number | null;
  labourRate: number | null;
  discountRate: number | null;
};

export type Insight = {
  id: string;
  severity: "critical" | "attention" | "opportunity" | "informational";
  title: string;
  whatHappened: string;
  probableCause: string;
  financialImpact: string;
  recommendedAction: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  missingInformation: string[];
  suggestedTask: { title: string; detail: string; priority: "high" | "medium" | "low"; expectedImpact: string };
};

function dateOffset(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sum(rows: MetricRow[]): Totals {
  const base = rows.reduce((acc, row) => ({
    grossSalesCents: acc.grossSalesCents + row.grossSalesCents,
    netSalesCents: acc.netSalesCents + row.netSalesCents,
    costOfGoodsCents: acc.costOfGoodsCents + row.costOfGoodsCents,
    transactionCount: acc.transactionCount + row.transactionCount,
    unitsSold: acc.unitsSold + row.unitsSold,
    refundsCents: acc.refundsCents + row.refundsCents,
    discountsCents: acc.discountsCents + row.discountsCents,
    labourCostCents: acc.labourCostCents + row.labourCostCents,
  }), { grossSalesCents: 0, netSalesCents: 0, costOfGoodsCents: 0, transactionCount: 0, unitsSold: 0, refundsCents: 0, discountsCents: 0, labourCostCents: 0 });
  const grossProfitCents = base.netSalesCents - base.costOfGoodsCents;
  return {
    days: rows.length,
    ...base,
    grossProfitCents,
    contributionCents: grossProfitCents - base.labourCostCents,
    grossMarginRate: base.netSalesCents ? grossProfitCents / base.netSalesCents : null,
    averageTransactionCents: base.transactionCount ? base.netSalesCents / base.transactionCount : null,
    unitsPerTransaction: base.transactionCount ? base.unitsSold / base.transactionCount : null,
    labourRate: base.netSalesCents ? base.labourCostCents / base.netSalesCents : null,
    discountRate: base.grossSalesCents ? base.discountsCents / base.grossSalesCents : null,
  };
}

function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / Math.abs(previous);
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

function percentage(value: number): string {
  return new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function buildInsights(current: Totals, previous: Totals, currency: string): Insight[] {
  const insights: Insight[] = [];
  const enoughHistory = previous.days >= 7 && current.days >= 7;
  if (!enoughHistory) {
    insights.push({
      id: "history-readiness",
      severity: "informational",
      title: "More history is required for a reliable trend",
      whatHappened: `${current.days} current-period day${current.days === 1 ? " is" : "s are"} verified.`,
      probableCause: "The comparison period does not yet contain at least seven daily records.",
      financialImpact: "No financial impact is estimated because the baseline is incomplete.",
      recommendedAction: "Import at least 60 consecutive daily summaries for a complete 30-day comparison.",
      confidence: "high",
      evidence: [`Current period: ${current.days} days`, `Previous period: ${previous.days} days`],
      missingInformation: ["A complete prior-period baseline"],
      suggestedTask: { title: "Complete daily sales history", detail: "Import enough verified daily summaries to unlock trend and anomaly analysis.", priority: "medium", expectedImpact: "Enables defensible period-over-period recommendations." },
    });
    return insights;
  }

  const salesChange = percentChange(current.netSalesCents, previous.netSalesCents) ?? 0;
  const transactionChange = percentChange(current.transactionCount, previous.transactionCount) ?? 0;
  const aovChange = current.averageTransactionCents && previous.averageTransactionCents
    ? percentChange(current.averageTransactionCents, previous.averageTransactionCents) ?? 0
    : 0;
  const salesDelta = current.netSalesCents - previous.netSalesCents;
  const trafficEffect = previous.averageTransactionCents
    ? (current.transactionCount - previous.transactionCount) * previous.averageTransactionCents
    : 0;
  const basketEffect = current.averageTransactionCents && previous.averageTransactionCents
    ? current.transactionCount * (current.averageTransactionCents - previous.averageTransactionCents)
    : 0;
  if (Math.abs(salesChange) >= 0.05) {
    const trafficLed = Math.abs(trafficEffect) >= Math.abs(basketEffect);
    const direction = salesDelta >= 0 ? "increased" : "decreased";
    insights.push({
      id: "sales-trend",
      severity: salesDelta >= 0 ? "opportunity" : "attention",
      title: `Net sales ${direction} ${percentage(Math.abs(salesChange))}`,
      whatHappened: `Net sales ${direction} by ${money(Math.abs(salesDelta), currency)} versus the preceding 30-day window.`,
      probableCause: trafficLed
        ? `Transaction volume moved ${percentage(Math.abs(transactionChange))} and explains more of the modeled change than basket value.`
        : `Average transaction value moved ${percentage(Math.abs(aovChange))} and explains more of the modeled change than transaction volume.`,
      financialImpact: `${money(Math.abs(salesDelta), currency)} ${salesDelta >= 0 ? "in additional net sales" : "in lower net sales"}.`,
      recommendedAction: trafficLed
        ? "Review traffic by weekday and hour once the POS transaction feed is connected; preserve basket value while correcting weak traffic periods."
        : "Review product mix and add-on behaviour once line-item data is connected; protect the strongest basket drivers.",
      confidence: "medium",
      evidence: [`Transactions: ${percentage(transactionChange)} vs prior period`, `Average transaction: ${percentage(aovChange)} vs prior period`, "Cause split uses a volume-versus-basket decomposition"],
      missingInformation: ["Hourly traffic", "Product and category mix", "Promotion attribution"],
      suggestedTask: { title: salesDelta >= 0 ? "Protect the strongest sales driver" : "Investigate the sales decline", detail: trafficLed ? "Compare weekday and hourly traffic after the POS transaction feed is available." : "Inspect product mix and add-on behaviour after line-item data is available.", priority: salesDelta >= 0 ? "medium" : "high", expectedImpact: `${money(Math.abs(salesDelta), currency)} period-level opportunity.` },
    });
  }

  if (current.grossMarginRate !== null && previous.grossMarginRate !== null) {
    const marginDelta = current.grossMarginRate - previous.grossMarginRate;
    if (Math.abs(marginDelta) >= 0.01) {
      const discountDelta = (current.discountRate ?? 0) - (previous.discountRate ?? 0);
      const discountLed = marginDelta < 0 && discountDelta > 0.005;
      const marginImpact = current.netSalesCents * marginDelta;
      insights.push({
        id: "margin-trend",
        severity: marginDelta >= 0 ? "opportunity" : "attention",
        title: `Gross margin ${marginDelta >= 0 ? "improved" : "declined"} ${percentage(Math.abs(marginDelta))}`,
        whatHappened: `Gross margin moved from ${percentage(previous.grossMarginRate)} to ${percentage(current.grossMarginRate)}.`,
        probableCause: discountLed ? "Discounts consumed a larger share of gross sales and are a supported contributing factor." : "Daily summaries confirm the margin movement, but product-cost and supplier detail are required to isolate the cause.",
        financialImpact: `${money(Math.abs(marginImpact), currency)} estimated gross-profit effect at current sales volume.`,
        recommendedAction: discountLed ? "Audit the highest-discount promotions and replace unprofitable offers with bundles or targeted offers." : "Connect line-item costs and supplier invoices before changing prices or assortment.",
        confidence: discountLed ? "medium" : "low",
        evidence: [`Current gross profit: ${money(current.grossProfitCents, currency)}`, `Discount rate moved ${percentage(discountDelta)}`],
        missingInformation: ["SKU-level cost changes", "Supplier price changes", "Promotion-level margin"],
        suggestedTask: { title: marginDelta >= 0 ? "Document the margin improvement" : "Review margin compression", detail: discountLed ? "Identify promotions whose gross-profit impact was negative." : "Connect product costs and supplier invoice detail before taking pricing action.", priority: marginDelta >= 0 ? "low" : "high", expectedImpact: `${money(Math.abs(marginImpact), currency)} estimated gross-profit effect.` },
      });
    }
  }

  if (current.labourRate !== null && previous.labourRate !== null) {
    const labourDelta = current.labourRate - previous.labourRate;
    if (labourDelta >= 0.02) {
      insights.push({
        id: "labour-pressure",
        severity: "attention",
        title: "Labour is consuming more of each sales dollar",
        whatHappened: `Labour cost reached ${percentage(current.labourRate)} of net sales, up ${percentage(labourDelta)}.`,
        probableCause: transactionChange < 0 ? "Transaction volume declined while labour cost did not fall proportionally." : "Daily summaries show higher labour pressure; shift-level traffic is required to identify the exact schedule gap.",
        financialImpact: `${money(current.labourCostCents - previous.labourCostCents, currency)} change in recorded labour cost.`,
        recommendedAction: "Compare staffing to sales by hour before changing shifts; do not rank employees solely by revenue.",
        confidence: "medium",
        evidence: [`Current labour rate: ${percentage(current.labourRate)}`, `Prior labour rate: ${percentage(previous.labourRate)}`],
        missingInformation: ["Shift hours", "Hourly traffic", "Employee roles"],
        suggestedTask: { title: "Review labour coverage by hour", detail: "Match staffing to hourly transactions and customer traffic before adjusting the schedule.", priority: "high", expectedImpact: "Reduce labour pressure without creating understaffed peak periods." },
      });
    }
  }

  if (!insights.length) {
    insights.push({
      id: "stable-performance",
      severity: "informational",
      title: "No material period-level exception was detected",
      whatHappened: "Sales, margin and labour stayed inside the current exception thresholds.",
      probableCause: "The verified daily summaries do not show a change large enough to prioritize.",
      financialImpact: "No material impact is estimated from the available aggregates.",
      recommendedAction: "Keep collecting daily data and connect line-item feeds to unlock product, customer and promotion opportunities.",
      confidence: "medium",
      evidence: ["Sales threshold: 5%", "Margin threshold: 1 percentage point", "Labour threshold: 2 percentage points"],
      missingInformation: ["Product mix", "Customer cohorts", "Marketing attribution"],
      suggestedTask: { title: "Connect line-item operating data", detail: "Add product, customer and campaign dimensions for deeper opportunity detection.", priority: "low", expectedImpact: "Unlocks product, retention and marketing intelligence." },
    });
  }
  return insights;
}

export function buildCommandCentre(rows: MetricRow[], currency: string) {
  const sorted = [...rows].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  if (!sorted.length) {
    return {
      ready: false,
      source: { rowCount: 0, latestBusinessDate: null, freshness: "missing" },
      current: null,
      previous: null,
      comparisons: null,
      balances: null,
      metrics: {},
      trend: [],
      insights: [],
      dataQuality: { status: "blocked", verifiedFields: 0, missingDimensions: ["Daily sales summaries", "Product and category detail", "Inventory movement", "Customer identity", "Marketing spend", "Shift-level labour"] },
    };
  }
  const latestBusinessDate = sorted.at(-1)!.businessDate;
  const currentStart = dateOffset(latestBusinessDate, -29);
  const previousStart = dateOffset(latestBusinessDate, -59);
  const previousEnd = dateOffset(latestBusinessDate, -30);
  const currentRows = sorted.filter((row) => row.businessDate >= currentStart && row.businessDate <= latestBusinessDate);
  const previousRows = sorted.filter((row) => row.businessDate >= previousStart && row.businessDate <= previousEnd);
  const current = sum(currentRows);
  const previous = sum(previousRows);
  const latestWith = <K extends keyof MetricRow>(key: K) => [...sorted].reverse().find((row) => row[key] !== null)?.[key] ?? null;
  const latestAgeDays = Math.max(0, Math.floor((Date.now() - Date.parse(`${latestBusinessDate}T23:59:59Z`)) / 86_400_000));
  const freshness: FreshnessStatus = latestAgeDays <= 1 ? "current" : latestAgeDays <= 7 ? "aging" : "stale";
  const comparisons = {
    netSalesRate: percentChange(current.netSalesCents, previous.netSalesCents),
    grossProfitRate: percentChange(current.grossProfitCents, previous.grossProfitCents),
    transactionRate: percentChange(current.transactionCount, previous.transactionCount),
    averageTransactionRate: current.averageTransactionCents !== null && previous.averageTransactionCents !== null ? percentChange(current.averageTransactionCents, previous.averageTransactionCents) : null,
    marginPointChange: current.grossMarginRate !== null && previous.grossMarginRate !== null ? current.grossMarginRate - previous.grossMarginRate : null,
  };
  const metrics = buildMetricResults({
    rows: currentRows,
    currency,
    periodStart: currentStart,
    periodEnd: latestBusinessDate,
    comparisonPeriodStart: previousStart,
    comparisonPeriodEnd: previousEnd,
    freshnessStatus: freshness,
    values: {
      gross_sales: current.grossSalesCents,
      net_sales: current.netSalesCents,
      cost_of_goods: current.costOfGoodsCents,
      gross_profit: current.grossProfitCents,
      gross_margin: current.grossMarginRate,
      transactions: current.transactionCount,
      average_transaction: current.averageTransactionCents,
      units: current.unitsSold,
      units_per_transaction: current.unitsPerTransaction,
      discounts: current.discountsCents,
      refunds: current.refundsCents,
      labour_cost: current.labourCostCents,
      labour_rate: current.labourRate,
      contribution_after_labour: current.contributionCents,
      inventory_value: latestWith("inventoryValueCents") as number | null,
      operating_cash: latestWith("cashBalanceCents") as number | null,
      accounts_payable: latestWith("accountsPayableCents") as number | null,
    },
  });
  return {
    ready: true,
    source: { rowCount: sorted.length, latestBusinessDate, freshness, ageDays: latestAgeDays },
    current,
    previous,
    comparisons,
    balances: { inventoryValueCents: latestWith("inventoryValueCents"), cashBalanceCents: latestWith("cashBalanceCents"), accountsPayableCents: latestWith("accountsPayableCents") },
    metrics,
    trend: currentRows.slice(-14).map((row) => ({ date: row.businessDate, netSalesCents: row.netSalesCents, grossProfitCents: row.netSalesCents - row.costOfGoodsCents })),
    insights: buildInsights(current, previous, currency),
    dataQuality: { status: previous.days >= 7 ? "usable" : "limited", verifiedFields: 10, missingDimensions: ["Product and category detail", "Customer identity", "Marketing attribution", "Hourly traffic", "Supplier invoices"] },
  };
}

export function measureEventImpact(rows: MetricRow[], eventDate: string) {
  const beforeStart = dateOffset(eventDate, -14);
  const beforeEnd = dateOffset(eventDate, -1);
  const afterEnd = dateOffset(eventDate, 13);
  const before = rows.filter((row) => row.businessDate >= beforeStart && row.businessDate <= beforeEnd);
  const after = rows.filter((row) => row.businessDate >= eventDate && row.businessDate <= afterEnd);
  if (before.length < 7 || after.length < 7) return { measurable: false, reason: "At least seven verified days are required on both sides of the event." };
  const beforeAverage = sum(before).netSalesCents / before.length;
  const afterAverage = sum(after).netSalesCents / after.length;
  return { measurable: true, beforeDays: before.length, afterDays: after.length, beforeAverageSalesCents: Math.round(beforeAverage), afterAverageSalesCents: Math.round(afterAverage), changeRate: percentChange(afterAverage, beforeAverage) };
}
