import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryShell from "../discovery-shell";
import { absoluteUrl, safeJsonLd } from "../seo";
import { planSelectionUrl } from "../../shared/plan-selection";
import { RETAIL_SOLUTION, SOLUTION_SECTORS } from "./content";
import "./sector-pages.css";

const title = "Operating reviews for retail, food and dealerships | Vanteloq";
const description = "Explore Vanteloq for retail, dealerships, cafés and restaurants. Review the records, operating decisions and source limits behind each industry workflow.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/solutions" },
  openGraph: { type: "website", url: "/solutions", title, description },
  twitter: { card: "summary", title, description },
};

export default function SolutionsPage() {
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Solutions", item: absoluteUrl("/solutions") },
    ],
  };

  return <DiscoveryShell className="sector-public-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}/>
    <main id="discovery-main" className="sector-solutions-main">
      <nav className="sector-breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-current="page">Solutions</span></nav>
      <section className="sector-hero" aria-labelledby="solutions-title">
        <div>
          <p className="sector-eyebrow">Vanteloq for your business</p>
          <h1 id="solutions-title">A clearer review of the work your business runs on.</h1>
          <p className="sector-introduction">A shop, a dealership and a kitchen need different operating records. Choose your industry to see the inputs, decisions and limits of its Vanteloq workflows.</p>
          <div className="sector-actions"><Link className="sector-button" href="/book-demo">Book a free demo</Link><Link className="sector-button secondary" prefetch={false} href={planSelectionUrl({ plan: "free", bookloq: false })} data-public-event="signup_start" data-public-section="hero" data-public-plan="free">Build your dashboard</Link></div>
          <p className="sector-small">Prefer to explore first? <Link href="/demo">Try the fictional retail demo.</Link></p>
        </div>
        <aside className="sector-question-panel" aria-label="How the review works">
          <p className="sector-eyebrow">From records to a next step</p>
          <ol className="sector-review-path">
            <li><strong>Bring the evidence</strong><p>Use records with a source, date, location and clear scope.</p></li>
            <li><strong>Inspect the calculation</strong><p>See which costs, quantities and timing support the figure.</p></li>
            <li><strong>Review the action</strong><p>Keep assumptions visible and approval with your team.</p></li>
          </ol>
        </aside>
      </section>

      <section className="sector-section" aria-labelledby="choose-industry">
        <div className="sector-section-heading"><p className="sector-eyebrow">Choose your industry</p><h2 id="choose-industry">Begin with the question you need to answer.</h2></div>
        <div className="sector-hub-grid">
          <article className="sector-hub-card"><p className="sector-eyebrow">{RETAIL_SOLUTION.label}</p><h3><Link href={RETAIL_SOLUTION.href}>{RETAIL_SOLUTION.question}</Link></h3><p>{RETAIL_SOLUTION.description}</p><p className="sector-card-records"><strong>Start with</strong> {RETAIL_SOLUTION.records}</p><Link className="sector-text-link" href={RETAIL_SOLUTION.href}>Explore retail <span aria-hidden="true">→</span></Link></article>
          {SOLUTION_SECTORS.map(sector => <article className="sector-hub-card" key={sector.slug}><p className="sector-eyebrow">{sector.label}</p><h3><Link href={`/solutions/${sector.slug}`}>{sector.question}</Link></h3><p>{sector.introduction}</p><p className="sector-card-records"><strong>Start with</strong> {sector.inputs[0]}</p><Link className="sector-text-link" href={`/solutions/${sector.slug}`}>Explore {sector.label.toLowerCase()} <span aria-hidden="true">→</span></Link></article>)}
        </div>
      </section>

      <section className="sector-section sector-tools-section" aria-labelledby="solutions-tools">
        <div className="sector-section-heading"><p className="sector-eyebrow">Try a planning question</p><h2 id="solutions-tools">Make the assumptions visible before acting.</h2><p>These public tools model your inputs. A scenario does not create an order, approve financing or establish a future outcome.</p></div>
        <div className="sector-resource-grid"><Link className="sector-resource-card" href="/tools/cash-order-planner"><span>Planning tool</span><h3>Cash order planner</h3><p>Compare a purchase and its payment timing with expected receipts and your chosen cash reserve.</p><strong>Explore the planner <span aria-hidden="true">→</span></strong></Link><Link className="sector-resource-card" href="/tools/vehicle-holding-cost"><span>Planning tool</span><h3>Vehicle holding cost</h3><p>Separate a holding-cost estimate from actual vehicle costs and inspect the rate and time assumptions.</p><strong>Explore the calculator <span aria-hidden="true">→</span></strong></Link></div>
      </section>

      <section className="sector-cta" aria-labelledby="solutions-next-step"><div><p className="sector-eyebrow">Find your starting point</p><h2 id="solutions-next-step">Bring a real operating question to the demo.</h2><p>Discuss the records you already have, supported workflows and the access your team needs. Industry settings organise your view; plan and permission requirements still apply.</p></div><div className="sector-actions"><Link className="sector-button" href="/book-demo">Book a free demo</Link><Link className="sector-button secondary" href="/pricing" data-public-event="pricing_view" data-public-section="final_cta">Review plans</Link></div></section>
    </main>
  </DiscoveryShell>;
}
