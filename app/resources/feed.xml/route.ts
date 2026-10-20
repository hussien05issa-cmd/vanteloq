import { RESOURCE_ARTICLES } from "../content";
import { absoluteUrl } from "../../seo";

const xml = (value: string) => value.replace(/[<>&"']/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

export function GET() {
  const articles = [...RESOURCE_ARTICLES].sort((a, b) => b.updated.localeCompare(a.updated) || a.slug.localeCompare(b.slug));
  const items = articles.map(article => {
    const url = xml(absoluteUrl(`/resources/${article.slug}`));
    return `<item><title>${xml(article.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><description>${xml(article.description)}</description><pubDate>${new Date(`${article.published}T00:00:00Z`).toUTCString()}</pubDate></item>`;
  }).join("");
  const updated = articles[0]?.updated;
  const buildDate = updated ? `<lastBuildDate>${new Date(`${updated}T00:00:00Z`).toUTCString()}</lastBuildDate>` : "";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Vanteloq Business Resource Library</title><link>${xml(absoluteUrl("/resources"))}</link><description>Practical guides to inventory, business analytics, finance, marketing and operations.</description><language>en-ca</language><atom:link href="${xml(absoluteUrl("/resources/feed.xml"))}" rel="self" type="application/rss+xml"/>${buildDate}${items}</channel></rss>`, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=1800, stale-while-revalidate=3600", "X-Robots-Tag": "noindex, follow" },
  });
}
