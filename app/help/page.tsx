import type { Metadata } from "next";
import Link from "next/link";
import { APP_HELP_TOPICS } from "../../domain/app-help";
import ProductBrandLogo from "../product-brand-logo";
import { absoluteUrl, safeJsonLd } from "../seo";

export const metadata: Metadata = { title: "Vanteloq help | Setup, BookLoQ, reports and AI privacy", description: "Learn how to connect your data, verify reports, use BookLoQ and control Vanteloq AI privacy. Practical steps and clear limits for your workspace.", alternates: { canonical: "/help" }, openGraph: { title: "Vanteloq help centre", description: "Practical guidance for your Vanteloq workspace and BookLoQ.", url: "/help" } };

export default function HelpPage() {
  return <div className="public-site demo-page"><header className="demo-page-nav"><Link href="/" aria-label="Vanteloq home"><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong></Link><Link href="/demo">Try the demo</Link><Link href="/?start=signin">Open workspace →</Link></header><main className="product-help"><p className="demo-eyebrow">HELP CENTRE</p><h1>A clear next step.</h1><p>Find your way around Vanteloq, understand your reports and stay in control of your data.</p><nav aria-label="Help topics">{APP_HELP_TOPICS.map(topic => <a key={topic.id} href={`#${topic.id}`}>{topic.title} →</a>)}</nav><div className="product-help-topics">{APP_HELP_TOPICS.map(topic => <section id={topic.id} key={topic.id}><p className="demo-eyebrow">{topic.area}</p><h2>{topic.title}</h2><ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol><p className="help-boundary">{topic.limit}</p></section>)}</div><div className="demo-conversion"><div><h2>See it before you connect it.</h2><p>Explore the sample workspace with fictional data.</p></div><Link href="/demo">Try the interactive demo →</Link></div></main><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd({ "@context":"https://schema.org", "@type":"BreadcrumbList", itemListElement:[{"@type":"ListItem",position:1,name:"Vanteloq",item:absoluteUrl("/")},{"@type":"ListItem",position:2,name:"Help centre",item:absoluteUrl("/help")}] }) }}/></div>;
}
