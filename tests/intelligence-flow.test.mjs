import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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
  const headers = {
    accept: "application/json",
    "oai-authenticated-user-email": email,
    "oai-authenticated-user-full-name": encodeURIComponent(fullName),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
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
  const environment = { DB: database, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  return { miniflare, worker, environment };
}

async function dispatch(worker, environment, path, { method = "GET", email, name, body, idempotencyKey } = {}) {
  const write = method !== "GET";
  const headers = identityHeaders(email, name, write);
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return worker.fetch(new Request(`${origin}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), environment, context);
}

test("migrations, tenant isolation and the complete intelligence-to-action flow work", async () => {
  const { miniflare, worker, environment } = await createEnvironment();
  try {
    const owner = { email: "owner-one@example.invalid", name: "Owner One" };
    const secondOwner = { email: "owner-two@example.invalid", name: "Owner Two" };

    const onboarding = await dispatch(worker, environment, "/api/v1/onboarding", { method: "POST", ...owner, body: onboardingBody(owner.name, "North Store") });
    assert.equal(onboarding.status, 201);

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
    assert.equal((await replay.json()).replayed, true);

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
    assert.ok(bookloq.alerts.every(alert => alert.demoRecord === 1));

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
    const secondCommand = await dispatch(worker, environment, "/api/v1/command-centre", secondOwner);
    assert.equal(secondCommand.status, 200);
    const secondBody = await secondCommand.json();
    assert.equal(secondBody.commandCentre.ready, false);
    assert.equal(secondBody.commandCentre.source.rowCount, 0);
    const secondBookLoq = await dispatch(worker, environment, "/api/v1/bookloq", secondOwner);
    assert.equal(secondBookLoq.status, 200);
    const secondBookLoqBody = await secondBookLoq.json();
    assert.equal(secondBookLoqBody.bookloq.configured, false);
    assert.equal(secondBookLoqBody.bookloq.transactions.length, 0);
  } finally {
    await miniflare.dispose();
  }
});
