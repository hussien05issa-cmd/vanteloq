import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, NoOpLog, Response } from "miniflare";

// Exercise native workerd fetch, whose redirect modes differ from Node mocks.
test("Microsoft OAuth and selected-file metadata work in Workers without forwarding credentials to redirects", async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    absWorkingDir: root, tsconfigRaw: { compilerOptions: { target: "ESNext" } },
    stdin: { resolveDir: root, contents: `
      import { beginCloudAuthorization, finishCloudAuthorization, cloudFileMetadata } from "./server/linked-files";
      import { encryptIntegrationSecret } from "./server/integrations/lightspeed";
      export default { async fetch(request, env) {
        globalThis.__vanteloqEnv = env;
        try {
          const operation = new URL(request.url).pathname;
          if (operation === "/authorize") return Response.json(await beginCloudAuthorization({ organizationId: "organization", userId: "owner", authSubject: "subject" }, "microsoft-files"));
          if (operation === "/callback") return await finishCloudAuthorization(request, "microsoft-files");
          const connection = { provider: "microsoft-files", token_ciphertext: await encryptIntegrationSecret(JSON.stringify({ access: "fictional-access", refresh: "fictional-refresh", expires: Math.floor(Date.now()/1000)+3600 })) };
          return Response.json(await cloudFileMetadata(connection, "fictional-file"));
        }
        catch (error) { return Response.json({ code: error.code, name: error.name, message: error.message }, { status: error.status || 500 }); }
      }};` },
    bundle: true, platform: "browser", format: "esm", write: false, logLevel: "error",
  });
  let providerStatus = 200;
  const calls = [];
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, log: new NoOpLog(),
    compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    bindings: { MICROSOFT_FILES_ENABLED: "true", MICROSOFT_FILES_CLIENT_ID: "fictional-client", MICROSOFT_FILES_CLIENT_SECRET: "fictional-secret", INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") },
    // Every outbound request is intercepted. No Microsoft traffic or real data.
    outboundService: async (request) => {
      calls.push({ url: request.url, authorization: request.headers.get("authorization") });
      if (providerStatus !== 200) return new Response(null, { status: providerStatus, headers: { Location: "https://credential-sink.invalid/" } });
      if (new URL(request.url).hostname === "login.microsoftonline.com") return Response.json({ access_token: "fictional-access", refresh_token: "fictional-refresh", expires_in: 3600 });
      return Response.json({ id: "fictional-file", name: "Fictional.docx", file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, eTag: "revision-1" });
    },
  });
  try {
    const db = await mf.getD1Database("DB");
    await db.exec("CREATE TABLE cloud_file_connections(id TEXT PRIMARY KEY,organization_id TEXT,user_id TEXT,auth_subject TEXT,provider TEXT,state_hash TEXT,state_expires_at INTEGER,verifier_ciphertext TEXT,token_ciphertext TEXT,consumed_at INTEGER,status TEXT DEFAULT 'pending',created_at INTEGER,updated_at INTEGER); CREATE TABLE users(id TEXT,status TEXT,auth_subject TEXT); CREATE TABLE memberships(user_id TEXT,organization_id TEXT,status TEXT,role TEXT); CREATE TABLE account_deletion_jobs(stage TEXT,user_id TEXT,scope TEXT,organization_id TEXT); INSERT INTO users VALUES('owner','active','subject'); INSERT INTO memberships VALUES('owner','organization','active','owner');");
    await t.test("reads selected Word metadata with native Worker fetch", async () => {
      const response = await mf.dispatchFetch("https://fixture.invalid/metadata");
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).kind, "document");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].authorization, "Bearer fictional-access");
    });
    for (const status of [301, 302, 303, 307, 308, 401, 429, 500]) {
      await t.test(`rejects metadata response ${status} before forwarding the token`, async () => {
        providerStatus = status; calls.length = 0;
        const response = await mf.dispatchFetch("https://fixture.invalid/metadata");
        assert.equal(response.status, status === 401 ? 409 : 502, await response.clone().text());
        assert.equal((await response.json()).code, status === 401 ? "FILE_RECONNECT_REQUIRED" : "FILE_PROVIDER_UNAVAILABLE");
        assert.equal(calls.length, 1);
        assert.equal(new URL(calls[0].url).hostname, "graph.microsoft.com");
      });
    }
    for (const status of [200, 302, 401]) {
      await t.test(`authorization-code exchange handles token response ${status} in native Worker fetch`, async () => {
        providerStatus = status; calls.length = 0;
        const started = await mf.dispatchFetch("https://fixture.invalid/authorize");
        assert.equal(started.status, 200, await started.clone().text());
        const { authorizationUrl, cookie } = await started.json();
        const state = new URL(authorizationUrl).searchParams.get("state");
        const response = await mf.dispatchFetch(`https://fixture.invalid/callback?state=${state}&code=fictional-code`, { redirect: "manual", headers: { cookie: cookie.split(";")[0] } });
        assert.equal(response.status, status === 200 ? 303 : status === 401 ? 409 : 502, await response.clone().text());
        if (status !== 200) assert.equal((await response.json()).code, status === 401 ? "FILE_RECONNECT_REQUIRED" : "FILE_PROVIDER_UNAVAILABLE");
        assert.equal(calls.length, 1);
        assert.equal(new URL(calls[0].url).hostname, "login.microsoftonline.com");
      });
    }
  } finally { await mf.dispose(); }
});
