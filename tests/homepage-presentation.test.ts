import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";
import HowItWorks from "../app/how-it-works/page";

const homepage = renderToStaticMarkup(createElement(HowItWorks));
test("the homepage keeps the exact animated source principle above its business overview heading", () => {
  const original = renderToStaticMarkup(createElement(Home));
  const principle = "A number without a source is a rumour.";
  assert.match(original, /class="home-source-principle" data-motion="off"/);
  assert.match(original, /<span class="sr-only">A number without a source is a rumour\.<\/span>/);
  assert.equal((original.match(/class="home-source-word"/g) ?? []).length, 8);
  assert.ok(original.indexOf(principle) < original.indexOf('<h1 id="home-title">Your business, <em>at a glance.</em></h1>'));
  assert.match(original, /Retail\. Dealerships\. Cafés\. Restaurants\./);
  assert.match(original, /href="\/how-it-works"/);
  assert.doesNotMatch(original, /See what is happening\. Know what to do next/);
});
test("the guided walkthrough retains its buying journey and reachable deep links", () => {
  for (const anchor of ["main-content","demo","platform","capabilities","connections","vanteloq-ai","security","plans","company"]) assert.ok(homepage.includes('id="'+anchor+'"'),anchor);
  for(const route of ["/pricing","/custom-plan","/contact","/help","/privacy","/features/retail-intelligence"]) assert.ok(homepage.includes('href="'+route+'"'),route);
  assert.match(homepage,/Fictional records/);
  assert.doesNotMatch(homepage,/Preview thinking|Pause logo animation/);
  assert.match(homepage,/Scripted product illustration/);
  assert.match(homepage,/How Vanteloq works/);
  assert.doesNotMatch(homepage,/>0[123]<\/span>/);
  assert.match(homepage,/start=signup&amp;plan=free/);
});
test("setup explains verification, security and billing before a source is connected", () => {
  for(const text of ["Verify your email","authenticator","add your business","subscription","review the import"]) assert.ok(homepage.includes(text),text);
  assert.match(homepage,/sample store/i);
  assert.match(homepage,/incomplete import/i);
});
