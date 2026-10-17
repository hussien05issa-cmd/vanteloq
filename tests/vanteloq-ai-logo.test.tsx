import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import VanteloqAiLogo from "../app/vanteloq-ai-logo";

test("the restored orbital AI symbol is scalable and has a single accessible name", () => {
  const html = renderToStaticMarkup(<VanteloqAiLogo size={96}/>);
  assert.match(html, /viewBox="0 0 160 160"/);
  assert.match(html, /width:96px;height:96px/);
  assert.equal((html.match(/role="img"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Vanteloq AI logo"/);
  assert.match(html, /class="vai-orbit-back"/);
  assert.match(html, /class="vai-orbit-spin"/);
  assert.doesNotMatch(html, /product-brand-artwork|<image|<img|src="https?:/);
});

test("decorative and compact AI symbols preserve their existing interaction states", () => {
  const decorative = renderToStaticMarkup(<VanteloqAiLogo size={26} decorative thinking/>);
  assert.match(decorative, /vanteloq-ai-logo is-compact is-thinking/);
  assert.match(decorative, /aria-hidden="true"/);
  assert.doesNotMatch(decorative, /role="img"|aria-label=/);
  const active = renderToStaticMarkup(<VanteloqAiLogo active className="workspace-icon"/>);
  assert.match(active, /vanteloq-ai-logo is-attentive workspace-icon/);
});

test("multiple AI symbols do not share SVG paint references", () => {
  const html = renderToStaticMarkup(<><VanteloqAiLogo/><VanteloqAiLogo/></>);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 14);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/url\(#([^)]+)\)/g)) {
    assert.ok(ids.includes(match[1]), `Missing paint definition: ${match[1]}`);
  }
  const styles = readFileSync(new URL("../app/vanteloq-ai-brand.css", import.meta.url), "utf8");
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /animation: none !important; transition: none !important/);
  assert.match(styles, /data-motion-paused="true"/);
});
