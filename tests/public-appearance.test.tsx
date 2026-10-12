import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import Home from "../app/page";
import PublicAppearanceControl from "../app/public-appearance-control";

test("homepage starts Dark without browser APIs and preserves the existing product story", () => {
  const html = renderToStaticMarkup(createElement(Home));
  assert.match(html, /data-public-theme="dark" data-public-appearance="dark"/);
  assert.match(html, /A number without a source is a rumour\./);
  assert.match(html, /Your business, <em>at a glance\.<\/em>/);
  const header = html.slice(html.indexOf('<header class="public-nav"'), html.indexOf('</header>'));
  assert.match(header, /aria-label="Vanteloq home"/);
  assert.match(header, /aria-label="Vanteloq logo"/);
  assert.doesNotMatch(header, /<span>Vanteloq<\/span>/);
});

test("the compact appearance choice exposes Dark, Light and System with one selected default", () => {
  const html = renderToStaticMarkup(createElement(PublicAppearanceControl));
  assert.match(html, /<select[^>]*aria-label="Colour theme"/);
  assert.match(html, /<option value="dark" selected="">Dark<\/option>/);
  assert.match(html, /<option value="light">Light<\/option>/);
  assert.match(html, /<option value="system">System<\/option>/);
  assert.equal((html.match(/ selected=/g) || []).length, 1);
});

test("homepage and portalled details share the existing recoverable device preference", () => {
  const control = readFileSync(new URL("../app/public-appearance-control.tsx", import.meta.url), "utf8");
  const surface = readFileSync(new URL("../app/expanding-surface.tsx", import.meta.url), "utf8");
  assert.match(control, /useWorkspaceAppearance\(\)/);
  assert.doesNotMatch(control, /localStorage|matchMedia/);
  assert.match(control, /appearance\.storageNotice \|\| appearance\.systemNotice/);
  assert.match(surface, /\.operating-shell\[data-workspace-theme\],\.public-site\[data-public-theme\]/);
  assert.match(surface, /<WorkspaceAppearanceBoundary>\{surface\}<\/WorkspaceAppearanceBoundary>/);
});
