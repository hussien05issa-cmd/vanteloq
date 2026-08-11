import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buildLightspeedAuthorizationUrl,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  LIGHTSPEED_SCOPES,
  lightspeedReadiness,
  normalizeLightspeedSale,
  validateDomainPrefix,
  verifyLightspeedWebhookSignature,
} from "../server/integrations/lightspeed.ts";
import {
  buildLightspeedRDailyMetrics,
  buildLightspeedRLiveSalesSnapshot,
  buildLightspeedRAuthorizationUrl,
  decryptLightspeedRSecret,
  encryptLightspeedRSecret,
  LIGHTSPEED_R_SCOPES,
  lightspeedRReadiness,
  normalizeLightspeedRInventoryItem,
  normalizeLightspeedRCustomer,
  normalizeLightspeedRProduct,
  normalizeLightspeedRSale,
  normalizeLightspeedRSaleLine,
  normalizeLightspeedRSaleLines,
  normalizeLightspeedRPayments,
  lightspeedRPaymentTypeMap,
  normalizeLightspeedRSupplier,
} from "../server/integrations/lightspeed-r.ts";

const clientSecret = "test-client-secret";
(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  LIGHTSPEED_CLIENT_ID: "test-client-id",
  LIGHTSPEED_CLIENT_SECRET: clientSecret,
  LIGHTSPEED_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/lightspeed/callback",
  LIGHTSPEED_API_VERSION: "2026-07",
  LIGHTSPEED_R_CLIENT_ID: "test-r-client-id",
  LIGHTSPEED_R_CLIENT_SECRET: "test-r-client-secret",
  LIGHTSPEED_R_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/lightspeed-r/callback",
  INTEGRATION_ENCRYPTION_KEY: Buffer.from(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  ).toString("base64"),
};

test("authorization is read-only and bound to an exact callback and state", () => {
  const state = "state-value-with-entropy";
  const url = new URL(buildLightspeedAuthorizationUrl(state));
  assert.equal(url.origin, "https://secure.retail.lightspeed.app");
  assert.equal(url.pathname, "/connect");
  assert.equal(url.searchParams.get("client_id"), "test-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://vanteloq.example/api/v1/integrations/lightspeed/callback");
  assert.equal(url.searchParams.get("state"), state);
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), [...LIGHTSPEED_SCOPES]);
  assert.doesNotMatch(url.toString(), /test-client-secret/);
});

test("R-Series authorization uses the official multi-account OAuth endpoint and read-only scopes", () => {
  const url = new URL(buildLightspeedRAuthorizationUrl("r-series-state-with-entropy"));
  assert.equal(url.origin, "https://cloud.lightspeedapp.com");
  assert.equal(url.pathname, "/auth/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "test-r-client-id");
  assert.equal(url.searchParams.get("state"), "r-series-state-with-entropy");
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), [...LIGHTSPEED_R_SCOPES]);
  assert.doesNotMatch(url.toString(), /test-r-client-secret/);
});

test("R-Series callback accepts the provider's long opaque authorization code shape", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(
    `${process.cwd()}/app/api/v1/integrations/lightspeed-r/callback/route.ts`,
    "utf8",
  ));
  assert.match(source, /code\.length > 4096/);
  assert.doesNotMatch(source, /code\.length > 512/);
  assert.match(source, /\^\[A-Za-z0-9_-\]\{43\}\$/);
});

test("R-Series readiness exposes the verified read-only live sync", () => {
  const readiness = lightspeedRReadiness();
  assert.equal(readiness.adapterBuilt, true);
  assert.equal(readiness.credentialsConfigured, true);
  assert.equal(readiness.apiVersion, "V3");
  assert.deepEqual(readiness.scopes, ["employee:register_read", "employee:inventory_read"]);
  assert.equal(readiness.mode, "read_only_live_sync");
  assert.equal(readiness.dataPromotionEnabled, true);
});

test("R-Series tokens use provider-bound authenticated encryption", async () => {
  const encrypted = await encryptLightspeedRSecret("r-series-private-token");
  assert.match(encrypted, /^v1\./);
  assert.doesNotMatch(encrypted, /r-series-private-token/);
  assert.equal(await decryptLightspeedRSecret(encrypted), "r-series-private-token");
  await assert.rejects(() => decryptIntegrationSecret(encrypted));
});

test("R-Series sale normalization preserves financial facts and excludes customer data", async () => {
  const normalized = await normalizeLightspeedRSale({
    saleID: "401", timeStamp: "2026-08-05T12:00:00Z", completeTime: "2026-08-05T11:59:00Z",
    completed: "true", voided: "false", shopID: "8", total: "61.75", taxTotal: "3.75",
    calcFIFOCost: "24.10", calcDiscount: "2.00", Customer: { firstName: "Do not store", email: "private@example.invalid" },
    SaleLines: { SaleLine: [{ saleLineID: "1" }, { saleLineID: "2" }] },
  });
  assert.equal(normalized.externalSaleId, "401");
  assert.equal(normalized.outletRef, "8");
  assert.equal(normalized.state, "completed");
  assert.equal(normalized.totalCents, 6175);
  assert.equal(normalized.taxCents, 375);
  assert.equal(normalized.costCents, 2410);
  assert.equal(normalized.discountCents, 200);
  assert.equal(normalized.lineCount, 2);
  assert.doesNotMatch(JSON.stringify(normalized), /Do not store|private@example/);
});

test("R-Series inventory normalization extracts per-shop balances without customer data", () => {
  const balances = normalizeLightspeedRInventoryItem({
    itemID: "900",
    description: "Creatine A",
    customSku: "CRE-A",
    ItemShops: {
      ItemShop: [
        { shopID: "8", qoh: "45", reorderPoint: "24" },
        { shopID: "9", qoh: "12", reorderPoint: "6" },
      ],
    },
    Customer: { email: "private@example.invalid" },
  });
  assert.deepEqual(balances, [
    { externalItemId: "900", outletRef: "8", sku: "CRE-A", name: "Creatine A", onHandQuantity: 45, reorderPoint: 24 },
    { externalItemId: "900", outletRef: "9", sku: "CRE-A", name: "Creatine A", onHandQuantity: 12, reorderPoint: 6 },
  ]);
  assert.doesNotMatch(JSON.stringify(balances), /private@example/);
});

test("R-Series commerce normalization produces provider-neutral catalog, customer, supplier and sale-line records", async () => {
  const product = await normalizeLightspeedRProduct({
    itemID: "900", description: "Creatine A", customSku: "CRE-A", categoryID: "12",
    defaultVendorID: "44", defaultCost: "21.50", Prices: { ItemPrice: [{ useType: "Default", amount: "39.99" }] },
  });
  assert.equal(product.defaultCostCents, 2150);
  assert.equal(product.defaultPriceCents, 3999);
  assert.equal(product.supplierRef, "44");
  const customer = await normalizeLightspeedRCustomer({
    customerID: "cust-1", firstName: "Ada", lastName: "Lovelace",
    Contact: { email: "ada@example.invalid", phone: "555-0100" },
  });
  assert.equal(customer.displayName, "Ada Lovelace");
  assert.equal(customer.email, "ada@example.invalid");
  const supplier = await normalizeLightspeedRSupplier({
    vendorID: "44", name: "North Supply", accountNumber: "NS-14",
    Contact: { firstName: "Sam", lastName: "Lee", email: "orders@example.invalid" },
  });
  assert.equal(supplier.contactName, "Sam Lee");
  const lines = await normalizeLightspeedRSaleLines({
    saleID: "sale-1", customerID: "cust-1", shopID: "8", completeTime: "2026-08-09T10:00:00-06:00",
    SaleLines: { SaleLine: [{ saleLineID: "line-1", itemID: "900", unitQuantity: "2", calcSubtotal: "79.98", calcFIFOCost: "43.00" }] },
  });
  assert.equal(lines[0].quantityMilli, 2000);
  assert.equal(lines[0].netSalesCents, 7998);
  assert.equal(lines[0].customerRef, "cust-1");
  const directLine = await normalizeLightspeedRSaleLine({
    saleLineID: "line-2", saleID: "sale-1", itemID: "900", shopID: "8",
    unitQuantity: "3", unitPrice: "12.50", calcFIFOCost: "18.00",
  });
  assert.equal(directLine.quantityMilli, 3000);
  assert.equal(directLine.netSalesCents, 3750);
  assert.equal(directLine.costCents, 1800);
  const relatedItemLine = await normalizeLightspeedRSaleLine({
    saleLineID: "line-3", saleID: "sale-1", unitQuantity: "1", unitPrice: "9.99",
    Item: { itemID: "901", customSku: "PRE-B", description: "Pre-workout B" },
  });
  assert.equal(relatedItemLine.productRef, "901");
  assert.equal(relatedItemLine.sku, "PRE-B");
  assert.equal(relatedItemLine.productName, "Pre-workout B");
});

test("R-Series payment normalization records tender totals without card or customer details", async () => {
  const types = lightspeedRPaymentTypeMap([
    { paymentTypeID: "1", name: "Cash" },
    { paymentTypeID: "2", name: "Visa" },
  ]);
  const normalized = await normalizeLightspeedRPayments({
    saleID: "sale-100",
    shopID: "8",
    completeTime: "2026-08-09T10:00:00-06:00",
    SalePayments: { SalePayment: [
      { salePaymentID: "pay-1", paymentTypeID: "1", amount: "20.00", cardNumber: "4111111111111111" },
      { salePaymentID: "pay-2", paymentTypeID: "2", amount: "42.50", customerName: "Do not store" },
    ] },
  }, types);
  assert.deepEqual(normalized.map((payment) => ({ id: payment.externalPaymentId, category: payment.category, amount: payment.amountCents })), [
    { id: "pay-1", category: "cash", amount: 2000 },
    { id: "pay-2", category: "card", amount: 4250 },
  ]);
  assert.doesNotMatch(JSON.stringify(normalized), /4111111111111111|Do not store/);
});

test("R-Series daily metrics aggregate completed sales and refunds by source shop", async () => {
  const sale = await normalizeLightspeedRSale({
    saleID: "sale-1", completed: "true", shopID: "8", completeTime: "2026-08-09T10:00:00-06:00",
    total: "107.00", taxTotal: "5.00", calcFIFOCost: "40.00", calcDiscount: "3.00",
    SaleLines: { SaleLine: [{ saleLineID: "1" }, { saleLineID: "2" }] },
  });
  const refund = await normalizeLightspeedRSale({
    saleID: "sale-2", completed: "true", shopID: "8", completeTime: "2026-08-09T11:00:00-06:00",
    total: "-21.00", taxTotal: "-1.00", calcFIFOCost: "-8.00", calcDiscount: "0",
    SaleLines: { SaleLine: [{ saleLineID: "3" }] },
  });
  assert.deepEqual(buildLightspeedRDailyMetrics([sale, refund]), [{
    businessDate: "2026-08-09",
    locationRef: "lightspeed-r:8",
    grossSalesCents: 10_500,
    netSalesCents: 8_200,
    costOfGoodsCents: 3_200,
    transactionCount: 1,
    unitsSold: 2,
    refundsCents: 2_000,
    discountsCents: 300,
  }]);
});

test("R-Series live snapshot calculates current-day sales, profit, average transaction and hourly points", async () => {
  const saleOne = await normalizeLightspeedRSale({
    saleID: "today-1", completed: "true", shopID: "8", completeTime: "2026-08-09T10:15:00-06:00",
    total: "107.00", taxTotal: "5.00", calcFIFOCost: "40.00", calcDiscount: "3.00",
    SaleLines: { SaleLine: [{ saleLineID: "1" }, { saleLineID: "2" }] },
  });
  const saleTwo = await normalizeLightspeedRSale({
    saleID: "today-2", completed: "true", shopID: "8", completeTime: "2026-08-09T11:45:00-06:00",
    total: "53.50", taxTotal: "2.50", calcFIFOCost: "20.00", calcDiscount: "0",
    SaleLines: { SaleLine: [{ saleLineID: "3" }] },
  });
  const refund = await normalizeLightspeedRSale({
    saleID: "today-refund", completed: "true", shopID: "8", completeTime: "2026-08-09T12:10:00-06:00",
    total: "-21.00", taxTotal: "-1.00", calcFIFOCost: "-8.00", calcDiscount: "0",
    SaleLines: { SaleLine: [{ saleLineID: "4" }] },
  });
  const yesterday = await normalizeLightspeedRSale({
    saleID: "yesterday", completed: "true", shopID: "8", completeTime: "2026-08-08T16:00:00-06:00",
    total: "999.00", taxTotal: "0", calcFIFOCost: "100.00",
  });
  const snapshot = buildLightspeedRLiveSalesSnapshot(
    [saleOne, saleTwo, refund, yesterday],
    "America/Edmonton",
    new Date("2026-08-09T19:00:00Z"),
  );
  assert.equal(snapshot.businessDate, "2026-08-09");
  assert.equal(snapshot.netSalesCents, 13_300);
  assert.equal(snapshot.grossProfitCents, 8_100);
  assert.equal(snapshot.averageTransactionCents, 6_650);
  assert.equal(snapshot.transactionCount, 2);
  assert.equal(snapshot.unitsSold, 3);
  assert.equal(snapshot.refundsCents, 2_000);
  assert.equal(snapshot.hourly[10].netSalesCents, 10_200);
  assert.equal(snapshot.hourly[11].netSalesCents, 5_100);
  assert.equal(snapshot.hourly[12].netSalesCents, -2_000);
});

test("readiness reports a staged adapter with promotion disabled", () => {
  const readiness = lightspeedReadiness();
  assert.equal(readiness.adapterBuilt, true);
  assert.equal(readiness.credentialsConfigured, true);
  assert.equal(readiness.mode, "read_only_staging");
  assert.equal(readiness.dataPromotionEnabled, false);
  assert.deepEqual(readiness.scopes, ["outlets:read", "sales:read"]);
});

test("retailer domains are constrained to a single safe prefix", () => {
  assert.equal(validateDomainPrefix("  North-Store  "), "north-store");
  for (const value of ["evil.example", "https://evil", "../retailer", "two labels"]) {
    assert.throws(() => validateDomainPrefix(value));
  }
});

test("provider tokens encrypt with authenticated encryption and round-trip", async () => {
  const plaintext = "access-token-that-must-not-be-stored";
  const encrypted = await encryptIntegrationSecret(plaintext);
  assert.match(encrypted, /^v1\./);
  assert.doesNotMatch(encrypted, new RegExp(plaintext));
  assert.equal(await decryptIntegrationSecret(encrypted), plaintext);
});

test("sale normalization stores accounting fields but drops customer PII", async () => {
  const normalized = await normalizeLightspeedSale({
    id: "sale-100",
    state: "closed",
    date: "2026-08-05T15:00:00Z",
    outlet_id: "outlet-1",
    customer: { name: "Never Persist", email: "private@example.invalid" },
    totals: { total_price: 42.55, total_tax: 2.55, total_discount: 1.5 },
    line_items: [
      { quantity: 2, pricing: { cost: 8.25 }, product: { name: "Private source label" } },
    ],
    _metadata: { version: 17 },
  });
  assert.equal(normalized.externalSaleId, "sale-100");
  assert.equal(normalized.externalVersion, "17");
  assert.equal(normalized.totalCents, 4_255);
  assert.equal(normalized.taxCents, 255);
  assert.equal(normalized.discountCents, 150);
  assert.equal(normalized.costCents, 1_650);
  assert.equal(normalized.lineCount, 1);
  assert.doesNotMatch(JSON.stringify(normalized), /Never Persist|private@example|Private source label/);
});

test("sale normalization reads the official 2026-07 totals and line aggregate fields", async () => {
  const normalized = await normalizeLightspeedSale({
    id: "sale-2026-07",
    date: "2026-08-09T15:00:00Z",
    state: "closed",
    source: { outlet_id: "outlet-live" },
    totals: { price: 48, tax: 2.4, price_incl_tax: 50.4 },
    line_items: [
      {
        quantity: 2,
        pricing: {
          price: 30,
          total: 48,
          discount: 6,
          discount_total: 12,
          cost: 15,
          cost_total: 30,
        },
      },
    ],
    _metadata: { version: 22446763475 },
  });
  assert.equal(normalized.externalVersion, "22446763475");
  assert.equal(normalized.outletRef, "outlet-live");
  assert.equal(normalized.totalCents, 4_800);
  assert.equal(normalized.taxCents, 240);
  assert.equal(normalized.discountCents, 1_200);
  assert.equal(normalized.costCents, 3_000);
});

test("webhook HMAC verification rejects tampering", async () => {
  const body = new TextEncoder().encode("type=sale.update&domain_prefix=north-store");
  const signature = createHmac("sha256", clientSecret).update(body).digest("hex");
  assert.equal((await verifyLightspeedWebhookSignature(body, `algorithm=HMAC-SHA256, signature=${signature}`)).valid, true);
  const tampered = new TextEncoder().encode("type=sale.update&domain_prefix=other-store");
  assert.equal((await verifyLightspeedWebhookSignature(tampered, `algorithm=HMAC-SHA256, signature=${signature}`)).valid, false);
});
