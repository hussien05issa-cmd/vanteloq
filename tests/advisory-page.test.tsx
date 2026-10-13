import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import AdvisoryPage, { metadata } from "../app/advisory/page";
import AdvisoryInquiry, { advisoryInquiryReducer, isAdvisoryInquiryHash } from "../app/advisory/advisory-inquiry";
import { isInterfaceMotionDisabledPath } from "../app/interface-motion";

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
  assert.match(html, /data-public-theme="dark"/);
  assert.doesNotMatch(html, /aria-label="Colour theme"/);
  assert.match(html, /aria-label="Book a Walkthrough"[^>]*href="\/book-demo"/);
  assert.equal(Array.from(html.matchAll(/href="\/book-demo"/g)).length, 1);
  assert.doesNotMatch(html, /VantaTalk|BookLoQ|brand family/i);
});

test("advisory services use one connected path instead of repeated cards", () => {
  assert.equal(Array.from(html.matchAll(/class="advisory-capability-path"/g)).length, 1);
  assert.doesNotMatch(html, /advisory-capability-mark/);
  assert.match(html, /class="advisory-capability-path" role="list"/);
  assert.match(html, /class="advisory-method-list" role="list"/);
  assert.doesNotMatch(html, /advisory-capability-grid/);
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
  assert.equal((html.match(/href="\/resources\/business-consulting-vs-business-software"/g) ?? []).length, 1);
  assert.match(html, /href="\/social"/);
  assert.match(html, /aria-label="Follow Vanteloq"/);
  assert.match(html, /id="team"/);
  assert.equal(Array.from(html.matchAll(/class="advisory-social-card advisory-social-card-/g)).length, 4);
  for (const platform of ["Instagram", "TikTok", "YouTube", "Facebook"]) assert.match(html, new RegExp(`>${platform}<`));
  assert.doesNotMatch(html, /-qr\.(?:svg|png)/);
  assert.match(html, /"@type":"Service"/);
  assert.doesNotMatch(html, /guarantee|guaranteed revenue|certified accountant|legal advice/i);
});

test("advisory clarity calls use the first-party inquiry flow", () => {
  assert.match(html, /href="#advisory-inquiry-form"[^>]*>Request a 30-Minute Clarity Call/);
  assert.match(html, /id="advisory-inquiry-form"[^>]*data-inquiry-purpose="advisory"/);
  assert.match(html, /vanteloq-advisory-signal-path-480\.webp 480w/);
  assert.match(html, /vanteloq-advisory-signal-path-1280\.webp 1280w/);
  for (const detail of ["30 minutes", "Virtual or Edmonton", "No payment to request"]) assert.match(html, new RegExp(detail));
  assert.doesNotMatch(html, /calendly\.com|hussienissa-lexedgeconsulting|Book a 30-Minute Clarity Call/);
});

test("advisory loading is reserved for the real asynchronous form", () => {
  const inquiry = renderToStaticMarkup(createElement(AdvisoryInquiry));
  assert.match(inquiry, /id="advisory-inquiry-form"/);
  assert.match(inquiry, /data-inquiry-purpose="advisory"/);
  assert.match(inquiry, /data-loading-state="waiting"/);
  assert.doesNotMatch(inquiry, /aria-busy="true"/);
  assert.match(inquiry, /class="advisory-inquiry-skeleton"/);
  assert.doesNotMatch(inquiry, /role="button"|<button|\.\.\.|…/);

  const css = readFileSync(new URL("../app/advisory/advisory.css", import.meta.url), "utf8");
  assert.match(css, /@keyframes advisory-skeleton-shift/);
  assert.match(css, /prefers-reduced-motion: no-preference/);
  assert.match(css, /data-motion="off"/);
  assert.match(css, /forced-colors: active/);
  assert.doesNotMatch(css, /advisory-(?:enter|signal-drift|light-sweep|social-float|social-orbit|capability-glow)/);
});

test("advisory motion and inquiry loading remain correct across navigation and retries", () => {
  assert.equal(isInterfaceMotionDisabledPath("/advisory"), true);
  assert.equal(isInterfaceMotionDisabledPath("/"), false);
  assert.equal(isInterfaceMotionDisabledPath("/pricing"), false);
  assert.equal(isAdvisoryInquiryHash("#advisory-inquiry-form"), true);
  assert.equal(isAdvisoryInquiryHash("#contact"), true);
  assert.equal(isAdvisoryInquiryHash("#team"), false);

  const waiting = { phase: "waiting" as const, error: "", attempt: 0 };
  const loading = advisoryInquiryReducer(waiting, { type: "start" });
  assert.deepEqual(loading, { phase: "loading", error: "", attempt: 0 });
  const error = advisoryInquiryReducer(loading, { type: "fail", message: "Unavailable" });
  assert.deepEqual(error, { phase: "error", error: "Unavailable", attempt: 0 });
  const retry = advisoryInquiryReducer(error, { type: "retry" });
  assert.deepEqual(retry, { phase: "loading", error: "", attempt: 1 });
  assert.deepEqual(advisoryInquiryReducer(retry, { type: "ready" }), { phase: "ready", error: "", attempt: 1 });
});
