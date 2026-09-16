import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, NoOpLog, Response } from "miniflare";

// Exercise the actual discovery implementation inside workerd. Node fetch mocks
// accept redirect modes that the deployed Workers runtime does not support.
test("Google Ads discovery is Worker-compatible and never follows provider redirects", async (t) => {
  const bundle = await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    tsconfigRaw: { compilerOptions: { target: "ESNext" } },
    stdin: {
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      contents: `
        import { discoverGoogleAdsAccounts } from "./server/integrations/google-ads-access";
        export default {
          async fetch(request, env) {
            globalThis.__vanteloqEnv = env;
            try { return Response.json({ accounts: await discoverGoogleAdsAccounts("fixture-oauth") }); }
            catch (error) { return Response.json({ code: error.code, message: error.message }, { status: 502 }); }
          }
        }`,
    },
    bundle: true, platform: "browser", format: "esm", write: false, logLevel: "error",
  });
  let redirect = null;
  const calls = [];
  const manager = "customers/1234567890";
  const child = "customers/9876543210";
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
    log: new NoOpLog(),
    bindings: { GOOGLE_ADS_DEVELOPER_TOKEN: "fixture-developer-token", GOOGLE_ADS_API_VERSION: "v25" },
    // Every outbound request terminates here. No Google accounts, credentials,
    // production data or external network requests are used by this test.
    outboundService: async (request) => {
      const body = request.method === "POST" ? await request.json() : null;
      const phase = request.method === "GET" ? "list" : body?.query?.includes("FROM customer_client") ? "hierarchy" : "identity";
      calls.push({ url: request.url, phase, authorization: request.headers.get("authorization"), developerToken: request.headers.get("developer-token"), manager: request.headers.get("login-customer-id") });
      if (redirect?.phase === phase) return new Response(null, { status: redirect.status, headers: { Location: redirect.location } });
      const data = phase === "list" ? { resourceNames: [manager] }
        : phase === "identity" ? { results: [{ customer: { resourceName: manager, manager: true } }] }
        : { results: [{ customerClient: { clientCustomer: child, descriptiveName: "Fixture store", manager: false, testAccount: true } }] };
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    },
  });
  try {
    await t.test("discovers a manager's client account through native Worker fetch", async () => {
      const response = await mf.dispatchFetch("https://fixture.invalid/");
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual((await response.json()).accounts, [{ resourceRef: child, name: "Fixture store · 987-654-3210 · Test account", loginCustomerId: "1234567890", testAccount: true }]);
      assert.deepEqual(calls.map(({ phase }) => phase), ["list", "identity", "hierarchy"]);
      assert.deepEqual(calls.map(({ manager }) => manager), [null, null, "1234567890"]);
      for (const call of calls) {
        assert.equal(new URL(call.url).origin, "https://googleads.googleapis.com");
        assert.equal(call.authorization, "Bearer fixture-oauth");
        assert.equal(call.developerToken, null);
      }
    });
    for (const [index, phase] of ["list", "identity", "hierarchy"].entries()) {
      for (const status of [300, 301, 302, 303, 304, 307, 308, 399]) {
        for (const location of ["https://googleads.googleapis.com/redirect-sink", "https://credential-sink.invalid/private-location"]) {
          await t.test(`rejects ${status} during ${phase}, including ${new URL(location).hostname}`, async () => {
            calls.length = 0;
            redirect = { phase, status, location };
            const response = await mf.dispatchFetch("https://fixture.invalid/");
            assert.equal(response.status, 502);
            const body = await response.json();
            assert.deepEqual(body, {
              code: "GOOGLE_ADS_DIRECTORY_UNAVAILABLE",
              message: "Google Ads accounts could not be fully verified. Check account access, API approval and provider limits, then retry. Existing selections are unchanged.",
            });
            assert.equal(calls.length, index + 1, "Redirects must not trigger another outbound request");
            for (const call of calls) assert.equal(call.url, `https://googleads.googleapis.com/v25/${call.phase === "list" ? "customers:listAccessibleCustomers" : `${manager}/googleAds:search`}`);
          });
        }
      }
    }
  } finally { await mf.dispose(); }
});

test("marketing reports run in Workers and reject redirects without forwarding authorization", async () => {
  const bundle = await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    tsconfigRaw: { compilerOptions: { target: "ESNext" } },
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
      import { fetchMarketingReport } from "./server/integrations/marketing-reporting";
      export default { async fetch(request, env) {
        globalThis.__vanteloqEnv = env;
        try { return Response.json(await fetchMarketingReport("fixture-oauth", {
          id: "fixture", provider: "google", dataset: "google_analytics",
          externalResourceRef: "properties/123", scopeKind: "organization", localLocationId: null
        }, "channels", 28, new Date("2026-09-16T00:00:00Z"))); }
        catch (error) { return Response.json({ code: error.code }, { status: 502 }); }
      }};` },
    bundle: true, platform: "browser", format: "esm", write: false, logLevel: "error",
  });
  let redirectStatus = null;
  const calls = [];
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], log: new NoOpLog(),
    outboundService: async (request) => {
      calls.push(request.url);
      assert.equal(request.headers.get("authorization"), "Bearer fixture-oauth");
      if (redirectStatus) return new Response(null, { status: redirectStatus, headers: { Location: "https://credential-sink.invalid/" } });
      return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: "Organic Search" }], metricValues: ["100", "60", "200", "3.5"].map(value => ({ value })) }] }), { headers: { "Content-Type": "application/json" } });
    },
  });
  try {
    const success = await mf.dispatchFetch("https://fixture.invalid/");
    assert.equal(success.status, 200, await success.clone().text());
    assert.equal((await success.json()).totals.sessions, 100);
    for (const status of [300, 301, 302, 303, 304, 307, 308, 399]) {
      redirectStatus = status; calls.length = 0;
      const response = await mf.dispatchFetch("https://fixture.invalid/");
      assert.equal(response.status, 502);
      assert.equal((await response.json()).code, "MARKETING_REPORT_UNAVAILABLE");
      assert.ok(calls.length > 0);
      assert.ok(calls.every(url => url === "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport"));
    }
  } finally { await mf.dispose(); }
});
