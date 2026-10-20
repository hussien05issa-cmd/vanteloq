import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const appNames = ["Compose", "Model", "Deckly", "Blueprint", "Calendar", "Studio"];
const assetNames = ["compose.webp", "model.webp", "deckly.webp", "blueprint.webp", "calendar.webp", "studio-glass-v2.webp"];

const [page, css, legacyPage, navigation, footer, analyticsRoutes, sitemap, worker, assets] = await Promise.all([
  readFile(new URL("../app/workspace/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workspace/workspace.css", import.meta.url), "utf8"),
  readFile(new URL("../app/vanteloqworkspace/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/public-page-nav.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/public-footer.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/analytics-public-routes.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  Promise.all(assetNames.map(name => stat(new URL(`../public/brand/workspace/${name}`, import.meta.url)))),
]);

test("the canonical Workspace route hands off without proxying identity or data", () => {
  assert.match(page, /https:\/\/vanteloq-workspace\.hussien05issa\.chatgpt\.site\/workspace/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /rel="noopener noreferrer"/);
  assert.match(page, /referrerPolicy="no-referrer"/);
  assert.match(page, /primaryNavAction=\{\{/);
  assert.match(page, /label: "Open Workspace"/);
  assert.match(page, /accountAction=\{\{/);
  assert.match(page, /label: "Workspace sign in"/);
  assert.match(page, /separate Vanteloq application/i);
  assert.match(page, /session and customer records are not forwarded/i);
  assert.match(page, /not automatically shared/i);
  assert.match(page, /planned or configuration-dependent/i);
  assert.doesNotMatch(page, /<iframe|fetch\(|Authorization|document\.cookie|dangerouslySetInnerHTML/);
  assert.doesNotMatch(page, /access_token|refresh_token|oai-authenticated-user/);
});

test("the canonical route presents the six-app family with real approved assets", () => {
  for (const name of appNames) assert.match(page, new RegExp(`name: "${name}"`));
  for (const asset of assetNames) assert.match(page, new RegExp(`/brand/workspace/${asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  for (const file of assets) assert.ok(file.size > 0 && file.size < 200_000, `${file.size} should fit the logo delivery budget`);
  assert.match(page, /Studio → Model → Compose → Deckly → Blueprint → Calendar/);
  assert.match(page, /Keep the source beside the work/);
  assert.doesNotMatch(page, /padStart\(|>0[1-6]</);
});

test("the legacy route permanently redirects while retaining only safe campaign parameters", () => {
  assert.match(legacyPage, /permanentRedirect/);
  assert.match(legacyPage, /URLSearchParams/);
  assert.match(legacyPage, /SAFE_CAMPAIGN_PARAMS/);
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    assert.match(legacyPage, new RegExp(`"${key}"`));
  }
  assert.doesNotMatch(legacyPage, /Object\.entries\(params\)/);
  assert.doesNotMatch(legacyPage, /access_token|refresh_token|return_to/);
  assert.match(legacyPage, /`\/workspace\$\{suffix\}`/);
});

test("Workspace is canonical across metadata, navigation, sitemap and analytics", () => {
  assert.match(page, /canonical: "\/workspace"/);
  assert.match(page, /url: "\/workspace"/);
  assert.match(navigation, /href="\/workspace"[^>]*>Workspace</);
  assert.match(footer, /href="\/workspace"[^>]*>Vanteloq Workspace</);
  assert.match(analyticsRoutes, /"\/workspace"/);
  assert.doesNotMatch(analyticsRoutes, /"\/vanteloqworkspace"/);
  assert.match(sitemap, /absoluteUrl\("\/workspace"\)/);
  assert.doesNotMatch(sitemap, /absoluteUrl\("\/vanteloqworkspace"\)/);
});

test("the Workspace surface retains focus, responsive and reduced-motion treatment", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the existing worker security and Data Studio ownership remain intact", () => {
  assert.match(worker, /X-Frame-Options", "DENY"/);
  assert.match(worker, /frame-ancestors 'none'/);
  assert.match(worker, /base-uri 'self'/);
  assert.match(worker, /if \(url\.pathname\.startsWith\("\/api\/"\)\)/);
  assert.match(worker, /text\\\/\(html\|x-component\)/);
  assert.doesNotMatch(worker, /vanteloqworkspace/);
});
