import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPlaidLinkToken, normalizePlaidTransaction, plaidReadiness } from "../server/integrations/plaid.ts";

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

test("Plaid creates financial accounts before advancing the first transaction cursor", async () => {
  const source = await readFile(new URL("../server/integrations/plaid.ts", import.meta.url), "utf8");
  const syncStart = source.indexOf("export async function syncPlaidTransactions");
  const accountSync = source.indexOf("const accountsImported = await syncAccounts", syncStart);
  const transactionLoop = source.indexOf("while (hasMore", syncStart);
  assert.ok(syncStart >= 0 && accountSync > syncStart && transactionLoop > accountSync);
});

test("successful Plaid balance syncs can power cash intelligence without posting transactions", async () => {
  const source = await readFile(new URL("../server/integrations/plaid.ts", import.meta.url), "utf8");
  assert.match(source, /dataPromotionStatus: accountsImported > 0 \? "approved" : "staging"/);
  assert.match(source, /approvalStatus: "pending"/);
  assert.match(source, /reconciliationStatus: "unreconciled"/);
  assert.match(source, /categorizationStatus: record\.categorizationStatus/);
});
