import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";

const origin = "https://vanteloq.example";
const context = { waitUntil() {}, passThroughOnException() {} };

function dateOffset(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function identityHeaders(email, fullName, write = false) {
  const payload = Buffer.from(JSON.stringify({ email, aal: "aal2", session_id: `session:${email}` })).toString("base64url");
  const headers = {
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

function onboardingBody(ownerName, businessName) {
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
    hours: days.map(day => ({ day, open: "10:00", close: "21:00", closed: false })),
    sourceMode: "csv",
    selectedPos: "",
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
  await new Promise((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const address = authServer.address();
  assert.ok(address && typeof address !== "string");
  const supabaseUrl = `http://127.0.0.1:${address.port}`;
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `vanteloq-flow-${crypto.randomUUID()}` },
  });
  const database = await miniflare.getD1Database("DB");
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter(file => /^\d{4}.*\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("flow-test", crypto.randomUUID());
  const worker = (await import(workerUrl.href)).default;
  const environment = {
    DB: database,
    BOOKLOQ_DEMO_ENABLED: "true",
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  return { miniflare, worker, environment, database, authServer };
}

async function dispatch(worker, environment, path, { method = "GET", email, name, body, idempotencyKey } = {}) {
  const write = method !== "GET";
  const headers = identityHeaders(email, name, write);
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return worker.fetch(new Request(`${origin}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), environment, context);
}

async function grantBookLoqForFlow(database, businessName) {
  const workspace = await database.prepare("SELECT id FROM workspaces WHERE business_name = ? LIMIT 1").bind(businessName).first();
  assert.ok(workspace?.id, `Expected ${businessName} workspace before granting the test entitlement.`);
  const now = Date.now();
  await database.batch([
    database.prepare(`INSERT INTO tenant_subscriptions
      (organization_id, base_plan, billing_interval, status, cancel_at_period_end, version, created_at, updated_at)
      VALUES (?, 'pro', 'month', 'active', 0, 1, ?, ?)`)
      .bind(workspace.id, now, now),
    database.prepare(`INSERT INTO tenant_addons
      (id, organization_id, addon_key, status, created_at, updated_at)
      VALUES (?, ?, 'bookloq', 'active', ?, ?)`)
      .bind(crypto.randomUUID(), workspace.id, now, now),
  ]);
}

test("migrations, tenant isolation and the complete intelligence-to-action flow work", async () => {
  const { miniflare, worker, environment, database, authServer } = await createEnvironment();
  try {
    const owner = { email: "owner-one@example.invalid", name: "Owner One" };
    const secondOwner = { email: "owner-two@example.invalid", name: "Owner Two" };

    const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", { method: "POST", ...owner, body: onboardingBody(owner.name, "North Store") });
    assert.equal(onboarding.status, 201);

    const gatedBookLoq = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(gatedBookLoq.status, 403);
    assert.equal((await gatedBookLoq.json()).error.code, "ADDON_NOT_INCLUDED");
    const gatedDemo = await dispatch(worker, environment, "/api/v1/bookloq/demo", { method: "POST", ...owner, body: {} });
    assert.equal(gatedDemo.status, 403);
    assert.equal((await gatedDemo.json()).error.code, "ADDON_NOT_INCLUDED");

    await grantBookLoqForFlow(environment.DB, "North Store");

    const unavailableBookLoqResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(unavailableBookLoqResponse.status, 200);
    const unavailableBookLoq = (await unavailableBookLoqResponse.json()).bookloq;
    assert.equal(unavailableBookLoq.configured, false);
    assert.equal(unavailableBookLoq.summary.revenueCents, null);
    assert.equal(unavailableBookLoq.summary.bookBalanceCents, null);
    assert.equal(unavailableBookLoq.summary.healthScore, null);
    assert.equal(unavailableBookLoq.cashIntelligence.status, "unavailable");

    const integrationResponse = await dispatch(worker, environment, "/api/v1/integrations", owner);
    assert.equal(integrationResponse.status, 200);
    const integrationBody = await integrationResponse.json();
    assert.equal(integrationBody.syncEnabled, false);
    assert.equal(integrationBody.preSyncControls.filter(control => control.status === "verified").length, 7);
    assert.ok(integrationBody.preSyncControls.some(control => control.id === "reconciliation" && control.status === "gated"));
    assert.ok(integrationBody.integrations.every(provider => provider.status === "not_connected"));
    assert.equal(integrationBody.integrations.find(provider => provider.id === "lightspeed").availability, "credentials_required");
    assert.equal(integrationBody.integrations.find(provider => provider.id === "lightspeed").providerReadiness.dataPromotionEnabled, false);
    assert.equal(integrationBody.integrations.some(provider => ["mx", "flinks"].includes(provider.id)), false);
    assert.ok(integrationBody.integrations.some(provider => provider.id === "plaid"));

    for (const provider of ["lightspeed", "stripe"]) {
      const unavailableAuthorization = await dispatch(worker, environment, `/api/v1/integrations/${provider}/authorize`, {
        method: "POST", ...owner, body: {},
      });
      assert.equal(unavailableAuthorization.status, 503, provider);
    }
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM integration_connections
      WHERE provider IN ('lightspeed', 'stripe')`).first()).count, 0);
    assert.equal((await database.prepare(`SELECT COUNT(*) count FROM integration_oauth_states
      WHERE provider IN ('lightspeed', 'stripe')`).first()).count, 0);

    const empty = await dispatch(worker, environment, "/api/v1/command-centre", owner);
    assert.equal(empty.status, 200);
    assert.equal((await empty.json()).commandCentre.ready, false);

    const latest = "2026-08-03";
    const rows = [];
    for (let offset = -59; offset <= 0; offset++) {
      const current = offset >= -29;
      rows.push({
        businessDate: dateOffset(latest, offset), locationRef: "Main",
        grossSalesCents: current ? 90_000 : 105_000,
        netSalesCents: current ? 80_000 : 100_000,
        costOfGoodsCents: 50_000,
        transactionCount: current ? 80 : 100,
        unitsSold: current ? 110 : 140,
        refundsCents: current ? 2_000 : 1_000,
        discountsCents: current ? 10_000 : 5_000,
        labourCostCents: current ? 20_000 : 15_000,
        inventoryValueCents: 2_000_000,
        cashBalanceCents: 1_200_000,
        accountsPayableCents: 700_000,
      });
    }
    const importKey = crypto.randomUUID();
    const imported = await dispatch(worker, environment, "/api/v1/daily-metrics", { method: "POST", ...owner, idempotencyKey: importKey, body: { importType: "daily_summary_csv", fileName: "verified.csv", rows } });
    assert.equal(imported.status, 201);
    assert.equal((await imported.json()).import.rowCount, 60);

    const replay = await dispatch(worker, environment, "/api/v1/daily-metrics", { method: "POST", ...owner, idempotencyKey: importKey, body: { importType: "daily_summary_csv", fileName: "verified.csv", rows } });
    assert.equal(replay.status, 200);
    const replayBody = await replay.json();
    assert.equal(replayBody.replayed, true);
    assert.deepEqual(Object.keys(replayBody.import).sort(), ["id", "rowCount", "status"]);

    const commandResponse = await dispatch(worker, environment, "/api/v1/command-centre", owner);
    assert.equal(commandResponse.status, 200);
    const command = (await commandResponse.json()).commandCentre;
    assert.equal(command.ready, true);
    assert.equal(command.source.rowCount, 60);
    assert.ok(command.insights.some(insight => insight.id === "sales-trend"));
    assert.ok(command.insights.every(insight => insight.evidence.length > 0));

    const seeded = await dispatch(worker, environment, "/api/v1/bookloq/demo", { method: "POST", ...owner, body: {} });
    assert.equal(seeded.status, 201);
    assert.equal((await seeded.json()).seeded, true);
    const seededReplay = await dispatch(worker, environment, "/api/v1/bookloq/demo", { method: "POST", ...owner, body: {} });
    assert.equal(seededReplay.status, 200);
    assert.equal((await seededReplay.json()).replayed, true);
    const bookloqResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(bookloqResponse.status, 200);
    const bookloq = (await bookloqResponse.json()).bookloq;
    assert.equal(bookloq.configured, true);
    assert.equal(bookloq.settings.dataMode, "demonstration");
    assert.equal(bookloq.statements.trialBalance.totalDebitCents, bookloq.statements.trialBalance.totalCreditCents);
    assert.equal(bookloq.summary.revenueCents, 1_460_000);
    assert.equal(bookloq.summary.salesTaxPayableCents, 1_750);
    assert.equal(bookloq.summary.missingReceiptsCount, 1);
    assert.ok(bookloq.summary.healthScore < 100);
    assert.ok(bookloq.alerts.every(alert => alert.demoRecord === 1));

    const ownerRecord = await database.prepare(`SELECT u.id userId, m.organization_id organizationId
      FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(owner.email).first();
    const primaryLocation = await database.prepare(`SELECT id FROM organization_locations
      WHERE organization_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`).bind(ownerRecord.organizationId).first();
    assert.ok(ownerRecord?.userId && ownerRecord?.organizationId && primaryLocation?.id);
    const alertTimestamp = Math.floor(Date.now() / 1_000);
    await database.batch(Array.from({ length: 100 }, (_, index) => database.prepare(`INSERT INTO bookloq_alerts
      (id, organization_id, severity, alert_type, title, explanation, dollar_impact_cents,
       confidence, supporting_records_json, recommended_action, assigned_user_id, due_date,
       status, resolution_history_json, demo_record, created_at, updated_at)
      VALUES (?, ?, 'critical', 'test_non_receipt', ?, 'Aggregate health coverage fixture.', NULL,
        'high', '[]', 'Review the fixture.', NULL, NULL, 'open', '[]', 1, ?, ?)`)
      .bind(`health-alert-${index}`, ownerRecord.organizationId, `Critical fixture ${index}`, alertTimestamp + index, alertTimestamp + index)));
    const crowdedBookLoqResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(crowdedBookLoqResponse.status, 200);
    const crowdedSummary = (await crowdedBookLoqResponse.json()).bookloq.summary;
    assert.equal(crowdedSummary.missingReceiptsCount, 1);
    assert.notEqual(crowdedSummary.healthScore, null);
    const freshBankNow = Date.now();
    await database.batch([
      database.prepare("UPDATE bookloq_settings SET data_mode = 'live', updated_at = ? WHERE organization_id = ?")
        .bind(freshBankNow, ownerRecord.organizationId),
      database.prepare(`UPDATE bank_accounts SET provider = 'plaid', demo_record = 0, connection_status = 'healthy',
        currency = 'CAD', live_balance_cents = 2397800, available_balance_cents = 2397800,
        last_sync_at = ?, updated_at = ? WHERE organization_id = ?`)
        .bind(Math.floor((freshBankNow - 60_000) / 1_000), freshBankNow, ownerRecord.organizationId),
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, status, scopes_json, data_promotion_status, connected_at,
         last_successful_sync_at, created_at, updated_at)
        VALUES ('plaid-live-fixture', ?, 'plaid', 'connected', '["transactions","balance"]',
          'approved', ?, ?, ?, ?)`)
        .bind(ownerRecord.organizationId, freshBankNow, freshBankNow, freshBankNow, freshBankNow),
    ]);
    const liveBankResponse = await dispatch(worker, environment, "/api/v1/bookloq", owner);
    assert.equal(liveBankResponse.status, 200);
    const liveBankBookLoq = (await liveBankResponse.json()).bookloq;
    assert.equal(liveBankBookLoq.banks[0].balanceState, "current");
    assert.equal(liveBankBookLoq.summary.bankBalanceCents, 2397800);
    assert.equal(liveBankBookLoq.integrations.banking, "connected_and_synced");
    await database.batch([
      database.prepare("UPDATE bookloq_settings SET data_mode = 'demonstration', updated_at = ? WHERE organization_id = ?")
        .bind(freshBankNow, ownerRecord.organizationId),
      database.prepare("UPDATE bank_accounts SET demo_record = 1, updated_at = ? WHERE organization_id = ?")
        .bind(freshBankNow, ownerRecord.organizationId),
      database.prepare("DELETE FROM integration_connections WHERE id = 'plaid-live-fixture' AND organization_id = ?")
        .bind(ownerRecord.organizationId),
    ]);
    const financeReader = { email: "finance-reader@example.invalid", name: "Finance Reader" };
    const readerUserId = crypto.randomUUID();
    const readerRoleId = crypto.randomUUID();
    const readerNow = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`).bind(readerUserId, financeReader.email, financeReader.name, readerNow, readerNow),
      database.prepare(`INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'employee', 'active', ?, ?)`).bind(crypto.randomUUID(), readerUserId, ownerRecord.organizationId, readerNow, readerNow),
      database.prepare(`INSERT INTO access_roles
        (id, organization_id, name, description, color, permissions_json, location_scope_json, archived, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, 'Financial statements only', '', '#53657a', '["finance.statements","reports.operational","reports.export","metrics.revenue"]', '[]', 0, ?, ?, ?)`)
        .bind(readerRoleId, ownerRecord.organizationId, ownerRecord.userId, readerNow, readerNow),
      database.prepare(`INSERT INTO team_members
        (id, organization_id, user_id, role_id, first_name, last_name, email, employee_code,
         primary_location_id, permitted_locations_json, status, remote_login, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Finance', 'Reader', ?, 'FIN-READ', ?, ?, 'active', 1, ?, ?, ?)`)
        .bind(crypto.randomUUID(), ownerRecord.organizationId, readerUserId, readerRoleId, financeReader.email,
          primaryLocation.id, JSON.stringify([primaryLocation.id]), ownerRecord.userId, readerNow, readerNow),
    ]);
    const limitedBookLoqResponse = await dispatch(worker, environment, "/api/v1/bookloq", financeReader);
    assert.equal(limitedBookLoqResponse.status, 200);
    const limitedBookLoq = (await limitedBookLoqResponse.json()).bookloq;
    assert.ok(limitedBookLoq.statements.accounts.length > 0);
    for (const key of ["banks", "transactions", "reconciliations", "bills", "invoices", "contacts", "audit", "forecasts"]) {
      assert.deepEqual(limitedBookLoq[key], [], key);
    }
    for (const key of ["bankBalanceCents", "accountsReceivableCents", "accountsPayableCents", "payrollObligationsCents", "upcomingBillsCount", "overdueInvoicesCount", "unreconciledCount", "uncategorizedCount"]) {
      assert.equal(limitedBookLoq.summary[key], null, key);
    }
    assert.equal(limitedBookLoq.cashIntelligence.status, "unavailable");
    assert.doesNotMatch(JSON.stringify(limitedBookLoq), /4821|accounts@peak-demo\.invalid/);

    const limitedReportResponse = await dispatch(worker, environment, "/api/v1/reports?report=sales_totals", financeReader);
    assert.equal(limitedReportResponse.status, 200);
    const limitedReport = await limitedReportResponse.json();
    assert.equal(limitedReport.totals.costOfGoodsCents, null);
    assert.equal(limitedReport.totals.grossProfitCents, null);
    assert.equal(limitedReport.totals.labourCostCents, null);
    assert.equal(limitedReport.totals.discountsCents, null);
    assert.equal(limitedReport.totals.refundsCents, null);
    assert.ok(limitedReport.rows.every((row) => row.costOfGoodsCents === null));

    const limitedCsvResponse = await dispatch(worker, environment, "/api/v1/reports?report=sales_totals&format=csv", financeReader);
    assert.equal(limitedCsvResponse.status, 200);
    const [csvHeader, csvRow] = (await limitedCsvResponse.text()).split("\n");
    const csvColumns = csvHeader.split(",");
    const csvValues = csvRow.split(",");
    for (const restrictedColumn of [
      "Discounts (minor units)",
      "Refunds (minor units)",
      "Cost of goods (minor units)",
      "Gross profit (minor units)",
      "Labour cost (minor units)",
    ]) {
      assert.equal(csvValues[csvColumns.indexOf(restrictedColumn)], "", restrictedColumn);
    }

    await database.batch([
      database.prepare(`INSERT INTO integration_connections
        (id, organization_id, provider, status, scopes_json, data_promotion_status, connected_at, last_successful_sync_at, created_at, updated_at)
        VALUES (?, ?, 'plaid', 'connected', '["transactions","balance"]', 'approved', ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), ownerRecord.organizationId, readerNow, readerNow, readerNow, readerNow),
      database.prepare(`UPDATE bank_accounts SET provider = 'plaid', external_account_ref = 'sandbox-fixture',
        connection_status = 'healthy', available_balance_cents = 900000000, live_balance_cents = 900000000,
        last_sync_at = ?, demo_record = 1, updated_at = ?
        WHERE id = (SELECT id FROM bank_accounts WHERE organization_id = ? LIMIT 1)`)
        .bind(readerNow, readerNow, ownerRecord.organizationId),
    ]);
    const sandboxPurchasingResponse = await dispatch(worker, environment, "/api/v1/purchasing", owner);
    assert.equal(sandboxPurchasingResponse.status, 200);
    const sandboxCash = (await sandboxPurchasingResponse.json()).catalog.cashContext;
    assert.equal(sandboxCash.status, "needs_bank_connection");
    assert.equal(sandboxCash.verifiedCashCents, null);
    assert.equal(sandboxCash.verifiedPurchasingCapacityCents, null);
    assert.equal(sandboxCash.accountsUsed, 0);

    const debitAccount = bookloq.statements.accounts.find(account => account.systemKey === "supplies_expense");
    const creditAccount = bookloq.statements.accounts.find(account => account.systemKey === "accounts_payable");
    const journalKey = crypto.randomUUID();
    const manualJournal = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "POST", ...owner, idempotencyKey: journalKey, body: {
      entryDate: latest, memo: "Verified manual journal", currency: "CAD",
      lines: [
        { accountId: debitAccount.id, description: "Supplies", debitCents: 10_000, creditCents: 0, locationRef: "Main" },
        { accountId: creditAccount.id, description: "Supplier payable", debitCents: 0, creditCents: 10_000, locationRef: "Main" },
      ],
    } });
    assert.equal(manualJournal.status, 201);
    const manualJournalBody = await manualJournal.json();
    assert.equal(manualJournalBody.journal.totalDebitCents, 10_000);
    const journalReplay = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "POST", ...owner, idempotencyKey: journalKey, body: {
      entryDate: latest, memo: "Verified manual journal", currency: "CAD",
      lines: [
        { accountId: debitAccount.id, debitCents: 10_000, creditCents: 0 },
        { accountId: creditAccount.id, debitCents: 0, creditCents: 10_000 },
      ],
    } });
    assert.equal(journalReplay.status, 200);
    assert.equal((await journalReplay.json()).replayed, true);

    const reversal = await dispatch(worker, environment, "/api/v1/bookloq/journals", { method: "PATCH", ...owner, idempotencyKey: crypto.randomUUID(), body: { entryId: manualJournalBody.journal.id, reason: "Correct the verified test entry", reversalDate: latest } });
    assert.equal(reversal.status, 201);
    assert.equal((await reversal.json()).journal.reversalOfEntryId, manualJournalBody.journal.id);

    const salesInsight = command.insights.find(insight => insight.id === "sales-trend");
    const task = await dispatch(worker, environment, "/api/v1/tasks", { method: "POST", ...owner, idempotencyKey: crypto.randomUUID(), body: { ...salesInsight.suggestedTask, sourceType: "insight", sourceRef: salesInsight.id, assignee: "Owner", dueDate: null } });
    assert.equal(task.status, 201);
    assert.equal((await task.json()).task.sourceRef, "sales-trend");

    const event = await dispatch(worker, environment, "/api/v1/events", { method: "POST", ...owner, body: { eventType: "promotion", title: "Changed weekend offer", detail: "Test event", eventDate: "2026-07-15", expectedOutcome: "Improve contribution", reviewDate: "2026-08-01" } });
    assert.equal(event.status, 201);
    const eventList = await dispatch(worker, environment, "/api/v1/events", owner);
    assert.equal(eventList.status, 200);
    assert.equal((await eventList.json()).events[0].measuredImpact.measurable, true);

    const secondOnboarding = await dispatch(worker, environment, "/api/v1/onboarding", { method: "POST", ...secondOwner, body: onboardingBody(secondOwner.name, "South Store") });
    assert.equal(secondOnboarding.status, 201);
    const ownerGovernance = await dispatch(worker, environment, "/api/v1/governance", owner);
    const secondGovernance = await dispatch(worker, environment, "/api/v1/governance", secondOwner);
    assert.equal(ownerGovernance.status, 200);
    assert.equal(secondGovernance.status, 200);
    const ownerGovernanceBody = (await ownerGovernance.json()).governance;
    const secondGovernanceBody = (await secondGovernance.json()).governance;
    const foreignRole = secondGovernanceBody.roles.find((role) => role.systemKey === "general_manager");
    const ownerMember = ownerGovernanceBody.members.find((member) => member.userId === ownerRecord.userId);
    assert.ok(foreignRole?.id && ownerMember?.id);
    const crossTenantRoleWrite = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...owner,
      body: { action: "save_role", roleId: foreignRole.id, name: "Tampered role", description: "", color: "#53657a", permissions: ["dashboard.view"], locationScope: [] },
    });
    assert.equal(crossTenantRoleWrite.status, 404);
    assert.equal((await crossTenantRoleWrite.json()).error.code, "ROLE_NOT_FOUND");
    const crossTenantRoleAssignment = await dispatch(worker, environment, "/api/v1/governance", {
      method: "POST",
      ...owner,
      body: { action: "update_employee", memberId: ownerMember.id, roleId: foreignRole.id, status: "active" },
    });
    assert.equal(crossTenantRoleAssignment.status, 400);
    assert.equal((await crossTenantRoleAssignment.json()).error.code, "INVALID_FIELD");
    const secondCommand = await dispatch(worker, environment, "/api/v1/command-centre", secondOwner);
    assert.equal(secondCommand.status, 200);
    const secondBody = await secondCommand.json();
    assert.equal(secondBody.commandCentre.ready, false);
    assert.equal(secondBody.commandCentre.source.rowCount, 0);
    const secondBookLoq = await dispatch(worker, environment, "/api/v1/bookloq", secondOwner);
    assert.equal(secondBookLoq.status, 403);
    assert.equal((await secondBookLoq.json()).error.code, "ADDON_NOT_INCLUDED");
  } finally {
    await new Promise((resolve) => authServer.close(resolve));
    await miniflare.dispose();
  }
});

test("location-limited purchasing cannot list or approve another location's orders", async () => {
  const { miniflare, worker, environment, database, authServer } = await createEnvironment();
  try {
    const owner = { email: "purchasing-owner@example.invalid", name: "Purchasing Owner" };
    const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", {
      method: "POST",
      ...owner,
      body: onboardingBody(owner.name, "Scoped Purchasing"),
    });
    assert.equal(onboarding.status, 201);
    assert.equal((await dispatch(worker, environment, "/api/v1/command-centre", owner)).status, 200);

    const ownerRecord = await database.prepare(`SELECT u.id userId, m.organization_id organizationId
      FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ?`).bind(owner.email).first();
    const north = await database.prepare(`SELECT id FROM organization_locations
      WHERE organization_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`).bind(ownerRecord.organizationId).first();
    assert.ok(ownerRecord?.userId && ownerRecord?.organizationId && north?.id);
    const southId = crypto.randomUUID();
    const managerUserId = crypto.randomUUID();
    const managerRoleId = crypto.randomUUID();
    const manager = { email: "north-manager@example.invalid", name: "North Manager" };
    const qualityViewerUserId = crypto.randomUUID();
    const qualityViewerRoleId = crypto.randomUUID();
    const qualityViewer = { email: "quality-viewer@example.invalid", name: "Quality Viewer" };
    const now = Date.now();
    await database.batch([
      database.prepare(`INSERT INTO organization_locations
        (id, organization_id, name, status, country_code, address_line_1, locality, administrative_area,
         postal_code, timezone, currency, validation_status, created_at, updated_at)
        VALUES (?, ?, 'South', 'active', 'CA', '2 South Road', 'Edmonton', 'AB', 'T5A 1A2',
          'America/Edmonton', 'CAD', 'validated', ?, ?)`)
        .bind(southId, ownerRecord.organizationId, now, now),
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`).bind(managerUserId, manager.email, manager.name, now, now),
      database.prepare(`INSERT INTO users (id, email, display_name, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`).bind(qualityViewerUserId, qualityViewer.email, qualityViewer.name, now, now),
      database.prepare(`INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'manager', 'active', ?, ?)`).bind(crypto.randomUUID(), managerUserId, ownerRecord.organizationId, now, now),
      database.prepare(`INSERT INTO memberships (id, user_id, organization_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'employee', 'active', ?, ?)`).bind(crypto.randomUUID(), qualityViewerUserId, ownerRecord.organizationId, now, now),
      database.prepare(`INSERT INTO access_roles
        (id, organization_id, name, description, color, permissions_json, location_scope_json, archived, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, 'North purchasing manager', '', '#53657a', '["purchasing.view","purchasing.approve","operations.tasks","operations.manage","insights.create_task","documents.view","documents.upload","documents.download","documents.retention","integrations.view","integrations.manage","finance.connections","finance.bank_balances","finance.ap_ar","data_imports.view"]', '[]', 0, ?, ?, ?)`)
        .bind(managerRoleId, ownerRecord.organizationId, ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO access_roles
        (id, organization_id, name, description, color, permissions_json, location_scope_json, archived, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, 'Data quality viewer', '', '#53657a', '["integrations.view"]', '[]', 0, ?, ?, ?)`)
        .bind(qualityViewerRoleId, ownerRecord.organizationId, ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO team_members
        (id, organization_id, user_id, role_id, first_name, last_name, email, employee_code,
         primary_location_id, permitted_locations_json, status, remote_login, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'North', 'Manager', ?, 'NORTH-MGR', ?, ?, 'active', 1, ?, ?, ?)`)
        .bind(crypto.randomUUID(), ownerRecord.organizationId, managerUserId, managerRoleId, manager.email,
          north.id, JSON.stringify([north.id]), ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO team_members
        (id, organization_id, user_id, role_id, first_name, last_name, email, employee_code,
         primary_location_id, permitted_locations_json, status, remote_login, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'Quality', 'Viewer', ?, 'QUALITY-VIEW', ?, ?, 'active', 1, ?, ?, ?)`)
        .bind(crypto.randomUUID(), ownerRecord.organizationId, qualityViewerUserId, qualityViewerRoleId, qualityViewer.email,
          north.id, JSON.stringify([north.id, southId]), ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO purchase_orders
        (id, organization_id, order_number, supplier_name, delivery_location_id, order_date, currency,
         status, subtotal_cents, tax_cents, discount_cents, total_cents, created_by_user_id, created_at, updated_at)
        VALUES ('po-north', ?, 'PO-NORTH', 'North Supplier', ?, '2026-08-11', 'CAD',
          'awaiting_approval', 10000, 0, 0, 10000, ?, ?, ?)`)
        .bind(ownerRecord.organizationId, north.id, ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO purchase_orders
        (id, organization_id, order_number, supplier_name, delivery_location_id, order_date, currency,
         status, subtotal_cents, tax_cents, discount_cents, total_cents, created_by_user_id, created_at, updated_at)
        VALUES ('po-south', ?, 'PO-SOUTH', 'South Supplier', ?, '2026-08-11', 'CAD',
          'awaiting_approval', 20000, 0, 0, 20000, ?, ?, ?)`)
        .bind(ownerRecord.organizationId, southId, ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO workspace_documents
        (id, organization_id, document_type, file_name, object_key, content_type, size_bytes, sha256_hex,
         status, scan_status, extraction_status, extracted_json, uploaded_by_user_id, created_at, updated_at)
        VALUES ('pending-invoice', ?, 'invoice', 'pending-invoice.pdf', 'quarantine/pending-invoice.pdf',
          'application/pdf', 128, 'pending-invoice-hash', 'review_required', 'pending', 'not_configured', '{}', ?, ?, ?)`)
        .bind(ownerRecord.organizationId, ownerRecord.userId, now, now),
      database.prepare(`INSERT INTO goods_receipts
        (id, organization_id, purchase_order_id, received_date, received_by_user_id, lines_json,
         discrepancy_status, created_at)
        VALUES ('receipt-private', ?, 'po-north', '2026-08-11', ?, '[]', 'review_required', ?)`)
        .bind(ownerRecord.organizationId, ownerRecord.userId, now),
      database.prepare(`INSERT INTO invoice_matches
        (id, organization_id, purchase_order_id, document_id, status, difference_cents, details_json,
         reviewed_by_user_id, created_at, updated_at)
        VALUES ('match-private', ?, 'po-north', 'pending-invoice', 'review_required', 10000, '{}', ?, ?, ?)`)
        .bind(ownerRecord.organizationId, ownerRecord.userId, now, now),
    ]);
    await grantBookLoqForFlow(database, "Scoped Purchasing");

    const qualityResponse = await dispatch(worker, environment, "/api/v1/data-quality", qualityViewer);
    assert.equal(qualityResponse.status, 200);
    const qualityPayload = await qualityResponse.json();
    assert.equal(qualityPayload.sources.documents, 0);
    assert.equal(
      qualityPayload.issues.some((issue) => ["document_review", "receiving_discrepancy", "invoice_match"].includes(issue.type)),
      false,
      "integrations.view must not expose document or purchasing evidence",
    );

    for (const path of [
      "/api/v1/tasks",
      "/api/v1/documents",
      "/api/v1/integrations",
      "/api/v1/integrations/lightspeed/outlets",
      "/api/v1/integrations/lightspeed-r/shops",
      "/api/v1/daily-metrics",
    ]) {
      const response = await dispatch(worker, environment, path, manager);
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).error.code, "ORGANIZATION_SCOPE_REQUIRED", path);
    }
    for (const request of [
      { path: "/api/v1/tasks", method: "POST", idempotencyKey: crypto.randomUUID(), body: { title: "Cross-location task", detail: "", priority: "medium", assignee: "Manager", dueDate: null, sourceType: "manual", sourceRef: null, expectedImpact: "" } },
      { path: "/api/v1/tasks", method: "PATCH", body: { id: "task-from-another-location", status: "done" } },
      { path: "/api/v1/documents", method: "POST", body: {} },
      { path: "/api/v1/documents?id=document-from-another-location", method: "DELETE", body: {} },
      { path: "/api/v1/integrations/plaid/link-token", method: "POST", body: {} },
      { path: "/api/v1/integrations/plaid/exchange", method: "POST", body: { publicToken: "public-sandbox-token", consentAcknowledged: true } },
      { path: "/api/v1/integrations/plaid/sync", method: "POST", body: {} },
      { path: "/api/v1/integrations/plaid/disconnect", method: "POST", body: {} },
    ]) {
      const response = await dispatch(worker, environment, request.path, { ...request, ...manager });
      assert.equal(response.status, 403, request.path);
      assert.equal((await response.json()).error.code, "ORGANIZATION_SCOPE_REQUIRED", request.path);
    }

    const managerResponse = await dispatch(worker, environment, "/api/v1/purchasing", manager);
    assert.equal(managerResponse.status, 200);
    const managerPayload = await managerResponse.json();
    assert.deepEqual(managerPayload.orders.map((order) => order.id), ["po-north"]);
    assert.equal(managerPayload.catalog.cashContext, null, "location-limited finance roles must not receive or use organization-wide cash data");
    assert.equal(managerPayload.calendar.some((entry) => entry.kind === "supplier_bill" || entry.kind === "customer_invoice"), false);

    await database.prepare("UPDATE tenant_addons SET status = 'inactive', updated_at = ? WHERE organization_id = ? AND addon_key = 'bookloq'")
      .bind(Date.now(), ownerRecord.organizationId).run();
    const inactiveAddonResponse = await dispatch(worker, environment, "/api/v1/purchasing", owner);
    assert.equal(inactiveAddonResponse.status, 200, "ordinary purchasing remains available without BookLoQ");
    const inactiveAddonPayload = await inactiveAddonResponse.json();
    assert.deepEqual(inactiveAddonPayload.orders.map((order) => order.id).sort(), ["po-north", "po-south"]);
    assert.equal(inactiveAddonPayload.catalog.cashContext, null, "inactive BookLoQ must not enrich purchasing with cash capacity");
    await database.prepare("UPDATE tenant_addons SET status = 'active', updated_at = ? WHERE organization_id = ? AND addon_key = 'bookloq'")
      .bind(Date.now(), ownerRecord.organizationId).run();

    const ownerResponse = await dispatch(worker, environment, "/api/v1/purchasing", owner);
    assert.equal(ownerResponse.status, 200);
    assert.deepEqual((await ownerResponse.json()).orders.map((order) => order.id).sort(), ["po-north", "po-south"]);

    const explicitDenied = await dispatch(worker, environment, `/api/v1/purchasing?location=${encodeURIComponent(southId)}`, manager);
    assert.equal(explicitDenied.status, 403);
    assert.equal((await explicitDenied.json()).error.code, "LOCATION_ACCESS_DENIED");
    const approveDenied = await dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      ...manager,
      body: { action: "approve", purchaseOrderId: "po-south" },
    });
    assert.equal(approveDenied.status, 403);
    assert.equal((await approveDenied.json()).error.code, "LOCATION_ACCESS_DENIED");
    assert.equal((await database.prepare("SELECT status FROM purchase_orders WHERE id = 'po-south'").first()).status, "awaiting_approval");

    const quarantinedMatch = await dispatch(worker, environment, "/api/v1/purchasing", {
      method: "POST",
      ...owner,
      body: { action: "match_invoice", purchaseOrderId: "po-north", documentId: "pending-invoice", invoiceTotalCents: 10000 },
    });
    assert.equal(quarantinedMatch.status, 423);
    assert.equal((await quarantinedMatch.json()).error.code, "DOCUMENT_SCAN_REQUIRED");
    assert.equal((await database.prepare("SELECT status FROM purchase_orders WHERE id = 'po-north'").first()).status, "awaiting_approval");
  } finally {
    await new Promise((resolve) => authServer.close(resolve));
    await miniflare.dispose();
  }
});
