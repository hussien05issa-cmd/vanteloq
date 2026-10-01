import assert from "node:assert/strict";
import test from "node:test";
import { encryptSlackCredentials } from "../server/integrations/slack.ts";
import { providerPrivacyAcceptance } from "../domain/provider-privacy.ts";
import { createEnvironment, createReportWorkspace, dispatch } from "./helpers/retail-worker-fixture.mjs";

test("Slack public connection and link sharing enforce consent, active channel and workspace ownership", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const originalFetch = globalThis.fetch;
  const sends = [];
  Object.assign(environment, {
    SLACK_CLIENT_ID: "123456.789012",
    SLACK_CLIENT_SECRET: "fixture-secret",
    SLACK_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/slack/callback",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  });
  try {
    const owner = await createReportWorkspace(worker, environment, database, "slack-owner");
    const other = await createReportWorkspace(worker, environment, database, "slack-other");
    const missingConsent = await dispatch(worker, environment, "/api/v1/integrations/slack/authorize", { ...owner.owner, method: "POST", body: {} });
    assert.equal(missingConsent.status, 400);
    assert.equal((await missingConsent.json()).error.code, "PROVIDER_PRIVACY_REQUIRED");
    const authorized = await dispatch(worker, environment, "/api/v1/integrations/slack/authorize", { ...owner.owner, method: "POST", body: providerPrivacyAcceptance(true) });
    assert.equal(authorized.status, 200, await authorized.clone().text());
    const grant = await authorized.json();
    assert.deepEqual(grant.scopes, ["incoming-webhook"]);
    assert.match(authorized.headers.get("set-cookie"), /HttpOnly/);
    const connectionId = grant.connectionId;
    const now = Math.floor(Date.now() / 1000);
    globalThis.__vanteloqEnv = environment;
    const ciphertext = await encryptSlackCredentials({
      version: 1, accessToken: "xoxb-fictional-token", teamId: "T00000000", channelId: "C00000000",
      webhookUrl: "https://hooks.slack.com/services/fixture-team/fixture-channel/not-a-real-credential",
    });
    await database.prepare("UPDATE integration_connections SET status='connected', external_account_ref='T00000000', domain_prefix='C00000000' WHERE id=? AND organization_id=?").bind(connectionId, owner.organizationId).run();
    await database.prepare("INSERT INTO integration_secrets (id, organization_id, provider, connection_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, created_at, updated_at) VALUES (?,?,'slack',?,?,'unused',?,?,?)")
      .bind(crypto.randomUUID(), owner.organizationId, connectionId, ciphertext, now + 86400, now, now).run();
    globalThis.fetch = async (request, init) => {
      const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
      if (url.startsWith("https://hooks.slack.com/")) {
        sends.push(JSON.parse(String(init?.body)));
        return new Response("ok");
      }
      return originalFetch(request, init);
    };
    const path = "/api/v1/integrations/slack/share-workspace";
    const unconfirmed = await dispatch(worker, environment, path, { ...owner.owner, method: "POST", body: { connectionId } });
    assert.equal(unconfirmed.status, 400);
    const foreign = await dispatch(worker, environment, path, { ...other.owner, method: "POST", body: { connectionId, confirmed: true } });
    assert.equal(foreign.status, 404);
    assert.equal(sends.length, 0);
    const sent = await dispatch(worker, environment, path, { ...owner.owner, method: "POST", body: { connectionId, confirmed: true, text: "PRIVATE CUSTOMER DATA", url: "https://invalid.example/" } });
    assert.equal(sent.status, 200, await sent.clone().text());
    assert.equal((await sent.json()).containedBusinessData, false);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].blocks[1].elements[0].url, "https://vanteloq.example/");
    assert.doesNotMatch(JSON.stringify(sends[0]), /PRIVATE CUSTOMER|invalid\.example|xoxb-fictional-token/);
    await database.prepare("UPDATE integration_connections SET status='revoked' WHERE id=?").bind(connectionId).run();
    const revoked = await dispatch(worker, environment, path, { ...owner.owner, method: "POST", body: { connectionId, confirmed: true } });
    assert.equal(revoked.status, 404);
    assert.equal(sends.length, 1);
    await database.prepare("UPDATE memberships SET role='employee' WHERE user_id=? AND organization_id=?").bind(owner.userId, owner.organizationId).run();
    const forbidden = await dispatch(worker, environment, path, { ...owner.owner, method: "POST", body: { connectionId, confirmed: true } });
    assert.equal(forbidden.status, 403);
    assert.equal(sends.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await dispose();
  }
});
