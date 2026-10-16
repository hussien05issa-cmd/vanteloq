import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, statSync } from "node:fs";
import AdvisoryPage, { metadata } from "../app/advisory/page";
import {
  connectionAllowsCinematicMedia,
  isCinematicMediaNearViewport,
  readCinematicDocumentState,
  requestCinematicPlayback,
  shouldMountCinematicSource,
  shouldPlayCinematicSource,
  shouldRenderCinematicSource,
} from "../app/advisory/advisory-hero-media-policy";
import AdvisoryInquiry, { advisoryInquiryReducer, isAdvisoryInquiryHash } from "../app/advisory/advisory-inquiry";
import { isInterfaceMotionDisabledPath } from "../app/interface-motion";
import { SOCIAL_PROFILES } from "../app/social-profiles";

const html = renderToStaticMarkup(createElement(AdvisoryPage));

test("advisory route gives the service one clear identity and customer journey", () => {
  assert.equal(metadata.alternates?.canonical, "/advisory");
  assert.equal(metadata.title, "Business Consulting and Analytics in Edmonton | Vanteloq");
  assert.match(String(metadata.description), /Business consulting, analytics and practical implementation/);
  assert.equal(Array.from(html.matchAll(/<h1(?:\s|>)/g)).length, 1);
  assert.match(html, /<main id="discovery-main"/);
  assert.match(html, /Vanteloq Advisory/);
  assert.match(html, /Clearer Business Decisions\. <span class="advisory-title-accent">Practical <span class="advisory-keep-together">Follow-Through\.<\/span><\/span>/);
  assert.match(html, /href="#contact"/);
  assert.match(html, /href="#method"/);
  assert.doesNotMatch(html, /advisory-outcome-flow/);
  assert.match(html, /Based in Edmonton, Alberta/);
  assert.match(html, /provides business consulting, analytics and practical implementation/);
  assert.match(html, /vanteloq-advisory-signal-path-480\.webp 480w/);
  assert.match(html, /vanteloq-advisory-signal-path-1280\.webp 1280w/);
  assert.doesNotMatch(html, /advisory-outcome-flow|One priority at a time|A Useful Answer Works in the Business/);
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

test("hero motion is deferred, self-hosted and resilient", () => {
  const media = readFileSync(new URL("../app/advisory/advisory-hero-media.tsx", import.meta.url), "utf8");
  const policy = readFileSync(new URL("../app/advisory/advisory-hero-media-policy.ts", import.meta.url), "utf8");
  assert.match(media, /useMotionPreference/);
  assert.match(media, /IntersectionObserver/);
  assert.match(media, /visibilitychange/);
  assert.match(media, /connection\?\.addEventListener\?\.\("change", updateConnection\)/);
  assert.match(media, /document\.readyState === "complete"/);
  assert.match(media, /requestIdleCallback/);
  assert.match(policy, /saveData/);
  assert.match(policy, /effectiveType/);
  assert.match(media, /muted/);
  assert.match(media, /playsInline/);
  assert.match(media, /preload="none"/);
  assert.match(media, /aria-hidden="true"/);
  assert.match(media, /vanteloq-advisory-connected-systems\.mp4/);
  assert.match(media, /media="\(max-width: 680px\)"/);
  assert.match(media, /vanteloq-advisory-connected-systems-mobile\.mp4/);
  assert.ok(media.indexOf("vanteloq-advisory-connected-systems-mobile.mp4") < media.indexOf("vanteloq-advisory-connected-systems.mp4"));
  assert.ok(statSync(new URL("../public/brand/advisory/vanteloq-advisory-connected-systems-mobile.mp4", import.meta.url)).size < 2_000_000);
  assert.ok(statSync(new URL("../public/brand/advisory/vanteloq-advisory-connected-systems.mp4", import.meta.url)).size < 5_000_000);
  assert.match(media, /setFailed\(true\)/);
  assert.doesNotMatch(media, /\bloop\b/);
  assert.doesNotMatch(media, /cloudfront|https?:\/\//i);
  assert.match(html, /alt=""[^>]*fetchPriority="high"/);
  assert.doesNotMatch(html, /vanteloq-advisory-connected-systems\.mp4/);
});

test("hero cinematic source mounting respects every runtime gate", () => {
  const allowed = {
    failed: false,
    mediaAllowed: true,
    motion: true,
    pageLoaded: true,
    pageVisible: true,
    sourceMounted: false,
    visible: true,
  };
  assert.equal(shouldMountCinematicSource(allowed), true);

  for (const key of ["mediaAllowed", "motion", "pageLoaded", "pageVisible", "visible"] as const) {
    assert.equal(shouldMountCinematicSource({ ...allowed, [key]: false }), false, `${key} must suppress the source`);
  }
  assert.equal(shouldMountCinematicSource({ ...allowed, failed: true }), false);
  assert.equal(shouldMountCinematicSource({ ...allowed, sourceMounted: true }), false);

  assert.equal(connectionAllowsCinematicMedia(), true);
  assert.equal(connectionAllowsCinematicMedia({ effectiveType: "4g" }), true);
  assert.equal(connectionAllowsCinematicMedia({ saveData: true, effectiveType: "4g" }), false);
  for (const effectiveType of ["slow-2g", "2g", "3g"]) {
    assert.equal(connectionAllowsCinematicMedia({ effectiveType }), false);
  }
});

test("hero cinematic source stops rendering and playing when the network policy changes", () => {
  const mounted = {
    failed: false,
    mediaAllowed: true,
    motion: true,
    pageVisible: true,
    sourceMounted: true,
    visible: true,
  };
  assert.equal(shouldRenderCinematicSource(mounted), true);
  assert.equal(shouldPlayCinematicSource(mounted), true);

  const blocked = { ...mounted, mediaAllowed: false };
  assert.equal(shouldRenderCinematicSource(blocked), false);
  assert.equal(shouldPlayCinematicSource(blocked), false);

  const media = readFileSync(new URL("../app/advisory/advisory-hero-media.tsx", import.meta.url), "utf8");
  assert.match(media, /video\.current\?\.pause\(\)/);
  assert.match(media, /setSourceMounted\(false\)/);
});

test("hero document state synchronizes loaded and hidden tabs immediately", () => {
  assert.deepEqual(readCinematicDocumentState({ hidden: false, readyState: "complete" }), { pageLoaded: true, pageVisible: true });
  assert.deepEqual(readCinematicDocumentState({ hidden: true, readyState: "interactive" }), { pageLoaded: false, pageVisible: false });
});

test("hero visibility initializes from the current viewport before observer delivery", () => {
  assert.equal(isCinematicMediaNearViewport({ top: 590, bottom: 1175 }, 1200), true);
  assert.equal(isCinematicMediaNearViewport({ top: 558, bottom: 827 }, 844), true);
  assert.equal(isCinematicMediaNearViewport({ top: 1400, bottom: 1900 }, 844), false);
  assert.equal(isCinematicMediaNearViewport({ top: -700, bottom: -300 }, 844), false);
});

test("hero playback pauses when inactive and preserves the poster when autoplay rejects", async () => {
  let paused = 0;
  let played = 0;
  const inactive = {
    pause: () => { paused += 1; },
    play: async () => { played += 1; },
  };
  assert.equal(await requestCinematicPlayback(inactive, false), false);
  assert.equal(paused, 1);
  assert.equal(played, 0);

  const rejected = {
    pause: () => { paused += 1; },
    play: async () => { played += 1; throw new Error("Autoplay unavailable"); },
  };
  assert.equal(await requestCinematicPlayback(rejected, true), false);
  assert.equal(played, 1);

  const accepted = {
    pause: () => { paused += 1; },
    play: async () => { played += 1; },
  };
  assert.equal(await requestCinematicPlayback(accepted, true), true);
  assert.equal(played, 2);
});

test("advisory content is concise, accessible and focused on one conversion path", () => {
  for (const step of ["Understand", "Diagnose", "Decide", "Implement", "Review"]) assert.match(html, new RegExp(`>${step}<`));
  const faq = html.slice(html.indexOf('class="advisory-faq-list"'), html.indexOf('</section>', html.indexOf('class="advisory-faq-list"')));
  assert.equal(Array.from(faq.matchAll(/<details/g)).length, 4);
  assert.equal(Array.from(faq.matchAll(/<details open/g)).length, 0);
  assert.match(html, /Use Advisory With or Without Vanteloq Workspace\./);
  assert.match(html, /href="\/workspace"[^>]*>Explore Vanteloq Workspace/);
  assert.equal((html.match(/href="\/resources\/business-consulting-vs-business-software"/g) ?? []).length, 1);
  assert.match(html, /href="\/social"/);
  assert.match(html, /aria-label="Follow Vanteloq"/);
  assert.match(html, /id="team"/);
  const socialStart = html.indexOf('<section class="advisory-social"');
  const social = html.slice(socialStart, html.indexOf('</section>', socialStart));
  assert.match(social, /aria-label="Vanteloq social profiles"/);
  assert.doesNotMatch(social, /advisory-social-card|<h2/);
  for (const profile of Object.values(SOCIAL_PROFILES)) {
    assert.ok(social.includes(`href="${profile.href.replaceAll("&", "&amp;")}"`));
    assert.ok(social.includes(`aria-label="Vanteloq on ${profile.name} (opens in a new tab)"`));
  }
  assert.doesNotMatch(html, /-qr\.(?:svg|png)/);
  assert.match(html, /"@type":"Service"/);
  for (const type of ["WebPage", "BreadcrumbList", "FAQPage"]) assert.match(html, new RegExp(`"@type":"${type}"`));
  assert.equal(Array.from(html.matchAll(/"@type":"Person"/g)).length, 3);
  assert.equal(Array.from(html.matchAll(/"@type":"Question"/g)).length, 4);
  assert.doesNotMatch(html, /guarantee|guaranteed revenue|certified accountant|legal advice/i);
  assert.doesNotMatch(html, /aggregateRating|meta name="keywords"/i);
});

test("advisory clarity calls use the first-party inquiry flow", () => {
  assert.match(html, /href="#contact"[^>]*>Talk to an Advisor/);
  assert.doesNotMatch(html, /advisory-schedule-link|advisory-contact-points/);
  assert.match(html, /id="advisory-inquiry-form"[^>]*data-inquiry-purpose="advisory"/);
  assert.match(html, /vanteloq-advisory-signal-path-480\.webp 480w/);
  assert.match(html, /vanteloq-advisory-signal-path-1280\.webp 1280w/);
  for (const detail of ["30 minutes, virtual or in Edmonton.", "No payment to request.", "We agree on scope and fees before paid work."]) assert.ok(html.includes(detail));
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
  assert.match(css, /custom-plan-error \{ color: #ffadb5!important; \}/);
  assert.match(css, /forced-colors: active/);
  assert.doesNotMatch(css, /transition:\s*all/i);
});

test("advisory motion is progressive, sequenced and scoped to the route", () => {
  const css = readFileSync(new URL("../app/advisory/advisory.css", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../app/advisory/advisory-motion.tsx", import.meta.url), "utf8");
  assert.equal(Array.from(html.matchAll(/data-advisory-reveal="true"/g)).length, 8);
  assert.equal(Array.from(html.matchAll(/class="advisory-team-card"[^>]*data-advisory-item="true"/g)).length, 3);
  assert.equal(Array.from(html.matchAll(/class="advisory-method-list"[\s\S]*?<\/ol>/g))[0]?.[0].match(/data-advisory-item/g)?.length, 5);
  assert.match(html, /class="advisory-method-progress" aria-hidden="true"/);
  assert.equal(Array.from(html.matchAll(/class="advisory-faq-answer"/g)).length, 4);

  for (const token of ["--advisory-motion-ease", "--advisory-motion-base", "--advisory-motion-distance"]) assert.match(css, new RegExp(token));
  for (const animation of ["advisory-hero-enter", "advisory-hero-media-enter"]) assert.match(css, new RegExp(`@keyframes ${animation}`));
  for (const removedAnimation of ["advisory-accent-draw", "advisory-orb-drift"]) assert.doesNotMatch(css, new RegExp(`@keyframes ${removedAnimation}`));
  assert.match(css, /data-advisory-motion="ready"/);
  assert.match(css, /data-advisory-visible="true"/);
  assert.match(css, /transform:\s*scaleX\(0\)/);
  assert.match(css, /transform:\s*scaleY\(0\)/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

  assert.match(controller, /IntersectionObserver/);
  assert.match(controller, /requestAnimationFrame/);
  assert.match(controller, /focusin/);
  assert.match(controller, /useMotionPreference/);
  assert.match(controller, /observer\.disconnect\(\)/);
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
