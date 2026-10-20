import assert from "node:assert/strict";
import test from "node:test";
import { SLACK_CONVERSATION_READ_NOTICE_VERSION } from "../domain/slack-conversations";
import { buildSlackAuthorizationUrl, decryptSlackCredentials, encryptSlackCredentials, exchangeSlackAuthorizationCode,
  newSlackOAuthState, slackCredentialEnvelope, SLACK_CONVERSATION_SCOPES, type SlackCredentialEnvelope } from "../server/integrations/slack";
import { readSlackRecentConversation, SlackConversationRateLimitError, validateSlackPublicChannel } from "../server/integrations/slack-conversation";

(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  SLACK_CLIENT_ID: "fixture-client", SLACK_CLIENT_SECRET: "fixture-secret", SLACK_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/slack/callback",
  INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
const credentials: SlackCredentialEnvelope = { version: 1, accessToken: "xoxb-fictional-fixture", teamId: "TFIXTURE", channelId: "CFIXTURE",
  webhookUrl: "https://hooks.slack.com/services/fixtureteam/fixturechannel/fictionalcredential",
  conversationRead: { version: 1, enabled: true, noticeVersion: SLACK_CONVERSATION_READ_NOTICE_VERSION, authorizedByUserId: "fixture-owner", nextReadAt: 0 } };
const channel = { id: credentials.channelId, context_team_id: credentials.teamId, name: "fixture-channel", is_channel: true,
  is_private: false, is_member: true, is_im: false, is_mpim: false, is_archived: false, is_shared: false, is_ext_shared: false, is_org_shared: false };
const oauth = (extra: Record<string, unknown> = {}) => ({ ok: true, app_id: "AFIXTURE", access_token: credentials.accessToken,
  bot_user_id: "UFIXTURE", scope: SLACK_CONVERSATION_SCOPES.join(","), token_type: "bot", team: { id: credentials.teamId, name: "Fixture" },
  incoming_webhook: { channel: "fixture-channel", channel_id: credentials.channelId, url: credentials.webhookUrl }, ...extra });
const isCode = (code: string) => (error: unknown) => error instanceof Error && "code" in error && error.code === code;
const message = (index = 0) => ({ type: "message", user: "UFIXTURE", ts: `1760000000.${String(index).padStart(6, "0")}`, text: `Message ${index}` });

test("conversation OAuth requires exactly the selected read scope set and never requests a user token", async () => {
  const url = new URL(buildSlackAuthorizationUrl(newSlackOAuthState(), "single_channel_conversations"));
  assert.equal(url.searchParams.get("scope"), SLACK_CONVERSATION_SCOPES.join(","));
  assert.equal(url.searchParams.has("user_scope"), false);
  const grant = await exchangeSlackAuthorizationCode("fictional-code", (async () => Response.json(oauth())) as typeof fetch, "single_channel_conversations");
  assert.deepEqual(grant.scopes, SLACK_CONVERSATION_SCOPES);
  assert.throws(() => slackCredentialEnvelope(grant), isCode("SLACK_CONVERSATION_CONSENT_REQUIRED"));
  assert.equal(slackCredentialEnvelope(grant, "fixture-owner").conversationRead?.enabled, true);
  for (const scope of ["incoming-webhook", "incoming-webhook,channels:read", "channels:history", `${SLACK_CONVERSATION_SCOPES.join(",")},files:read`]) {
    await assert.rejects(() => exchangeSlackAuthorizationCode("code", (async () => Response.json(oauth({ scope }))) as typeof fetch, "single_channel_conversations"),
      isCode(scope.includes("files:read") ? "SLACK_SCOPES_INVALID" : "SLACK_CONVERSATION_SCOPES_REQUIRED"));
  }
  await assert.rejects(() => exchangeSlackAuthorizationCode("code", (async () => Response.json(oauth())) as typeof fetch), isCode("SLACK_SCOPES_INVALID"));
});

test("unsupported rotating and user-token grants fail closed", async () => {
  for (const extra of [{ refresh_token: "fictional-refresh" }, { expires_in: 43200 },
    { authed_user: { access_token: "xoxp-fictional-user-token" } }, { authed_user: { scope: "users:read" } }]) {
    await assert.rejects(() => exchangeSlackAuthorizationCode("code", (async () => Response.json(oauth(extra))) as typeof fetch, "single_channel_conversations"), isCode("SLACK_TOKEN_ROTATION_UNSUPPORTED"));
  }
  await assert.rejects(() => exchangeSlackAuthorizationCode("code", (async () => Response.json(oauth({ token_type: "user" }))) as typeof fetch, "single_channel_conversations"), isCode("SLACK_TOKEN_RESPONSE_INVALID"));
});

test("encrypted read metadata is bounded, validated and compatible with notification-only envelopes", async () => {
  const encrypted = await encryptSlackCredentials(credentials);
  assert.deepEqual(await decryptSlackCredentials(encrypted), credentials);
  assert.doesNotMatch(encrypted, /fictional-fixture|fixture-owner|CFIXTURE/);
  const { conversationRead, ...legacy } = credentials;
  assert.deepEqual(await decryptSlackCredentials(await encryptSlackCredentials(legacy)), legacy);
  const withUnknown = { ...credentials, unexpectedPrivateProperty: "must-not-escape-decoder" };
  assert.equal("unexpectedPrivateProperty" in await decryptSlackCredentials(await encryptSlackCredentials(withUnknown)), false);
  for (const extra of [{ enabled: false }, { version: 2 }, { noticeVersion: "obsolete" }, { authorizedByUserId: "" }, { nextReadAt: Infinity }, { nextReadAt: -1 }]) {
    const invalid = { ...credentials, conversationRead: { ...conversationRead!, ...extra } } as SlackCredentialEnvelope;
    await assert.rejects(() => encryptSlackCredentials(invalid).then(decryptSlackCredentials));
  }
});

test("legacy credentials cannot call any conversation endpoint", async () => {
  const legacy = { ...credentials }; delete legacy.conversationRead;
  let calls = 0;
  await assert.rejects(() => readSlackRecentConversation(legacy, (async () => { calls++; throw Error("No provider calls allowed"); }) as typeof fetch), isCode("SLACK_CONVERSATION_CONSENT_REQUIRED"));
  assert.equal(calls, 0);
});

test("reads validate the fixed public channel and project at most 15 plain-text parents", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const raw = Array.from({ length: 20 }, (_, index) => ({ ...message(index), files: [{ private_download: "private-file" }], blocks: [{ secret: "block-private" }], attachments: [{ secret: "attachment-private" }] }));
  raw[1] = { ...raw[1]!, thread_ts: "1760000000.999999" } as typeof raw[0];
  raw[2] = { ...raw[2]!, hidden: true } as typeof raw[0];
  raw[3] = { ...raw[3]!, subtype: "message_changed" } as typeof raw[0];
  raw[4]!.text = "<script>untrusted content</script>";
  raw[5]!.text = "x".repeat(9000);
  const result = await readSlackRecentConversation(credentials, (async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init });
    return Response.json(url.pathname.endsWith("conversations.info") ? { ok: true, channel } : { ok: true, messages: raw, has_more: true, is_limited: true });
  }) as typeof fetch);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(item => item.url.pathname), ["/api/conversations.info", "/api/conversations.history"]);
  for (const request of requests) {
    assert.equal(request.url.origin, "https://slack.com");
    assert.equal(request.url.searchParams.get("channel"), credentials.channelId);
    assert.equal(request.init?.redirect, "manual");
    assert.equal((request.init?.headers as Record<string, string>).Authorization, `Bearer ${credentials.accessToken}`);
    assert.equal(request.url.searchParams.has("token"), false);
  }
  assert.equal(requests[1]!.url.searchParams.get("limit"), "15");
  assert.equal(requests[1]!.url.searchParams.has("cursor"), false);
  assert.equal(result.messages.length, 12);
  assert.equal(result.messages[0]!.ts, message(14).ts);
  assert.equal(result.messages.at(-1)!.ts, message(0).ts);
  assert.match(result.messages.find(item => item.ts === message(5).ts)!.text, /Message shortened/);
  assert.ok(result.messages.every(item => item.text.length <= 8000));
  assert.equal(result.messages.find(item => item.ts === message(4).ts)!.text, "<script>untrusted content</script>");
  assert.doesNotMatch(JSON.stringify(result), /private-file|block-private|attachment-private|xoxb-|webhookUrl/);
  assert.equal(result.channelUrl, "https://slack.com/app_redirect?channel=CFIXTURE&team=TFIXTURE");
  assert.equal(result.hasMore, true); assert.equal(result.isLimited, true);
});

test("private, shared, nonmember, archived, foreign and malformed channels cannot reach history", async () => {
  for (const override of [{ id: "COTHER" }, { context_team_id: "TOTHER" }, { context_team_id: undefined }, { is_private: true },
    { is_member: false }, { is_im: true }, { is_mpim: true }, { is_archived: true }, { is_shared: true }, { is_org_shared: true },
    { is_ext_shared: true }, { is_pending_ext_shared: true }, { shared_team_ids: ["TOTHER"] }, { is_channel: false }]) {
    let calls = 0;
    await assert.rejects(() => readSlackRecentConversation(credentials, (async input => {
      calls++; assert.match(String(input), /conversations\.info/); return Response.json({ ok: true, channel: { ...channel, ...override } });
    }) as typeof fetch), isCode("SLACK_PUBLIC_CHANNEL_REQUIRED"));
    assert.equal(calls, 1);
  }
});

test("read responses reject redirects, malformed JSON, oversized payloads and provider errors safely", async () => {
  for (const factory of [() => new Response("private-provider-text", { status: 302, headers: { Location: "https://evil.invalid/" } }),
    () => new Response("not-json"), () => Response.json({ ok: true, channel, extra: "x".repeat(262144) }),
    () => Response.json({ ok: false, error: "private-provider-text" })]) {
    await assert.rejects(() => validateSlackPublicChannel(credentials, (async () => factory()) as typeof fetch), error => {
      assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /private-provider-text|evil\.invalid|xoxb-/); return true;
    });
  }
  for (const error of ["missing_scope", "token_expired", "token_revoked", "invalid_auth"]) {
    await assert.rejects(() => validateSlackPublicChannel(credentials, (async () => Response.json({ ok: false, error })) as typeof fetch), isCode("SLACK_CONVERSATION_RECONNECT_REQUIRED"));
  }
  await assert.rejects(() => validateSlackPublicChannel(credentials, (async () => { throw Error("private-network-detail"); }) as typeof fetch), isCode("SLACK_CONVERSATION_UNAVAILABLE"));
});

test("Slack 429 responses carry a bounded cooldown and preserve the provider minimum", async () => {
  for (const [header, expected] of [["120", 120], ["1", 60], ["invalid", 60], ["999999", 86400]] as const) {
    await assert.rejects(() => validateSlackPublicChannel(credentials, (async () => new Response("", { status: 429, headers: { "Retry-After": header } })) as typeof fetch),
      error => error instanceof SlackConversationRateLimitError && error.retryAfterSeconds === expected);
  }
});
