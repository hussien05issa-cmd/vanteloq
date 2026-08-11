import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createPlaidLinkToken,
  missingPlaidAccountRefs,
  normalizePlaidTransaction,
  plaidAccountsMissingFromSync,
  plaidConnectionClaimErrorCode,
  plaidReadiness,
  plaidWebhookDisposition,
  settlePlaidWebhookEvent,
} from "../server/integrations/plaid.ts";

(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  PLAID_CLIENT_ID: "plaid-client-test",
  PLAID_SECRET: "plaid-secret-test",
  PLAID_ENV: "sandbox",
  PLAID_WEBHOOK_URL: "https://vanteloq.example/api/v1/integrations/plaid/webhook",
  PLAID_REDIRECT_URI: "https://vanteloq.example/?integration=plaid",
  INTEGRATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

test("Plaid readiness fails closed when any hosted secret or webhook setting is missing", () => {
  const readiness = plaidReadiness({
    PLAID_CLIENT_ID: "client",
    PLAID_SECRET: "secret",
    PLAID_ENV: "sandbox",
    PLAID_WEBHOOK_URL: "",
    PLAID_REDIRECT_URI: "https://vanteloq.example/?integration=plaid",
    INTEGRATION_ENCRYPTION_KEY: "key",
  });
  assert.equal(readiness.credentialsConfigured, false);
  assert.ok(readiness.missingConfiguration.includes("PLAID_WEBHOOK_URL"));
});

test("Plaid Link uses a pseudonymous user reference and only the required Canadian transaction product", async () => {
  let target = "";
  let payload: Record<string, unknown> = {};
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    target = String(input);
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ link_token: "link-sandbox-test", expiration: "2026-08-11T12:00:00Z" });
  };
  const result = await createPlaidLinkToken("user-sensitive", "org-sensitive", "connect", fetcher as typeof fetch);
  assert.equal(result.link_token, "link-sandbox-test");
  assert.equal(target, "https://sandbox.plaid.com/link/token/create");
  assert.deepEqual(payload.products, ["transactions"]);
  assert.deepEqual(payload.country_codes, ["CA"]);
  assert.equal(payload.redirect_uri, "https://vanteloq.example/?integration=plaid");
  assert.equal(payload.webhook, "https://vanteloq.example/api/v1/integrations/plaid/webhook");
  assert.doesNotMatch(JSON.stringify(payload), /user-sensitive|org-sensitive/);
});

test("Plaid transaction normalization preserves bank-feed uncertainty", () => {
  const pending = normalizePlaidTransaction({
    transaction_id: "tx-1",
    account_id: "account-1",
    amount: 42.15,
    iso_currency_code: "CAD",
    date: "2026-08-10",
    name: "Supplier payment",
    merchant_name: null,
    pending: true,
    pending_transaction_id: null,
  });
  assert.equal(pending.amountCents, -4215);
  assert.equal(pending.sourceState, "pending");
  assert.equal(pending.categorizationStatus, "missing");
  assert.equal(pending.confidenceBasisPoints, 0);
});

test("Plaid sync fails closed when a transaction account was not synchronized", () => {
  const first = normalizePlaidTransaction({
    transaction_id: "tx-1",
    account_id: "account-known",
    amount: 10,
    iso_currency_code: "CAD",
    date: "2026-08-10",
    name: "Known account",
    merchant_name: null,
    pending: false,
    pending_transaction_id: null,
  });
  const second = normalizePlaidTransaction({
    transaction_id: "tx-2",
    account_id: "account-new",
    amount: 12,
    iso_currency_code: "CAD",
    date: "2026-08-10",
    name: "New account",
    merchant_name: null,
    pending: false,
    pending_transaction_id: null,
  });
  assert.deepEqual(missingPlaidAccountRefs([first, second, second], new Set(["account-known"])), ["account-new"]);
});

test("Plaid refuses to replace an active or unresolved Item", () => {
  assert.equal(plaidConnectionClaimErrorCode("connected"), "PLAID_EXISTING_ITEM_REQUIRES_DISCONNECT");
  assert.equal(plaidConnectionClaimErrorCode("error"), "PLAID_EXISTING_ITEM_REQUIRES_DISCONNECT");
  assert.equal(plaidConnectionClaimErrorCode("pending"), "PLAID_CONNECTION_IN_PROGRESS");
  assert.equal(plaidConnectionClaimErrorCode("not_connected"), null);
  assert.equal(plaidConnectionClaimErrorCode("revoked"), null);
});

test("Plaid webhook disposition retries only actionable transaction updates", () => {
  assert.equal(plaidWebhookDisposition("TRANSACTIONS", "SYNC_UPDATES_AVAILABLE"), "synchronize");
  assert.equal(plaidWebhookDisposition("ITEM", "ERROR"), "processed");
  assert.equal(plaidWebhookDisposition("ACCOUNTS", "DEFAULT_UPDATE"), "processed");
});

test("Plaid account synchronization identifies accounts removed from an Item", () => {
  assert.deepEqual(plaidAccountsMissingFromSync(["checking", "savings", "credit"], ["checking", "credit"]), ["savings"]);
  assert.deepEqual(plaidAccountsMissingFromSync(["checking"], ["checking"]), []);
});

test("Plaid webhook settlement stays queued and asks the provider to retry after a sync failure", async () => {
  await assert.rejects(
    settlePlaidWebhookEvent(
      "event-1",
      "organization-1",
      "connection-1",
      "TRANSACTIONS",
      "SYNC_UPDATES_AVAILABLE",
      async () => { throw new Error("temporary provider failure"); },
    ),
    (error: unknown) => Boolean(
      error && typeof error === "object" &&
      "code" in error && error.code === "PLAID_WEBHOOK_SYNC_DEFERRED" &&
      "status" in error && error.status === 503
    ),
  );
});

test("Plaid creates financial accounts before advancing the first transaction cursor", async () => {
  const source = await readFile(new URL("../server/integrations/plaid.ts", import.meta.url), "utf8");
  const syncStart = source.indexOf("export async function syncPlaidTransactions");
  const accountSync = source.indexOf("const accountsImported = await syncAccounts", syncStart);
  const transactionLoop = source.indexOf("while (hasMore", syncStart);
  assert.ok(syncStart >= 0 && accountSync > syncStart && transactionLoop > accountSync);
});

test("successful Plaid balance syncs remain staged until reviewed without posting transactions", async () => {
  const source = await readFile(new URL("../server/integrations/plaid.ts", import.meta.url), "utf8");
  assert.match(source, /dataPromotionStatus: "staging"/);
  assert.match(source, /approvalStatus: "pending"/);
  assert.match(source, /reconciliationStatus: "unreconciled"/);
  assert.match(source, /categorizationStatus: record\.categorizationStatus/);
});

test("repair-required initial Plaid sync remains blocked", async () => {
  const source = await readFile(new URL("../app/api/v1/integrations/plaid/exchange/route.ts", import.meta.url), "utf8");
  assert.match(source, /dataPromotionStatus:\s*plaidRequiresUserRepair\(errorCode\)\s*\?\s*"blocked"\s*:\s*"staging"/);
});

test("Plaid Item webhooks cannot mutate a replacement Item", async () => {
  const source = await readFile(new URL("../server/integrations/plaid.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function settlePlaidWebhookEvent");
  const settlement = source.slice(start, source.indexOf("function hex", start));
  assert.equal((settlement.match(/eq\(integrationConnections\.externalAccountRef,\s*options\.itemId\)/g) ?? []).length, 2);
});

test("Plaid retains cleanup credentials before optional Item metadata lookup", async () => {
  const source = await readFile(new URL("../server/integrations/plaid.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function exchangePlaidPublicToken");
  const end = source.indexOf("async function credentials", start);
  const exchange = source.slice(start, end);
  assert.ok(exchange.indexOf("database.insert(integrationSecrets)") < exchange.indexOf('"/item/get"'));
  assert.match(exchange, /if \(providerAuthorizationRevoked\) \{[\s\S]*?delete\(integrationSecrets\)[\s\S]*?\} else \{[\s\S]*?PLAID_PROVISIONING_CLEANUP_REQUIRED/);
});

test("Plaid authorization is bound to durable, versioned consent evidence", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const control = await readFile(new URL("../domain/privacy-controls.ts", import.meta.url), "utf8");
  const privacy = await readFile(new URL("../server/privacy.ts", import.meta.url), "utf8");
  const linkRoute = await readFile(new URL("../app/api/v1/integrations/plaid/link-token/route.ts", import.meta.url), "utf8");
  const exchangeRoute = await readFile(new URL("../app/api/v1/integrations/plaid/exchange/route.ts", import.meta.url), "utf8");

  assert.match(schema, /integration_consents/);
  assert.match(schema, /noticeVersion/);
  assert.match(schema, /privacyPolicyVersion/);
  assert.match(control, /PLAID_CONSENT_NOTICE_VERSION/);
  assert.match(privacy, /recordPlaidConsent/);
  assert.match(privacy, /requireFreshPlaidConsent/);
  assert.match(privacy, /PLAID_CONSENT_MAX_AGE_MS/);
  assert.match(linkRoute, /input\.consentAcknowledged !== true/);
  assert.match(linkRoute, /consentRecordId: consent\.id/);
  assert.match(exchangeRoute, /requireFreshPlaidConsent/);
  assert.doesNotMatch(exchangeRoute, /input\.consentAcknowledged !== true/);
});

test("Plaid deletion fails closed and preserves only de-identified accounting evidence", async () => {
  const route = await readFile(new URL("../app/api/v1/integrations/plaid/delete-data/route.ts", import.meta.url), "utf8");
  const source = await readFile(new URL("../server/integrations/plaid.ts", import.meta.url), "utf8");
  assert.match(route, /requireAccess\(request, \["owner"\]\)/);
  assert.match(route, /DELETE PLAID DATA/);
  assert.match(route, /plaid:delete-data/);
  assert.match(source, /PLAID_DISCONNECT_REQUIRED/);
  assert.match(source, /database\.batch/);
  assert.match(source, /DELETE FROM financial_transactions/);
  assert.match(source, /source_system = 'retained_accounting'/);
  assert.match(source, /external_account_ref = NULL/);
});
