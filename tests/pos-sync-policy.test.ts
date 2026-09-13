import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { verifySyncSignature } from "../server/integrations/sync-signature.ts";
import { isScheduledPosProvider, nextSyncAt, shouldPauseSync, syncRetryDelay } from "../server/integrations/sync-policy.ts";
const secret = "fixture-only-background-secret-32-characters";
test("scheduler signatures bind timestamp, nonce and exact body", async () => {
  const timestamp = String(Math.floor(Date.now()/1000)), nonce = randomUUID();
  const signature = createHmac("sha256", secret).update(timestamp + "." + nonce + ".{}").digest("hex");
  await verifySyncSignature(secret, timestamp, nonce, signature, "{}");
  for (const values of [
    [secret, timestamp, nonce, signature, '{"connectionId":"other"}'],
    [secret, timestamp, randomUUID(), signature, "{}"],
    [secret, String(Number(timestamp)-91), nonce, signature, "{}"],
    [secret, timestamp, nonce, "0".repeat(64), "{}"],
    [undefined, timestamp, nonce, signature, "{}"],
  ]) await assert.rejects(() => verifySyncSignature(...values as Parameters<typeof verifySyncSignature>));
});
test("background retries are bounded and history resumes faster than routine refresh", () => {
  assert.equal(syncRetryDelay(1), 60);
  assert.equal(syncRetryDelay(3), 240);
  assert.equal(syncRetryDelay(90), 3600);
  assert.equal(nextSyncAt(100, { backfillComplete: false }), 160);
  assert.equal(nextSyncAt(100, { hasMore: true }), 160);
  assert.equal(nextSyncAt(100, { coalesced: true }), 160);
  assert.equal(nextSyncAt(100, {}), 1000);
  assert.ok(shouldPauseSync("LIGHTSPEED_AUTHORIZATION_EXPIRED"));
  assert.ok(shouldPauseSync("SYNC_AUTHORIZATION_WITHDRAWN"));
  assert.equal(shouldPauseSync("LIGHTSPEED_RATE_LIMITED"), false);
  assert.equal(isScheduledPosProvider("google"), false);
});

