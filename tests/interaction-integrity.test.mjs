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
