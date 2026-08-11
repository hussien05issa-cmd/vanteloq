import assert from "node:assert/strict";
import test from "node:test";
import { buildPurchaseCommitmentBoard } from "../domain/purchase-commitments.ts";

test("open purchases are grouped by vendor with remaining units, prices, and delivery status", () => {
  const board = buildPurchaseCommitmentBoard([
    {
      id: "po-1",
      orderNumber: "PO-1042",
      supplierName: "Peak Supply",
      status: "acknowledged",
      orderDate: "2026-08-08",
      expectedDeliveryDate: "2026-08-15",
      committedCashDate: "2026-08-14",
      currency: "CAD",
      totalCents: 24_000,
      lines: [
        { sku: "CRE-A", description: "Creatine", quantity: 12, receivedQuantity: 2, unitCostCents: 2_000, previousCostCents: 1_800 },
      ],
    },
    {
      id: "po-2",
      orderNumber: "PO-1043",
      supplierName: "Peak Supply",
      status: "partially_received",
      orderDate: "2026-08-09",
      expectedDeliveryDate: "2026-08-18",
      committedCashDate: null,
      currency: "CAD",
      totalCents: 10_000,
      lines: [
        { sku: "WHEY-B", description: "Whey", quantity: 5, receivedQuantity: 3, unitCostCents: 2_000, previousCostCents: null },
      ],
    },
    {
      id: "po-cancelled",
      orderNumber: "PO-1000",
      supplierName: "Old Supplier",
      status: "cancelled",
      orderDate: "2026-07-01",
      expectedDeliveryDate: null,
      committedCashDate: null,
      currency: "CAD",
      totalCents: 99_000,
      lines: [],
    },
  ]);

  assert.equal(board.vendors.length, 1);
  assert.equal(board.vendors[0].supplierName, "Peak Supply");
  assert.equal(board.vendors[0].openOrderCount, 2);
  assert.equal(board.vendors[0].remainingMerchandiseCents, 24_000);
  assert.equal(board.vendors[0].nextDeliveryDate, "2026-08-15");
  assert.equal(board.vendors[0].orders[0].lines[0].remainingQuantity, 10);
  assert.equal(board.vendors[0].orders[0].lines[0].priceChangeRate, 2_000 / 1_800 - 1);
  assert.match(board.vendors[0].orders[0].lines[0].duplicateWarning, /10 units.*already purchased/i);
  assert.equal(board.vendors[0].orders[1].statusLabel, "Partially received, balance still coming");
});

test("fully received or closed orders are removed from the upcoming commitment board", () => {
  const board = buildPurchaseCommitmentBoard([
    {
      id: "po-closed",
      orderNumber: "PO-1001",
      supplierName: "Peak Supply",
      status: "closed",
      orderDate: "2026-07-01",
      expectedDeliveryDate: "2026-07-04",
      committedCashDate: null,
      currency: "CAD",
      totalCents: 5_000,
      lines: [{ sku: "A", description: "A", quantity: 5, receivedQuantity: 5, unitCostCents: 1_000, previousCostCents: null }],
    },
  ]);
  assert.deepEqual(board.vendors, []);
  assert.equal(board.totalRemainingMerchandiseCents, 0);
});

test("draft orders are warnings, not purchased commitments", () => {
  const board = buildPurchaseCommitmentBoard([{
    id: "po-draft",
    orderNumber: "PO-DRAFT",
    supplierName: "Peak Supply",
    status: "draft",
    orderDate: "2026-08-11",
    expectedDeliveryDate: null,
    committedCashDate: null,
    currency: "CAD",
    totalCents: 10_000,
    lines: [{ sku: "A", description: "Product A", quantity: 10, receivedQuantity: 0, unitCostCents: 1_000, previousCostCents: null }],
  }]);
  assert.equal(board.vendors.length, 0);
  assert.equal(board.totalRemainingMerchandiseCents, 0);
  assert.equal(board.plannedOrders.length, 1);
  assert.match(board.plannedOrders[0].lines[0].duplicateWarning, /already planned/i);
});

test("an internally approved order remains planned until it is sent to the vendor", () => {
  const board = buildPurchaseCommitmentBoard([{
    id: "po-approved",
    orderNumber: "PO-APPROVED",
    supplierName: "Peak Supply",
    status: "approved",
    orderDate: "2026-08-11",
    expectedDeliveryDate: null,
    committedCashDate: null,
    currency: "CAD",
    totalCents: 10_000,
    lines: [{ sku: "A", description: "Product A", quantity: 10, receivedQuantity: 0, unitCostCents: 1_000, previousCostCents: null }],
  }]);
  assert.equal(board.vendors.length, 0);
  assert.equal(board.plannedOrders.length, 1);
  assert.match(board.plannedOrders[0].statusLabel, /not sent to vendor/i);
});
