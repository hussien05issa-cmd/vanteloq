import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { buildThirteenWeekCashFlow } from "../domain/thirteen-week-cash-flow.ts";

const origin = "https://vanteloq.example";
const executionContext = { waitUntil() {}, passThroughOnException() {} };

function identityHeaders(email: string, write = false) {
  const payload = Buffer.from(JSON.stringify({
    email,
    aal: "aal2",
    session_id: `session:${email}`,
  })).toString("base64url");
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer test.${payload}.signature`,
  };
  if (write) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
    headers["sec-fetch-site"] = "same-origin";
  }
  return headers;
}

function onboardingBody(ownerName: string, businessName: string) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return {
    ownerName,
    businessName,
    legalName: `${businessName} Ltd.`,
    businessEmail: `${businessName.toLowerCase().replace(/[^a-z]/g, "")}@example.invalid`,
    phone: "",
    website: "",
    industry: "Retail",
    country: "CA",
    province: "AB",
    city: "Edmonton",
    address: "1 Test Avenue",
    postalCode: "T5A 1A1",
    emailNotifications: true,
    timezone: "America/Edmonton",
    currency: "CAD",
    fiscalYearStart: "January",
    taxNumber: "",
    hours: days.map((day) => ({ day, open: "10:00", close: "21:00", closed: false })),
    sourceMode: "csv",
    selectedPos: "",
    legalAccepted: true,
    termsVersion: "2026-08-24",
    privacyPolicyVersion: "2026-08-24",
    legalNoticeVersion: "account-creation-v2",
  };
}

async function createEnvironment() {
  const authServer = createServer((request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `test-user:${payload.email}`,
      email: payload.email,
      email_confirmed_at: "2026-08-01T00:00:00.000Z",
      user_metadata: { full_name: payload.email },
    }));
  });
  await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const address = authServer.address();
  assert.ok(address && typeof address !== "string");

  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-bookloq-cash-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((file) => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("bookloq-cash-regression", crypto.randomUUID());
  const worker = (await import(workerUrl.href)).default;
  const environment = {
    DB: database,
    BOOKLOQ_DEMO_ENABLED: "true",
    SUPABASE_URL: `http://127.0.0.1:${address.port}`,
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const dispose = async () => {
    try {
      await miniflare.dispose();
    } finally {
      authServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => authServer.close((error) => error ? reject(error) : resolve()));
    }
  };
  return { worker, environment, database, dispose };
}

async function dispatch(
  worker: { fetch: (request: Request, environment: unknown, context: unknown) => Promise<Response> },
  environment: unknown,
  path: string,
  options: { method?: string; email: string; body?: unknown; idempotencyKey?: string },
) {
  const method = options.method ?? "GET";
  const headers = identityHeaders(options.email, method !== "GET");
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  return worker.fetch(new Request(`${origin}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }), environment, executionContext);
}

async function grantBookLoQ(database: D1Database, organizationId: string) {
  const now = Date.now();
  await database.batch([
    database.prepare(`INSERT INTO tenant_subscriptions
      (organization_id, base_plan, billing_interval, status, cancel_at_period_end, version, created_at, updated_at)
      VALUES (?, 'pro', 'month', 'active', 0, 1, ?, ?)`).bind(organizationId, now, now),
    database.prepare(`INSERT INTO tenant_addons
      (id, organization_id, addon_key, status, created_at, updated_at)
      VALUES (?, ?, 'bookloq', 'active', ?, ?)`).bind(crypto.randomUUID(), organizationId, now, now),
  ]);
}

async function getCashFlow(
  worker: { fetch: (request: Request, environment: unknown, context: unknown) => Promise<Response> },
  environment: unknown,
  email: string,
) {
  const response = await dispatch(worker, environment, "/api/v1/bookloq", { email });
  assert.equal(response.status, 200);
  return (await response.json()).bookloq.thirteenWeekCashFlow;
}

function forecastTotals(flow: { weeks: Array<{ confirmedNetCents: number; expectedNetCents: number }> }) {
  return flow.weeks.reduce((totals, week) => ({
    confirmedCents: totals.confirmedCents + week.confirmedNetCents,
    expectedCents: totals.expectedCents + week.expectedNetCents,
  }), { confirmedCents: 0, expectedCents: 0 });
}

async function clearLiveCommitments(database: D1Database, organizationId: string) {
  await database.batch([
    database.prepare("DELETE FROM supplier_bills WHERE organization_id = ? AND demo_record = 0").bind(organizationId),
    database.prepare("DELETE FROM purchase_orders WHERE organization_id = ?").bind(organizationId),
  ]);
}

async function seedPurchaseOrder(database: D1Database, input: {
  organizationId: string;
  userId: string;
  locationId: string;
  id: string;
  orderNumber: string;
  currency?: string;
  totalCents?: number;
  committedCashDate?: string | null;
  expectedDeliveryDate?: string | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const totalCents = input.totalCents ?? 100_000;
  await database.prepare(`INSERT INTO purchase_orders
    (id, organization_id, order_number, supplier_name, delivery_location_id, order_date,
     expected_delivery_date, currency, status, subtotal_cents, tax_cents, discount_cents,
     total_cents, committed_cash_date, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, 'Regression supplier', ?, ?, ?, ?, 'sent', ?, 0, 0, ?, ?, ?, ?, ?)`).bind(
      input.id,
      input.organizationId,
      input.orderNumber,
      input.locationId,
      today,
      input.expectedDeliveryDate === undefined ? today : input.expectedDeliveryDate,
      input.currency ?? "CAD",
      totalCents,
      totalCents,
      input.committedCashDate === undefined ? today : input.committedCashDate,
      input.userId,
      now,
      now,
    ).run();
}

async function seedSupplierBill(database: D1Database, input: {
  organizationId: string;
  supplierId: string;
  id: string;
  billNumber: string;
  purchaseOrderRef: string;
  status: string;
  approvalStatus: string;
  totalCents: number;
  paidCents: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  await database.prepare(`INSERT INTO supplier_bills
    (id, organization_id, supplier_id, bill_number, invoice_date, due_date, status,
     subtotal_cents, tax_cents, total_cents, paid_cents, currency, purchase_order_ref,
     location_ref, approval_status, demo_record, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'CAD', ?, 'all', ?, 0, ?, ?)`).bind(
      input.id,
      input.organizationId,
      input.supplierId,
      input.billNumber,
      today,
      today,
      input.status,
      input.totalCents,
      input.totalCents,
      input.paidCents,
      input.purchaseOrderRef,
      input.approvalStatus,
      now,
      now,
    ).run();
}

test("BookLoQ cash-flow route deduplicates commitments and only counts trusted cash movements", async (t) => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `bookloq-cash-${suffix}@example.invalid`;
    const businessName = `BookLoQ cash ${suffix}`;
    const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", {
      method: "POST",
      email,
      body: onboardingBody("Cash Control Owner", businessName),
    });
    assert.equal(onboarding.status, 201);

    const identity = await database.prepare(`SELECT u.id userId, m.organization_id organizationId
      FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(email).first<{
        userId: string;
        organizationId: string;
      }>();
    assert.ok(identity?.userId && identity.organizationId);
    const location = await database.prepare(`SELECT id FROM organization_locations
      WHERE organization_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
      .bind(identity.organizationId).first<{ id: string }>();
    assert.ok(location?.id);
    await grantBookLoQ(database, identity.organizationId);

    const seeded = await dispatch(worker, environment, "/api/v1/bookloq/demo", {
      method: "POST",
      email,
      body: {},
    });
    assert.equal(seeded.status, 201);

    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1_000);
    const approvedItemRef = `plaid-item-${suffix}`;
    await database.batch([
      database.prepare("UPDATE bookloq_settings SET data_mode = 'live', updated_at = ? WHERE organization_id = ?")
        .bind(nowSeconds, identity.organizationId),
      database.prepare(`UPDATE bank_accounts SET provider = 'plaid', demo_record = 0,
        external_account_ref = ?, external_item_ref = ?, currency = 'CAD',
        connection_status = 'healthy', live_balance_cents = 2397800,
        available_balance_cents = 2397800, last_sync_at = ?, updated_at = ?
        WHERE organization_id = ?`)
        .bind(`plaid-account-${suffix}`, approvedItemRef, nowSeconds - 60, nowSeconds, identity.organizationId),
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, status, external_account_ref, scopes_json,
         data_promotion_status, connected_at, last_successful_sync_at, created_at, updated_at)
        VALUES (?, ?, 'plaid', 'connected', ?, '["transactions","balance"]',
          'approved', ?, ?, ?, ?)`)
        .bind(`plaid-connection-${suffix}`, identity.organizationId, approvedItemRef,
          nowSeconds, nowSeconds, nowSeconds, nowSeconds),
    ]);
    const supplier = await database.prepare(`SELECT id FROM bookloq_contacts
      WHERE organization_id = ? AND contact_type = 'supplier' ORDER BY created_at LIMIT 1`)
      .bind(identity.organizationId).first<{ id: string }>();
    assert.ok(supplier?.id);

    await t.test("a fully paid and reconciled linked bill retires the purchase-order commitment", async () => {
      await clearLiveCommitments(database, identity.organizationId);
      await seedPurchaseOrder(database, {
        organizationId: identity.organizationId,
        userId: identity.userId,
        locationId: location.id,
        id: "cash-regression-paid-po",
        orderNumber: "PO-CASH-PAID",
      });
      await seedSupplierBill(database, {
        organizationId: identity.organizationId,
        supplierId: supplier.id,
        id: "cash-regression-paid-bill",
        billNumber: "BILL-CASH-PAID",
        purchaseOrderRef: "cash-regression-paid-po",
        status: "reconciled",
        approvalStatus: "approved",
        totalCents: 100_000,
        paidCents: 100_000,
      });

      assert.deepEqual(forecastTotals(await getCashFlow(worker, environment, email)), {
        confirmedCents: 0,
        expectedCents: 0,
      });
    });

    await t.test("a provisional bill below its PO value leaves only the unpaid PO amount confirmed", async () => {
      await clearLiveCommitments(database, identity.organizationId);
      await seedPurchaseOrder(database, {
        organizationId: identity.organizationId,
        userId: identity.userId,
        locationId: location.id,
        id: "cash-regression-below-po",
        orderNumber: "PO-CASH-BELOW",
      });
      await seedSupplierBill(database, {
        organizationId: identity.organizationId,
        supplierId: supplier.id,
        id: "cash-regression-below-bill",
        billNumber: "BILL-CASH-BELOW",
        purchaseOrderRef: "cash-regression-below-po",
        status: "under_review",
        approvalStatus: "pending",
        totalCents: 60_000,
        paidCents: 20_000,
      });

      assert.deepEqual(forecastTotals(await getCashFlow(worker, environment, email)), {
        confirmedCents: -80_000,
        expectedCents: 0,
      });
    });

    await t.test("a provisional bill above its PO value retains the uncovered variance as expected", async () => {
      await clearLiveCommitments(database, identity.organizationId);
      await seedPurchaseOrder(database, {
        organizationId: identity.organizationId,
        userId: identity.userId,
        locationId: location.id,
        id: "cash-regression-above-po",
        orderNumber: "PO-CASH-ABOVE",
      });
      await seedSupplierBill(database, {
        organizationId: identity.organizationId,
        supplierId: supplier.id,
        id: "cash-regression-above-bill",
        billNumber: "BILL-CASH-ABOVE",
        purchaseOrderRef: "PO-CASH-ABOVE",
        status: "under_review",
        approvalStatus: "pending",
        totalCents: 140_000,
        paidCents: 20_000,
      });

      assert.deepEqual(forecastTotals(await getCashFlow(worker, environment, email)), {
        confirmedCents: -80_000,
        expectedCents: -40_000,
      });
    });

    await t.test("actual cash excludes credit accounts and Plaid items without an approved connection", async () => {
      await clearLiveCommitments(database, identity.organizationId);
      const operatingBank = await database.prepare(`SELECT financial_account_id financialAccountId
        FROM bank_accounts WHERE organization_id = ? AND account_type = 'chequing' LIMIT 1`)
        .bind(identity.organizationId).first<{ financialAccountId: string }>();
      assert.ok(operatingBank?.financialAccountId);
      const creditAccountId = `cash-regression-credit-${suffix}`;
      const disconnectedAccountId = `cash-regression-disconnected-${suffix}`;
      const disconnectedItemRef = `plaid-disconnected-${suffix}`;
      await database.batch([
        database.prepare(`INSERT INTO financial_accounts
          (id, organization_id, code, name, account_type, account_subtype, normal_balance,
           system_key, description, plain_language, tax_treatment, restricted, active, created_at, updated_at)
          VALUES (?, ?, '1098', 'Regression credit card', 'liability', 'credit_card', 'credit',
            NULL, '', '', 'none', 0, 1, ?, ?)`)
          .bind(creditAccountId, identity.organizationId, nowSeconds, nowSeconds),
        database.prepare(`INSERT INTO financial_accounts
          (id, organization_id, code, name, account_type, account_subtype, normal_balance,
           system_key, description, plain_language, tax_treatment, restricted, active, created_at, updated_at)
          VALUES (?, ?, '1099', 'Regression disconnected cash', 'asset', 'bank', 'debit',
            NULL, '', '', 'none', 0, 1, ?, ?)`)
          .bind(disconnectedAccountId, identity.organizationId, nowSeconds, nowSeconds),
        database.prepare(`INSERT INTO bank_accounts
          (id, organization_id, financial_account_id, name, account_type, institution_name,
           masked_number, currency, provider, external_account_ref, external_item_ref,
           live_balance_cents, available_balance_cents, book_balance_cents, connection_status,
           last_sync_at, demo_record, created_at, updated_at)
          VALUES (?, ?, ?, 'Regression card', 'credit_card', 'Regression bank', '1001',
            'CAD', 'plaid', ?, ?, -10000, NULL, -10000, 'healthy', ?, 0, ?, ?)`)
          .bind(`cash-regression-credit-bank-${suffix}`, identity.organizationId, creditAccountId,
            `plaid-credit-${suffix}`, approvedItemRef, nowSeconds - 60, nowSeconds, nowSeconds),
        database.prepare(`INSERT INTO bank_accounts
          (id, organization_id, financial_account_id, name, account_type, institution_name,
           masked_number, currency, provider, external_account_ref, external_item_ref,
           live_balance_cents, available_balance_cents, book_balance_cents, connection_status,
           last_sync_at, demo_record, created_at, updated_at)
          VALUES (?, ?, ?, 'Disconnected cash', 'merchant', 'Regression bank', '1002',
            'CAD', 'plaid', ?, ?, 0, 0, 0, 'healthy', ?, 0, ?, ?)`)
          .bind(`cash-regression-disconnected-bank-${suffix}`, identity.organizationId, disconnectedAccountId,
            `plaid-disconnected-account-${suffix}`, disconnectedItemRef, nowSeconds - 60, nowSeconds, nowSeconds),
      ]);

      const today = new Date().toISOString().slice(0, 10);
      const transaction = (id: string, accountId: string, amountCents: number) => database.prepare(`INSERT INTO financial_transactions
        (id, organization_id, transaction_date, posting_date, description, original_description,
         amount_cents, currency, exchange_rate_ppm, tax_amount_cents, account_id, source_system,
         external_source_id, source_state, location_ref, reconciliation_status,
         categorization_status, confidence_basis_points, approval_status, demo_record, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '', ?, 'CAD', 1000000, 0, ?, 'plaid', ?, 'posted', 'all',
          'unreconciled', 'confirmed', 10000, 'not_required', 0, ?, ?)`).bind(
            id,
            identity.organizationId,
            today,
            today,
            id,
            amountCents,
            accountId,
            id,
            nowSeconds,
            nowSeconds,
          );
      await database.batch([
        transaction(`cash-regression-operating-${suffix}`, operatingBank.financialAccountId, 10_000),
        transaction(`cash-regression-credit-transaction-${suffix}`, creditAccountId, 20_000),
        transaction(`cash-regression-disconnected-transaction-${suffix}`, disconnectedAccountId, 30_000),
      ]);

      const flow = await getCashFlow(worker, environment, email);
      assert.equal(flow.weeks.reduce((sum: number, week: { actualNetCents: number }) => sum + week.actualNetCents, 0), 10_000);
    });

    await t.test("malformed committed cash dates are rejected and legacy malformed values fail closed", async () => {
      await clearLiveCommitments(database, identity.organizationId);
      const today = new Date().toISOString().slice(0, 10);
      const createResponse = await dispatch(worker, environment, "/api/v1/purchasing", {
        method: "POST",
        email,
        body: {
          action: "create",
          supplierName: "Regression supplier",
          deliveryLocationId: location.id,
          orderNumber: `PO-MALFORMED-${suffix}`,
          orderDate: today,
          expectedDeliveryDate: today,
          committedCashDate: "2026-02-30",
          currency: "CAD",
          lines: [{ description: "Regression item", quantity: 1, unitCostCents: 100_000 }],
        },
      });
      assert.equal(createResponse.status, 400);
      assert.equal((await createResponse.json()).error.code, "INVALID_FIELD");

      await seedPurchaseOrder(database, {
        organizationId: identity.organizationId,
        userId: identity.userId,
        locationId: location.id,
        id: "cash-regression-malformed-po",
        orderNumber: "PO-CASH-MALFORMED",
        committedCashDate: "2026-02-30",
      });
      const flow = await getCashFlow(worker, environment, email);
      assert.equal(flow.status, "needs_review");
      assert.equal(flow.capacityStatus, "commitment_date_required");
      assert.equal(flow.purchasingCapacityCents, null);
      assert.equal(flow.undatedCommittedItemCount, 1);
      assert.ok(flow.decisionBlocks.includes("undated_purchase_commitments"));
    });

    await t.test("foreign, undated, and combined commitments retain their specific review states", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const cases = [
        {
          label: "foreign",
          orders: [{ id: "cash-regression-foreign-po", orderNumber: "PO-CASH-FOREIGN", currency: "USD", committedCashDate: today }],
          status: "needs_review",
          capacityStatus: "currency_review_required",
          excludedCurrencyItemCount: 1,
          undatedCommittedItemCount: 0,
        },
        {
          label: "undated",
          orders: [{ id: "cash-regression-undated-po", orderNumber: "PO-CASH-UNDATED", currency: "CAD", committedCashDate: null }],
          status: "needs_review",
          capacityStatus: "commitment_date_required",
          excludedCurrencyItemCount: 0,
          undatedCommittedItemCount: 1,
        },
        {
          label: "both",
          orders: [
            { id: "cash-regression-both-foreign-po", orderNumber: "PO-CASH-BOTH-FOREIGN", currency: "USD", committedCashDate: today },
            { id: "cash-regression-both-undated-po", orderNumber: "PO-CASH-BOTH-UNDATED", currency: "CAD", committedCashDate: null },
          ],
          status: "needs_review",
          capacityStatus: "currency_review_required",
          excludedCurrencyItemCount: 1,
          undatedCommittedItemCount: 1,
        },
      ] as const;

      for (const scenario of cases) {
        await clearLiveCommitments(database, identity.organizationId);
        for (const order of scenario.orders) {
          await seedPurchaseOrder(database, {
            organizationId: identity.organizationId,
            userId: identity.userId,
            locationId: location.id,
            ...order,
          });
        }
        const flow = await getCashFlow(worker, environment, email);
        assert.equal(flow.status, scenario.status, scenario.label);
        assert.equal(flow.capacityStatus, scenario.capacityStatus, scenario.label);
        assert.equal(flow.purchasingCapacityCents, null, scenario.label);
        assert.equal(flow.excludedCurrencyItemCount, scenario.excludedCurrencyItemCount, scenario.label);
        assert.equal(flow.undatedCommittedItemCount, scenario.undatedCommittedItemCount, scenario.label);
      }
    });
  } finally {
    await dispose();
  }
});

test("cash-flow capacity statuses prioritize the actionable review reason", () => {
  const cases = [
    {
      label: "foreign",
      decisionBlocks: ["foreign_currency_obligations"],
      excludedCurrencyItemCount: 1,
      undatedCommittedItemCount: 0,
      status: "needs_review",
      capacityStatus: "currency_review_required",
    },
    {
      label: "undated",
      decisionBlocks: ["undated_purchase_commitments"],
      excludedCurrencyItemCount: 0,
      undatedCommittedItemCount: 1,
      status: "needs_review",
      capacityStatus: "commitment_date_required",
    },
    {
      label: "foreign and undated",
      decisionBlocks: ["foreign_currency_obligations", "undated_purchase_commitments"],
      excludedCurrencyItemCount: 1,
      undatedCommittedItemCount: 1,
      status: "needs_review",
      capacityStatus: "currency_review_required",
    },
    {
      label: "bank unavailable",
      decisionBlocks: ["bank_data_unavailable"],
      excludedCurrencyItemCount: 0,
      undatedCommittedItemCount: 0,
      status: "unavailable",
      capacityStatus: "unavailable",
    },
  ] as const;

  for (const scenario of cases) {
    const result = buildThirteenWeekCashFlow({
      asOf: "2026-08-11",
      openingCashCents: scenario.label === "bank unavailable" ? null : 500_000,
      safetyThresholdCents: 100_000,
      actualTransactions: [],
      forecastItems: [],
      excludedCurrencyItemCount: scenario.excludedCurrencyItemCount,
      undatedCommittedItemCount: scenario.undatedCommittedItemCount,
      decisionBlocks: scenario.decisionBlocks,
    });
    assert.equal(result.status, scenario.status, scenario.label);
    assert.equal(result.capacityStatus, scenario.capacityStatus, scenario.label);
    assert.equal(result.purchasingCapacityCents, null, scenario.label);
  }
});

test("cash-flow UI names every commitment blocker and reserves bank guidance for bank failures", async () => {
  const source = await readFile(new URL("../app/bookloq-workspace.tsx", import.meta.url), "utf8");

  assert.match(source, /decisionBlocks\.includes\("foreign_currency_obligations"\)[\s\S]{0,500}foreign-currency obligation/);
  assert.match(source, /decisionBlocks\.includes\("undated_purchase_commitments"\)[\s\S]{0,500}valid cash date/);
  assert.match(source, /capacityWarnings\.join\(" "\)/);
  assert.match(
    source,
    /flow\.status === "needs_review" \? <ProviderGate title="Cash forecast needs commitment review" detail=\{capacityWarning[\s\S]{0,500}: <ProviderGate title="Verified cash forecast unavailable" detail="Connect and synchronize a healthy owner-authorized bank source/,
    "Commitment review must select its specific warning before the generic bank-unavailable remediation.",
  );
});
