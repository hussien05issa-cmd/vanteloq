import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdvisoryPage, { metadata } from "../app/advisory/page";

const html = renderToStaticMarkup(createElement(AdvisoryPage));

test("advisory route gives the service one clear identity and customer journey", () => {
  assert.equal(metadata.alternates?.canonical, "/advisory");
  assert.equal(Array.from(html.matchAll(/<h1(?:\s|>)/g)).length, 1);
  assert.match(html, /<main id="discovery-main"/);
  assert.match(html, /Vanteloq Advisory/);
  assert.match(html, /Clearer Business Decisions\. <span>Practical <span class="advisory-keep-together">Follow-Through\.<\/span><\/span>/);
  assert.match(html, /href="#contact"/);
  assert.match(html, /href="#method"/);
  assert.match(html, /Based in Edmonton, Alberta/);
  assert.doesNotMatch(html, /VantaTalk|BookLoQ|brand family/i);
});

test("team section preserves approved people, order, titles and responsive portraits", () => {
  const names = ["Zak Mohamed", "Ahmed Yassin", "Hussien Issa"];
  let previous = -1;
  for (const name of names) {
    const index = html.indexOf(name);
    assert.ok(index > previous, `${name} must appear in the approved order`);
    previous = index;
  }
  for (const title of ["Partner, Data Analytics", "Partner, Accounting", "Founder and Managing Director"]) assert.match(html, new RegExp(title));
  for (const name of names) assert.match(html, new RegExp(`alt="Portrait of ${name}"`));
  for (const slug of ["zak-mohamed", "ahmed-yassin", "hussien-issa"]) {
    assert.ok(html.includes(`/brand/advisory/team/${slug}-256.webp`));
    assert.ok(html.includes(`/brand/advisory/team/${slug}-480.webp`));
    assert.ok(html.includes(`/brand/advisory/team/${slug}-768.webp`));
  }
  assert.equal(Array.from(html.matchAll(/class="advisory-team-card"/g)).length, 3);
});

test("origin film is preserved as a deliberate click-to-play story", () => {
  const video = html.match(/<video[^>]*>/)?.[0] ?? "";
  assert.match(video, /controls=""/);
  assert.match(video, /playsInline=""/);
  assert.match(video, /preload="none"/);
  assert.match(video, /poster="\/brand\/advisory\/vanteloq-advisory-origin-poster\.webp"/);
  assert.doesNotMatch(video, /autoPlay/);
  assert.match(html, /src="\/brand\/advisory\/vanteloq-advisory-origin-film\.mp4"/);
  assert.match(html, /Our advisory work began as Lexedge Consulting and is now part of Vanteloq\./);
  assert.equal((html.match(/Lexedge Consulting/g) ?? []).length, 1);
});

test("advisory content is concise, accessible and focused on one conversion path", () => {
  for (const step of ["Understand", "Diagnose", "Decide", "Implement", "Review"]) assert.match(html, new RegExp(`>${step}<`));
  const faq = html.slice(html.indexOf('class="advisory-faq-list"'), html.indexOf('</section>', html.indexOf('class="advisory-faq-list"')));
  assert.equal(Array.from(faq.matchAll(/<details/g)).length, 4);
  assert.equal(Array.from(faq.matchAll(/<details open/g)).length, 0);
  assert.match(html, /Use Advisory With or Without Vanteloq Workspace\./);
  assert.match(html, /purpose="advisory"/);
  assert.match(html, /href="\/social"/);
  assert.match(html, /aria-label="Follow Vanteloq"/);
  assert.match(html, /"@type":"Service"/);
  assert.doesNotMatch(html, /guarantee|guaranteed revenue|certified accountant|legal advice/i);
});
