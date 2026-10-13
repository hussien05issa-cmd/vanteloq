import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DiscoveryShell from "../../discovery-shell";
import IntegrationBrandLogo from "../../integration-brand-logo";
import { integrationCatalog, integrationPublicStatus } from "../../integration-catalog";
import { absoluteUrl, safeJsonLd } from "../../seo";
import { PUBLIC_INTEGRATION_GUIDES, getPublicIntegrationGuide } from "../content";
import "../integration-guides.css";

type Props = { params: Promise<{ provider: string }> };
export function generateStaticParams() { return Object.keys(PUBLIC_INTEGRATION_GUIDES).map(provider => ({ provider })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { provider } = await params, guide = getPublicIntegrationGuide(provider);
  return guide ? { title: guide.title, description: guide.description, alternates: { canonical: `/integrations/${provider}` }, openGraph: { title: guide.title, description: guide.description, url: `/integrations/${provider}`, type: "website" } } : { title: "Connection guide not found | Vanteloq", robots: { index: false, follow: false } };
}

export default async function IntegrationGuide({ params }: Props) {
  const { provider: id } = await params, guide = getPublicIntegrationGuide(id);
  if (!guide) notFound();
  const provider = integrationCatalog.find(item => item.id === id)!;
  const status = integrationPublicStatus(provider);
  const breadcrumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Integration guides", item: absoluteUrl("/integrations") },
    { "@type": "ListItem", position: 2, name: guide.name, item: absoluteUrl(`/integrations/${id}`) },
  ] };
  return <DiscoveryShell className="integration-guide-page"><main id="discovery-main" className="integration-guide-main">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }}/>
    <nav aria-label="Breadcrumb"><Link href="/integrations">Integration guides</Link> / {guide.name}</nav>
    <header><span className="integration-guide-mark"><IntegrationBrandLogo name={guide.markName}/></span><p className="integration-guide-eyebrow">{status.label} · {guide.name}</p><h1>{guide.name}, with the records behind the numbers.</h1><p className="integration-guide-lead">{guide.lead}</p><div className="integration-guide-actions"><Link href="/?start=signup">Build your dashboard →</Link><Link href="/demo#retail">Inspect a fictional example →</Link></div><p>Connection availability and reporting depend on your account, authorisation, configured source and completed review. Check the current connection screen before choosing a plan.</p></header>
    <section><h2>What Vanteloq can read</h2><dl className="integration-records">{guide.records.map(([title, body]) => <div key={title}><dt>{title}</dt><dd>{body}</dd></div>)}</dl></section>
    <section><h2>Before the numbers reach your dashboard</h2><div className="integration-guide-grid"><article><h3>Authorise your account</h3><p>In your own workspace, review the connection&apos;s privacy acknowledgement, then approve the provider&apos;s permissions. You choose the account; another customer&apos;s connection is not used for your reports.</p></article><article><h3>Map and finish the import</h3><p>Match source locations, inspect validation and continue any unfinished history. Record the same date range and location when comparing totals.</p></article><article><h3>Review the source totals</h3><p>Check a representative period against your POS. Review differences and missing inputs before approving reports. A successful sign-in is only the first step.</p></article></div></section>
    <section><h2>Why sales and payouts can differ</h2><p>Sales, payments and bank deposits describe different events. Refunds, sales tax, fees and settlement dates can explain a difference. Do not count both a sale and its payment as separate revenue.</p><div className="integration-calculation"><span>Fictional merchandise-sales example · CAD</span><dl><div><dt>Completed merchandise sales</dt><dd>$1,250.00</dd></div><div><dt>Merchandise refunds</dt><dd>−$50.00</dd></div><div><dt>Net merchandise sales</dt><dd>$1,200.00</dd></div></dl><p>Sales tax excluded. This example does not determine the payout, profit or bank balance.</p></div><Link href="/resources/how-to-calculate-gross-margin-small-business">Understand cost and margin →</Link></section>
    <section><h2>Refresh and reporting coverage</h2><p>{guide.refresh}</p><ul>{guide.boundaries.map(item => <li key={item}>{item}</li>)}</ul></section>
    <section><h2>Permissions and control</h2><p>{guide.scopeExplanation}</p><details><summary>Inspect the requested read scopes</summary><ul className="integration-scope-list">{guide.permissions.map(scope => <li key={scope}><code>{scope}</code></li>)}</ul></details><p>Vanteloq processes authorised data to provide the service. Workspace access depends on roles and permissions. Review retention, service providers and your options before connecting.</p><div className="integration-guide-actions"><Link href="/privacy">Vanteloq Privacy Policy →</Link><a href={guide.providerPrivacy} rel="noreferrer" target="_blank">{guide.name} Privacy Policy →</a><Link href="/data-processing">Data processing →</Link><Link href="/subprocessors">Service providers →</Link></div></section>
    <section><h2>If something does not match</h2><p>Check the selected account and location, period and time zone, unfinished pages, refunds and source freshness. Do not fill a missing cost with zero. Keep the source reference when asking for support.</p><div className="integration-guide-actions"><Link href="/help">Get setup help →</Link><a href={guide.providerDocs} rel="noreferrer" target="_blank">Read the provider documentation →</a><Link href="/tools/cash-order-planner">Try the cash-order planner →</Link></div></section>
    <aside className="integration-trademark"><p>{guide.name} names, logos and marks belong to {guide.providerCompany}. References identify interoperability and do not imply endorsement, sponsorship or affiliation. Availability and data access vary by provider, account, region and third-party terms. Vanteloq is an independent platform.</p><p>Guide updated October 11, 2026. <Link href="/about/editorial">Editorial standards</Link>.</p></aside>
  </main></DiscoveryShell>;
}
