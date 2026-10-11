import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironment, context, origin } from "./helpers/retail-worker-fixture.mjs";

test("demo request route enforces its consent boundary, retries unconfirmed delivery and returns a receipt without booking", async () => {
 let worker, environment, dispose;
 const oldFetch = globalThis.fetch;
 const originalFetchSymbol = Symbol.for("vinext.fetchCache.originalFetch");
 const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, originalFetchSymbol);
 const body = {
  purpose: "demo", name: "Demo visitor", email: "visitor@example.com", consent: true,
  noticeVersion: "demo-request-v1", consentSubmittedAt: new Date().toISOString(),
  submissionId: "11111111-1111-4111-8111-111111111111", website: "", token: "first-demo-token",
 };
 let address = 10, providerStatus = 200, verification = { success: true, hostname: "vanteloq.example", action: "custom-plan" };
 const attempts = [], tokens = [], fixtureErrors = [], receipts = new Map();
 const post = (data = body, headers = {}) => worker.fetch(new Request(origin + "/api/v1/custom-plan", {
  method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "cf-connecting-ip": `192.0.2.${address++}`, ...headers },
  body: JSON.stringify(data),
 }), environment, context);
 try {
  globalThis.fetch = async (input, init) => {
   try {
   // The compiled framework may forward a Request rather than fetch(url, init).
   // Normalize both forms while allowing only the two prepared provider endpoints.
   const outbound = new Request(input, init), url = outbound.url;
   assert.equal(outbound.method, "POST");
   const payload = await outbound.text();
   if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    const proof = JSON.parse(payload);
    assert.equal(proof.secret, "captcha-secret");
    tokens.push(proof.response);
    return Response.json(verification);
   }
   assert.equal(url, "https://api.resend.com/emails", "Only fixture verification and delivery endpoints may be requested");
   const message = JSON.parse(payload), key = outbound.headers.get("Idempotency-Key");
   assert.deepEqual(message.to, ["private-owner@example.com"]);
   assert.equal(message.reply_to, body.email);
   assert.equal(message.subject, "Vanteloq free demo request");
   assert.ok(message.text.includes(body.consentSubmittedAt));
   assert.match(message.text, /demo-request-v1/);
   assert.match(message.text, /not marketing enrollment/);
   assert.match(message.text, /No appointment, subscription or payment was created/);
   assert.doesNotMatch(message.text, /first-demo-token|fresh-demo-token|captcha-secret|fixture-secret/);
   attempts.push({ body: payload, key });
   if (providerStatus !== 200) return Response.json({ error: "PRIVATE PROVIDER DETAIL fixture-secret" }, { status: providerStatus });
   if (receipts.has(key)) assert.equal(receipts.get(key).body, payload, "A repeated provider key must use the identical email payload");
   else receipts.set(key, { body: payload, id: `fixture-receipt-${receipts.size + 1}` });
   return Response.json({ id: receipts.get(key).id });
   } catch (error) {
    fixtureErrors.push(error);
    throw error;
   }
  };
  // Vinext captures the original fetch while importing the compiled Worker.
  // Install the provider fixture before that import, rather than after startup.
  ({ worker, environment, dispose } = await createEnvironment());
  Object.assign(environment, {
   RESEND_API_KEY: "fixture-secret", CUSTOM_PLAN_INQUIRY_TO: "private-owner@example.com",
   TURNSTILE_SITE_KEY: "public-key", TURNSTILE_SECRET_KEY: "captcha-secret", TURNSTILE_ALLOWED_HOSTNAMES: "vanteloq.example",
  });
  const config = await worker.fetch(new Request(origin + "/api/v1/custom-plan"), environment, context);
  assert.equal(config.status, 200);
  assert.match(config.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await config.json(), { configured: true, siteKey: "public-key", action: "custom-plan" });
  assert.equal((await post(body, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await post({ ...body, needs: "x".repeat(17000) })).status, 413);
  for (const changes of [
   { consent: false }, { consent: "true" }, { noticeVersion: "custom-plan-contact-v1" }, { purpose: "newsletter" },
   { to: "attacker@example.com" }, { address: "Unnecessary personal data" }, { marketingConsent: true },
   { name: "" }, { email: "name@example.com\nBcc: attacker@example.com" }, { needs: "x".repeat(3001) },
   { consentSubmittedAt: "2026-01-01T00:00:00.000Z" },
  ]) assert.equal((await post({ ...body, ...changes })).status, 400, JSON.stringify(changes));
  assert.equal(attempts.length, 0);
  for (const changes of [{ hostname: "attacker.example" }, { action: "demo" }, { success: false }]) {
   verification = { success: true, hostname: "vanteloq.example", action: "custom-plan", ...changes };
   const before = tokens.length, checked = await post();
   assert.equal(fixtureErrors.length, 0, fixtureErrors[0]?.stack);
   assert.equal(tokens.length, before + 1, "The compiled route must reach the Turnstile provider fixture");
   assert.equal(checked.status, 400, await checked.clone().text());
   assert.equal(attempts.length, 0);
  }
  verification = { success: true, hostname: "vanteloq.example", action: "custom-plan" };
  providerStatus = 503;
  const failed = await post();
  assert.equal(failed.status, 502);
  const failure = await failed.json();
  assert.equal(failure.error.code, "INQUIRY_DELIVERY_UNCONFIRMED");
  assert.match(failure.error.message, /details are still in the form/);
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE PROVIDER DETAIL|fixture-secret|private-owner/);
  providerStatus = 200;
  const successful = await post({ ...body, token: "fresh-demo-token" });
  assert.equal(successful.status, 202, await successful.clone().text());
  assert.deepEqual(await successful.json(), { sent: true, reference: body.submissionId });
  assert.equal(attempts[0].key, attempts[1].key);
  assert.equal(attempts[0].body, attempts[1].body);
  assert.equal(tokens.at(-1), "fresh-demo-token");
  for (let i = 0; i < 5; i++) assert.equal((await post(body, { "cf-connecting-ip": "192.0.2.200" })).status, 202);
  assert.equal((await post(body, { "cf-connecting-ip": "192.0.2.200" })).status, 429);
  assert.equal(receipts.size, 1, "Provider deduplication retains a single confirmed demo message");
  const page = await worker.fetch(new Request(origin + "/book-demo", { headers: { accept: "text/html" } }), environment, context);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /See how Vanteloq fits your business/);
  assert.match(html, /schedule a Vanteloq demo/);
  assert.doesNotMatch(html, /private-owner@example\.com|fixture-secret|captcha-secret|first-demo-token|appointment is booked/);
 } finally {
  try { if (dispose) await dispose(); }
  finally {
   globalThis.fetch = oldFetch;
   if (originalFetchDescriptor) Object.defineProperty(globalThis, originalFetchSymbol, originalFetchDescriptor);
   else Reflect.deleteProperty(globalThis, originalFetchSymbol);
  }
 }
});
