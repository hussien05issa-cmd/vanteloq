import assert from "node:assert/strict";
import test from "node:test";
import {
  missingPlaidAccountRefs,
  plaidAccountsMissingFromSync,
  normalizePlaidTransaction,
  plaidConnectionClaimErrorCode,
  plaidReadiness,
  plaidWebhookDisposition,
  settlePlaidWebhookEvent,
} from "../server/integrations/plaid.ts";

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
  assert.deepEqual(
    missingPlaidAccountRefs([first, second, second], new Set(["account-known"])),
    ["account-new"],
  );
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
  assert.deepEqual(
    plaidAccountsMissingFromSync(["checking", "savings", "credit"], ["checking", "credit"]),
    ["savings"],
  );
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
