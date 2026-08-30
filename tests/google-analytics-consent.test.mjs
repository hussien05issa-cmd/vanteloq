import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Google Analytics is gated behind an explicit visitor choice", async () => {
  const [layout, consent] = await Promise.all([
    source("app/layout.tsx"),
    source("app/google-analytics-consent.tsx"),
  ]);

  assert.match(layout, /<GoogleAnalyticsConsent\s*\/>/);
  assert.match(layout, /analytics_storage:\s*["']denied["']/);
  assert.match(layout, /ad_storage:\s*["']denied["']/);
  assert.match(layout, /ad_user_data:\s*["']denied["']/);
  assert.match(layout, /ad_personalization:\s*["']denied["']/);

  assert.match(consent, /NEXT_PUBLIC_GOOGLE_ANALYTICS_ID/);
  assert.match(consent, /PUBLIC_GOOGLE_ANALYTICS_ID/);
  assert.match(consent, /process\.env\.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID\?\.trim\(\) \|\| PUBLIC_GOOGLE_ANALYTICS_ID/);
  assert.match(consent, /\^G-\[A-Z0-9\]\+\$/);
  assert.match(consent, /analytics_storage:\s*["']granted["']/);
  assert.match(consent, /Essential only/);
  assert.match(consent, /Allow analytics/);
  assert.match(consent, /Cookie settings/);
  assert.match(consent, /https:\/\/www\.googletagmanager\.com\/gtag\/js/);
});

test("analytics page views exclude query strings and advertising signals", async () => {
  const consent = await source("app/google-analytics-consent.tsx");

  assert.match(consent, /window\.location\.origin\}\$\{pathname\}/);
  assert.match(consent, /window\.location\.search === ["']{2}/);
  assert.match(consent, /isPublicMeasurementPage/);
  assert.doesNotMatch(consent, /useSearchParams/);
  assert.doesNotMatch(consent, /window\.location\.href/);
  assert.match(consent, /allow_google_signals:\s*false/);
  assert.match(consent, /allow_ad_personalization_signals:\s*false/);
  assert.doesNotMatch(consent, /user_id|email_address|phone_number/i);
});

test("the worker and legal notices disclose the consent controlled analytics provider", async () => {
  const [worker, cookies, privacy, subprocessors, exampleEnv] = await Promise.all([
    source("worker/index.ts"),
    source("app/cookies/page.tsx"),
    source("app/privacy/page.tsx"),
    source("app/subprocessors/page.tsx"),
    source(".env.example"),
  ]);

  assert.match(worker, /https:\/\/www\.googletagmanager\.com/);
  assert.match(worker, /https:\/\/www\.google-analytics\.com/);
  assert.match(worker, /https:\/\/region1\.google-analytics\.com/);
  assert.match(cookies, /Google Analytics/);
  assert.match(cookies, /explicit choice/i);
  assert.match(privacy, /website analytics/i);
  assert.match(subprocessors, /Google Analytics/);
  assert.match(exampleEnv, /NEXT_PUBLIC_GOOGLE_ANALYTICS_ID=/);
});
