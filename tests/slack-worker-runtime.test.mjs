import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, NoOpLog, Response } from "miniflare";

// Native Worker fetch is intentional: Node mocks do not enforce its redirect modes.
test("Slack requests work in Workers and never forward credentials to redirects", async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    absWorkingDir: root, tsconfigRaw: { compilerOptions: { target: "ESNext" } },
    stdin: { resolveDir: root, contents: `
      import { exchangeSlackAuthorizationCode, sendSlackTestNotification, sendSlackWorkspaceLink, revokeSlackInstallation } from "./server/integrations/slack";
      export default { async fetch(request, env) {
        globalThis.__vanteloqEnv = env;
        const credentials = { version: 1, accessToken: "xoxb-fictional", teamId: "T00000000", channelId: "C00000000", webhookUrl: "https://hooks.slack.com/services/fixture-team/fixture-channel/not-a-real-credential" };
        try {
          const operation = new URL(request.url).pathname;
          const result = operation === "/exchange" ? await exchangeSlackAuthorizationCode("fictional-code")
            : operation === "/notify" ? await sendSlackTestNotification(credentials)
            : operation === "/share" ? await sendSlackWorkspaceLink(credentials)
            : await revokeSlackInstallation(credentials);
          return Response.json({ ok: true, result: operation === "/exchange" ? result.teamId : result ?? true });
        } catch (error) { return Response.json({ code: error.code, name: error.name, message: error.message }, { status: 502 }); }
      }};` },
    bundle: true, platform: "browser", format: "esm", write: false, logLevel: "error",
  });
  const calls = [];
  let redirectStatus = null;
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], log: new NoOpLog(),
    bindings: { SLACK_CLIENT_ID: "123.456", SLACK_CLIENT_SECRET: "fictional-secret", SLACK_REDIRECT_URI: "https://fixture.invalid/callback", INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") },
    // Fully isolated: no provider traffic, production credentials or business records.
    outboundService: async (request) => {
      calls.push(request.url);
      if (redirectStatus) return new Response(null, { status: redirectStatus, headers: { Location: "https://credential-sink.invalid/" } });
      if (request.url.includes("hooks.slack.com")) return new Response("ok");
      if (request.url.endsWith("apps.uninstall")) return Response.json({ ok: true });
      return Response.json({ ok: true, app_id: "A00000000", access_token: "xoxb-fictional", token_type: "bot", scope: "incoming-webhook", team: { id: "T00000000", name: "Fixture" }, incoming_webhook: { channel: "general", channel_id: "C00000000", url: "https://hooks.slack.com/services/fixture-team/fixture-channel/not-a-real-credential" } });
    },
  });
  try {
    for (const operation of ["exchange", "notify", "share", "revoke"]) {
      await t.test(`${operation} succeeds through native Worker fetch`, async () => {
        redirectStatus = null; calls.length = 0;
        const response = await mf.dispatchFetch(`https://fixture.invalid/${operation}`);
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal((await response.json()).ok, true);
        assert.equal(calls.length, 1);
      });
      for (const status of [300, 301, 302, 303, 304, 307, 308, 399]) {
        await t.test(`${operation} rejects redirect ${status}`, async () => {
          redirectStatus = status; calls.length = 0;
          const response = await mf.dispatchFetch(`https://fixture.invalid/${operation}`);
          const body = await response.json();
          if (operation === "revoke") assert.deepEqual(body, { ok: true, result: false });
          else {
            assert.equal(response.status, 502);
            assert.equal(body.code, operation === "exchange" ? "SLACK_TOKEN_EXCHANGE_FAILED" : "SLACK_NOTIFICATION_FAILED");
          }
          assert.equal(calls.length, 1, "A redirect must never trigger another request");
          assert.ok(!calls.some(url => url.includes("credential-sink")));
        });
      }
    }
  } finally { await mf.dispose(); }
});
