import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildSlackAuthorizationUrl,
  decryptSlackCredentials,
  encryptSlackCredentials,
  exchangeSlackAuthorizationCode,
  newSlackOAuthState,
  revokeSlackInstallation,
  sendSlackTestNotification,
  sendSlackWorkspaceLink,
  slackCredentialEnvelope,
  slackReadiness,
  validateSlackWebhookUrl,
} from "../server/integrations/slack.ts";

const encryptionKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64");
const testWebhook = "https://hooks.slack.com/services/fixture-team/fixture-channel/not-a-real-credential";
(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  SLACK_CLIENT_ID: "1234567890.1234567890",
  SLACK_CLIENT_SECRET: "fictional-slack-client-secret",
  SLACK_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/slack/callback",
  INTEGRATION_ENCRYPTION_KEY: encryptionKey,
};

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    app_id: "A0123456789",
    access_token: "xoxb-fictional-slack-token",
    bot_user_id: "U0123456789",
    scope: "incoming-webhook",
    token_type: "bot",
    team: { id: "T0123456789", name: "Vanteloq Test" },
    enterprise: null,
    incoming_webhook: {
      channel: "vanteloq-alerts",
      channel_id: "C0123456789",
      configuration_url: "https://vanteloq-test.slack.com/apps/A0123456789",
      url: testWebhook,
    },
    ...overrides,
  };
}

test("Slack authorization is browser-state bound and requests only one approved incoming-webhook channel", () => {
  const state = newSlackOAuthState();
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(buildSlackAuthorizationUrl(state));
  assert.equal(url.origin, "https://slack.com");
  assert.equal(url.pathname, "/oauth/v2/authorize");
  assert.equal(url.searchParams.get("client_id"), "1234567890.1234567890");
  assert.equal(url.searchParams.get("redirect_uri"), "https://vanteloq.example/api/v1/integrations/slack/callback");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.get("scope"), "incoming-webhook");
  assert.equal(url.searchParams.has("user_scope"), false);
  assert.doesNotMatch(url.toString(), /client-secret|xoxb-|hooks\.slack/);
  assert.deepEqual(slackReadiness().scopes, ["incoming-webhook"]);
});

test("Slack OAuth exchange validates the exact scope, bot grant, team, channel, and official webhook host", async () => {
  const exchangeRequests: Array<{ url: string; body: URLSearchParams; redirect?: RequestRedirect }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    exchangeRequests.push({ url: String(input), body: new URLSearchParams(String(init?.body)), redirect: init?.redirect });
    return Response.json(tokenResponse());
  }) as typeof fetch;
  const grant = await exchangeSlackAuthorizationCode("fictional-code", fetcher);
  const exchangeRequest = exchangeRequests[0];
  assert.ok(exchangeRequest);
  assert.equal(exchangeRequest.url, "https://slack.com/api/oauth.v2.access");
  assert.equal(exchangeRequest.body.get("client_id"), "1234567890.1234567890");
  assert.equal(exchangeRequest.body.get("client_secret"), "fictional-slack-client-secret");
  assert.equal(exchangeRequest.body.get("redirect_uri"), "https://vanteloq.example/api/v1/integrations/slack/callback");
  assert.equal(exchangeRequest.redirect, "manual");
  assert.deepEqual(grant.scopes, ["incoming-webhook"]);
  assert.equal(grant.teamId, "T0123456789");
  assert.equal(grant.channelId, "C0123456789");
  assert.equal(grant.channelName, "vanteloq-alerts");

  for (const payload of [
    tokenResponse({ scope: "chat:write,incoming-webhook" }),
    tokenResponse({ scope: "" }),
    tokenResponse({ token_type: "user" }),
    tokenResponse({ incoming_webhook: { channel: "alerts", channel_id: "C0123456789", url: "https://example.com/steal" } }),
  ]) {
    await assert.rejects(
      () => exchangeSlackAuthorizationCode("fictional-code", (async () => Response.json(payload)) as typeof fetch),
      (error: unknown) => error instanceof Error && "code" in error && String(error.code).startsWith("SLACK_"),
    );
  }
});

test("Slack credential envelope is encrypted with authenticated encryption and rejects tampering", async () => {
  const grant = await exchangeSlackAuthorizationCode("fictional-code", (async () => Response.json(tokenResponse())) as typeof fetch);
  const original = slackCredentialEnvelope(grant);
  const encrypted = await encryptSlackCredentials(original);
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(encrypted, /xoxb-|hooks\.slack|T0123456789|C0123456789/);
  assert.deepEqual(await decryptSlackCredentials(encrypted), original);
  // Flip a ciphertext byte; changing unused base64 padding bits can decode unchanged.
  const [version, iv, encodedCiphertext] = encrypted.split(".");
  const tampered = Buffer.from(encodedCiphertext!, "base64url");
  tampered[0] = tampered[0]! ^ 1;
  await assert.rejects(
    () => decryptSlackCredentials(`${version}.${iv}.${tampered.toString("base64url")}`),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "SLACK_SECRET_DECRYPTION_FAILED",
  );
});

test("Slack webhook validation prevents credential-driven SSRF", () => {
  assert.equal(validateSlackWebhookUrl(testWebhook), testWebhook);
  for (const value of [
    "http://hooks.slack.com/services/fixture-team/fixture-channel/not-a-real-credential",
    "https://hooks.slack.com.evil.invalid/services/fixture-team/fixture-channel/not-a-real-credential",
    "https://user@hooks.slack.com/services/fixture-team/fixture-channel/not-a-real-credential",
    "https://hooks.slack.com/services/T00000000/B00000000",
    "https://hooks.slack.com/services/fixture-team/fixture-channel/not-a-real-credential?next=evil",
  ]) assert.throws(() => validateSlackWebhookUrl(value));
});

test("Slack test notification is fixed, contains no business data, and fails closed", async () => {
  const credentials = {
    version: 1 as const,
    accessToken: "xoxb-fictional-slack-token",
    teamId: "T0123456789",
    channelId: "C0123456789",
    webhookUrl: testWebhook,
  };
  const sentRequests: Array<{ url: string; body: string; redirect?: RequestRedirect }> = [];
  await sendSlackTestNotification(credentials, (async (input, init) => {
    sentRequests.push({ url: String(input), body: String(init?.body), redirect: init?.redirect });
    return new Response("ok");
  }) as typeof fetch);
  const sent = sentRequests[0];
  assert.ok(sent);
  assert.equal(sent.url, testWebhook);
  assert.equal(sent.redirect, "manual");
  assert.match(sent.body, /Vanteloq connection test/);
  assert.match(sent.body, /No business data was included/);
  assert.doesNotMatch(sent.body, /xoxb-|T0123456789|C0123456789|hooks\.slack/);
  await assert.rejects(
    () => sendSlackTestNotification(credentials, (async () => new Response("invalid_payload", { status: 400 })) as typeof fetch),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "SLACK_NOTIFICATION_FAILED",
  );
  await assert.rejects(
    () => sendSlackTestNotification(credentials, (async () => new Response("", { status: 429, headers: { "Retry-After": "1" } })) as typeof fetch),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "SLACK_RATE_LIMITED",
  );
});

test("workspace sharing sends only a fixed authenticated entry link, with no unfurl or business data", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  await sendSlackWorkspaceLink({ version: 1, accessToken: "private-token", teamId: "T0123456789", channelId: "C0123456789", webhookUrl: testWebhook }, (async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response("ok");
  }) as typeof fetch);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url, testWebhook);
  assert.equal(request.init?.redirect, "manual");
  const payload = JSON.parse(String(request.init?.body));
  assert.equal(payload.blocks[1].elements[0].url, "https://vanteloq.example/");
  assert.equal(payload.unfurl_links, false);
  assert.equal(payload.unfurl_media, false);
  assert.doesNotMatch(JSON.stringify(payload), /private-token|T0123456789|C0123456789|hooks\.slack/);
  assert.match(payload.text, /Sign-in and workspace access are required/);
});

test("Slack disconnect calls the official uninstall endpoint without following redirects", async () => {
  const credentials = {
    version: 1 as const,
    accessToken: "xoxb-fictional-slack-token",
    teamId: "T0123456789",
    channelId: "C0123456789",
    webhookUrl: testWebhook,
  };
  const uninstallRequests: Array<{ url: string; body: URLSearchParams; redirect?: RequestRedirect }> = [];
  assert.equal(await revokeSlackInstallation(credentials, (async (input, init) => {
    uninstallRequests.push({ url: String(input), body: new URLSearchParams(String(init?.body)), redirect: init?.redirect });
    return Response.json({ ok: true });
  }) as typeof fetch), true);
  const uninstallRequest = uninstallRequests[0];
  assert.ok(uninstallRequest);
  assert.equal(uninstallRequest.url, "https://slack.com/api/apps.uninstall");
  assert.equal(uninstallRequest.body.get("token"), credentials.accessToken);
  assert.equal(uninstallRequest.redirect, "manual");
  assert.equal(await revokeSlackInstallation(credentials, (async () => Response.json({ ok: false, error: "invalid_auth" })) as typeof fetch), false);
});

test("Slack routes preserve tenant, browser, rollout, permission, and credential deletion boundaries", () => {
  const route = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
  const authorize = route("app/api/v1/integrations/slack/authorize/route.ts");
  const callback = route("app/api/v1/integrations/slack/callback/route.ts");
  const status = route("app/api/v1/integrations/slack/status/route.ts");
  const notification = route("app/api/v1/integrations/slack/test-notification/route.ts");
  const disconnect = route("app/api/v1/integrations/slack/disconnect/route.ts");
  assert.match(authorize, /requireIntegrationRollout\(context, SLACK_PROVIDER\)/);
  assert.match(authorize, /initiatorAuthSubject: context\.identity\.subject/);
  assert.match(authorize, /requirePermission\(context, "integrations\.manage"\)/);
  assert.ok(callback.indexOf("requireOAuthBrowser(request") < callback.indexOf("from(integrationOAuthStates)"));
  assert.match(callback, /eq\(integrationConnections\.organizationId, context\.organizationId\)/);
  assert.doesNotMatch(status, /integrationSecrets|accessTokenCiphertext|webhookUrl/);
  assert.match(notification, /requireOwnedIntegrationConnection/);
  assert.doesNotMatch(notification, /input\.message|input\.text|input\.blocks/);
  assert.match(disconnect, /withdrawSlackGrant/);
  assert.match(disconnect, /localAccessRemoved: true|localAccessRemoved:true/);
});
