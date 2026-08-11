import type { ResourceArticle } from "./content";
import { getCategory, getReadingTime } from "./content";
import Link from "next/link";
import ProductBrandLogo from "../product-brand-logo";

export function ResourceHeader() {
  return (
    <header className="resource-header">
      <Link className="resource-brand" href="/" aria-label="Vanteloq home">
        <ProductBrandLogo product="vanteloq" priority />
        <span>Vanteloq<small>RESOURCES</small></span>
      </Link>
      <nav aria-label="Resource navigation">
        <Link href="/">Home</Link>
        <Link href="/resources">All guides</Link>
        <Link href="/resources/inventory">Inventory</Link>
        <Link href="/resources/analytics">Analytics</Link>
        <Link href="/resources/finance">Finance</Link>
        <Link href="/resources/pos">POS</Link>
      </nav>
      <div className="resource-header-actions">
        <Link className="resource-header-signin" href="/?start=signin">Sign in</Link>
        <Link className="resource-header-cta" href="/?start=signup">Create workspace</Link>
      </div>
    </header>
  );
}

export function ResourceFooter() {
  return (
    <footer className="resource-footer">
      <div>
        <Link className="resource-brand" href="/" aria-label="Vanteloq home">
          <ProductBrandLogo product="vanteloq" />
          <span>Vanteloq<small>BUSINESS OPERATING SYSTEM</small></span>
        </Link>
        <p>Practical operating guidance built around clear definitions, traceable inputs and human review.</p>
      </div>
      <nav aria-label="Footer navigation">
        <Link href="/resources">Resources</Link>
        <Link href="/#platform">Platform</Link>
        <Link href="/#connections">Connections</Link>
        <Link href="/?start=signin">Sign in</Link>
      </nav>
    </footer>
  );
}

export function ResourceVisual({ category, compact = false }: { category: string; compact?: boolean }) {
  const labels: Record<string, string> = {
    inventory: "Inventory records and movement controls",
    finance: "Financial formulas and margin context",
    analytics: "Dashboard measures and decision context",
    marketing: "Marketing sources and measured outcomes",
    operations: "Operational work and accountability",
    ai: "Responsible analysis with human review",
    pos: "Point-of-sale records and reconciliation",
  };
  const shortLabels: Record<string, string> = {
    inventory: "SKU",
    finance: "%",
    analytics: "KPI",
    marketing: "ROI",
    operations: "OPS",
    ai: "AI",
    pos: "POS",
  };

  return (
    <div className={`resource-visual visual-${category}${compact ? " compact" : ""}`} role="img" aria-label={labels[category] ?? "Business operating guide"}>
      <span className="resource-visual-label">{shortLabels[category] ?? "VQL"}</span>
      <span className="resource-visual-bars" aria-hidden="true"><i/><i/><i/><i/></span>
      <span className="resource-visual-line" aria-hidden="true"><i/><i/><i/></span>
      <span className="resource-visual-status" aria-hidden="true">SOURCE CHECKED</span>
    </div>
  );
}

export function ResourceShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="resource-site">
      <ResourceHeader />
      {children}
      <ResourceFooter />
    </div>
  );
}

export function ArticleCard({ article, featured = false }: { article: ResourceArticle; featured?: boolean }) {
  const category = getCategory(article.category);
  return (
    <article className={`resource-card${featured ? " featured" : ""}`}>
      <div className="resource-card-meta">
        <Link href={`/resources/${article.category}`}>{category?.shortName}</Link>
        <span>{getReadingTime(article)} min read</span>
      </div>
      <ResourceVisual category={article.category} compact={!featured} />
      <h2><Link href={`/resources/${article.slug}`}>{article.title}</Link></h2>
      <p>{article.description}</p>
      <Link className="resource-card-link" href={`/resources/${article.slug}`} aria-label={`Read ${article.title}`}>
        Read guide <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

export function Breadcrumbs({ items }: { items: readonly { label: string; href?: string }[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
