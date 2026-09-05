import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("account deletion requires protected identity and exact confirmation", () => {
  const route = read("../app/api/v1/account/deletion/route.ts");
  assert.match(route, /requireSameOrigin\(request\)/);
  assert.match(route, /requirePrivacyAccess\(request/);
  assert.match(route, /DELETE VANTELOQ WORKSPACE/);
  assert.match(route, /DELETE MY VANTELOQ ACCOUNT/);
  assert.match(route, /acknowledgeNoRecovery/);
  assert.match(route, /acknowledgeBillingCancellation/);
  assert.match(route, /enforceRateLimit\("account:delete"/);
});

test("workspace deletion cancels billing before deleting records and files", () => {
  const route = read("../app/api/v1/account/deletion/route.ts");
  const service = read("../server/account-deletion.ts");
  assert.match(service, /await terminateStripeBilling/);
  assert.match(service, /await deleteWorkspaceObjects/);
  assert.match(service, /await eraseLocal/);
  assert.doesNotMatch(route, /deleteSupabaseAuthUser|revokeSupabaseSessions/);
  assert.match(service, /identityBridge\(job, token, "cleanup"\)/);
  assert.match(route, /membershipCount/);
  assert.match(route, /exclusiveUserIds/);
});

test("deletion receipts exclude direct identity and expire", () => {
  const schema = read("../db/schema.ts");
  const migration = read("../drizzle/0038_nice_major_mapleleaf.sql");
  assert.match(schema, /accountDeletionReceipts/);
  assert.doesNotMatch(migration, /email|display_name|workspace_name|ip_address/);
  assert.match(migration, /account_hash/);
  assert.match(migration, /expires_at/);
  const route = read("../app/api/v1/account/deletion/route.ts");
  assert.match(route, /DELETE FROM account_deletion_receipts WHERE expires_at < \?/);
});

test("settings expose separate owner and teammate deletion consequences", () => {
  const settings = read("../app/governance-workspaces.tsx");
  assert.match(settings, /AccountDeletionSettings/);
  assert.match(settings, /Permanently delete workspace/);
  assert.match(settings, /Permanently delete my account/);
});
