import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";

const homepage = renderToStaticMarkup(createElement(Home));

test("homepage omits the former independent retail label", () => {
  assert.doesNotMatch(homepage, /Operations and analytics for independent retail/);
  assert.doesNotMatch(homepage, /<span class="public-pill">/);
});

test("homepage sequence labels do not use leading zeroes", () => {
  const platform = homepage.match(/<section class="home-platform"[\s\S]*?<\/section>/)?.[0] ?? "";
  const capabilities = homepage.match(/<section class="home-capabilities"[\s\S]*?<\/section>/)?.[0] ?? "";
  const gemini = homepage.match(/<section class="home-gemini"[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.ok(platform, "homepage should render the platform sequence");
  assert.ok(capabilities, "homepage should render the capability sequence");
  assert.ok(gemini, "homepage should render the Gemini evidence sequence");
  assert.match(platform, /<b>1<\/b>/);
  assert.match(platform, /<b>2<\/b>/);
  assert.match(platform, /<b>3<\/b>/);
  assert.match(gemini, /<b>1<\/b>/);
  assert.match(gemini, /<b>2<\/b>/);
  assert.match(gemini, /<b>3<\/b>/);
  for (const number of [1, 2, 3, 4, 5, 6]) assert.match(capabilities, new RegExp(`<small>${number}<\\/small>`));
  assert.doesNotMatch(`${platform}${capabilities}${gemini}`, />(?:01|02|03|04|05|06)</);
});
