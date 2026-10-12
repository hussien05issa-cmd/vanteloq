import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DiscoveryShell from "../../discovery-shell";
import { absoluteUrl, safeJsonLd } from "../../seo";
import { planSelectionUrl } from "../../../shared/plan-selection";
import { getSolutionSector, SOLUTION_SECTORS } from "../content";
import "../sector-pages.css";

type SectorProps = { params: Promise<{ sector: string }> };

export function generateStaticParams() {
  return SOLUTION_SECTORS.map(sector => ({ sector: sector.slug }));
}

export async function generateMetadata({ params }: SectorProps): Promise<Metadata> {
  const sector = getSolutionSector((await params).sector);
  if (!sector) return { title: "Solution not found | Vanteloq", robots: { index: false, follow: false } };
  const url = `/solutions/${sector.slug}`;
  return {
    title: sector.title,
    description: sector.description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, title: sector.title, description: sector.description },
    twitter: { card: "summary", title: sector.title, description: sector.description },
  };
}

export default async function SectorSolutionPage({ params }: SectorProps) {
  const sector = getSolutionSector((await params).sector);
  if (!sector) notFound();
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Solutions", item: absoluteUrl("/solutions") },
      { "@type": "ListItem", position: 3, name: sector.label, item: absoluteUrl(`/solutions/${sector.slug}`) },
    ],
  };

  return <DiscoveryShell className="sector-public-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}/>
    <main id="discovery-main" className="sector-solutions-main">
      <nav className="sector-breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><Link href="/solutions">Solutions</Link><span aria-current="page">{sector.label}</span></nav>
      <nav className="sector-industry-nav" aria-label="Industries"><Link href="/solutions/retail">Retail</Link>{SOLUTION_SECTORS.map(item => <Link href={`/solutions/${item.slug}`} key={item.slug} aria-current={item.slug === sector.slug ? "page" : undefined}>{item.label}</Link>)}</nav>
      <section className="sector-hero" aria-labelledby="sector-title">
        <div><p className="sector-eyebrow">Vanteloq for {sector.label.toLowerCase()}</p><h1 id="sector-title">{sector.headline}</h1><p className="sector-introduction">{sector.introduction}</p><div className="sector-actions"><Link className="sector-button" href="/book-demo">Book a free demo</Link><Link className="sector-button secondary" prefetch={false} href={planSelectionUrl({ plan: "free", bookloq: false })} data-public-event="signup_start" data-public-section="hero" data-public-plan="free">Create a workspace</Link></div><p className="sector-small">{sector.fit}</p></div>
        <aside className="sector-question-panel"><p className="sector-eyebrow">Your operating question</p><h2>{sector.question}</h2><p>Keep source inputs, missing evidence and the next review together.</p><div className="sector-panel-note"><strong>Review before approval</strong><p>Your industry settings organise tools and recommended measures. They do not unlock paid features or verify connected data.</p></div></aside>
      </section>

      <section className="sector-section" aria-labelledby="sector-workflows"><div className="sector-section-heading"><p className="sector-eyebrow">The operating review</p><h2 id="sector-workflows">From the record to the decision.</h2></div><div className="sector-workflow-grid">{sector.workflows.map(workflow => <article className="sector-workflow-card" key={workflow.title}><h3>{workflow.title}</h3><p><strong>Records</strong>{workflow.records}</p><p><strong>Review decision</strong>{workflow.decision}</p></article>)}</div></section>

      <section className="sector-section sector-evidence-grid" aria-labelledby="sector-inputs"><div className="sector-inputs"><p className="sector-eyebrow">The inputs matter</p><h2 id="sector-inputs">{sector.inputHeading}</h2><ul>{sector.inputs.map(input => <li key={input}>{input}</li>)}</ul><p className="sector-small">Use matching dates, locations and currencies. An unknown value stays unknown; it is not a verified zero.</p></div><figure className="sector-example"><figcaption>Fictional illustration · CAD</figcaption><h3>{sector.example.title}</h3><dl>{sector.example.rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl><div className="sector-example-result"><span>{sector.example.resultLabel}</span><strong>{sector.example.result}</strong></div><p>{sector.example.explanation}</p><p className="sector-example-boundary">{sector.example.boundary}</p></figure></section>

      <section className="sector-section" aria-labelledby="sector-boundaries"><div className="sector-section-heading"><p className="sector-eyebrow">Scope and limits</p><h2 id="sector-boundaries">Know what the review can establish.</h2><p>These workflows organise and compare reviewed records. The next action depends on evidence, access and your approval.</p></div><div className="sector-boundary-grid">{sector.boundaries.map(boundary => <article key={boundary.title}><h3>{boundary.title}</h3><p>{boundary.detail}</p></article>)}</div></section>

      <section className="sector-section" aria-labelledby="sector-resources"><div className="sector-section-heading"><p className="sector-eyebrow">Put the method to work</p><h2 id="sector-resources">Read the guide. Test the assumptions.</h2></div><div className="sector-resource-grid sector-resource-grid-three">{sector.guides.map(guide => <Link className="sector-resource-card" href={guide.href} key={guide.href}><span>Business guide</span><h3>{guide.title}</h3><p>{guide.description}</p><strong>Read the guide <span aria-hidden="true">→</span></strong></Link>)}<Link className="sector-resource-card" href={sector.tool.href}><span>Planning tool</span><h3>{sector.tool.title}</h3><p>{sector.tool.description}</p><strong>Try the tool <span aria-hidden="true">→</span></strong></Link></div>{sector.slug === "dealerships" && <p className="sector-small">Planning a parts or supplier purchase? <Link href="/tools/cash-order-planner">Try the cash order planner.</Link></p>}</section>

      <section className="sector-cta" aria-labelledby="sector-next-step"><div><p className="sector-eyebrow">Your next step</p><h2 id="sector-next-step">Bring your {sector.industryId === "cafe" ? "café" : sector.industryId} records into the conversation.</h2><p>Book a demo to review your sector requirements and access. The <Link href="/demo">public interactive demo</Link> uses fictional retail records and requires no signup.</p></div><div className="sector-actions"><Link className="sector-button" href="/book-demo">Book a free demo</Link><Link className="sector-button secondary" prefetch={false} href={planSelectionUrl({ plan: "free", bookloq: false })} data-public-event="signup_start" data-public-section="final_cta" data-public-plan="free">Create a workspace</Link></div></section>
    </main>
  </DiscoveryShell>;
}
