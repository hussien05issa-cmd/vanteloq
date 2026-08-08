import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryWrites, confirmationCopy, eventKey, parsePaymentSettlement } from "../server/operations.ts";

const payment = () => parsePaymentSettlement({
  sourceSystem: "lightspeed-r",
  sourceEventId: "sale-1482",
  paymentId: "payment-1482",
  locationRef: "new-castle",
  customerEmail: "customer@example.ca",
  currency: "CAD",
  totalCents: 8998,
  occurredAt: "2026-08-08T18:30:00.000Z",
  lines: [
    { sku: "CRE-MONO-500", name: "Creatine Monohydrate 500g", quantity: 2, unitPriceCents: 3999 },
    { sku: "SHAKER-01", name: "Shaker", quantity: 1, unitPriceCents: 1000 },
  ],
});

test("normalizes a settled payment and produces deterministic inventory movements", () => {
  const settlement = payment();
  const key = eventKey("workspace-1", settlement);
  assert.equal(key, "payment:workspace-1:lightspeed-r:sale-1482");
  assert.deepEqual(buildInventoryWrites(key, settlement).map(({ sku, quantityDelta }) => ({ sku, quantityDelta })), [
    { sku: "CRE-MONO-500", quantityDelta: -2 },
    { sku: "SHAKER-01", quantityDelta: -1 },
  ]);
});

test("rejects a payment whose lines do not reconcile to its total", () => {
  assert.throws(() => parsePaymentSettlement({ ...payment(), totalCents: 8999 }), /lines do not equal/i);
});

test("prepares but does not claim to send a customer confirmation", () => {
  const copy = confirmationCopy(payment());
  assert.match(copy.subject, /payment-1482/);
  assert.match(copy.bodyText, /CA\$89\.98|\$89\.98/);
});
