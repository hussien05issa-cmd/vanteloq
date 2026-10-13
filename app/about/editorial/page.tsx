import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryShell from "../../discovery-shell";
import { absoluteUrl, safeJsonLd } from "../../seo";
import "../credibility.css";

export const metadata: Metadata = {
  title: "Editorial method | Vanteloq resource library",
  description: "How Vanteloq guides separate source facts, calculations, assumptions and product limits, with dated sources, linked bylines and a route for corrections.",
  alternates: { canonical: "/about/editorial" },
  openGraph: { type: "website", url: "/about/editorial", title: "Vanteloq editorial method", description: "Clear definitions, explicit assumptions and sources you can inspect." },
};

export default function EditorialPage() {
  return <DiscoveryShell className="credibility-site">
    <main id="discovery-main" className="credibility-main credibility-editorial">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd({
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": `${absoluteUrl("/about/editorial")}#page`,
        url: absoluteUrl("/about/editorial"),
        name: "Vanteloq editorial method",
        about: { "@id": `${absoluteUrl()}#organization` },
      }) }} />
      <nav className="credibility-breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href="/about">About</Link><span aria-hidden="true">/</span><span>Editorial method</span></nav>
      <header className="credibility-editorial-hero"><p className="credibility-eyebrow">VANTELOQ EDITORIAL TEAM</p><h1>Explain the method. Keep the evidence and limits visible.</h1><p className="credibility-lead">The resource library helps owners and managers understand an operating question, examine the inputs and apply a method to their own records.</p></header>

      <section className="credibility-section" aria-labelledby="editorial-attribution"><h2 id="editorial-attribution">Who is responsible for the guides</h2><p><strong>Vanteloq Editorial Team</strong> is the publishing byline for this resource library. The guides are published by Vanteloq Inc., which operates Vanteloq.</p><p>These pages include AI-assisted writing and editing. The byline identifies the publisher; it does not certify independent professional review. General guidance does not establish a professional adviser relationship.</p><div className="credibility-links"><Link href="/about">About the operator and product</Link><Link href="/terms">Service terms</Link></div></section>

      <section className="credibility-section" aria-labelledby="editorial-method"><h2 id="editorial-method">How a guide explains a business question</h2><ol className="credibility-method">
        <li><h3>Define the question and the inputs</h3><p>Start with a direct answer, then explain the terms, units, dates and records the method needs. Similar measures get separate definitions, such as gross profit, food contribution and net operating profit.</p></li>
        <li><h3>Separate facts from assumptions</h3><p>Show the calculation and a worked example. Fictional amounts, scenario rates and planning buffers are illustrations. They are not industry benchmarks, forecasts or customer results.</p></li>
        <li><h3>Provide sources and their boundaries</h3><p>Link to the original material where practical, including official product documentation, public reporting and recognized accounting or business sources. A dated company result illustrates that company&apos;s experience. A source link does not imply endorsement of Vanteloq.</p></li>
        <li><h3>Describe the product as it operates</h3><p>Product explanations follow the implemented workflow and its access, configuration and evidence requirements. A sandbox connection, demonstration or available route does not establish that a provider is ready for a customer&apos;s production account.</p></li>
        <li><h3>Leave the judgment visible</h3><p>Missing information is not silently replaced with zero. Associations and historical comparisons do not establish causation. Material decisions require source review and, where appropriate, qualified advice.</p></li>
      </ol></section>

      <section className="credibility-section" aria-labelledby="guide-dates"><h2 id="guide-dates">Dates, product references and corrections</h2><p>Each guide shows a published date and an updated date. The updated date belongs to the guide&apos;s content record. A website deployment does not by itself establish that every guide or source was reviewed again.</p><p>Provider rules, products and legal requirements can change. Check the linked original source before relying on a time-sensitive statement. Where a guide discusses Canadian legal obligations, the relevant federal, provincial or territorial scope matters.</p><p>Send a correction with the guide URL, the passage in question and a supporting source through <Link href="/contact">the contact form</Link> or <a href="mailto:support@vanteloq.com">support@vanteloq.com</a>. Do not include private customer records.</p></section>

      <section className="credibility-contact"><div><h2>Start with a question you can verify.</h2><p>Read a guide, try a fictional calculation and compare the result with your own source records.</p></div><div className="credibility-links"><Link href="/resources">Browse the published guides</Link><Link href="/tools">Explore the planning tools</Link></div></section>
      <p className="credibility-updated">Editorial method prepared <time dateTime="2026-10-11">October 11, 2026</time>.</p>
    </main>
  </DiscoveryShell>;
}
