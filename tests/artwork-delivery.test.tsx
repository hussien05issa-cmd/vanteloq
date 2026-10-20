import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import IntegrationBrandLogo from "../app/integration-brand-logo";
import { RESOURCE_ARTICLES } from "../app/resources/content";

const preservedDelivery = [
  { original: "vantatalk-greeting-smile.png", encoded: "vantatalk-greeting-smile-lossless.webp", width: 1254, height: 1254,
    sha256: "1e298680c7c1b2129585ae447a792209e258bfe940e0467b10603374ff0d38d5" },
  { original: "pos-commerce-intelligence.png", encoded: "pos-commerce-intelligence-lossless.webp", width: 1774, height: 887,
    sha256: "cbb17f275b99aa9645cc95f59cfb53160edb0c449b9ac2809557b383a82db2db" },
  { original: "bookloq-cash-control-v1.png", encoded: "bookloq-cash-control-lossless.webp", width: 1774, height: 887,
    sha256: "957b4ed94ba44ccdca17e3655227417a53c7cb74088fba7254316f0a28d1098a" },
] as const;

test("delivery artwork preserves every original RGBA pixel, dimensions and original file bytes", async () => {
  for (const asset of preservedDelivery) {
    const original = readFileSync(`public/brand/${asset.original}`);
    const encoded = readFileSync(`public/brand/delivery-2026-10/${asset.encoded}`);
    assert.equal(createHash("sha256").update(original).digest("hex"), asset.sha256);
    const before = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const after = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(after.info.width, asset.width);
    assert.equal(after.info.height, asset.height);
    assert.deepEqual(after.info, before.info, asset.original);
    assert.ok(after.data.equals(before.data), `${asset.original}: no resampling, colour or alpha changes`);
    assert.ok(encoded.length <= original.length * .75, `${asset.original}: at least 25% smaller`);
  }
});

test("local provider images reserve their actual dimensions and decode without blocking layout", async () => {
  for (const name of ["DoorDash", "Stripe", "Clover", "Uber Eats", "Google", "Meta", "Lightspeed", "Lightspeed X-Series", "Plaid", "Deel", "Slack", "Moneris"]) {
    const markup = renderToStaticMarkup(<IntegrationBrandLogo name={name}/>);
    const image = markup.match(/<img\b[^>]*>/)?.[0];
    assert.ok(image, name);
    const source = image.match(/src="([^"]+)"/)?.[1];
    assert.ok(source?.startsWith("/"), name);
    const metadata = await sharp(`public${source}`).metadata();
    assert.ok(image.includes(`width="${metadata.width}"`), `${name}: width`);
    assert.ok(image.includes(`height="${metadata.height}"`), `${name}: height`);
    assert.match(image, /loading="lazy"/);
    assert.match(image, /decoding="async"/);
    assert.match(markup, /aria-label="[^"]+ logo"/);
    assert.doesNotMatch(markup, /src="https?:|rel="preload"/);
  }
});

test("high-density raster marks can use existing originals without enlarging or redrawing files", () => {
  for (const [name, small, large] of [["Google", "google-g-ui.webp 84w", "google-g.png 200w"], ["Plaid", "plaid-mark-ui.webp 84w", "plaid-mark.png 127w"]]) {
    const markup = renderToStaticMarkup(<IntegrationBrandLogo name={name} compact/>);
    assert.ok(markup.includes(small), name);
    assert.ok(markup.includes(large), name);
    assert.match(markup, /sizes="32px"/);
  }
});

test("Lightspeed uses the complete byte-identical official vector, not an upscaled raster or altered flame", () => {
  const bytes = readFileSync("public/integrations/lightspeed-logo-charcoal.svg");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "35087805d3de2d8522477857158d6c19c89ff04b0f10eb7ad6c937ae307e31ff");
  const svg = bytes.toString("utf8");
  assert.match(svg, /viewBox="0 0 432 100\.8"/);
  assert.match(svg, /\.st3\{fill:#191513;/);
  assert.doesNotMatch(svg, /<script|<foreignObject|href=|onload=|<image/i);
  for (const name of ["Lightspeed", "Lightspeed R-Series", "Lightspeed X-Series"]) {
    const markup = renderToStaticMarkup(<IntegrationBrandLogo name={name} compact/>);
    assert.match(markup, /src="\/integrations\/lightspeed-logo-charcoal\.svg"/);
    assert.doesNotMatch(markup, /lightspeed-mark-ui\.webp/);
  }
});

test("the article delivery choice retains the original source for social metadata and fallback", () => {
  const articles = RESOURCE_ARTICLES.filter(article => article.hero?.src === "/brand/bookloq-cash-control-v1.png");
  assert.equal(articles.length, 2);
  for (const article of articles) {
    assert.equal(article.hero?.webpSrc, "/brand/delivery-2026-10/bookloq-cash-control-lossless.webp");
    assert.equal(article.hero?.width, 1774);
    assert.equal(article.hero?.height, 887);
  }
  const source = readFileSync("app/resources/[segment]/page.tsx", "utf8");
  assert.match(source, /<source type="image\/webp" srcSet=\{article\.hero\.webpSrc\}/);
  assert.match(source, /src=\{article\.hero\.src\}/);
});
