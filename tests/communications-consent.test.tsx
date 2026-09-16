import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingChoice } from "../app/marketing-consent";
import { type VanteloqRuntimeEnv } from "../db";
import { type TrustedIdentity } from "../server/api";
import { claimMarketingIntent, eraseMarketingProfileForSubject, issueMarketingUnsubscribeToken, marketingConfig, marketingEmailEligible, marketingIntentCookie, readMarketingPreference, saveMarketingIntent, setMarketingPreference, suppressMarketingEmail, unsubscribeMarketingEmail } from "../server/communications";

const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
const identity = (name: string): TrustedIdentity => ({ subject: `test-${name}`, provider: "supabase", email: `${name}@example.test`, displayName: name, emailVerified: true, assuranceLevel: "aal1", sessionId: "test-session" });
const request = (token?: string) => new Request("https://vanteloq.com/api/v1/communications/signup-intent", { headers: { origin: "https://vanteloq.com", "user-agent": "consent-fixture", "cf-connecting-ip": "192.0.2.10", ...(token ? { cookie: `__Host-vanteloq_marketing_intent=${token}` } : {}) } });

test("marketing consent is explicit, identity-bound, reversible and separate from signup", { concurrency: false }, async t => {
  const previous = runtime.__vanteloqEnv;
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('fixture'); } };", compatibilityDate: "2026-05-01", d1Databases: { DB: `marketing-consent-${crypto.randomUUID()}` } });
  try {
    const db = await mf.getD1Database("DB");
    const sql = await readFile(new URL("../drizzle/0053_marketing_email_consent.sql", import.meta.url), "utf8");
    await db.batch(sql.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean).map(value => db.prepare(value)));
    await db.prepare("CREATE TABLE rate_limit_buckets (bucket_key TEXT PRIMARY KEY, scope TEXT, actor_hash TEXT, window_start INTEGER, request_count INTEGER, expires_at INTEGER)").run();
    runtime.__vanteloqEnv = { DB: db as unknown as D1Database, INTEGRATION_ENCRYPTION_KEY: btoa("k".repeat(32)), NEWSLETTER_ENROLLMENT_ENABLED: "true", NEWSLETTER_SENDER_POSTAL_ADDRESS: "PO Box 123, Edmonton, AB T5J 2G8, Canada" };
    const config = await marketingConfig();
    const notice = { noticeVersion: config.noticeVersion, noticeHash: config.noticeHash };
    const setChoice = async (who: TrustedIdentity, selected: boolean) => setMarketingPreference(request(), who, { selected, revision: (await readMarketingPreference(who)).revision, source: "settings", ...notice });

    await t.test("new users default off and a missing sender notice disables collection", async () => {
      assert.equal((await readMarketingPreference(identity("empty"))).subscribed, false);
      const savedAddress = runtime.__vanteloqEnv!.NEWSLETTER_SENDER_POSTAL_ADDRESS;
      runtime.__vanteloqEnv!.NEWSLETTER_SENDER_POSTAL_ADDRESS = "";
      assert.equal((await marketingConfig()).available, false);
      await assert.rejects(saveMarketingIntent(request(), { email: identity("empty").email, selected: true, ...notice }), /not available/);
      runtime.__vanteloqEnv!.NEWSLETTER_SENDER_POSTAL_ADDRESS = savedAddress;
    });
    await t.test("checkbox is optional and never preselected or bundled with required terms", () => {
      const html = renderToStaticMarkup(<MarketingChoice config={config} selected={false} change={() => undefined} />);
      assert.match(html, /Optional/); assert.match(html, /type="checkbox"/); assert.doesNotMatch(html, /checked=""|required=""/);
      assert.match(html, /Contact Us/); assert.match(html, /PO Box 123/);
    });
    await t.test("a guessed email or altered Supabase metadata cannot claim another browser's draft", async () => {
      const who = identity("draft");
      const token = await saveMarketingIntent(request(), { email: who.email, selected: true, ...notice });
      assert.equal((await readMarketingPreference(who)).chosen, false);
      assert.equal((await claimMarketingIntent(request(), who)).subscribed, false);
      assert.equal((await claimMarketingIntent(request(token), identity("wrong"))).subscribed, false);
      await assert.rejects(claimMarketingIntent(request(token), { ...who, emailVerified: false }), /Verify your email/);
      const claimed = await claimMarketingIntent(request(token), who);
      assert.equal(claimed.subscribed, true);
      assert.equal((await claimMarketingIntent(request(token), who)).revision, claimed.revision);
      assert.match(marketingIntentCookie(request(), token), /HttpOnly; SameSite=Lax; Secure/);
      const stored = await db.prepare("SELECT email_encrypted FROM marketing_email_preferences WHERE current_event_id = ?").bind(claimed.revision).first<{ email_encrypted: string }>();
      assert.ok(stored?.email_encrypted); assert.ok(!stored.email_encrypted.includes(who.email));
      const event = await db.prepare("SELECT notice_json, intent_at, occurred_at FROM marketing_email_events WHERE id = ?").bind(claimed.revision).first<{notice_json: string; intent_at: number; occurred_at: number}>();
      assert.match(event!.notice_json, /occasional offers/); assert.ok(event!.intent_at <= event!.occurred_at);
    });
    await t.test("skipping signup updates remains off and a replay cannot reverse later withdrawal", async () => {
      const who = identity("declined");
      const token = await saveMarketingIntent(request(), { email: who.email, selected: false, ...notice });
      assert.equal((await claimMarketingIntent(request(token), who)).status, "declined");
      await setChoice(who, true);
      const stale = await saveMarketingIntent(request(), { email: who.email, selected: true, ...notice });
      await setChoice(who, false);
      assert.equal((await claimMarketingIntent(request(stale), who)).subscribed, false);
    });
    await t.test("verified personal updates reject arbitrary recipient fields and stale revisions", async () => {
      const who = identity("personal");
      const before = await readMarketingPreference(who);
      await assert.rejects(setMarketingPreference(request(), who, { selected: true, revision: null, source: "settings", email: "someone@example.test", ...notice }), /Choose whether/);
      await setChoice(who, true); await setChoice(who, false);
      await assert.rejects(setMarketingPreference(request(), who, { selected: true, revision: before.revision, source: "settings", ...notice }), /another session/);
      assert.equal(await marketingEmailEligible(who), false);
    });
    await t.test("unsubscribe is immediate, repeatable, valid beyond 60 days and available while enrollment is disabled", async () => {
      const who = identity("unsubscribe"); await setChoice(who, true);
      const token = await issueMarketingUnsubscribeToken(who);
      const lifetime = await db.prepare("SELECT expires_at - created_at seconds FROM marketing_email_unsubscribe_tokens").first<{ seconds: number }>();
      assert.ok(lifetime!.seconds >= 60 * 86_400);
      runtime.__vanteloqEnv!.NEWSLETTER_ENROLLMENT_ENABLED = "false";
      await unsubscribeMarketingEmail(token); await unsubscribeMarketingEmail(token);
      assert.equal((await readMarketingPreference(who)).subscribed, false);
      runtime.__vanteloqEnv!.NEWSLETTER_ENROLLMENT_ENABLED = "true";
      await setChoice(who, true); await unsubscribeMarketingEmail(token);
      assert.equal(await marketingEmailEligible(who), false);
      await assert.rejects(unsubscribeMarketingEmail("not-a-capability"), /incomplete/);
    });
    await t.test("hard suppression cannot be cleared by an ordinary preference checkbox", async () => {
      const who = identity("bounce"); await setChoice(who, true);
      await suppressMarketingEmail(who.email, "bounce");
      assert.equal(await marketingEmailEligible(who), false);
      await assert.rejects(setChoice(who, true), /paused/);
      assert.equal((await setChoice(who, false)).status, "suppressed");
    });
    await t.test("a verified account email change retires the old address without enrolling the new one", async () => {
      const oldIdentity = identity("before-change"); const saved = await setChoice(oldIdentity, true);
      const original = await db.prepare("SELECT email_hash FROM marketing_email_preferences WHERE current_event_id = ?").bind(saved.revision).first<{email_hash: string}>();
      const currentIdentity = { ...oldIdentity, email: "after-change@example.test" };
      assert.equal((await claimMarketingIntent(request(), currentIdentity)).status, "not_chosen");
      const old = await db.prepare("SELECT status, email_encrypted FROM marketing_email_preferences WHERE email_hash = ?").bind(original!.email_hash).first<{status: string; email_encrypted: string | null}>();
      assert.equal(old!.status, "unsubscribed"); assert.equal(old!.email_encrypted, null);
      assert.equal(await marketingEmailEligible(currentIdentity), false);
    });
    await t.test("repeat withdrawal advances revision and rejects a previously prepared re-subscribe", async () => {
      const who = identity("withdraw-order"); await setChoice(who, true);
      const token = await issueMarketingUnsubscribeToken(who);
      await unsubscribeMarketingEmail(token);
      const stale = await readMarketingPreference(who);
      await unsubscribeMarketingEmail(token);
      await assert.rejects(setMarketingPreference(request(), who, { selected: true, revision: stale.revision, source: "settings", ...notice }), /another session/);
      assert.equal(await marketingEmailEligible(who), false);
    });
    await t.test("account deletion clears recipient and identity data while preserving minimal suppression", async () => {
      const who = identity("delete"); const saved = await setChoice(who, true);
      const marker = await db.prepare("SELECT email_hash FROM marketing_email_preferences WHERE current_event_id = ?").bind(saved.revision).first<{ email_hash: string }>();
      await eraseMarketingProfileForSubject(who.subject!); await eraseMarketingProfileForSubject(who.subject!);
      const row = await db.prepare("SELECT email_encrypted, subject_hash, status FROM marketing_email_preferences WHERE email_hash = ?").bind(marker!.email_hash).first<{email_encrypted: string | null; subject_hash: string | null; status: string}>();
      assert.equal(row!.email_encrypted, null); assert.equal(row!.subject_hash, null); assert.equal(row!.status, "unsubscribed");
      const proof = await db.prepare("SELECT COUNT(*) count FROM marketing_email_events WHERE email_hash = ? AND (subject_hash IS NOT NULL OR source_hash IS NOT NULL OR user_agent_hash IS NOT NULL)").bind(marker!.email_hash).first<{ count: number }>();
      assert.equal(proof!.count, 0); assert.equal(await marketingEmailEligible(who), false);
    });
    await t.test("expiry and a changed notice never activate an old signup draft", async () => {
      const who = identity("expired"); const token = await saveMarketingIntent(request(), { email: who.email, selected: true, ...notice });
      await db.prepare("UPDATE marketing_email_intents SET expires_at = 1").run();
      assert.equal((await claimMarketingIntent(request(token), who)).chosen, false);
      const next = identity("changed"); const newer = await saveMarketingIntent(request(), { email: next.email, selected: true, ...notice });
      runtime.__vanteloqEnv!.NEWSLETTER_SENDER_POSTAL_ADDRESS = "PO Box 456, Edmonton, AB T5J 2G8, Canada";
      assert.equal((await claimMarketingIntent(request(newer), next)).chosen, false);
    });
  } finally { runtime.__vanteloqEnv = previous; await mf.dispose(); }
});
