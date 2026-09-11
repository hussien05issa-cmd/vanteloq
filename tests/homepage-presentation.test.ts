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

test("operating steps use three noninteractive interface diagrams instead of generated thumbnails", () => {
  const steps = homepage.match(/<ol class="home-step-list">[\s\S]*?<\/ol>/)?.[0] ?? "";
  assert.ok(steps);
  assert.equal((steps.match(/home-operating-preview/g) ?? []).length, 3);
  assert.doesNotMatch(steps, /<img|<button|<a\s|home-step-review-visual/);
  for (const text of ["Source to workspace", "Record checks", "Review queue", "Approval needed"]) assert.ok(steps.includes(text));
});

test("signup roadmap keeps the real four-step sequence and distinct accessible content", () => {
  const roadmap = homepage.match(/<section class="home-account-steps home-account-roadmap"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.ok(roadmap);
  assert.equal((roadmap.match(/<li\s/g) ?? []).length, 4);
  assert.equal((roadmap.match(/<svg\s/g) ?? []).length, 4);
  for (const text of ["Verify your email", "authenticator app", "business details", "Stripe checkout"]) assert.ok(roadmap.includes(text));
  assert.match(roadmap, /aria-labelledby="account-roadmap-title"/);
  assert.doesNotMatch(roadmap, /<button|<a\s|>0[1-4]</);
});
