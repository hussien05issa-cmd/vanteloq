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

test("square favicons retain the original logo and keep its wordmark out of tab-sized images", async () => {
  const { default: sharp } = await import("sharp");
  const directory = new URL("../public/brand/glass-2026-10-12/", import.meta.url);
  const svg = readFileSync(new URL("favicon-v2.svg", directory), "utf8");
  const embedded = svg.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(embedded, "favicon embeds the supplied artwork");
  assert.equal(createHash("sha256").update(Buffer.from(embedded, "base64")).digest("hex"), expectedArtwork.vanteloq.hash);
  assert.equal(readFileSync(new URL("favicon.svg", directory), "utf8"), svg);
  assert.equal(readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8"), svg);

  for (const size of [16, 32, 48, 180]) {
    const file = size === 180 ? "apple-touch-icon-v2.png" : `favicon-v2-${size}.png`;
    const { data, info } = await sharp(readFileSync(new URL(file, directory))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, size);
    assert.equal(info.height, size);
    let silverPixels = 0;
    let bluePixels = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * info.channels;
        const [red, green, blue] = [data[index], data[index + 1], data[index + 2]];
        if (red > 100 && green > 100 && blue > 100) silverPixels++;
        if (blue > red + 50 && blue > green + 15) bluePixels++;
        if (y >= size - Math.ceil(size * .13)) {
          assert.ok(Math.max(red, green, blue) < 45, `${file} has no wordmark leakage at ${x},${y}`);
        }
      }
    }
    assert.ok(silverPixels > 0 && bluePixels > 0, `${file} retains the silver and blue symbol`);
  }
});

test("the conventional and versioned ICO contain the complete 16, 32 and 48 pixel fallbacks", () => {
  const directory = new URL("../public/brand/glass-2026-10-12/", import.meta.url);
  const ico = readFileSync(new URL("favicon-v2.ico", directory));
  assert.deepEqual(readFileSync(new URL("../public/favicon.ico", import.meta.url)), ico);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    assert.equal(ico[entry], size);
    assert.equal(ico[entry + 1], size);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.deepEqual(ico.subarray(offset, offset + length), readFileSync(new URL(`favicon-v2-${size}.png`, directory)));
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
      assert.doesNotMatch(html, /<sup|brand-trademark|™|<text|<path|<foreignObject|<img/);
      if (product === "bookloq") {
        assert.match(html, /clear-carrier/);
        assert.match(html, /<mask/);
        assert.match(html, /mask="url\(#/);
        assert.match(html, /color-interpolation-filters="sRGB"/);
      } else assert.doesNotMatch(html, /<filter|<mask/);
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
  assert.match(html, /class="product-brand-logo product-brand-artwork bookloq icon clear-carrier sidebar-brand"/);
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

test("an explicit SVG ID prefix is stable across server and browser render prefixes", () => {
  const render = (identifierPrefix: string) => renderToStaticMarkup(
    <ProductBrandLogo product="vanteloq" clearCarrier svgIdPrefix="public-footer-vanteloq"/>,
    { identifierPrefix },
  );
  const serverHtml = render("server-");
  const browserHtml = render("browser-");
  const definitionIds = (html: string) => [...html.matchAll(/<(?:clipPath|filter|mask) id="([^"]+)"/g)].map(match => match[1]);
  const expectedIds = [
    "public-footer-vanteloq-clip",
    "public-footer-vanteloq-carrier-filter",
    "public-footer-vanteloq-carrier",
  ];

  assert.deepEqual(definitionIds(serverHtml), expectedIds);
  assert.deepEqual(definitionIds(browserHtml), expectedIds);
  for (const id of expectedIds) {
    assert.ok(serverHtml.includes(`url(#${id})`), id);
    assert.ok(browserHtml.includes(`url(#${id})`), id);
  }
});

test("the dedicated brand banner can display the full supplied parent artwork", () => {
  const html = renderToStaticMarkup(<ProductBrandLogo product="vanteloq" variant="full" fullArtwork/>);
  const frame = PRODUCT_BRAND_ASSETS.vanteloq.frames.full;
  assert.match(html, /product-brand-artwork vanteloq full/);
  assert.ok(html.includes(`viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}"`));
});
