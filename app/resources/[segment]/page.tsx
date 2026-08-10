import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleCard, Breadcrumbs, ResourceShell } from "../components";
import {
  RESOURCE_ARTICLES,
  RESOURCE_CATEGORIES,
  getArticle,
  getArticlesByCategory,
  getCategory,
  getReadingTime,
  type ResourceArticle,
} from "../content";
import { absoluteUrl, DEFAULT_SOCIAL_IMAGE, safeJsonLd } from "../../seo";

type SegmentProps = { params: Promise<{ segment: string }> };

export function generateStaticParams() {
  return [
    ...RESOURCE_CATEGORIES.map((category) => ({ segment: category.slug })),
    ...RESOURCE_ARTICLES.map((article) => ({ segment: article.slug })),
  ];
}

export async function generateMetadata({ params }: SegmentProps): Promise<Metadata> {
  const { segment } = await params;
  const article = getArticle(segment);
  if (article) {
    const url = `/resources/${article.slug}`;
    return {
      title: article.seoTitle,
      description: article.description,
      authors: [{ name: article.author }],
      alternates: { canonical: url },
      openGraph: {
        type: "article",
        url,
        title: article.seoTitle,
        description: article.description,
        publishedTime: article.published,
        modifiedTime: article.updated,
        authors: [article.author],
        section: getCategory(article.category)?.name,
        images: [{ url: DEFAULT_SOCIAL_IMAGE, width: 1487, height: 1058, alt: "Vanteloq business operating view" }],
      },
      twitter: {
        card: "summary_large_image",
        title: article.seoTitle,
        description: article.description,
        images: [DEFAULT_SOCIAL_IMAGE],
      },
    };
  }

  const category = getCategory(segment);
  if (category) {
    const title = `${category.name} Guides for Small Businesses | Vanteloq`;
    return {
      title,
      description: category.description,
      alternates: { canonical: `/resources/${category.slug}` },
      openGraph: { type: "website", url: `/resources/${category.slug}`, title, description: category.description },
      twitter: { card: "summary", title, description: category.description },
    };
  }

  return { title: "Resource not found | Vanteloq", robots: { index: false, follow: false } };
}

function breadcrumbJsonLd(items: readonly { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

function ArticlePage({ article }: { article: ResourceArticle }) {
  const category = getCategory(article.category);
  const related = article.related.map(getArticle).filter((item): item is ResourceArticle => Boolean(item));
  const articleUrl = absoluteUrl(`/resources/${article.slug}`);
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${articleUrl}#article`,
    mainEntityOfPage: articleUrl,
    headline: article.title,
    description: article.description,
    datePublished: article.published,
    dateModified: article.updated,
    articleSection: category?.name,
    author: { "@type": "Organization", name: article.author },
    publisher: { "@id": `${absoluteUrl() }#organization` },
  };
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Resources", path: "/resources" },
    { name: category?.name ?? "Resources", path: `/resources/${article.category}` },
    { name: article.title, path: `/resources/${article.slug}` },
  ]);

  return (
    <ResourceShell>
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(articleJsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
        <article className="article-page">
          <Breadcrumbs items={[
            { label: "Resources", href: "/resources" },
            { label: category?.name ?? "Guides", href: `/resources/${article.category}` },
            { label: article.title },
          ]} />
          <header className="article-header">
            <p className="resource-eyebrow">{category?.name.toUpperCase()}</p>
            <h1>{article.title}</h1>
            <p className="article-dek">{article.dek}</p>
            <dl className="article-byline">
              <div><dt>Written by</dt><dd>{article.author}</dd></div>
              <div><dt>Published</dt><dd><time dateTime={article.published}>{formatDate(article.published)}</time></dd></div>
              <div><dt>Updated</dt><dd><time dateTime={article.updated}>{formatDate(article.updated)}</time></dd></div>
              <div><dt>Reading time</dt><dd>{getReadingTime(article)} minutes</dd></div>
            </dl>
          </header>

          <div className="article-layout">
            <aside className="article-toc" aria-label="Table of contents">
              <span>IN THIS GUIDE</span>
              <ol>{article.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.heading}</a></li>)}</ol>
            </aside>
            <div className="article-body">
              <section className="quick-answer" aria-labelledby="quick-answer">
                <p className="resource-eyebrow">QUICK ANSWER</p>
                <h2 id="quick-answer">The short version</h2>
                <p>{article.quickAnswer}</p>
              </section>

              {article.sections.map((section) => (
                <section id={section.id} key={section.id}>
                  <h2>{section.heading}</h2>
                  {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  {section.bullets && <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}
                  {section.numbered && <ol>{section.numbered.map((item) => <li key={item}>{item}</li>)}</ol>}
                  {section.formula && <div className="formula-card"><span>{section.formula.label}</span><strong>{section.formula.value}</strong>{section.formula.example && <p>{section.formula.example}</p>}</div>}
                  {section.table && <div className="article-table-wrap"><table><caption>{section.table.caption}</caption><thead><tr>{section.table.headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{section.table.rows.map((row) => <tr key={row.join("|")}>{row.map((cell, index) => index === 0 ? <th scope="row" key={cell}>{cell}</th> : <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>}
                  {section.callout && <aside className="article-callout"><strong>{section.callout.title}</strong><p>{section.callout.body}</p></aside>}
                </section>
              ))}

              <section className="article-sources" aria-labelledby="sources">
                <h2 id="sources">Sources and further reading</h2>
                <p>These sources support the accounting, platform or technical boundaries discussed in this guide. They are not endorsements of Vanteloq.</p>
                <ul>{article.sources.map((source) => <li key={source.url}><a href={source.url} rel="noreferrer" target="_blank">{source.title}</a><span>{source.publisher}</span></li>)}</ul>
              </section>

              <aside className="article-disclaimer">
                <strong>Editorial note</strong>
                <p>This guide is general operational information, not accounting, tax or legal advice. Definitions and obligations can vary by business, jurisdiction and reporting policy.</p>
              </aside>
            </div>
          </div>
        </article>

        {related.length > 0 && <section className="related-guides"><div className="resource-section-heading"><p className="resource-eyebrow">KEEP READING</p><h2>Related guides</h2></div><div className="resource-card-grid">{related.map((item) => <ArticleCard article={item} key={item.slug} />)}</div></section>}

        <section className="resource-wide-cta article-cta">
          <div><p className="resource-eyebrow">FROM GUIDE TO OPERATING RHYTHM</p><h2>Keep the source and the decision together.</h2><p>Vanteloq organizes verified operating inputs, calculation context and approval-owned actions in one business view.</p></div>
          <div><Link href="/?start=signup">Create your workspace</Link><Link className="secondary" href="/#platform">Explore Vanteloq</Link></div>
        </section>
      </main>
    </ResourceShell>
  );
}

function CategoryPage({ categorySlug }: { categorySlug: string }) {
  const category = getCategory(categorySlug);
  if (!category) notFound();
  const categoryArticles = getArticlesByCategory(category.slug);
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Resources", path: "/resources" },
    { name: category.name, path: `/resources/${category.slug}` },
  ]);
  return (
    <ResourceShell>
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbs) }} />
        <section className="category-hero">
          <Breadcrumbs items={[{ label: "Resources", href: "/resources" }, { label: category.name }]} />
          <p className="resource-eyebrow">RESOURCE TOPIC</p>
          <h1>{category.name}</h1>
          <p>{category.description}</p>
        </section>
        <section className="category-articles" aria-labelledby="category-guides">
          <div className="resource-section-heading"><p className="resource-eyebrow">PRACTICAL GUIDES</p><h2 id="category-guides">{category.name} questions, answered clearly</h2></div>
          {categoryArticles.length > 0 ? <div className="resource-card-grid">{categoryArticles.map((article) => <ArticleCard article={article} key={article.slug} />)}</div> : <div className="resource-empty"><h2>Guides are being prepared for this topic.</h2><p>Browse all published resources while this topic cluster is completed.</p><Link href="/resources">View all resources</Link></div>}
        </section>
      </main>
    </ResourceShell>
  );
}

export default async function ResourceSegmentPage({ params }: SegmentProps) {
  const { segment } = await params;
  const article = getArticle(segment);
  if (article) return <ArticlePage article={article} />;
  if (getCategory(segment)) return <CategoryPage categorySlug={segment} />;
  notFound();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
