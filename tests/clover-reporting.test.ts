import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  CLOVER_LATEST_SALES_SQL,
  CLOVER_VOIDED_PAYMENT_DELETE_SQL,
  CloverSourceEvidenceError,
  cloverLineDiscountCents,
  cloverLineNetSalesCents,
  cloverLineQuantityMilli,
  cloverOrderReportingState,
  cloverPaymentDisposition,
  cloverVoidedPaymentExternalId,
} from "../server/integrations/clover-reporting.ts";

function issue(code: string) {
  return (error: unknown) => error instanceof CloverSourceEvidenceError && error.code === code;
}

test("fixed and variable items ignore unitQty; weighted items preserve thousandths", () => {
  assert.equal(cloverLineQuantityMilli({ item: { priceType: "FIXED" }, unitQty: 1 }), 1000);
  assert.equal(cloverLineQuantityMilli({ item: { priceType: "VARIABLE" }, unitQty: 2000 }), 1000);
  assert.equal(cloverLineQuantityMilli({ item: { priceType: "PER_UNIT" }, unitQty: 2500 }), 2500);
  assert.equal(cloverLineQuantityMilli({ price: 1000 }), 1000);
});

test("reported quantities preserve zero and do not accept invalid or lossy values", () => {
  assert.equal(cloverLineQuantityMilli({ quantitySold: 0, unitQty: 1000 }), 0);
  assert.equal(cloverLineQuantityMilli({ quantitySold: 2.5 }), 2500);
  assert.equal(cloverLineQuantityMilli({ quantitySold: "1.005" }), 1005);
  for (const quantitySold of [-1, NaN, Infinity, true, "", " "]) {
    assert.throws(() => cloverLineQuantityMilli({ quantitySold }), issue("CLOVER_QUANTITY_INVALID"));
  }
  assert.throws(() => cloverLineQuantityMilli({ quantitySold: 0.0001 }), issue("CLOVER_QUANTITY_PRECISION"));
  assert.throws(() => cloverLineQuantityMilli({ quantitySold: Number.MAX_SAFE_INTEGER }), issue("CLOVER_QUANTITY_PRECISION"));
});

test("unknown source price type cannot make a populated unitQty authoritative", () => {
  assert.throws(() => cloverLineQuantityMilli({ item: { id: "mutable-item" }, unitQty: 2000 }), issue("CLOVER_QUANTITY_EVIDENCE_REQUIRED"));
  assert.throws(() => cloverLineQuantityMilli({ item: { priceType: "PER_UNIT" }, unitQty: null }), issue("CLOVER_QUANTITY_INVALID"));
});

test("discount collection wrappers and arrays produce the same cents", () => {
  assert.equal(cloverLineDiscountCents({ discounts: { elements: [{ amount: -100 }] }, orderLevelDiscounts: { elements: [{ amount: -50 }] } }), 150);
  assert.equal(cloverLineDiscountCents({ discounts: [{ amount: -100 }], orderLevelDiscounts: [{ amount: -50 }] }), 150);
});

test("calculated discount totals take precedence over their constituent lists", () => {
  assert.equal(cloverLineDiscountCents({ discountAmount: -100, orderLevelDiscountAmount: -50, discounts: [{ amount: -100 }], orderLevelDiscounts: [{ amount: -50 }] }), 150);
  assert.equal(cloverLineDiscountCents({ discountAmount: 0, orderLevelDiscountAmount: 0, discounts: [{ amount: -100 }] }), 0);
});

test("zero discount evidence differs from missing data and unallocated percentage discounts", () => {
  assert.equal(cloverLineDiscountCents({ discounts: { elements: [] }, orderLevelDiscounts: { elements: [] } }), 0);
  assert.throws(() => cloverLineDiscountCents({}), issue("CLOVER_DISCOUNT_EVIDENCE_REQUIRED"));
  assert.throws(() => cloverLineDiscountCents({ discounts: { elements: [{ percentage: 10 }] }, orderLevelDiscountAmount: 0 }), issue("CLOVER_DISCOUNT_ALLOCATION_REQUIRED"));
  assert.throws(() => cloverLineDiscountCents({ discountAmount: true, orderLevelDiscountAmount: 0 }), issue("CLOVER_DISCOUNT_INVALID"));
});

test("known discounts are subtracted once and supplied net reporting amounts stay net", () => {
  assert.equal(cloverLineNetSalesCents({ price: 400 }, 2500, 100), 900);
  assert.equal(cloverLineNetSalesCents({ priceWithModifiers: 1000 }, 2500, 100), 900);
  assert.equal(cloverLineNetSalesCents({ priceWithModifiersAndItemAndOrderDiscounts: 900 }, 2500, 100), 900);
  assert.throws(() => cloverLineNetSalesCents({}, 1000, 0), issue("CLOVER_LINE_AMOUNT_REQUIRED"));
  assert.throws(() => cloverLineNetSalesCents({ price: 100 }, 1000, 150), issue("CLOVER_LINE_AMOUNT_REQUIRED"));
});

test("locked orders are completed only with explicit paid status", () => {
  assert.equal(cloverOrderReportingState({ state: "locked", paymentState: "PAID" }), "completed");
  assert.equal(cloverOrderReportingState({ state: "locked", paymentState: "OPEN" }), "open");
  assert.equal(cloverOrderReportingState({ state: "locked", paymentState: "PARTIALLY_PAID" }), "open");
  assert.throws(() => cloverOrderReportingState({ state: "locked" }), issue("CLOVER_ORDER_STATUS_REQUIRED"));
  assert.equal(cloverOrderReportingState({ paymentState: "PAID", deletedTimestamp: 1789574400000 }), "voided");
});

test("refund order states remain reviewable rather than becoming full sales or zero refunds", () => {
  for (const paymentState of ["REFUNDED", "PARTIALLY_REFUNDED", "CREDITED"]) {
    assert.throws(() => cloverOrderReportingState({ state: "locked", paymentState }), issue("CLOVER_REFUND_REVIEW_REQUIRED"));
  }
});

test("failed retries, pending attempts and authorizations do not become collections", () => {
  const values = ["SUCCESS", "FAIL", "PENDING", "INITIATED", "AUTH", "OFFLINE_RETRYING", "VOIDED"];
  const posted = values.filter((result) => cloverPaymentDisposition({ result, amount: 1130 }) === "posted");
  assert.deepEqual(posted, ["SUCCESS"]);
  assert.equal(cloverPaymentDisposition({ result: "success", voided: true }), "not_posted");
});

test("uncertain settlement or linked void states require review", () => {
  for (const result of [undefined, "", "VOIDING", "VOID_FAILED", "AUTH_COMPLETED", "DISCOUNT", "NEW_PROVIDER_STATE"]) {
    assert.throws(() => cloverPaymentDisposition({ result }), issue("CLOVER_PAYMENT_STATUS_REQUIRED"));
  }
  assert.throws(() => cloverPaymentDisposition({ result: "SUCCESS", voidPaymentRef: { id: "void-reference" } }), issue("CLOVER_PAYMENT_VOID_REVIEW_REQUIRED"));
  assert.throws(() => cloverPaymentDisposition({ result: "SUCCESS", voided: "false" }), issue("CLOVER_PAYMENT_STATUS_REQUIRED"));
});

test("expanded void records cannot be mistaken for a clean successful payment", () => {
  assert.equal(cloverPaymentDisposition({ result: "SUCCESS", voids: { elements: [] } }), "posted");
  for (const voids of [{ elements: [{ id: "void-1" }] }, [{ id: "void-1" }], { href: "/voids" }, "invalid"]) {
    assert.throws(() => cloverPaymentDisposition({ result: "SUCCESS", voids }), issue("CLOVER_PAYMENT_VOID_REVIEW_REQUIRED"));
  }
  // Explicit provider evidence is authoritative; ambiguous linked records alone are not.
  assert.equal(cloverVoidedPaymentExternalId({ id: "payment-1", result: "SUCCESS", voided: true, voids: { elements: [{ id: "void-1" }] } }), "payment-1");
});

test("payment reversals require explicit void evidence and the original source ID", () => {
  assert.equal(cloverVoidedPaymentExternalId({ id: "payment-1", result: "SUCCESS", voided: true }), "payment-1");
  assert.equal(cloverVoidedPaymentExternalId({ id: "payment-1", result: "VOIDED" }), "payment-1");
  for (const result of ["SUCCESS", "FAIL", "PENDING", "INITIATED", "AUTH", "OFFLINE_RETRYING"]) {
    assert.equal(cloverVoidedPaymentExternalId({ id: "payment-1", result }), null);
  }
  for (const id of [undefined, "", " ", 12, "x".repeat(121)]) {
    assert.throws(() => cloverVoidedPaymentExternalId({ id, result: "VOIDED" }), issue("CLOVER_PAYMENT_ID_REQUIRED"));
  }
  assert.throws(() => cloverVoidedPaymentExternalId({ id: "payment-1", result: "SUCCESS", voidPaymentRef: { id: "linked" } }), issue("CLOVER_PAYMENT_VOID_REVIEW_REQUIRED"));
});

test("a confirmed void retracts an earlier collection without touching another account or a partial page", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE commerce_payments (organization_id TEXT, provider TEXT, connection_id TEXT,
        external_payment_id TEXT, amount_cents INTEGER);
      INSERT INTO commerce_payments VALUES
        ('org-a','clover','conn-a','namespace:payment-1',1130),
        ('org-a','clover','conn-a','namespace:payment-2',2260),
        ('org-b','clover','conn-a','namespace:payment-1',1130),
        ('org-a','clover','conn-b','namespace:payment-1',1130),
        ('org-a','square','conn-a','namespace:payment-1',1130);
    `);
    const total = () => db.prepare("SELECT SUM(amount_cents) amount FROM commerce_payments WHERE organization_id='org-a' AND provider='clover' AND connection_id='conn-a'").get()?.amount;
    assert.equal(total(), 3390);
    const id = cloverVoidedPaymentExternalId({ id: "payment-1", result: "SUCCESS", voided: true });
    assert.equal(id, "payment-1");
    const remove = db.prepare(CLOVER_VOIDED_PAYMENT_DELETE_SQL);
    assert.equal(remove.run("org-a", "clover", "conn-a", `namespace:${id}`).changes, 1);
    assert.equal(total(), 2260);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM commerce_payments").get()?.count, 4);
    assert.equal(remove.run("org-a", "clover", "conn-a", `namespace:${id}`).changes, 0);
    assert.equal(total(), 2260);
  } finally { db.close(); }
});

test("daily quantity query isolates connections and distinguishes incomplete from empty orders", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE integration_staged_sales (id TEXT, organization_id TEXT, provider TEXT, connection_id TEXT,
        external_sale_id TEXT, outlet_ref TEXT, sold_at TEXT, state TEXT, total_cents INTEGER,
        tax_cents INTEGER, cost_cents INTEGER, discount_cents INTEGER, line_count INTEGER,
        external_version TEXT, source_payload_hash TEXT, staged_at INTEGER);
      CREATE TABLE commerce_sale_lines (organization_id TEXT, provider TEXT, connection_id TEXT,
        external_sale_id TEXT, quantity_milli INTEGER);
      INSERT INTO integration_staged_sales VALUES
        ('old','org-a','clover','conn-a','weighted','m','2026-09-16','completed',1000,0,0,0,2,'1','h',1),
        ('new','org-a','clover','conn-a','weighted','m','2026-09-16','completed',1000,0,0,0,1,'2','h',2),
        ('missing','org-a','clover','conn-a','missing','m','2026-09-16','completed',1000,0,0,0,1,'1','h',1),
        ('empty','org-a','clover','conn-a','empty','m','2026-09-16','completed',0,0,0,0,0,'1','h',1),
        ('extra','org-a','clover','conn-a','extra','m','2026-09-16','completed',1000,0,0,0,1,'1','h',1);
      INSERT INTO commerce_sale_lines VALUES
        ('org-a','clover','conn-a','weighted',2500),
        ('org-b','clover','conn-a','weighted',99000),
        ('org-a','clover','conn-b','weighted',88000),
        ('org-a','square','conn-a','weighted',77000),
        ('org-a','clover','conn-a','extra',1000),
        ('org-a','clover','conn-a','extra',1000);
    `);
    const rows = db.prepare(CLOVER_LATEST_SALES_SQL).all("org-a", "clover", "conn-a");
    const quantities = Object.fromEntries(rows.map((row) => [row.externalSaleId, row.quantityMilli]));
    assert.deepEqual(quantities, { empty: 0, extra: null, missing: null, weighted: 2500 });
  } finally { db.close(); }
});
