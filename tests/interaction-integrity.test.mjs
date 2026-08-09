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
  assert.match(authPanel, /updateUser\(\{ password \}\)/);
  assert.match(authPanel, /auth\.resend/);
  assert.match(authPanel, /scope: "global"/);
  assert.match(home, /event === "PASSWORD_RECOVERY"/);
  assert.match(home, /get\("recovery"\) === "1"/);
  assert.match(browserClient, /flowType: "implicit"/);
  assert.doesNotMatch(home, /window\.location\.reload\(\)/);
  assert.doesNotMatch(authPanel, /window\.location\.reload\(\)/);
  assert.doesNotMatch(browserClient, /window\.location\.reload\(\)/);
  assert.match(home, /event === "SIGNED_IN"[\s\S]{0,300}loadWorkspace\(session\)/);
  assert.match(home, /entry === "load-error"/);
});

test("the founder account uses Supabase email reauthentication instead of an authenticator app", async () => {
  const source = await readFile(new URL("../app/founder-mfa-gate.tsx", import.meta.url), "utf8");
  assert.match(source, /auth\.reauthenticate\(\)/);
  assert.match(source, /verifyOtp\(\{ email, token: code, type: "reauthentication" \}\)/);
  assert.match(source, /30 \* 60 \* 1000/);
  assert.doesNotMatch(source, /auth\.mfa\./);
  assert.match(source, /hussienissa@lexedgeconsulting\.com/);
});
