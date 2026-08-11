export type PurchasingProductInput = {
  sku: string;
  name: string;
  supplierName: string | null;
  onHandUnits: number;
  reorderPointUnits: number;
  incomingUnits: number;
  unitsSold30: number;
  unitsSoldPrevious30: number;
  unitsSold90: number;
  unitCostCents: number | null;
  lastOrderedAt: string | null;
  lastOrderStatus: string | null;
  lastSaleAt: string | null;
};

export type PurchasingProductAssessment = PurchasingProductInput & {
  health: "issue" | "healthy" | "dead_stock" | "watch";
  recommendedUnits: number;
  recommendedCostCents: number | null;
  daysCover: number | null;
  demandTrendRate: number | null;
  summary: string;
  factors: string[];
};

export type CashConstrainedPurchasingAssessment = PurchasingProductAssessment & {
  cashConstrainedUnits: number | null;
  cashAllocatedCents: number | null;
  cashDecision: "within_capacity" | "cash_constrained" | "needs_verified_cash" | "needs_unit_cost" | "no_order_needed";
};

export type PurchasingCapacityAccount = {
  accountType: "chequing" | "savings" | "credit_card" | "line_of_credit" | "merchant" | "loan";
  currency: string;
  connectionStatus: "manual" | "healthy" | "delayed" | "error";
  availableBalanceCents: number | null;
  liveBalanceCents: number | null;
  lastSyncAtMs: number | null;
  demoRecord?: boolean | number;
};

export type PurchasingCapacityInput = {
  connectionVerified: boolean;
  nowMs: number;
  maximumAgeMs: number;
  baseCurrency: string;
  cashSafetyReserveCents: number;
  outstandingBillsCents: number;
  openPurchaseCommitmentsCents: number;
  accounts: readonly PurchasingCapacityAccount[];
};

export type PurchasingCapacityResult = {
  status: "available" | "needs_bank_connection" | "stale_bank_data" | "needs_healthy_cash_account";
  verifiedPurchasingCapacityCents: number | null;
  verifiedCashCents: number | null;
  cashSafetyReserveCents: number;
  outstandingBillsCents: number;
  openPurchaseCommitmentsCents: number;
  accountsUsed: number;
  baseCurrency: string;
  maximumAgeHours: number;
};

type PurchasingObligationOrder = {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  totalCents: number;
};

type PurchasingObligationBill = {
  status: string;
  totalCents: number;
  paidCents: number;
  currency: string;
  purchaseOrderRef: string | null;
  demoRecord: boolean | number;
};

export function calculateOpenPurchasingObligations(input: {
  baseCurrency: string;
  orders: readonly PurchasingObligationOrder[];
  bills: readonly PurchasingObligationBill[];
}) {
  const baseCurrency = input.baseCurrency.toUpperCase();
  const openBillStatuses = new Set([
    "draft", "received", "extracted", "under_review", "matched", "awaiting_approval",
    "approved", "scheduled", "partially_paid", "disputed",
  ]);
  const committedOrderStatuses = new Set([
    "sent", "acknowledged", "partially_received", "received",
    "partially_invoiced", "invoiced", "disputed",
  ]);
  const liveBills = input.bills.filter((bill) => !Boolean(bill.demoRecord) && bill.status !== "void");
  const committedOrders = input.orders.filter((order) => committedOrderStatuses.has(order.status));
  const linkedBillIndexes = new Set<number>();
  let openPurchaseCommitmentsCents = 0;

  for (const order of committedOrders.filter((item) => item.currency.toUpperCase() === baseCurrency)) {
    const linked = liveBills
      .map((bill, index) => ({ bill, index }))
      .filter(({ bill }) => bill.purchaseOrderRef === order.id || bill.purchaseOrderRef === order.orderNumber);
    linked.forEach(({ index }) => linkedBillIndexes.add(index));
    const paidCents = linked.reduce((sum, { bill }) => sum + Math.max(0, bill.paidCents), 0);
    const outstandingCents = linked
      .filter(({ bill }) => openBillStatuses.has(bill.status))
      .reduce((sum, { bill }) => sum + Math.max(0, bill.totalCents - bill.paidCents), 0);
    openPurchaseCommitmentsCents += Math.max(0, order.totalCents - paidCents, outstandingCents);
  }

  const outstandingBillsCents = liveBills.reduce((sum, bill, index) => {
    if (linkedBillIndexes.has(index) || !openBillStatuses.has(bill.status)) return sum;
    if (bill.currency.toUpperCase() !== baseCurrency) return sum;
    return sum + Math.max(0, bill.totalCents - bill.paidCents);
  }, 0);
  const excludedCurrencyObligations = liveBills.filter(
    (bill) => openBillStatuses.has(bill.status) && bill.currency.toUpperCase() !== baseCurrency,
  ).length + committedOrders.filter((order) => order.currency.toUpperCase() !== baseCurrency).length;

  return { outstandingBillsCents, openPurchaseCommitmentsCents, excludedCurrencyObligations };
}

export function verifiedCashSourceEligible(input: {
  connectionStatus: string;
  promotionStatus: string;
  liveDataEligible: boolean;
  bookloqAddonActive: boolean;
  bookloqStatus: string | null;
  bookloqDataMode: string | null;
  hasDemoAccounts: boolean;
}): boolean {
  return input.connectionStatus === "connected"
    && input.promotionStatus === "approved"
    && input.liveDataEligible
    && input.bookloqAddonActive
    && input.bookloqStatus === "active"
    && input.bookloqDataMode === "live"
    && !input.hasDemoAccounts;
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateVerifiedPurchasingCapacity(
  input: PurchasingCapacityInput,
): PurchasingCapacityResult {
  const baseCurrency = input.baseCurrency.trim().toUpperCase();
  const cashSafetyReserveCents = Math.floor(nonNegative(input.cashSafetyReserveCents));
  const outstandingBillsCents = Math.floor(nonNegative(input.outstandingBillsCents));
  const openPurchaseCommitmentsCents = Math.floor(
    nonNegative(input.openPurchaseCommitmentsCents),
  );
  const base = {
    cashSafetyReserveCents,
    outstandingBillsCents,
    openPurchaseCommitmentsCents,
    baseCurrency,
    maximumAgeHours: Math.round(input.maximumAgeMs / (60 * 60 * 1000)),
  };
  if (!input.connectionVerified) {
    return {
      ...base,
      status: "needs_bank_connection",
      verifiedPurchasingCapacityCents: null,
      verifiedCashCents: null,
      accountsUsed: 0,
    };
  }

  const cashTypes = new Set(["chequing", "savings", "merchant"]);
  const relevantAccounts = input.accounts.filter(
    (account) => cashTypes.has(account.accountType) && account.currency.toUpperCase() === baseCurrency,
  );
  const usableAccount = (account: PurchasingCapacityAccount) => {
    if (Boolean(account.demoRecord) || account.connectionStatus !== "healthy" || account.lastSyncAtMs === null) return false;
    const ageMs = input.nowMs - account.lastSyncAtMs;
    if (ageMs < 0 || ageMs > input.maximumAgeMs) return false;
    const balance = account.availableBalanceCents ?? account.liveBalanceCents;
    return balance !== null && Number.isFinite(balance);
  };
  if (!relevantAccounts.length || relevantAccounts.some((account) => !usableAccount(account))) {
    const hasStaleBalance = relevantAccounts.some(
      (account) => account.lastSyncAtMs !== null && input.nowMs - account.lastSyncAtMs > input.maximumAgeMs,
    );
    return {
      ...base,
      status: hasStaleBalance ? "stale_bank_data" : "needs_healthy_cash_account",
      verifiedPurchasingCapacityCents: null,
      verifiedCashCents: null,
      accountsUsed: 0,
    };
  }

  const verifiedCashCents = relevantAccounts.reduce(
    (sum, account) => sum + Math.floor(account.availableBalanceCents ?? account.liveBalanceCents ?? 0),
    0,
  );
  return {
    ...base,
    status: "available",
    verifiedCashCents,
    verifiedPurchasingCapacityCents: Math.max(
      0,
      verifiedCashCents - cashSafetyReserveCents - outstandingBillsCents - openPurchaseCommitmentsCents,
    ),
    accountsUsed: relevantAccounts.length,
  };
}

export function assessPurchasingProduct(input: PurchasingProductInput): PurchasingProductAssessment {
  const onHand = nonNegative(input.onHandUnits);
  const incoming = nonNegative(input.incomingUnits);
  const currentDemand = nonNegative(input.unitsSold30);
  const previousDemand = nonNegative(input.unitsSoldPrevious30);
  const demand90 = nonNegative(input.unitsSold90);
  const dailyDemand = currentDemand / 30;
  const demandTrendRate = previousDemand > 0 ? (currentDemand - previousDemand) / previousDemand : null;
  const growthFactor = demandTrendRate === null ? 1 : Math.min(1.5, Math.max(0.75, 1 + demandTrendRate * 0.5));
  const targetUnits = Math.max(nonNegative(input.reorderPointUnits) * 2, Math.ceil(currentDemand * growthFactor));
  const availableUnits = onHand + incoming;
  const daysCover = dailyDemand > 0 ? Math.round((availableUnits / dailyDemand) * 10) / 10 : null;
  const deadStock = demand90 === 0 && onHand > 0;
  const openOrderBuffer = incoming > 0 ? Math.ceil(dailyDemand * 7) : 0;
  const rawNeed = Math.max(0, targetUnits - availableUnits);
  const recommendedUnits = deadStock || rawNeed <= openOrderBuffer ? 0 : Math.ceil(rawNeed);
  const factors: string[] = [];

  if (demandTrendRate !== null) {
    factors.push(`${Math.abs(demandTrendRate * 100).toFixed(0)}% demand ${demandTrendRate >= 0 ? "growth" : "decline"} versus the prior 30 days`);
  } else {
    factors.push("Prior-period demand is not available");
  }
  factors.push(`${onHand} on hand plus ${incoming} already incoming`);
  factors.push(`${targetUnits} unit performance target using 30-day demand and reorder point`);
  if (input.lastOrderedAt) factors.push(`Last ordered ${input.lastOrderedAt} with status ${input.lastOrderStatus?.replaceAll("_", " ") || "recorded"}`);

  let health: PurchasingProductAssessment["health"] = "watch";
  let summary = "Review product history before committing cash.";
  if (deadStock) {
    health = "dead_stock";
    summary = "No units sold in 90 days. Pause reordering and review markdown, transfer, or removal options.";
  } else if (availableUnits <= nonNegative(input.reorderPointUnits) || (recommendedUnits > 0 && (daysCover ?? 0) < 14)) {
    health = "issue";
    summary = `${recommendedUnits} units recommended to restore performance-based cover.`;
  } else if (recommendedUnits === 0) {
    health = "healthy";
    summary = incoming > 0
      ? "Current and incoming stock cover the next order cycle. Do not duplicate the open order."
      : "Inventory cover is healthy for the current demand rate.";
  } else {
    summary = `${recommendedUnits} units suggested for the next reviewed order.`;
  }

  return {
    ...input,
    onHandUnits: onHand,
    incomingUnits: incoming,
    unitsSold30: currentDemand,
    unitsSoldPrevious30: previousDemand,
    unitsSold90: demand90,
    health,
    recommendedUnits,
    recommendedCostCents: input.unitCostCents === null ? null : recommendedUnits * Math.max(0, input.unitCostCents),
    daysCover,
    demandTrendRate,
    summary,
    factors,
  };
}

export function allocatePurchasingCapacity(
  assessments: readonly PurchasingProductAssessment[],
  verifiedPurchasingCapacityCents: number | null,
): CashConstrainedPurchasingAssessment[] {
  if (verifiedPurchasingCapacityCents === null || !Number.isFinite(verifiedPurchasingCapacityCents)) {
    return assessments.map((assessment) => ({
      ...assessment,
      cashConstrainedUnits: assessment.recommendedUnits === 0 ? 0 : null,
      cashAllocatedCents: assessment.recommendedUnits === 0 ? 0 : null,
      cashDecision: assessment.recommendedUnits === 0 ? "no_order_needed" : "needs_verified_cash",
    }));
  }

  let remaining = Math.max(0, Math.floor(verifiedPurchasingCapacityCents));
  const priority = new Map(
    [...assessments]
      .sort((a, b) => {
        const healthRank = { issue: 0, watch: 1, healthy: 2, dead_stock: 3 } as const;
        const byHealth = healthRank[a.health] - healthRank[b.health];
        if (byHealth !== 0) return byHealth;
        const byCover = (a.daysCover ?? Number.POSITIVE_INFINITY) - (b.daysCover ?? Number.POSITIVE_INFINITY);
        if (byCover !== 0) return byCover;
        return a.sku.localeCompare(b.sku);
      })
      .map((assessment, index) => [assessment.sku, index]),
  );

  const allocated = new Map<string, Pick<CashConstrainedPurchasingAssessment, "cashAllocatedCents" | "cashConstrainedUnits" | "cashDecision">>();
  for (const assessment of [...assessments].sort((a, b) => (priority.get(a.sku) ?? 0) - (priority.get(b.sku) ?? 0))) {
    if (assessment.recommendedUnits === 0) {
      allocated.set(assessment.sku, { cashConstrainedUnits: 0, cashAllocatedCents: 0, cashDecision: "no_order_needed" });
      continue;
    }
    const unitCost = assessment.unitCostCents === null ? null : Math.max(0, Math.floor(assessment.unitCostCents));
    if (!unitCost) {
      allocated.set(assessment.sku, { cashConstrainedUnits: null, cashAllocatedCents: null, cashDecision: "needs_unit_cost" });
      continue;
    }
    const affordableUnits = Math.min(assessment.recommendedUnits, Math.floor(remaining / unitCost));
    const cashAllocatedCents = affordableUnits * unitCost;
    remaining -= cashAllocatedCents;
    allocated.set(assessment.sku, {
      cashConstrainedUnits: affordableUnits,
      cashAllocatedCents,
      cashDecision: affordableUnits === assessment.recommendedUnits ? "within_capacity" : "cash_constrained",
    });
  }

  return assessments.map((assessment) => ({
    ...assessment,
    ...(allocated.get(assessment.sku) ?? {
      cashConstrainedUnits: null,
      cashAllocatedCents: null,
      cashDecision: "needs_verified_cash" as const,
    }),
  }));
}
