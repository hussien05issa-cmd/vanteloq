export type PurchaseCommitmentLineInput = {
  sku: string;
  description: string;
  quantity: number;
  receivedQuantity: number;
  unitCostCents: number;
  previousCostCents: number | null;
};

export type PurchaseCommitmentOrderInput = {
  id: string;
  orderNumber: string;
  supplierName: string;
  status: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  committedCashDate: string | null;
  currency: string;
  totalCents: number;
  lines: PurchaseCommitmentLineInput[];
};

const terminalStatuses = new Set(["closed", "cancelled"]);
const plannedStatuses = new Set(["draft", "suggested", "awaiting_approval", "approved"]);

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Draft, not purchased yet",
    suggested: "Suggested, not purchased yet",
    awaiting_approval: "Awaiting approval, not purchased yet",
    approved: "Approved internally, not sent to vendor",
    sent: "Purchased, awaiting vendor acknowledgement",
    acknowledged: "Purchased, awaiting delivery",
    partially_received: "Partially received, balance still coming",
    received: "Received, invoice review remains",
    partially_invoiced: "Received or incoming, invoice partially matched",
    invoiced: "Invoice recorded, close-out remains",
    disputed: "Purchased, discrepancy under review",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

export function buildPurchaseCommitmentBoard(orders: readonly PurchaseCommitmentOrderInput[]) {
  const openOrders = orders
    .filter((order) => !terminalStatuses.has(order.status))
    .map((order) => {
      const lines = order.lines.map((line) => {
        const remainingQuantity = Math.max(0, line.quantity - line.receivedQuantity);
        const priceChangeRate = line.previousCostCents && line.previousCostCents > 0
          ? line.unitCostCents / line.previousCostCents - 1
          : null;
        return {
          ...line,
          remainingQuantity,
          remainingCostCents: remainingQuantity * Math.max(0, line.unitCostCents),
          priceChangeRate,
          duplicateWarning: remainingQuantity
            ? plannedStatuses.has(order.status)
              ? `${remainingQuantity} units of ${line.description} are already planned on ${order.orderNumber}. Review that draft before creating another order.`
              : `${remainingQuantity} units of ${line.description} are already purchased on ${order.orderNumber}. Count them as incoming before creating another order.`
            : "This line is fully received.",
        };
      });
      return {
        ...order,
        statusLabel: statusLabel(order.status),
        lines,
        remainingMerchandiseCents: lines.reduce((sum, line) => sum + line.remainingCostCents, 0),
        remainingUnits: lines.reduce((sum, line) => sum + line.remainingQuantity, 0),
      };
    })
    .filter((order) => order.remainingUnits > 0);

  const committedOrders = openOrders.filter((order) => !plannedStatuses.has(order.status));
  const plannedOrders = openOrders.filter((order) => plannedStatuses.has(order.status));
  const grouped = new Map<string, typeof committedOrders>();
  for (const order of committedOrders) {
    const key = `${order.currency}:${order.supplierName.trim().toLocaleLowerCase("en-CA")}`;
    const existing = grouped.get(key) ?? [];
    existing.push(order);
    grouped.set(key, existing);
  }
  const vendors = [...grouped.values()].map((vendorOrders) => ({
    supplierName: vendorOrders[0].supplierName,
    currency: vendorOrders[0].currency,
    openOrderCount: vendorOrders.length,
    remainingMerchandiseCents: vendorOrders.reduce((sum, order) => sum + order.remainingMerchandiseCents, 0),
    remainingUnits: vendorOrders.reduce((sum, order) => sum + order.remainingUnits, 0),
    nextDeliveryDate: vendorOrders.map((order) => order.expectedDeliveryDate).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    orders: [...vendorOrders].sort((left, right) => (left.expectedDeliveryDate ?? "9999-12-31").localeCompare(right.expectedDeliveryDate ?? "9999-12-31")),
  })).sort((left, right) => (left.nextDeliveryDate ?? "9999-12-31").localeCompare(right.nextDeliveryDate ?? "9999-12-31") || left.supplierName.localeCompare(right.supplierName));
  return {
    vendors,
    plannedOrders,
    totalRemainingMerchandiseCents: vendors.reduce((sum, vendor) => sum + vendor.remainingMerchandiseCents, 0),
    boundary: "This is the line-cost value of open, unreceived merchandise. It excludes order-level tax and discounts and is not a remaining invoice balance. Supplier bills are reconciled separately so the same purchase is not counted twice.",
  };
}
