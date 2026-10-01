import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, NoOpLog, Response } from "miniflare";

// Run native workerd fetch: a Node mock accepts unsupported Worker redirect modes.
test("Moneris requests work in Workers and never send credentials to redirect targets", async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    absWorkingDir: root, tsconfigRaw: { compilerOptions: { target: "ESNext" } },
    stdin: { resolveDir: root, contents: `
      import { requestMonerisAccessToken, fetchMonerisPayments } from "./server/integrations/moneris";
      import { encryptIntegrationSecret } from "./server/integrations/lightspeed";
      export default { async fetch(request, env) {
        globalThis.__vanteloqEnv = env;
        const credentials = { environment: "sandbox", merchantId: "0123456789101", clientId: "fictional-client", clientSecret: "fictional-secret-only", scope: "payment.read" };
        try {
          const operation = new URL(request.url).pathname;
          if (operation === "/seed") {
            await env.DB.prepare("INSERT INTO integration_connections(id,organization_id,provider,external_account_ref,domain_prefix,source_namespace) VALUES ('connection','organization','moneris','0123456789101',NULL,'sandbox:0123456789101')").run();
            await env.DB.prepare("INSERT INTO integration_secrets(connection_id,organization_id,provider,access_token_ciphertext,refresh_token_ciphertext) VALUES ('connection','organization','moneris',?,?)")
              .bind(await encryptIntegrationSecret(credentials.clientId), await encryptIntegrationSecret(credentials.clientSecret)).run();
            return Response.json({ ok: true });
          }
          const result = operation === "/token" ? await requestMonerisAccessToken(credentials)
            : await fetchMonerisPayments("organization", "connection", { createdFrom: "2026-09-24T00:00:00Z", createdTo: "2026-09-24T23:59:59Z", maxPages: 1 });
          return Response.json({ ok: true, count: operation === "/payments" ? result.data.length : undefined });
        } catch (error) { return Response.json({ code: error.code, name: error.name, message: error.message }, { status: 502 }); }
      }};` },
    bundle: true, platform: "browser", format: "esm", write: false, logLevel: "error",
  });
  let failure = null;
  const calls = [];
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], log: new NoOpLog(),
    d1Databases: ["DB"], bindings: { INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64") },
    // All outbound traffic is intercepted. No real credentials or provider calls.
    outboundService: async (request) => {
      calls.push(request.url);
      const pathname = new URL(request.url).pathname;
      if (failure && pathname === failure.path) return new Response(null, { status: failure.status, headers: { Location: "https://credential-sink.invalid/" } });
      if (pathname === "/oauth2/token") return Response.json({ access_token: "fictional-access-token", expires_in: 900 });
      if (pathname === "/payments") return Response.json({ data: [{ paymentId: "fixture-only" }], next: null });
      return new Response(null, { status: 500 });
    },
  });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec("CREATE TABLE integration_connections(id TEXT, organization_id TEXT, provider TEXT, external_account_ref TEXT, domain_prefix TEXT, source_namespace TEXT); CREATE TABLE integration_secrets(connection_id TEXT, organization_id TEXT, provider TEXT, access_token_ciphertext TEXT, refresh_token_ciphertext TEXT);");
    const seed = await mf.dispatchFetch("https://fixture.invalid/seed");
    assert.equal(seed.status, 200, await seed.clone().text());
    for (const operation of ["token", "payments"]) {
      await t.test(`${operation} succeeds through native Worker fetch`, async () => {
        failure = null; calls.length = 0;
        const response = await mf.dispatchFetch(`https://fixture.invalid/${operation}`);
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal((await response.json()).ok, true);
        assert.equal(calls.length, operation === "token" ? 1 : 2);
      });
      for (const status of [300, 301, 302, 303, 304, 307, 308, 399, 401, 429, 500]) {
        await t.test(`${operation} rejects provider status ${status}`, async () => {
          failure = { status, path: operation === "token" ? "/oauth2/token" : "/payments" }; calls.length = 0;
          const response = await mf.dispatchFetch(`https://fixture.invalid/${operation}`);
          const body = await response.json();
          assert.equal(response.status, 502);
          assert.equal(body.code, status === 429 ? "MONERIS_RATE_LIMITED" : operation === "token" ? "MONERIS_CREDENTIALS_REJECTED" : "MONERIS_PAYMENTS_FAILED");
          assert.equal(calls.length, operation === "token" ? 1 : 2);
          assert.ok(!calls.some(url => url.includes("credential-sink")), "A redirect must never receive the token or merchant credentials");
        });
      }
    }
  } finally { await mf.dispose(); }
});
