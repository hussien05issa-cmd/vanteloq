import assert from "node:assert/strict";
import test from "node:test";
import { RESOURCE_ARTICLES, RESOURCE_CATEGORIES, getArticlesByCategory } from "../app/resources/content";
import { articleSearchImage, resourceCollectionJsonLd } from "../app/resources/search";
import ResourceSegmentPage, { generateMetadata } from "../app/resources/[segment]/page";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "../app/resources/feed.xml/route";
import sitemap from "../app/sitemap";

test("every article keeps its canonical URL, dates and supported search image", async () => {
  for (const article of RESOURCE_ARTICLES) {
    const metadata = await generateMetadata({ params: Promise.resolve({ segment: article.slug }) });
    assert.equal(metadata.alternates?.canonical, `/resources/${article.slug}`);
    assert.equal(metadata.title, article.seoTitle);
    assert.equal(metadata.description, article.description);
    assert.equal((metadata.robots as Record<string, unknown>)["max-image-preview"], "large");
    const image = articleSearchImage(article);
    assert.doesNotMatch(image.src, /\.svg/);
    assert.ok(image.width >= 1200);
    const entry = sitemap().find(item => item.url === `https://vanteloq.com/resources/${article.slug}`);
    assert.equal(entry?.lastModified, article.updated);
    assert.deepEqual(entry?.images, [`https://vanteloq.com${image.src}`]);
    const html = renderToStaticMarkup(await ResourceSegmentPage({ params: Promise.resolve({ segment: article.slug }) }));
    const schema = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(match => JSON.parse(match[1])).find(item => item["@type"] === "Article");
    assert.equal(schema.image.url, `https://vanteloq.com${image.src}`);
    assert.equal(schema.datePublished, article.published);
    assert.equal(schema.dateModified, article.updated);
    assert.equal(schema.headline, article.title);
    assert.equal(schema.isPartOf["@id"], "https://vanteloq.com/resources#webpage");
  }
});

test("library and topic collections list only the matching canonical articles", () => {
  for (const category of RESOURCE_CATEGORIES) {
    const articles = getArticlesByCategory(category.slug);
    const schema = resourceCollectionJsonLd(`/resources/${category.slug}`, category.name, category.description, articles);
    assert.equal(schema.mainEntity.numberOfItems, articles.length);
    assert.deepEqual(schema.mainEntity.itemListElement.map(item => item.url), articles.map(article => `https://vanteloq.com/resources/${article.slug}`));
    assert.equal(schema.inLanguage, "en-CA");
    assert.equal(schema.publisher["@id"], "https://vanteloq.com/#organization");
  }
});

test("RSS exposes every public article with its real publication date and no private URLs", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type")!, /application\/rss\+xml/);
  const xml = await response.text();
  assert.equal([...xml.matchAll(/<item>/g)].length, RESOURCE_ARTICLES.length);
  for (const article of RESOURCE_ARTICLES) {
    assert.ok(xml.includes(`<link>https://vanteloq.com/resources/${article.slug}</link>`));
    assert.ok(xml.includes(`<pubDate>${new Date(`${article.published}T00:00:00Z`).toUTCString()}</pubDate>`));
  }
  assert.doesNotMatch(xml, /\/api\/|\/dashboard|lexedgeconsulting/);
  assert.match(xml, /isPermaLink="true"/);
});
