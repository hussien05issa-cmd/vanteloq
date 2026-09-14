import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";

const homepage = renderToStaticMarkup(createElement(Home));
test("the focused homepage retains its buying journey and reachable deep links", () => {
  for (const anchor of ["main-content","demo","platform","capabilities","connections","vanteloq-ai","security","plans","company"]) assert.ok(homepage.includes('id="'+anchor+'"'),anchor);
  for(const route of ["/pricing","/custom-plan","/contact","/help","/privacy","/features/retail-intelligence"]) assert.ok(homepage.includes('href="'+route+'"'),route);
  assert.match(homepage,/Fictional records/);
  assert.doesNotMatch(homepage,/Preview thinking|Pause logo animation/);
  assert.match(homepage,/ai-orbit-showcase/);
});
test("setup explains verification, security and billing before a source is connected", () => {
  for(const text of ["Verify your email","authenticator","add your business","subscription","review the import"]) assert.ok(homepage.includes(text),text);
  assert.match(homepage,/sample workspace/i);
  assert.match(homepage,/incomplete import/i);
});
