import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProductBrandLogo from "../app/product-brand-logo";
import { PRODUCT_BRAND_ASSETS, type ProductBrand } from "../app/product-brand-assets";

const expectedArtwork = {
  vanteloq: { width: 1254, height: 1254, hash: "0f81ca4d90c976eb13028ffee2f6f1746a3d9bea25f8fe467bb276700743da71" },
  bookloq: { width: 1280, height: 853, hash: "e387ae8b42cc2b5242526b53acd20f4a244094b0a043d7cadced8fec8147221e" },
} as const;

const products = Object.keys(expectedArtwork) as ProductBrand[];

test("all installed brand files preserve the exact customer-supplied JPEG bytes", () => {
  for (const product of products) {
    const artwork = PRODUCT_BRAND_ASSETS[product];
    assert.equal(artwork.source, product === "vanteloq" ? "/brand/glass-2026-10-12/vanteloq.jpg" : `/brand/origin-metal-2026/${product}.jpg`);
    assert.equal(artwork.width, expectedArtwork[product].width);
    assert.equal(artwork.height, expectedArtwork[product].height);
    const bytes = readFileSync(new URL(`../public${artwork.source}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedArtwork[product].hash, product);
  }
});

test("rendered frames stay within the original image bounds and preserve its aspect ratio", () => {
  for (const product of products) {
    const artwork = PRODUCT_BRAND_ASSETS[product];
    for (const variant of ["icon", "full"] as const) {
      const displayedVariant = product === "vanteloq" ? "icon" : variant;
      const frame = artwork.frames[displayedVariant];
      assert.ok(frame.x >= 0 && frame.y >= 0 && frame.width > 0 && frame.height > 0, `${product} ${variant}`);
      assert.ok(frame.x + frame.width <= artwork.width && frame.y + frame.height <= artwork.height, `${product} ${variant}`);
      const html = renderToStaticMarkup(<ProductBrandLogo product={product} variant={variant}/>);
      assert.ok(html.includes(`viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}"`), `${product} ${variant}`);
      assert.match(html, /preserveAspectRatio="xMidYMid meet"/);
      assert.ok(html.includes(`<image href="${artwork.source}" width="${artwork.width}" height="${artwork.height}"`));
    }
  }
});

test("Vanteloq symbol-only branding excludes the supplied wordmark even at legacy full-lockup call sites", () => {
  const artwork = PRODUCT_BRAND_ASSETS.vanteloq;
  const icon = artwork.frames.icon;
  const wordmark = artwork.frames.full;
  const html = renderToStaticMarkup(<ProductBrandLogo product="vanteloq" variant="full"/>);
  assert.match(html, /class="product-brand-logo product-brand-artwork vanteloq icon"/);
  assert.ok(html.includes(`viewBox="${icon.x} ${icon.y} ${icon.width} ${icon.height}"`));
  assert.ok(!html.includes(`viewBox="${wordmark.x} ${wordmark.y} ${wordmark.width} ${wordmark.height}"`));
  assert.equal((html.match(/role="img"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Vanteloq logo"/);
});

test("each visible mark has one accessible image name without an extra trademark or decorative text", () => {
  for (const product of products) {
    const artwork = PRODUCT_BRAND_ASSETS[product];
    for (const variant of ["icon", "full"] as const) {
      const html = renderToStaticMarkup(<ProductBrandLogo product={product} variant={variant}/>);
      assert.equal((html.match(/role="img"/g) ?? []).length, 1);
      assert.ok(html.includes(`aria-label="${artwork.name} logo"`));
      assert.match(html, /focusable="false"/);
      assert.doesNotMatch(html, /<sup|brand-trademark|™|<text|<path|<filter|<foreignObject|<img/);
      assert.doesNotMatch(html, /logo-ui\.webp|mark-ui\.webp|src="https?:|href="https?:/);
    }
  }
});

test("priority artwork is preloaded as the same local image with high fetch priority", () => {
  const html = renderToStaticMarkup(<ProductBrandLogo product="vanteloq" variant="full" priority/>);
  const preload = html.match(/<link[^>]*rel="preload"[^>]*>/)?.[0];
  assert.ok(preload, "priority logo includes a resource preload");
  assert.match(preload, /as="image"/);
  assert.match(preload, /fetchPriority="high"/);
  assert.ok(preload.includes(`href="${PRODUCT_BRAND_ASSETS.vanteloq.source}"`));
});

test("non-priority marks avoid eager resource hints and default to the icon frame", () => {
  const html = renderToStaticMarkup(<ProductBrandLogo product="bookloq" className="sidebar-brand"/>);
  const frame = PRODUCT_BRAND_ASSETS.bookloq.frames.icon;
  assert.match(html, /class="product-brand-logo product-brand-artwork bookloq icon sidebar-brand"/);
  assert.ok(html.includes(`viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}"`));
  assert.doesNotMatch(html, /rel="preload"|fetchPriority="high"/);
});

test("each viewport clips to its own crop when differently shaped logo containers share a page", () => {
  const html = renderToStaticMarkup(<><ProductBrandLogo product="vanteloq"/><ProductBrandLogo product="bookloq" variant="full"/><ProductBrandLogo product="vanteloq" variant="full" fullArtwork/></>);
  const clipIds = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(clipIds.length, 3);
  assert.equal(new Set(clipIds).size, 3);
  for (const clipId of clipIds) assert.ok(html.includes(`clip-path="url(#${clipId})"`));
});

test("the dedicated brand banner can display the full supplied parent artwork", () => {
  const html = renderToStaticMarkup(<ProductBrandLogo product="vanteloq" variant="full" fullArtwork/>);
  const frame = PRODUCT_BRAND_ASSETS.vanteloq.frames.full;
  assert.match(html, /product-brand-artwork vanteloq full/);
  assert.ok(html.includes(`viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}"`));
});
