import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, css, launcher, analyticsRoutes, sitemap, worker] = await Promise.all([
  readFile(new URL("../app/vanteloqworkspace/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/vanteloqworkspace/workspace-gateway.css", import.meta.url), "utf8"),
  readFile(new URL("../app/workspace-launcher.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/analytics-public-routes.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
  readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
]);

test("the commercial route hands off to the standalone Workspace without proxying identity or data", () => {
  assert.match(page, /https:\/\/vanteloq-workspace\.hussien05issa\.chatgpt\.site\//);
  assert.match(page, /target="_blank"/);
  assert.match(page, /rel="noopener noreferrer"/);
  assert.match(page, /referrerPolicy="no-referrer"/);
  assert.match(page, /separate Vanteloq application/i);
  assert.match(page, /session, account tokens and customer records are not forwarded/i);
  assert.match(page, /not automatically shared/i);
  assert.doesNotMatch(page, /<iframe|fetch\(|Authorization|document\.cookie|dangerouslySetInnerHTML/);
  assert.doesNotMatch(page, /access_token|refresh_token|oai-authenticated-user/);
});

test("the route presents the implemented six-app family without claiming a shared commercial account", () => {
  for (const name of ["Compose", "Model", "Deckly", "Blueprint", "Calendar", "Studio"]) assert.match(page, new RegExp(`name: "${name}"`));
  for (const boundary of ["Separate session", "Workspace-owned records", "Commercial systems stay separate", "You choose the transfer"]) assert.match(page, new RegExp(boundary));
  assert.match(page, /No merchant sync or customer account is created here/);
  assert.match(page, /fixedTheme="dark"/);
  assert.doesNotMatch(page, /padStart\(|workspace-gateway-brand/);
  const handoff = page.slice(page.indexOf('<p className="workspace-gateway-handoff"'), page.indexOf('</p>', page.indexOf('<p className="workspace-gateway-handoff"')));
  assert.match(handoff, /Separate sign-in and data boundary/);
  assert.match(handoff, /Your Vanteloq session and customer records are not forwarded/);
  const boundary = page.slice(page.indexOf('<section className="workspace-gateway-section workspace-gateway-boundary"'), page.indexOf('</section>', page.indexOf('<section className="workspace-gateway-section workspace-gateway-boundary"')));
  assert.match(boundary, /<details>\s*<summary id="workspace-boundary-title">Account and data access/);
  assert.equal((boundary.match(/<article>/g) ?? []).length, 4);
  assert.doesNotMatch(boundary, /<details[^>]*\bopen(?:[ =>])/);
});

test("the gateway is responsive, keyboard visible and discoverable from the commercial shell", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(launcher, /href="\/datstudio"/);
  assert.match(analyticsRoutes, /"\/vanteloqworkspace"/);
  assert.match(sitemap, /absoluteUrl\("\/vanteloqworkspace"\)/);
});

test("the existing worker security and cache policy applies to the new route", () => {
  assert.match(worker, /X-Frame-Options", "DENY"/);
  assert.match(worker, /frame-ancestors 'none'/);
  assert.match(worker, /base-uri 'self'/);
  assert.match(worker, /if \(url\.pathname\.startsWith\("\/api\/"\)\)/);
  assert.match(worker, /text\\\/\(html\|x-component\)/);
  assert.doesNotMatch(worker, /vanteloqworkspace/);
});
