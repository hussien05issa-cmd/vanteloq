import assert from "node:assert/strict";
import test from "node:test";
import { connectorHealth, connectorNextStep, type Connector } from "../domain/connector-guidance.ts";

const now = Date.parse("2026-09-25T12:00:00Z");
const syncedAt = "2026-09-25T11:55:00Z";
const provider: Connector = {
  id: "square", name: "Square", category: "Point of sale", availability: "credentials_required",
  status: "connected", dataPromotionStatus: "approved", lastSuccessfulSyncAt: syncedAt,
  providerReadiness: { credentialsConfigured: true, mode: "production", liveDataEligible: true },
};
const schedule = { configured: true, healthy: true, enabled: true, status: "completed", lastErrorCode: null, intervalMinutes: 15 };
const health = (changes: Partial<Connector> = {}) => connectorHealth({ ...provider, ...changes }, { now });

test("authorization alone does not claim synchronized or report-ready data", () => {
  const authorized = health({ lastSuccessfulSyncAt: null, dataPromotionStatus: "staging" });
  assert.equal(authorized.state, "initial_import");
  assert.equal(authorized.label, "Import and review");
  assert.equal(authorized.action, "import");
  assert.equal(authorized.lastSuccessfulSyncAt, null);
  assert.equal(authorized.freshness, "unknown");
  const imported = health({ dataPromotionStatus: "staging" });
  assert.equal(imported.state, "review_required");
  assert.equal(imported.action, "review_data");
  assert.match(imported.detail, /before approving/);
});

test("active imports show real work without fabricated completion percentages", () => {
  const first = health({ syncActive: true, lastSuccessfulSyncAt: null, dataPromotionStatus: "staging" });
  assert.equal(first.state, "initial_import");
  assert.equal(first.action, null);
  assert.match(first.label, /Importing/);
  assert.equal(health({ syncActive: true }).state, "syncing");
  assert.equal(health({ automaticSync: { ...schedule, status: "backfilling" } }).state, "initial_import");
  assert.doesNotMatch(JSON.stringify(first), /percent|\d+%/i);
  assert.equal(connectorNextStep({ ...provider, syncActive: true }, true, true).stage, "Import in progress");
});

test("completed imports with warnings stay distinct from clean approval", () => {
  const result = health({ lastErrorCode: "SQUARE_LOCATION_UNMAPPED" });
  assert.equal(result.state, "warning");
  assert.equal(result.action, "review_connection");
  assert.equal(result.lastSuccessfulSyncAt, syncedAt);
  assert.equal(result.freshness, "unknown");
});

test("expired authorization offers reconnection rather than a misleading import retry", () => {
  for (const code of ["SQUARE_AUTHORIZATION_EXPIRED", "GOOGLE_REAUTHORIZATION_REQUIRED", "TOKEN_REVOKED", "INTEGRATION_NOT_CONNECTED"]) {
    const result = health({ lastErrorCode: code });
    assert.equal(result.state, "reauthorize", code);
    assert.equal(result.action, "reconnect", code);
  }
  assert.equal(health({ automaticSync: { ...schedule, lastErrorCode: "CLOVER_AUTHORIZATION_EXPIRED" } }).state, "reauthorize");
  assert.equal(health({ lastErrorCode: "SLACK_TOKEN_EXCHANGE_FAILED" }).state, "warning", "an exchange error is not evidence that existing access expired");
});

test("test, unverified and verification-only accounts do not gain live-report status", () => {
  assert.equal(health({ reportingEnvironment: "sandbox" }).state, "test_only");
  assert.equal(connectorNextStep({ ...provider, reportingEnvironment: "sandbox" }, true, true).stage, "Test data only");
  assert.equal(health({ reportingEnvironment: "unverified" }).state, "eligibility_required");
  assert.equal(health({ providerReadiness: { credentialsConfigured: true, mode: "production", liveDataEligible: false } }).state, "eligibility_required");
  const verificationOnly = health({ id: "quickbooks", providerReadiness: { credentialsConfigured: true, mode: "sandbox_read_only_staging", ledgerImportEnabled: false } });
  assert.equal(verificationOnly.state, "verification_only");
  assert.match(verificationOnly.detail, /does not populate BookLoQ/);
});

test("marketing resources need their own review before report eligibility", () => {
  const result = health({ id: "google", category: "Marketing", dataPromotionStatus: "staging", providerReadiness: { credentialsConfigured: true, mode: "measurement", liveDataEligible: false } });
  assert.equal(result.state, "review_required");
  assert.equal(result.actionLabel, "Select and review resources");
  assert.equal(health({ id: "google", category: "Marketing", dataPromotionStatus: "staging", syncActive: true, lastSuccessfulSyncAt: null }).state, "initial_import");
});

test("freshness derives from the expected schedule and tolerates one delayed interval", () => {
  assert.equal(health({ automaticSync: schedule }).freshness, "current");
  const inGrace = health({ automaticSync: schedule, lastSuccessfulSyncAt: "2026-09-25T11:40:00Z" });
  assert.equal(inGrace.state, "synced");
  const overdue = health({ automaticSync: schedule, lastSuccessfulSyncAt: "2026-09-25T11:29:59Z" });
  assert.equal(overdue.state, "stale");
  assert.equal(overdue.action, "import");
  assert.equal(overdue.freshness, "stale");
});

test("manual imports do not invent a refresh cadence or call an old timestamp current", () => {
  const result = health({ lastSuccessfulSyncAt: "2025-01-01T00:00:00Z" });
  assert.equal(result.state, "synced");
  assert.equal(result.freshness, "unknown");
  assert.match(result.detail, /Check its date and coverage/);
  assert.equal(connectorHealth(provider, { now, staleAfterMs: 60_000 }).state, "stale");
  assert.equal(connectorHealth(provider, { now, staleAfterMs: NaN }).freshness, "unknown");
});

test("missing, invalid and future synchronization dates cannot prove an import", () => {
  for (const lastSuccessfulSyncAt of [null, "not-a-date", "2026-09-26T12:00:00Z"]) {
    const result = health({ lastSuccessfulSyncAt });
    assert.equal(result.state, "initial_import");
    assert.equal(result.lastSuccessfulSyncAt, null);
    assert.equal(result.freshness, "unknown");
  }
});

test("automatic service failure remains visible even if old data was approved", () => {
  for (const automaticSync of [{ ...schedule, healthy: false }, { ...schedule, configured: false }, { ...schedule, status: "retrying" }]) {
    assert.equal(health({ automaticSync }).state, "warning");
  }
  assert.equal(health({ automaticSync: { ...schedule, enabled: false, healthy: false } }).state, "synced", "turning off automation does not invalidate an existing completed import");
});

test("one healthy account cannot hide another account's authorization or review failure", () => {
  const healthy = { ...provider, lastErrorCode: null };
  const failed = { ...healthy, status: "error", lastErrorCode: "SQUARE_AUTHORIZATION_EXPIRED" };
  const result = health({ connections: [healthy, failed] });
  assert.equal(result.state, "reauthorize");
  assert.equal(result.lastSuccessfulSyncAt, null);
  assert.match(result.detail, /each account/);
  const staged = health({ connections: [healthy, { ...healthy, dataPromotionStatus: "staging" }] });
  assert.equal(staged.state, "review_required");
  assert.equal(connectorNextStep({ ...provider, connections: [healthy, { ...healthy, dataPromotionStatus: "staging" }] }, true, true).stage, "Review source data");
});

test("multiple healthy accounts use the oldest account sync, not the latest", () => {
  const older = "2026-09-25T11:50:00Z";
  const result = health({ connections: [{ ...provider, lastSuccessfulSyncAt: older }, provider] });
  assert.equal(result.state, "synced");
  assert.equal(result.lastSuccessfulSyncAt, older);
  assert.equal(result.freshness, "unknown");
  const mixedCadence = health({ connections: [{ ...provider, automaticSync: schedule }, provider] });
  assert.equal(mixedCadence.freshness, "unknown");
});

test("unfinished providers and subscription permissions preserve their setup boundaries", () => {
  assert.equal(health({ id: "moneris", status: "not_connected" }).state, "coming_soon");
  assert.equal(health({ status: "pending" }).state, "authorizing");
  assert.equal(health({ status: "not_connected" }).action, "connect");
  assert.equal(connectorNextStep(provider, false, true).stage, "Plan access");
  assert.equal(connectorNextStep(provider, true, false).stage, "Owner action");
  assert.equal(health({ providerReadiness: null }).state, "unknown");
});

test("Slack is channel authorization, not a financial sync or automatic-alert promise", () => {
  const slack: Connector = { ...provider, id: "slack", category: "Communications", dataPromotionStatus: "blocked", providerReadiness: { credentialsConfigured: true, mode: "production", liveDataEligible: false } };
  const result = connectorHealth(slack, { now });
  assert.equal(result.state, "channel_authorized");
  assert.equal(result.label, "Channel authorized");
  assert.equal(result.action, "view_channel");
  assert.equal(result.lastSuccessfulSyncAt, null);
  assert.equal(result.freshness, "not_applicable");
  assert.match(result.detail, /cannot read conversations or files/);
  assert.match(result.detail, /Automatic alerts are not enabled/);
  assert.equal(connectorNextStep(slack, true, true).stage, "Channel authorized");
  assert.equal(connectorHealth({ ...slack, connections: [{ ...slack, status: "pending" }, slack] }, { now }).state, "channel_authorized", "abandoned pending authorizations do not invalidate the completed channel authorization");
  assert.equal(connectorHealth({ ...slack, lastErrorCode: "TOKEN_REVOKED" }, { now }).state, "reauthorize");
});
