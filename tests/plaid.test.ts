import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlaidTransaction, plaidReadiness } from "../server/integrations/plaid.ts";

test("Plaid readiness fails closed when any hosted secret or webhook setting is missing", () => {
  const readiness = plaidReadiness({
    PLAID_CLIENT_ID: "client",
    PLAID_SECRET: "secret",
    PLAID_ENV: "sandbox",
    PLAID_WEBHOOK_URL: "",
    INTEGRATION_ENCRYPTION_KEY: "key",
  });
  assert.equal(readiness.credentialsConfigured, false);
  assert.ok(readiness.missingConfiguration.includes("PLAID_WEBHOOK_URL"));
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
