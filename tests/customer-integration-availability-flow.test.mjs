import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch } from "./helpers/retail-worker-fixture.mjs";

test("integration response derives preview controls from the current subject-bound internal grant", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  try {
    Object.assign(environment, {
      VANTELOQ_INTERNAL_ACCESS_ENABLED: "true",
      QUICKBOOKS_CLIENT_ID: "fixture-only-client-id-12345", QUICKBOOKS_CLIENT_SECRET: "fixture-only-client-secret-12345",
      QUICKBOOKS_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/quickbooks/callback", QUICKBOOKS_ENV: "sandbox",
      INTEGRATION_ENCRYPTION_KEY: "fixture-only-encryption-1234567890",
      PLAID_CLIENT_ID: "fixture-only-client", PLAID_SECRET: "fixture-only-secret", PLAID_ENV: "sandbox",
      PLAID_WEBHOOK_URL: "https://vanteloq.example/api/v1/integrations/plaid/webhook", PLAID_REDIRECT_URI: "https://vanteloq.example/",
    });
    const account = await createReportWorkspace(worker, environment, database, "customer-availability");
    const load = async () => {
      const response = await dispatch(worker, environment, "/api/v1/integrations", account.owner);
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).integrations;
    };
    const ordinary = await load();
    for (const id of ["quickbooks", "plaid"]) {
      const item = ordinary.find(provider => provider.id === id);
      assert.equal(item.providerReadiness.credentialsConfigured, true);
      assert.deepEqual(item.customerAvailability, { comingSoon: true, canStartConnection: false, previewAccess: false });
      assert.doesNotMatch(item.activationRequirement, /staging|tenant|client secret|hosted credentials/i);
    }
    const id = randomUUID(), now = Math.floor(Date.now() / 1000);
    await database.prepare(`INSERT INTO internal_access(id,user_id,organization_id,access_level,reason,active,mfa_required,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,'founder','Isolated fixture review access',1,1,?,?,?)`)
      .bind(id, account.userId, account.organizationId, account.userId, now, now).run();
    const preview = (await load()).find(provider => provider.id === "quickbooks");
    assert.deepEqual(preview.customerAvailability, { comingSoon: true, canStartConnection: true, previewAccess: true });
    assert.equal(preview.providerReadiness.ledgerImportEnabled, false, "preview controls cannot turn on missing accounting functionality");
    await database.prepare("UPDATE internal_access SET active=0 WHERE id=?").bind(id).run();
    assert.equal((await load()).find(provider => provider.id === "quickbooks").customerAvailability.canStartConnection, false);
  } finally { await dispose(); }
});
