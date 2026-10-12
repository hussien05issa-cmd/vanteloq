import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryShell from "../discovery-shell";
import IntegrationBrandLogo from "../integration-brand-logo";
import { integrationCatalog, integrationPublicStatus } from "../integration-catalog";
import { PUBLIC_INTEGRATION_GUIDES } from "./content";
import "./integration-guides.css";

export const metadata: Metadata = {
  title: "POS Integration Guides and Source Coverage | Vanteloq",
  description: "Understand Vanteloq's Square and Lightspeed Retail R-Series connections: supported records, read permissions, import coverage and source-total review.",
  alternates: { canonical: "/integrations" },
  openGraph: { title: "POS Integration Guides | Vanteloq", description: "Understand what your connection can read and what needs review.", url: "/integrations", type: "website" },
};

export default function IntegrationGuides() {
  return <DiscoveryShell className="integration-guide-page"><main id="discovery-main" className="integration-guide-main">
    <header><p className="integration-guide-eyebrow">Your systems. A clearer review.</p><h1>Know what your connection brings in.</h1><p className="integration-guide-lead">Start with the records your system supplies. Understand the permissions, finish the import and compare source totals before using a report.</p></header>
    <div className="integration-guide-grid">{Object.entries(PUBLIC_INTEGRATION_GUIDES).map(([id, guide]) => {
      const provider = integrationCatalog.find(item => item.id === id)!;
      return <article key={id}><span className="integration-guide-mark"><IntegrationBrandLogo name={guide.markName}/></span><p className="integration-guide-eyebrow">{integrationPublicStatus(provider).label}</p><h2>{guide.name}</h2><p>{guide.lead}</p><Link href={`/integrations/${id}`}>Read the connection guide →</Link></article>;
    })}</div>
    <section><h2>Working with another system?</h2><p>See current availability for the full directory. Where a direct connection is pending, a supported CSV or manual entry can provide a reviewed snapshot. A saved connection alone does not prove reporting completeness.</p><div className="integration-guide-actions"><Link href="/#connections">Check all connections →</Link><Link href="/help">Review file-import setup →</Link><Link href="/contact">Discuss your requirements →</Link></div></section>
  </main></DiscoveryShell>;
}
