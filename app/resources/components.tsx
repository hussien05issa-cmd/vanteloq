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
        <Link href="/resources">All guides</Link>
        <Link href="/resources/inventory">Inventory</Link>
        <Link href="/resources/analytics">Analytics</Link>
        <Link href="/resources/finance">Finance</Link>
        <Link href="/resources/pos">POS</Link>
      </nav>
      <Link className="resource-header-cta" href="/?start=signup">Create workspace</Link>
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
        <Link href="/#connect">Connections</Link>
        <Link href="/?start=signin">Sign in</Link>
      </nav>
    </footer>
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
