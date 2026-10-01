import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createEnvironment, createReportWorkspace, dispatch, origin, context } from "./helpers/retail-worker-fixture.mjs";

// Built-route coverage with synthetic Microsoft responses and local D1 only.
// Native fetch compatibility is covered separately by the Worker runtime test.
test("Microsoft linked files enforce consent and import only selected files into quarantine", { timeout: 120000 }, async (t) => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const originalFetch = globalThis.fetch;
  const calls = [], writes = [];
  const officeFiles = {
    word: { name: "Fictional.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    excel: { name: "Fictional.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    slides: { name: "Fictional.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    pdf: { name: "Fictional.pdf", mimeType: "application/pdf" },
    unsupported: { name: "Fictional.exe", mimeType: "application/octet-stream" },
  };
  let revision = 1, downloadLocation = "https://fictional.sharepoint.com/download", downloadMode = "pdf", cancelled = false, produced = 0;
  const env = {
    ...environment, MICROSOFT_FILES_ENABLED: "true", MICROSOFT_FILES_CLIENT_ID: "fictional-client",
    MICROSOFT_FILES_CLIENT_SECRET: "fictional-secret", INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
    BUCKET: { put: async (key, bytes, options) => writes.push({ key, bytes, options }), delete: async () => {} },
  };
  try {
    const providerFetch = async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      // The only passthrough is the fixture's registered loopback identity server.
      if (url.origin === environment.SUPABASE_URL) return originalFetch(input, init);
      calls.push({ url: request.url, authorization: request.headers.get("authorization"), redirect: request.redirect });
      if (url.origin === "https://login.microsoftonline.com" && url.pathname === "/common/oauth2/v2.0/token") {
        calls.at(-1).form = new URLSearchParams(await request.text());
        return Response.json({ access_token: "fictional-access", refresh_token: "fictional-refresh", expires_in: 3600 });
      }
      if (url.origin === "https://graph.microsoft.com") {
        assert.equal(request.headers.get("authorization"), "Bearer fictional-access");
        if (url.pathname.endsWith("/children")) return Response.json({ value: Object.entries(officeFiles).map(([id, file]) => ({ id, name: file.name, file: { mimeType: file.mimeType } })) });
        const match = /^\/v1.0\/me\/drive\/items\/(word|excel|slides|pdf|unsupported)(\/content)?$/.exec(url.pathname);
        assert.ok(match, `Unexpected Graph request: ${request.url}`);
        if (match[2]) return new Response(null, { status: 302, headers: { Location: downloadLocation } });
        const file = officeFiles[match[1]];
        return Response.json({ id: match[1], name: file.name, file: { mimeType: file.mimeType }, eTag: `revision-${revision}` });
      }
      if (["fictional.sharepoint.com", "fictional.1drv.com", "fictional.onedrive.com"].includes(url.hostname)) {
        assert.equal(request.headers.get("authorization"), null, "Signed downloads must not receive the Graph bearer token");
        if (downloadMode === "redirect") return new Response(null, { status: 302, headers: { Location: "https://credential-sink.invalid/download" } });
        if (downloadMode === "declared-large") return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": String(10 * 1024 * 1024 + 1) } });
        if (downloadMode === "streamed-large") return new Response(new ReadableStream({
          pull(controller) { produced += 1024 * 1024; controller.enqueue(new Uint8Array(1024 * 1024)); },
          cancel() { cancelled = true; },
        }));
        return new Response(`%PDF-1.4\nFictional selected file revision ${revision}\n%%EOF`, { headers: { "content-type": "application/pdf" } });
      }
      throw new Error(`Unexpected external request blocked: ${request.url}`);
    };
    const { owner, userId, organizationId } = await createReportWorkspace(worker, env, database, "microsoft-files");
    await database.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES (?,?,'bookloq','active',?,?)").bind(crypto.randomUUID(), organizationId, Date.now(), Date.now()).run();
    // Install after initial route setup, which initializes the framework fetch wrapper.
    globalThis.fetch = providerFetch;
    const post = (body, runtime = env) => dispatch(worker, runtime, "/api/v1/linked-files", { method: "POST", ...owner, body });
    const authorize = { action: "authorize", provider: "microsoft-files", accepted: true, noticeVersion: "linked-files-2026-09-26" };
    const expectError = async (response, status, code) => {
      assert.equal(response.status, status, await response.clone().text());
      assert.equal((await response.json()).error.code, code);
    };

    await t.test("configuration stays unavailable until the gate and required credentials are present", async () => {
      for (const override of [{ MICROSOFT_FILES_ENABLED: "false" }, { MICROSOFT_FILES_CLIENT_SECRET: "" }, { INTEGRATION_ENCRYPTION_KEY: "" }, {}]) {
        const response = await dispatch(worker, { ...env, ...override }, "/api/v1/linked-files", owner);
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal((await response.json()).providers.find(item => item.provider === "microsoft-files").available, Object.keys(override).length === 0);
      }
      await expectError(await post(authorize, { ...env, MICROSOFT_FILES_ENABLED: "false" }), 503, "FILE_CONNECTOR_SETUP_REQUIRED");
      assert.equal(calls.length, 0);
    });
    await t.test("current explicit consent is required before creating OAuth state", async () => {
      await expectError(await post({ ...authorize, accepted: false }), 400, "FILE_CONSENT_REQUIRED");
      await expectError(await post({ ...authorize, noticeVersion: "stale-notice" }), 400, "FILE_CONSENT_REQUIRED");
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM cloud_file_connections WHERE user_id=?").bind(userId).first()).count, 0);
      assert.equal(calls.length, 0);
    });

    const started = await post(authorize);
    assert.equal(started.status, 200, await started.clone().text());
    const authorization = new URL((await started.json()).authorizationUrl), state = authorization.searchParams.get("state");
    const cookie = started.headers.get("set-cookie").split(";")[0];
    const callbackUrl = `${origin}/api/v1/linked-files/microsoft-files/callback?state=${state}&code=fictional-code`;
    const callback = (browserCookie) => worker.fetch(new Request(callbackUrl, { headers: browserCookie ? { cookie: browserCookie } : {} }), env, context);
    let connection;
    await t.test("read-only scopes, PKCE, browser state, expiry and one-time callback are enforced", async () => {
      assert.equal(authorization.origin + authorization.pathname, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
      assert.equal(authorization.searchParams.get("scope"), "offline_access Files.Read");
      assert.equal(authorization.searchParams.get("redirect_uri"), "https://vanteloq.com/api/v1/linked-files/microsoft-files/callback");
      assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
      assert.equal(authorization.searchParams.get("prompt"), "select_account");
      assert.match(started.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
      const pending = await database.prepare("SELECT * FROM cloud_file_connections WHERE user_id=?").bind(userId).first();
      assert.equal(pending.state_hash, createHash("sha256").update(state).digest("hex"));
      assert.notEqual(pending.verifier_ciphertext, authorization.searchParams.get("code_challenge"));
      await expectError(await callback(), 400, "OAUTH_BROWSER_BINDING_INVALID");
      await expectError(await callback(cookie.replace(state, "a".repeat(43))), 400, "OAUTH_BROWSER_BINDING_INVALID");
      await database.prepare("UPDATE cloud_file_connections SET state_expires_at=0 WHERE id=?").bind(pending.id).run();
      await expectError(await callback(cookie), 400, "FILE_OAUTH_EXPIRED");
      await database.prepare("UPDATE cloud_file_connections SET state_expires_at=? WHERE id=?").bind(pending.state_expires_at, pending.id).run();
      assert.equal(calls.length, 0);
      assert.equal(globalThis.fetch, providerFetch);
      const finished = await callback(cookie);
      assert.equal(finished.status, 303, await finished.clone().text());
      assert.match(finished.headers.get("set-cookie"), /Max-Age=0/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].form.get("grant_type"), "authorization_code");
      assert.equal(calls[0].form.get("redirect_uri"), authorization.searchParams.get("redirect_uri"));
      assert.equal(createHash("sha256").update(calls[0].form.get("code_verifier")).digest("base64url"), authorization.searchParams.get("code_challenge"));
      await expectError(await callback(cookie), 400, "FILE_OAUTH_EXPIRED");
      assert.equal(calls.length, 1, "Replayed callbacks must not exchange another token");
      connection = await database.prepare("SELECT * FROM cloud_file_connections WHERE id=?").bind(pending.id).first();
      assert.equal(connection.status, "connected");
      assert.equal(connection.verifier_ciphertext, "");
      assert.ok(!connection.token_ciphertext.includes("fictional-access"));
    });
    assert.ok(connection, "OAuth must complete before testing selected files");

    let selectedId;
    await t.test("listing does not import files and unsupported selections cannot be attached", async () => {
      const listing = await dispatch(worker, env, `/api/v1/linked-files?connection=${connection.id}`, owner);
      assert.equal(listing.status, 200, await listing.clone().text());
      assert.deepEqual((await listing.json()).files.map(file => file.id), ["word", "excel", "slides", "pdf"]);
      await expectError(await post({ action: "attach", connectionId: connection.id, remoteId: "unsupported" }), 400, "LINKED_FILE_UNSUPPORTED");
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM linked_files WHERE user_id=?").bind(userId).first()).count, 0);
      assert.equal(writes.length, 0);
    });
    for (const [index, remoteId] of ["word", "excel", "slides", "pdf"].entries()) {
      await t.test(`${remoteId} selection imports only a quarantined PDF without forwarding authorization`, async () => {
        revision++;
        downloadLocation = `https://${["fictional.sharepoint.com", "fictional.1drv.com", "fictional.onedrive.com", "fictional.sharepoint.com"][index]}/download`;
        const attached = await post({ action: "attach", connectionId: connection.id, remoteId });
        assert.equal(attached.status, 200, await attached.clone().text());
        const selected = await database.prepare("SELECT id,kind FROM linked_files WHERE connection_id=? AND remote_id=?").bind(connection.id, remoteId).first();
        assert.equal(selected.kind, "document");
        if (remoteId === "word") selectedId = selected.id;
        const before = calls.length;
        const refreshed = await post({ action: "refresh", id: selected.id });
        assert.equal(refreshed.status, 200, await refreshed.clone().text());
        const body = await refreshed.json();
        assert.equal(body.updated, true);
        const requests = calls.slice(before);
        assert.equal(requests.length, 3, "Read only the selected metadata, content and approved download");
        assert.equal(new URL(requests[1].url).search, remoteId === "pdf" ? "" : "?format=pdf");
        assert.equal(requests[1].authorization, "Bearer fictional-access");
        assert.equal(requests[2].authorization, null);
        assert.equal(requests[2].redirect, "manual");
        const document = await database.prepare("SELECT content_type,security_state,scan_status,extraction_status FROM workspace_documents WHERE id=?").bind(body.documentId).first();
        assert.deepEqual(document, { content_type: "application/pdf", security_state: "quarantined", scan_status: "pending", extraction_status: "not_configured" });
        assert.equal(writes.length, index + 1);
      });
    }
    for (const location of ["http://fictional.sharepoint.com/download", "https://fictional.sharepoint.com.evil.invalid/download", "https://token@fictional.sharepoint.com/download", "https://fictional.sharepoint.com:444/download", "", "/relative-download"]) {
      await t.test(`rejects unverified download location ${location || "(missing)"}`, async () => {
        revision++; downloadLocation = location;
        await database.prepare("UPDATE linked_files SET last_checked_at=0 WHERE id=?").bind(selectedId).run();
        const before = calls.length;
        await expectError(await post({ action: "refresh", id: selectedId }), 502, "FILE_DOWNLOAD_UNVERIFIED");
        assert.equal(calls.length - before, 2, "The rejected destination must receive no request");
        assert.equal(writes.length, 4);
      });
    }
    for (const mode of ["redirect", "declared-large", "streamed-large"]) {
      await t.test(`rejects ${mode} download and preserves the previous document`, async () => {
        revision++; downloadLocation = "https://fictional.sharepoint.com/download"; downloadMode = mode; cancelled = false; produced = 0;
        const before = await database.prepare("SELECT revision,document_id FROM linked_files WHERE id=?").bind(selectedId).first();
        await database.prepare("UPDATE linked_files SET last_checked_at=0 WHERE id=?").bind(selectedId).run();
        const callsBefore = calls.length;
        await expectError(await post({ action: "refresh", id: selectedId }), mode === "redirect" ? 502 : 413, mode === "redirect" ? "FILE_EXPORT_FAILED" : "LINKED_FILE_TOO_LARGE");
        assert.equal(calls.length - callsBefore, 3, "A second redirect must not be followed");
        if (mode !== "redirect") assert.equal(cancelled, true);
        if (mode === "streamed-large") assert.ok(produced <= 12 * 1024 * 1024, "Stop reading after the oversized chunk and at most one queued chunk");
        const after = await database.prepare("SELECT revision,document_id,lease,error_code FROM linked_files WHERE id=?").bind(selectedId).first();
        assert.equal(after.document_id, before.document_id);
        assert.equal(after.revision, before.revision);
        assert.equal(after.lease, null);
        assert.equal(writes.length, 4);
      });
    }
    assert.equal((await database.prepare("SELECT COUNT(*) count FROM journal_entries WHERE organization_id=?").bind(organizationId).first()).count, 0);
  } finally { globalThis.fetch = originalFetch; await dispose(); }
});
