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

test("product branding uses the supplied BookLoQ assets and a shared trademark glyph", async () => {
  const productLogoSource = await readFile(new URL("../app/product-brand-logo.tsx", import.meta.url), "utf8");
  assert.match(productLogoSource, /\/brand\/bookloq-logo\.png/);
  assert.match(productLogoSource, /\/brand\/bookloq-mark\.png/);
  assert.doesNotMatch(productLogoSource, /bookloq-logo\.jpeg/);
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
  assert.match(app, /providerActions\[integrationActionKey\(provider\.id, connection\.id\)\]/);
  assert.match(app, /integrationActionKey\(provider, connectionId\)/);
  assert.match(app, /delete next\[actionKey\]/);
  assert.doesNotMatch(app, /disabled=\{[^}]*Boolean\(providerActions\)[^}]*\}/);
});

test("provider location discovery uses a same-origin write request", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  for (const routePath of [
    "../app/api/v1/integrations/lightspeed/outlets/route.ts",
    "../app/api/v1/integrations/lightspeed-r/shops/route.ts",
  ]) {
    const route = await readFile(new URL(routePath, import.meta.url), "utf8");
    const getHandler = route.split("export async function GET")[1].split("export async function POST")[0];
    assert.doesNotMatch(getHandler, /fetchLightspeed|\.insert\(|\.update\(/, routePath);
    assert.match(route, /input\.action === "discover"/);
  }
  assert.match(app, /method: "POST"[\s\S]{0,180}action: "discover"/);
});

test("live sales and report time frames stay connected to real API filters", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  const reports = await readFile(new URL("../app/control-workspaces.tsx", import.meta.url), "utf8");
  const reportRoute = await readFile(new URL("../app/api/v1/reports/route.ts", import.meta.url), "utf8");
  const rSeriesSync = await readFile(new URL("../app/api/v1/integrations/lightspeed-r/sync/route.ts", import.meta.url), "utf8");
  assert.match(app, /IntradaySalesChart/);
  assert.match(app, /integrations\/lightspeed-r\/sync/);
  assert.match(app, /R-Series refreshes are started from Connections and remain hidden until the latest reconciliation is reviewed/);
  assert.match(reports, /report-period-presets/);
  assert.match(reports, /type="date"/);
  assert.match(reports, /new URLSearchParams\(\{ report: id \}\)/);
  assert.match(reports, /params\.set\("start", start\)/);
  assert.match(reports, /params\.set\("end", end\)/);
  assert.match(reports, /format=csv/);
  assert.match(reportRoute, /INVALID_DATE_RANGE/);
  assert.match(reportRoute, /periodStart: resolvedStart/);
  assert.match(reportRoute, /periodEnd: resolvedEnd/);
  assert.match(reportRoute, /commerce_payments/);
  assert.match(reportRoute, /comparisonPeriod/);
  assert.match(reports, /Month to date/);
  assert.match(reports, /Last month/);
  assert.match(reports, /Payment-method performance/);
  assert.match(rSeriesSync, /recentSalesPage/);
  assert.match(rSeriesSync, /24 \* 60 \* 60 \* 1_000/);
  assert.match(rSeriesSync, /\.\.\.recentSalesPage\.data, \.\.\.salesPage\.data/);
});

test("public resources always expose Home and Sign in navigation", async () => {
  const navigation = await readFile(new URL("../app/resources/components.tsx", import.meta.url), "utf8");
  const resources = await readFile(new URL("../app/resources/page.tsx", import.meta.url), "utf8");
  const article = await readFile(new URL("../app/resources/[segment]/page.tsx", import.meta.url), "utf8");
  assert.match(navigation, /href="\/">Home/);
  assert.match(navigation, /href="\/\?start=signin">Sign in/);
  assert.match(resources, /ResourceShell/);
  assert.match(article, /ResourceShell/);
  assert.match(article, /Breadcrumbs/);
});

test("resource article sections override the legacy global two-column rule", async () => {
  const css = await readFile(new URL("../app/resources/resources.css", import.meta.url), "utf8");
  assert.match(css, /\.resource-site \.article-body > section \{[^}]*display:\s*block;[^}]*grid-template-columns:\s*none;[^}]*padding:\s*0;[^}]*border-bottom:\s*0;/);
  assert.match(css, /\.resource-site \.article-body > section > \* \{[^}]*grid-column:\s*auto;/);
  assert.match(css, /\.resource-site \.article-body > section\.quick-answer \{[^}]*padding:\s*30px;/);
});

test("commerce charts expose exact-date and exact-hour keyboard tooltips", async () => {
  const charts = await readFile(new URL("../app/dashboard-charts.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  assert.match(charts, /chart-tooltip/);
  assert.match(charts, /onFocus=\{\(\) => setActiveIndex\(index\)\}/);
  assert.match(charts, /Net sales.*Gross profit.*transactions/s);
  assert.match(app, /Today vs same weekday/);
  assert.match(app, /PAYMENT MIX/);
  assert.match(app, /7-DAY OUTLOOK/);
});

test("sales payment mix defaults to today and offers verified date windows", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/command-centre/route.ts", import.meta.url), "utf8");
  assert.match(app, /paymentRange/);
  assert.match(app, /Today/);
  assert.match(app, /Last 7 days/);
  assert.match(app, /Last 30 days/);
  assert.match(route, /payment_days/);
  assert.match(route, /PAYMENT_PERIOD_INVALID/);
});

test("integrations open on Connections and never render a raw provider account identifier", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/integrations/route.ts", import.meta.url), "utf8");
  assert.match(app, /useState<"import" \| "connections">\("connections"\)/);
  assert.match(app, /Connections[\s\S]{0,500}Import data/);
  assert.doesNotMatch(app, /Account ID \{provider\.externalAccountRef\}/);
  assert.match(route, /maskedAccountRef/);
  assert.doesNotMatch(route, /externalAccountRef: byProvider/);
});

test("the authenticated homepage mirrors the integration directory with truthful availability badges", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  assert.match(app, /function ConnectorHomeDirectory/);
  assert.match(app, /integrationCatalog\.map/);
  assert.match(app, /data\.liveSource\.providers/);
  assert.match(app, /provider\.availability === "credentials_required"/);
  assert.match(app, /label: "Configure"/);
  assert.match(app, /label: "Planned"/);
  assert.match(app, /provider\.dataPromotionStatus === "approved"/);
  assert.match(app, /Fresh balances power cash analysis · transactions await review/);
  assert.match(app, /Manage connections/);
});

test("employee profiles are covered by organization billing and remote seats are capacity checked", async () => {
  const governance = await readFile(new URL("../app/api/v1/governance/route.ts", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../app/governance-workspaces.tsx", import.meta.url), "utf8");
  assert.match(governance, /canAddUser/);
  assert.match(governance, /employeeCheckoutRequired: false/);
  assert.match(workspace, /Covered by the owner plan/);
  assert.match(workspace, /Employees never complete a separate checkout/);
});

test("purchase orders use the tenant product and supplier database with traceable recommendations", async () => {
  const workspace = await readFile(new URL("../app/control-workspaces.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/purchasing/route.ts", import.meta.url), "utf8");
  assert.match(workspace, /Product from product database/);
  assert.match(workspace, /Last ordered/);
  assert.match(workspace, /already incoming/);
  assert.match(route, /label: "Dead stock"/);
  assert.match(route, /Healthy movement/);
  assert.match(route, /commerce_products/);
  assert.match(route, /commerce_suppliers/);
  assert.match(route, /commerce_sale_lines/);
  assert.match(route, /purchase_order_lines/);
  assert.match(route, /PRODUCT_SUPPLIER_MISMATCH/);
  assert.match(route, /reviewHorizonDays: 14/);
  assert.match(route, /supplierSource: selectedSupplier/);
});

test("marketing intelligence is owner-controlled, evidence-labeled and calendar-backed", async () => {
  const workspace = await readFile(new URL("../app/growth-workspace.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/growth/route.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");

  assert.match(workspace, /Owner entry/);
  assert.match(route, /Coming soon!/);
  assert.match(route, /Association is not proof of causation/i);
  assert.match(workspace, /marketing-intelligence-v2\.png/);
  assert.match(route, /marketing\.profile_updated/);
  assert.match(route, /marketing\.calendar_created/);
  assert.match(route, /sourceSystem: "owner_entry"|sourceSystem/);
  assert.match(schema, /marketing_profiles/);
  assert.match(schema, /marketing_calendar_entries/);
  assert.doesNotMatch(workspace, /Google connected|Meta connected/i);
});

test("industry models use the generated operating-model visual without inventing active modules", async () => {
  const workspace = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  assert.match(workspace, /industry-models-v2\.png/);
  assert.match(workspace, /Requires source adapter/);
  assert.match(workspace, /\{industries\.length\}<\/b><small>industry models/);
  assert.match(workspace, /Reviewed<\/b><small>source required/);
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

test("Plaid Link opens only after an explicit, accessible financial-data authorization", async () => {
  const button = await readFile(new URL("../app/plaid-link-button.tsx", import.meta.url), "utf8");
  assert.match(button, /role="dialog"/);
  assert.match(button, /aria-modal="true"/);
  assert.match(button, /type="checkbox"/);
  assert.doesNotMatch(button, /type="checkbox"[^>]*defaultChecked|type="checkbox"[^>]*checked=\{true\}/);
  assert.match(button, /Privacy Policy/);
  assert.match(button, /Retention and deletion/);
  assert.match(button, /consentRecordId/);
  assert.match(button, /Vanteloq cannot move money or make payments/);
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
  assert.match(source, /removal\.error\.status !== 404/);
  assert.match(source, /refreshedFactors\.data\.all\.some/);
  assert.match(source, /no new QR code was issued/i);
  assert.match(source, /currentLevel !== "aal2"/);
  assert.match(source, /six-digit code/i);
  assert.doesNotMatch(source, /Supabase AAL2|Server-enforced AAL2|Separate session on every device/);
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
  assert.match(api, /identity\.provider !== "supabase" \|\| identity\.assuranceLevel !== "aal2"/);
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

test("the authenticated shell switches to tablet navigation without a sidebar overlap", async () => {
  const [globals, design] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/design-v2.css", import.meta.url), "utf8"),
  ]);

  assert.match(globals, /@media\(max-width:900px\)\{\.app-shell\{display:block\}/);
  assert.match(globals, /@media\(max-width:900px\)\{\.sidebar\{position:fixed;left:-100%/);
  assert.match(design, /@media \(max-width: 900px\) \{[\s\S]*?\.operating-shell \.sidebar/);
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
