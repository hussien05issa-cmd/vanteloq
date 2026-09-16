import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { createEnvironment, context, origin, identityHeaders, onboardingBody } from "./helpers/retail-worker-fixture.mjs";

test("built Worker keeps optional newsletter consent separate and enforces identity, origin and unsubscribe boundaries", { concurrency: false }, async t => {
  const unverified = new Set();
  const identityRequests = [];
  const { worker, environment, database, dispose } = await createEnvironment({
    authResponse({ request, payload, user }) {
      // Editable metadata deliberately lies about verification and marketing.
      // Only the identity provider's confirmed timestamp can verify this email.
      const body = unverified.has(payload.email)
        ? { id: user.id, email: user.email, user_metadata: { ...user.user_metadata, email_verified: true, marketing_consent: true } }
        : user;
      identityRequests.push({
        method: request.method,
        path: request.url,
        email: body.email,
        verified: typeof body.email_confirmed_at === "string" || typeof body.confirmed_at === "string",
      });
      return body;
    },
  });
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `newsletter-${suffix}@example.invalid`;
  const other = `newsletter-${suffix}+other@example.invalid`;
  Object.assign(environment, {
    // Fictional fixture key only. The production key and provider accounts are never read.
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
    NEWSLETTER_ENROLLMENT_ENABLED: "false",
    NEWSLETTER_SENDER_POSTAL_ADDRESS: "",
  });
  const send = (path, { method = "GET", account, body, cookie, headers: changes = {} } = {}) => {
    const write = method !== "GET";
    const headers = account ? identityHeaders(account, "Newsletter fixture", write) : { accept: "application/json", ...(write ? { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" } : {}) };
    Object.assign(headers, { "cf-connecting-ip": "192.0.2.41", "user-agent": "newsletter-route-fixture" }, changes);
    if (cookie) headers.cookie = cookie;
    return worker.fetch(new Request(origin + path, { method, headers, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) }), environment, context);
  };
  const snapshot = async () => {
    const result = {};
    for (const table of ["marketing_email_intents", "marketing_email_preferences", "marketing_email_events", "marketing_email_unsubscribe_tokens"]) {
      result[table] = (await database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results;
    }
    return result;
  };
  const readPreference = async account => {
    const response = await send("/api/v1/communications/preferences", { account });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  let config;
  let cookie;
  try {
    await t.test("disabled newsletter configuration does not block normal workspace onboarding", async () => {
      const response = await send("/api/v1/communications/config");
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      const disabled = await response.json();
      assert.equal(disabled.available, false);
      assert.equal(disabled.postalAddress, null);
      const before = await snapshot();
      const unavailable = await send("/api/v1/communications/signup-intent", { method: "POST", body: { email, selected: true, noticeVersion: disabled.noticeVersion, noticeHash: disabled.noticeHash } });
      assert.equal(unavailable.status, 503);
      assert.deepEqual(await snapshot(), before);
      const onboarding = await send("/api/v1/onboarding", { method: "POST", account: email, body: onboardingBody("Newsletter Fixture", `Newsletter Fixture ${suffix}`) });
      assert.equal(onboarding.status, 201, await onboarding.clone().text());
      const saved = await database.prepare("SELECT u.id, p.email_notifications FROM users u JOIN account_preferences p ON p.user_id = u.id WHERE u.email = ?").bind(email).first();
      assert.ok(saved?.id);
      assert.equal(saved.email_notifications, 1, "Operational notifications retain their existing independent choice");
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM marketing_email_preferences").first()).count, 0);
    });

    await t.test("public draft capture sets a host-only secure cookie and does not enroll an unverified address", async () => {
      environment.NEWSLETTER_ENROLLMENT_ENABLED = "true";
      environment.NEWSLETTER_SENDER_POSTAL_ADDRESS = "PO Box 123, Edmonton, AB T5J 2G8, Canada";
      const response = await send("/api/v1/communications/config");
      config = await response.json();
      assert.equal(config.available, true);
      assert.equal(config.contactUrl, "https://vanteloq.com/contact");
      assert.deepEqual(Object.keys(config).sort(), ["available", "noticeVersion", "noticeHash", "senderName", "postalAddress", "contactUrl", "purpose", "withdrawal"].sort());
      const draft = await send("/api/v1/communications/signup-intent", { method: "POST", body: { email: ` ${email.toUpperCase()} `, selected: true, noticeVersion: config.noticeVersion, noticeHash: config.noticeHash } });
      assert.equal(draft.status, 200, await draft.clone().text());
      assert.deepEqual(await draft.json(), { saved: true, pendingEmailVerification: true });
      const setCookie = draft.headers.get("set-cookie");
      assert.match(setCookie ?? "", /^__Host-vanteloq_marketing_intent=[a-f0-9]{64};/);
      assert.match(setCookie, /Path=\//); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Secure/); assert.doesNotMatch(setCookie, /Domain=/i);
      cookie = setCookie.split(";", 1)[0];
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM marketing_email_preferences").first()).count, 0);
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM marketing_email_intents").first()).count, 1);
    });

    await t.test("cross-origin, wrong-email, absent-cookie and unverified claims leave consent unchanged", async () => {
      const before = await snapshot();
      const cross = await send("/api/v1/communications/signup-intent", { method: "POST", account: email, cookie, body: { action: "claim" }, headers: { origin: "https://attacker.example.invalid", "sec-fetch-site": "cross-site" } });
      assert.equal(cross.status, 403);
      assert.deepEqual(await snapshot(), before);
      unverified.add(email);
      const beforeDeniedRequests = identityRequests.length;
      const denied = await send("/api/v1/communications/signup-intent", { method: "POST", account: email, cookie, body: { action: "claim" } });
      assert.equal(denied.status, 401, await denied.clone().text());
      assert.ok(identityRequests.slice(beforeDeniedRequests).some(request => request.path === "/auth/v1/user" && request.email === email && request.verified === false), "The actual HTTP identity fixture returned an unverified email to the built Worker");
      assert.deepEqual(await snapshot(), before, "Metadata cannot bypass verified email or mutate the draft");
      unverified.delete(email);
      const wrong = await send("/api/v1/communications/signup-intent", { method: "POST", account: other, cookie, body: { action: "claim" } });
      assert.equal(wrong.status, 200); assert.equal((await wrong.json()).subscribed, false);
      assert.deepEqual(await snapshot(), before);
      const absent = await send("/api/v1/communications/signup-intent", { method: "POST", account: email, body: { action: "claim" } });
      assert.equal(absent.status, 200); assert.equal((await absent.json()).subscribed, false);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("only the verified matching email can claim the saved signup choice", async () => {
      const claimed = await send("/api/v1/communications/signup-intent", { method: "POST", account: email, cookie, body: { action: "claim" } });
      assert.equal(claimed.status, 200, await claimed.clone().text());
      const result = await claimed.json();
      assert.equal(result.status, "subscribed"); assert.equal(result.chosen, true);
      assert.match(claimed.headers.get("set-cookie") ?? "", /Max-Age=0/);
      const stored = await database.prepare("SELECT * FROM marketing_email_preferences WHERE current_event_id = ?").bind(result.revision).first();
      assert.equal(stored.status, "subscribed"); assert.ok(stored.email_encrypted); assert.ok(!stored.email_encrypted.includes(email));
      const event = await database.prepare("SELECT * FROM marketing_email_events WHERE id = ?").bind(result.revision).first();
      assert.equal(event.source, "signup_verified"); assert.equal(event.action, "subscribed"); assert.ok(event.intent_at <= event.occurred_at);
      assert.equal((await readPreference(other)).subscribed, false);
      assert.equal((await database.prepare("SELECT COUNT(*) count FROM marketing_email_intents").first()).count, 0);
    });

    await t.test("Settings opt-out is personal, requires same origin and preserves operational notifications", async () => {
      const current = await readPreference(email);
      const choice = { selected: false, source: "settings", revision: current.revision, noticeVersion: config.noticeVersion, noticeHash: config.noticeHash };
      const before = await snapshot();
      const rejected = await send("/api/v1/communications/preferences", { method: "POST", account: email, body: choice, headers: { origin: "https://attacker.example.invalid", "sec-fetch-site": "cross-site" } });
      assert.equal(rejected.status, 403); assert.deepEqual(await snapshot(), before);
      const forged = await send("/api/v1/communications/preferences", { method: "POST", account: other, body: { ...choice, email } });
      assert.equal(forged.status, 400); assert.deepEqual(await snapshot(), before);
      const saved = await send("/api/v1/communications/preferences", { method: "POST", account: email, body: choice });
      assert.equal(saved.status, 200, await saved.clone().text());
      assert.equal((await saved.json()).status, "unsubscribed");
      const account = await database.prepare("SELECT p.email_notifications FROM account_preferences p JOIN users u ON u.id = p.user_id WHERE u.email = ?").bind(email).first();
      assert.equal(account.email_notifications, 1);
      const privateRow = await database.prepare("SELECT email_encrypted FROM marketing_email_preferences").first();
      assert.equal(privateRow.email_encrypted, null);
    });

    await t.test("GET cannot unsubscribe or disclose a recipient; public capability POST works without sign-in", async () => {
      const current = await readPreference(email);
      const enabled = await send("/api/v1/communications/preferences", { method: "POST", account: email, body: { selected: true, source: "settings", revision: current.revision, noticeVersion: config.noticeVersion, noticeHash: config.noticeHash } });
      assert.equal(enabled.status, 200, await enabled.clone().text());
      const revision = (await enabled.json()).revision;
      const row = await database.prepare("SELECT email_hash FROM marketing_email_preferences WHERE current_event_id = ?").bind(revision).first();
      // The feature intentionally has no public token-minting or campaign route.
      // Seed one synthetic receipt to test the built public capability boundary.
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(`marketing-unsubscribe:${token}`).digest("hex");
      const now = Math.floor(Date.now() / 1000);
      await database.prepare("INSERT INTO marketing_email_unsubscribe_tokens (token_hash,email_hash,created_at,expires_at) VALUES (?,?,?,?)").bind(tokenHash, row.email_hash, now, now + 400 * 86400).run();
      const before = await snapshot();
      const anonymous = await send("/api/v1/communications/preferences");
      assert.equal(anonymous.status, 401); assert.doesNotMatch(await anonymous.text(), new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      const get = await send(`/api/v1/communications/unsubscribe?token=${token}`);
      assert.equal(get.status, 405, await get.clone().text());
      const landing = await send(`/email/unsubscribe?token=${token}`);
      assert.equal(landing.status, 200, await landing.clone().text());
      const html = await landing.text();
      assert.ok(!html.includes(email)); assert.ok(!html.includes(row.email_hash)); assert.ok(!html.includes(environment.INTEGRATION_ENCRYPTION_KEY));
      assert.match(html, /noindex/); assert.match(html, /no-referrer/);
      assert.deepEqual(await snapshot(), before, "GET and HTML prefetch must not mutate consent");
      environment.NEWSLETTER_ENROLLMENT_ENABLED = "false";
      const done = await send("/api/v1/communications/unsubscribe", { method: "POST", body: { token } });
      assert.equal(done.status, 200, await done.clone().text()); assert.deepEqual(await done.json(), { unsubscribed: true });
      assert.equal((await readPreference(email)).subscribed, false);
      const replay = await send(`/api/v1/communications/unsubscribe?token=${token}`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://mail-client.example.invalid", "sec-fetch-site": "cross-site" } });
      assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), { unsubscribed: true });
      assert.equal((await readPreference(email)).status, "unsubscribed");
      const after = await snapshot();
      const invalid = await send("/api/v1/communications/unsubscribe", { method: "POST", body: { token: "0".repeat(64) } });
      assert.equal(invalid.status, 400); assert.deepEqual(await snapshot(), after);
    });
    assert.ok(identityRequests.some(request => request.email === email && request.verified), "The build exercised the actual local HTTP verified identity boundary");
    assert.ok(identityRequests.every(request => request.method === "GET" && request.path === "/auth/v1/user"), "The local identity server received only its expected user lookups");
  } finally { await dispose(); }
});
