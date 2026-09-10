import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { Miniflare } from "miniflare";
import { registerSupabaseTestServer } from "./helpers/supabase-loopback-transport.mjs";

test("sign-in preserves passwords, distinguishes provider failures, and keeps protections", async (t) => {
  let providerStatus = 200;
  let providerPayload = { access_token: "fixture-access", refresh_token: "fixture-refresh" };
  const forwarded = [];
  const authServer = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    forwarded.push({ path: request.url, payload: JSON.parse(body) });
    response.writeHead(providerStatus, { "content-type": "application/json" });
    response.end(JSON.stringify(providerPayload));
  });
  await new Promise(resolve => authServer.listen(0, "127.0.0.1", resolve));
  const miniflare = new Miniflare({ modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `signin-${crypto.randomUUID()}` },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    for (const file of (await readdir(new URL("../drizzle/", import.meta.url))).filter(file => /^\d{4}.*\.sql$/.test(file)).sort()) {
      const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
        await database.prepare(statement).run();
      }
    }
    const worker = (await import("../dist/server/index.js")).default;
    const env = {
      DB: database,
      SUPABASE_URL: registerSupabaseTestServer(authServer.address().port),
      SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      SUPABASE_CAPTCHA_ENABLED: "true",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    };
    let sequence = 0;
    const signin = (overrides = {}, requestOrigin = "https://vanteloq.example") => worker.fetch(new Request("https://vanteloq.example/api/v1/auth/signin", {
      method: "POST",
      headers: { "content-type": "application/json", origin: requestOrigin, "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ email: `signin-${sequence++}@example.invalid`, password: "  Cafe\u0301-password!  ", turnstileToken: "fixture-security-token", ...overrides }),
    }), env, { waitUntil() {}, passThroughOnException() {} });

    await t.test("successful response forwards exact password and CAPTCHA", async () => {
      const response = await signin();
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).session, { accessToken: "fixture-access", refreshToken: "fixture-refresh" });
      assert.equal(forwarded[0].path, "/auth/v1/token?grant_type=password");
      assert.equal(forwarded[0].payload.password, "  Cafe\u0301-password!  ");
      assert.equal(forwarded[0].payload.gotrue_meta_security.captcha_token, "fixture-security-token");
      assert.match(response.headers.get("cache-control"), /no-store/);
    });

    for (const [status, code, expectedStatus, expectedCode] of [
      [400, "invalid_credentials", 400, "INVALID_CREDENTIALS"],
      [400, "captcha_failed", 400, "SECURITY_VERIFICATION_FAILED"],
      [400, "email_not_confirmed", 403, "EMAIL_NOT_CONFIRMED"],
      [429, "over_request_rate_limit", 429, "SIGNIN_RATE_LIMITED"],
      [503, "unexpected_failure", 503, "ACCOUNT_SERVICE_UNAVAILABLE"],
      [401, "invalid_api_key", 503, "ACCOUNT_SERVICE_UNAVAILABLE"],
    ]) await t.test(`provider ${code} has an accurate safe response`, async () => {
      providerStatus = status;
      providerPayload = { error_code: code, message: "private upstream diagnostic" };
      const response = await signin();
      assert.equal(response.status, expectedStatus);
      const payload = await response.json();
      assert.equal(payload.error.code, expectedCode);
      assert.doesNotMatch(JSON.stringify(payload), /private upstream diagnostic|fixture-access/);
    });

    await t.test("missing CAPTCHA and cross-origin requests never contact auth", async () => {
      const before = forwarded.length;
      assert.equal((await signin({ turnstileToken: "" })).status, 400);
      assert.equal((await signin({}, "https://attacker.example")).status, 403);
      assert.equal(forwarded.length, before);
    });

    await t.test("repeated attempts remain rate limited before contacting auth", async () => {
      providerStatus = 400;
      providerPayload = { error_code: "invalid_credentials" };
      for (let attempt = 0; attempt < 5; attempt++) assert.equal((await signin({ email: "limited@example.invalid" })).status, 400);
      const before = forwarded.length;
      const response = await signin({ email: "limited@example.invalid" });
      assert.equal(response.status, 429);
      assert.equal((await response.json()).error.code, "RATE_LIMITED");
      assert.equal(forwarded.length, before);
    });
  } finally {
    await miniflare.dispose();
    authServer.closeAllConnections();
    await new Promise(resolve => authServer.close(resolve));
  }
});
