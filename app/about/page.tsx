import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryShell from "../discovery-shell";
import { absoluteUrl, safeJsonLd } from "../seo";
import "./credibility.css";

export const metadata: Metadata = {
  title: "About Vanteloq | Operator and product approach",
  description: "Learn who operates Vanteloq, how source records support business decisions, and where to review product controls, editorial methods and service limits.",
  alternates: { canonical: "/about" },
  openGraph: { type: "website", url: "/about", title: "About Vanteloq", description: "The operator, product approach and review controls behind Vanteloq." },
};

export default function AboutPage() {
  return <DiscoveryShell className="credibility-site">
    <main id="discovery-main" className="credibility-main">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd({
        "@context": "https://schema.org",
        "@type": "AboutPage",
        "@id": `${absoluteUrl("/about")}#page`,
        url: absoluteUrl("/about"),
        name: "About Vanteloq",
        mainEntity: { "@id": `${absoluteUrl()}#organization` },
      }) }} />
      <nav className="credibility-breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><span>About</span></nav>
      <header className="credibility-hero">
        <div><p className="credibility-eyebrow">ABOUT VANTELOQ</p><h1>Useful business information starts with reviewable records.</h1><p className="credibility-lead">Vanteloq brings sales, inventory, financial records and daily work into a connected operating view. Its purpose is to help an authorized person understand the evidence and decide what to do next.</p></div>
        <aside className="credibility-facts" aria-label="Operator details"><h2>Who operates the service</h2><dl><div><dt>Legal operator</dt><dd>Vanteloq Inc.</dd></div><div><dt>Product</dt><dd>Vanteloq</dd></div><div><dt>Location</dt><dd>Alberta, Canada</dd></div><div><dt>Contact</dt><dd><a href="mailto:support@vanteloq.com">support@vanteloq.com</a></dd></div></dl></aside>
      </header>

      <section className="credibility-section" aria-labelledby="product-approach"><h2 id="product-approach">An operating view with visible boundaries</h2><p>Vanteloq supports different questions for independent retailers, dealerships, cafés and restaurants. BookLoQ brings financial review and cash planning into the workspace. The available functions depend on your plan, permissions, source records and provider configuration.</p><p>A connection is a source of records, not proof that the records are complete. Missing costs, dates or balances can limit a calculation. Demonstrations use fictional values so you can explore a workflow before connecting business data.</p><div className="credibility-links"><Link href="/solutions">Explore business workflows</Link><Link href="/integrations">Check connection requirements</Link><Link href="/demo">Try the fictional demo</Link></div></section>

      <section className="credibility-section" aria-labelledby="data-controls"><h2 id="data-controls">How you retain control of the data</h2><div className="credibility-grid">
        <article><h3>Review the inputs</h3><p>Reports identify their dates and available evidence. Reviewed imports, source selection and reconciliation help distinguish a source record from a reliable reporting input. Missing information remains a limitation.</p></article>
        <article><h3>Choose the right access</h3><p>Workspace membership, role permissions and permitted locations govern reporting and AI summaries. Finance and other sensitive views require their own permissions.</p></article>
        <article><h3>Control AI context</h3><p>AI Settings lets you choose whether permitted workspace summaries accompany a question and whether eligible chats are saved. Explicitly attached files have a separate review and consent step.</p></article>
        <article><h3>Manage records and connections</h3><p>Authorized users can export permitted records and disconnect providers. Account or workspace deletion is a separate protected process with scope checks. Retained accounting records, provider records and backups follow their applicable rules.</p></article>
      </div><div className="credibility-links"><Link href="/help">Read the setup and control guides</Link><Link href="/privacy">Read the privacy policy</Link></div></section>

      <section className="credibility-section" aria-labelledby="review-responsibility"><h2 id="review-responsibility">The decision remains with you</h2><p>Calculations depend on the quality and timing of the inputs. An AI explanation or planning scenario can be incomplete or wrong. Review material financial, tax, legal and operational decisions against the original records and seek qualified advice where appropriate.</p><p>Vanteloq AI explains permitted evidence. It does not gain authority to post journals, make payments, place orders or contact customers by answering a question.</p><div className="credibility-links"><Link href="/terms">Review the service limits</Link><Link href="/about/editorial">How we prepare the resource library</Link></div></section>

      <section className="credibility-contact"><div><h2>Discuss your records and requirements.</h2><p>Ask about the product, a connection requirement or a resource correction. Keep private business records out of an initial message.</p></div><div className="credibility-links"><Link href="/contact">Contact Vanteloq</Link><Link href="/book-demo">Request a free demo</Link></div></section>
      <p className="credibility-updated">Page prepared <time dateTime="2026-10-11">October 11, 2026</time>.</p>
    </main>
  </DiscoveryShell>;
}
