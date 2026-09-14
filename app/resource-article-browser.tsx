import Link from "next/link";
import { getCategory, getReadingTime, type ResourceArticle } from "./resources/content";

/** Native disclosure keeps the full catalogue in the HTML without a long wall of cards. */
export default function ResourceArticleBrowser({ articles, title = "Browse Articles" }: { articles: readonly ResourceArticle[]; title?: string }) {
  return <details className="resource-article-browser">
    <summary><span><strong>{title}</strong><small>{articles.length} practical guides · Open when you need them</small></span><span className="disclosure-plus" aria-hidden="true">+</span></summary>
    <div className="resource-article-list">{articles.map(article => <article key={article.slug}>
      <div className="resource-article-meta"><span>{getCategory(article.category)?.shortName}</span><span>{getReadingTime(article)} min read</span></div>
      <h3><Link href={`/resources/${article.slug}`}>{article.title}</Link></h3>
      <p>{article.description}</p>
      <Link className="resource-article-link" href={`/resources/${article.slug}`} aria-label={`Read ${article.title}`}>Read Guide <span aria-hidden="true">→</span></Link>
    </article>)}</div>
  </details>;
}
