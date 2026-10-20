import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalShell } from "../app/legal-shell";
import { ResourceShell } from "../app/resources/components";
import PricingPage from "../app/pricing/page";
import HelpPage from "../app/help/page";
import ContactPage from "../app/contact/page";
import BookDemoPage from "../app/book-demo/page";
import CustomPlanPage from "../app/custom-plan/page";
import DeelHelpPage from "../app/help/deel/page";
import SocialHubPage from "../app/social/page";
import HomepageLanding from "../app/homepage-landing";

// A footer destination that omits the system boundary recreates the abrupt
// fixed-light page reported by visitors using a dark device theme.
const pages = [
  ["legal documents", <LegalShell eyebrow="Policy" title="Policy heading" summary="Policy summary"><p>Unchanged document content.</p></LegalShell>],
  ["resource library", <ResourceShell><main><h1>Resource heading</h1></main></ResourceShell>],
  ["pricing", <PricingPage/>],
  ["help", <HelpPage/>],
  ["contact", <ContactPage/>],
  ["demo booking", <BookDemoPage/>],
  ["custom plans", <CustomPlanPage/>],
  ["Deel help", <DeelHelpPage/>],
  ["social hub", <SocialHubPage/>],
  ["retail landing", <HomepageLanding retail/>],
  ["product walkthrough", <HomepageLanding guide/>],
] as const;

for (const [name, page] of pages) {
  test(`${name} keeps a stable system appearance boundary without a theme control`, () => {
    const html = renderToStaticMarkup(page);
    assert.match(html, /data-public-theme="dark" data-public-appearance="system"/);
    assert.doesNotMatch(html, /aria-label="Colour theme"|public-appearance-control/);
    assert.match(html, /href="\/"/);
  });
}

test("resource navigation offers the same dashboard action as the main site", () => {
  const html = renderToStaticMarkup(<ResourceShell><main>Guide content</main></ResourceShell>);
  assert.match(html, /href="\/\?start=signup"[^>]*>Build your dashboard</);
  assert.doesNotMatch(html, />Create workspace</);
});
