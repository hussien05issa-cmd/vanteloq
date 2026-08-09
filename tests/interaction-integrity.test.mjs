import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function applicationSource() {
  const directory = new URL("../app/", import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".tsx"));
  return Promise.all(
    files.map(async (file) => ({
      file,
      source: await readFile(new URL(file, directory), "utf8"),
    })),
  );
}

test("visible controls do not use known no-op interaction patterns", async () => {
  for (const { file, source } of await applicationSource()) {
    assert.doesNotMatch(source, /onClick=\{\(\) => undefined\}/, file);
    assert.doesNotMatch(source, /onClick=\{\(\) => \{\}\}/, file);
    assert.doesNotMatch(source, /href=["']#["']/, file);
  }
});

test("literal disabled buttons explain why they are unavailable", async () => {
  for (const { file, source } of await applicationSource()) {
    const literalDisabledButtons = source.match(/<button\b(?=[^>]*\bdisabled(?:\s|>))[^>]*>/g) ?? [];
    for (const button of literalDisabledButtons) {
      assert.match(button, /\btitle=/, `${file}: ${button}`);
    }
  }
});

test("the Lightspeed integration uses the standalone image asset", async () => {
  const source = await readFile(
    new URL("../app/integration-brand-logo.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /\/brand\/lightspeed-mark\.png/);
  assert.doesNotMatch(source, /name === "Lightspeed"[\s\S]{0,200}<path/);
});

test("product branding uses the supplied BookLoq asset and a shared trademark glyph", async () => {
  const productLogoSource = await readFile(new URL("../app/product-brand-logo.tsx", import.meta.url), "utf8");
  assert.match(productLogoSource, /\/brand\/bookloq-logo\.png/);
  assert.match(productLogoSource, /brand-trademark/);
  assert.match(productLogoSource, />™<\/sup>/);
});

test("X-Series and R-Series are distinct, actionable connection choices", async () => {
  const catalog = await readFile(new URL("../app/integration-catalog.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  assert.match(catalog, /id: "lightspeed"[\s\S]*name: "Lightspeed X-Series"/);
  assert.match(catalog, /id: "lightspeed-r"[\s\S]*name: "Lightspeed R-Series"/);
  assert.match(app, /integrations\/\$\{provider\}\/authorize/);
  assert.match(app, /provider === "lightspeed-r" \? "shops" : "outlets"/);
});

test("the banking catalogue uses Plaid's standalone mark and omits removed aggregators", async () => {
  const logoSource = await readFile(
    new URL("../app/integration-brand-logo.tsx", import.meta.url),
    "utf8",
  );
  const catalogue = await readFile(
    new URL("../app/integration-catalog.ts", import.meta.url),
    "utf8",
  );
  assert.match(logoSource, /\/brand\/plaid-mark\.png/);
  assert.doesNotMatch(catalogue, /\bMX\b|\bFlinks\b/);
  assert.match(catalogue, /name: "Plaid"/);
});

test("account access includes confirmation recovery and a complete password-reset path", async () => {
  const authPanel = await readFile(new URL("../app/auth-panel.tsx", import.meta.url), "utf8");
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const browserClient = await readFile(new URL("../app/supabase-browser.ts", import.meta.url), "utf8");

  assert.match(authPanel, /resetPasswordForEmail/);
  assert.match(authPanel, /resetPasswordForEmail[\s\S]{0,250}captchaToken: turnstileToken/);
  assert.match(authPanel, /auth\.signUp\([\s\S]{0,400}canonicalAuthUrl/);
  assert.match(authPanel, /fetch\("\/api\/v1\/auth\/signin"[\s\S]{0,400}turnstileToken/);
  assert.match(authPanel, /auth\.setSession/);
  assert.match(authPanel, /auth\.resend[\s\S]{0,300}captchaToken: turnstileToken/);
  assert.match(authPanel, /updateUser\(\{ password \}\)/);
  assert.match(authPanel, /strongPasswordError\(password\)/);
  assert.match(authPanel, /passwordExposureStatus\(password\)/);
  assert.match(authPanel, /known breach data/i);
  assert.match(authPanel, /auth\.resend/);
  assert.match(authPanel, /scope: "global"/);
  assert.match(home, /event === "PASSWORD_RECOVERY"/);
  assert.match(home, /get\("recovery"\) === "1"/);
  assert.match(browserClient, /flowType: "pkce"/);
  assert.doesNotMatch(authPanel, /window\.location\.origin/);
  assert.doesNotMatch(home, /window\.location\.reload\(\)/);
  assert.doesNotMatch(authPanel, /window\.location\.reload\(\)/);
  assert.doesNotMatch(browserClient, /window\.location\.reload\(\)/);
  assert.match(home, /event === "SIGNED_IN"[\s\S]{0,300}loadWorkspace\(session\)/);
  assert.match(home, /entry === "load-error"/);
});

test("authenticated accounts require Supabase TOTP and a confirmed AAL2 session", async () => {
  const source = await readFile(new URL("../app/founder-mfa-gate.tsx", import.meta.url), "utf8");
  assert.match(source, /auth\.mfa\.getAuthenticatorAssuranceLevel/);
  assert.match(source, /auth\.mfa\.listFactors/);
  assert.match(source, /auth\.mfa\.enroll/);
  assert.match(source, /auth\.mfa\.challengeAndVerify/);
  assert.match(source, /currentLevel !== "aal2"/);
  assert.match(source, /six-digit code/i);
  assert.doesNotMatch(source, /sessionStorage|signInWithOtp|founder_email_verified/);
});

test("Cloudflare Turnstile protects every unauthenticated Supabase email flow", async () => {
  const authPanel = await readFile(new URL("../app/auth-panel.tsx", import.meta.url), "utf8");
  const signupRoute = await readFile(new URL("../app/api/v1/auth/signup/route.ts", import.meta.url), "utf8");
  const signinRoute = await readFile(new URL("../app/api/v1/auth/signin/route.ts", import.meta.url), "utf8");

  assert.match(authPanel, /mode === "signup" \|\| mode === "signin" \|\| mode === "request-reset"/);
  assert.match(authPanel, /password-recovery/);
  assert.match(signupRoute, /SUPABASE_CAPTCHA_ENABLED/);
  assert.match(authPanel, /auth\.signUp[\s\S]{0,500}captchaToken: turnstileToken/);
  assert.match(signinRoute, /SUPABASE_CAPTCHA_ENABLED/);
  assert.match(signinRoute, /gotrue_meta_security: \{ captcha_token: turnstileToken \}/);
  assert.match(signinRoute, /signin:account-source/);
  assert.match(signinRoute, /signin:source/);
  assert.doesNotMatch(signupRoute, /export async function POST/);
});

test("authentication callbacks use one canonical production origin", async () => {
  const authPanel = await readFile(new URL("../app/auth-panel.tsx", import.meta.url), "utf8");
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const authUrls = await readFile(new URL("../shared/auth-urls.ts", import.meta.url), "utf8");

  assert.match(authUrls, /CANONICAL_APP_ORIGIN = "https:\/\/vanteloq\.com"/);
  assert.match(authUrls, /LEGACY_APP_HOSTNAME = "vanteloq\.hussien05issa\.chatgpt\.site"/);
  assert.match(home, /canonicalLocation\(window\.location\)/);
  assert.match(home, /window\.location\.replace\(canonicalDestination\)/);
  assert.match(worker, /Response\.redirect\(destination, 308\)/);
  assert.match(authPanel, /canonicalAuthUrl\("\/"\)/);
  assert.match(authPanel, /canonicalAuthUrl\("\/\?recovery=1"\)/);
});

test("authorization is server-bound to immutable identity and Supabase AAL2", async () => {
  const authorization = await readFile(new URL("../server/authorization.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../server/api.ts", import.meta.url), "utf8");
  const internalAccess = await readFile(new URL("../server/internal-access.ts", import.meta.url), "utf8");

  assert.match(authorization, /row\.authSubject !== identity\.subject/);
  assert.match(authorization, /requireAal2\(identity\)/);
  assert.match(api, /identity\.provider === "supabase" && identity\.assuranceLevel !== "aal2"/);
  assert.match(internalAccess, /mfa_required = 1/);
  assert.doesNotMatch(internalAccess, /mfa_required[\s\S]{0,20}VALUES[\s\S]{0,80}, 0,/);
});

test("critical product surfaces preserve the readability and focus floor", async () => {
  const stylesheet = await readFile(new URL("../app/readability.css", import.meta.url), "utf8");

  assert.match(stylesheet, /\.operating-shell :is\(p, label, dt, dd\)/);
  assert.match(stylesheet, /font-size: max\(13px, 1em\) !important/);
  assert.match(stylesheet, /:focus-visible/);
  assert.match(stylesheet, /outline: 3px solid/);
  assert.match(stylesheet, /prefers-reduced-motion: reduce/);
  assert.match(stylesheet, /\.auth-panel input \{ min-height: 46px; font-size: 16px/);
  assert.match(stylesheet, /\.founder-mfa-copy p,[\s\S]*font-size: 16px/);
});

test("the worker enforces the complete content security policy", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

  assert.match(source, /headers\.set\(\s*"Content-Security-Policy"/);
  assert.match(source, /https:\/\/api\.pwnedpasswords\.com/);
  assert.match(source, /frame-ancestors 'none'/);
  assert.match(source, /object-src 'none'/);
  assert.match(source, /https:\/\/challenges\.cloudflare\.com/);
  assert.match(source, /upgrade-insecure-requests/);
  assert.match(source, /headers\.delete\("Content-Security-Policy-Report-Only"\)/);
});
