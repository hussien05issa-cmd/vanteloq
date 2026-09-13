import assert from "node:assert/strict";
import test from "node:test";
import { buildXDailyMetrics, normalizeXCommerceSale, normalizeXCustomer, normalizeXInventory, normalizeXProduct } from "../server/integrations/lightspeed-commerce.ts";

const receipt = () => ({ id: "sale", state: "closed", _metadata: { version: 17 }, source: { outlet_id: "outlet", register_id: "register" }, date: "2026-09-12T23:00:00-06:00", customer_id: "customer", totals: { price: 48, tax: 2.4, price_incl_tax: 50.4 }, line_items: [{ id: "line", product: { id: "product" }, quantity: 2, pricing: { price: 24, total: 48, discount: 6, discount_total: 12, cost: 15, cost_total: 30 } }], payments: [{ id: "payment", amount: 50.4, type: { id: "visa", name: "Visa" }, date: "2026-09-13T05:00:00Z", external_attributes: { card_number: "do-not-copy" } }] });

test("X-Series reconciles tax-exclusive discounted lines and keeps only permitted payment facts", async () => {
  const result = await normalizeXCommerceSale(receipt());
  assert.equal(result.sale.totalCents, 5040); assert.equal(result.sale.taxCents, 240);
  assert.equal(result.lines[0].netSalesCents, 4800); assert.equal(result.lines[0].discountCents, 1200);
  assert.equal(result.lines[0].costCents, 3000); assert.equal(result.lines[0].quantityMilli, 2000);
  assert.equal(result.sale.state, "completed"); assert.equal(result.payments[0].category, "card");
  assert.doesNotMatch(JSON.stringify(result), /do-not-copy|external_attributes/);
  const [daily] = buildXDailyMetrics([{ ...result.sale, unitsMilli: 2000 }], "America/Edmonton");
  assert.equal(daily.businessDate, "2026-09-12"); assert.equal(daily.netSalesCents, 4800);
  assert.equal(daily.grossSalesCents, 6000); assert.equal(daily.unitsSold, 2);
});

test("X-Series returns preserve signs and explicit zero costs differ from absent costs", async () => {
  const source = receipt(); source.totals = { price: -48, tax: -2.4, price_incl_tax: -50.4 };
  source.line_items[0].quantity = -2; source.line_items[0].pricing.total = -48;
  source.line_items[0].pricing.discount_total = -12; source.line_items[0].pricing.cost_total = -30;
  const result = await normalizeXCommerceSale(source);
  assert.equal(result.lines[0].netSalesCents, -4800); assert.equal(result.lines[0].costCents, -3000);
  const zero = receipt(); zero.line_items[0].pricing.cost = 0; zero.line_items[0].pricing.cost_total = 0;
  assert.equal((await normalizeXCommerceSale(zero)).missingCosts, 0);
  const unknown = receipt(); Object.assign(unknown.line_items[0].pricing, { cost: undefined, cost_total: undefined });
  assert.equal((await normalizeXCommerceSale(unknown)).lines[0].costCents, null);
  assert.equal((await normalizeXCommerceSale(unknown)).missingCosts, 1);
});

test("X-Series refuses unexplained totals, incomplete lines and register IDs used as outlets", async () => {
  const source = receipt(); source.line_items[0].pricing.total = 47;
  await assert.rejects(normalizeXCommerceSale(source), /do not reconcile/);
  const noOutlet = receipt(); Object.assign(noOutlet.source, { outlet_id: undefined });
  await assert.rejects(normalizeXCommerceSale(noOutlet), /outlet/);
  const voided = { ...receipt(), state: "voided", line_items: undefined };
  assert.deepEqual((await normalizeXCommerceSale(voided)).lines, []);
  assert.equal((await normalizeXCommerceSale({ ...receipt(), deleted_at: "2026-09-13T00:00:00Z" })).sale.state, "voided");
});

test("X-Series category paths use names, absent costs stay unknown and unnecessary customer fields are dropped", async () => {
  const product = await normalizeXProduct({ id: "product", name: "Creatine", sku: "CRE", product_category: { id: "leaf", name: "Creatine", category_path: [{ id: "root", name: "Performance" }] } });
  assert.equal(product.categoryName, "Performance / Creatine"); assert.equal(product.defaultCostCents, null);
  assert.equal(normalizeXInventory({ product_id: "product", outlet_id: "outlet", current_inventory_level: 12.5, reorder_point: 4 }).onHandQuantity, 12.5);
  const customer = await normalizeXCustomer({ id: "customer", first_name: "Test", date_of_birth: "never-store", note: "never-store", email: "never-store", physical_address_1: "never-store" });
  assert.doesNotMatch(JSON.stringify(customer), /never-store/);
});
