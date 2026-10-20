# Search discovery, October 19, 2026

This release changes search metadata and discovery files. It preserves visible article titles, descriptions, body text, artwork, layout, dates, author bylines and routes.

## Search intent

The inventory tracking guide has real Google Search Console impressions for inventory tracking questions. Its search title keeps that exact topic and adds the Vanteloq name. Eight other search titles clarify dashboard KPIs, business data analysis, small business data analytics, bookkeeping systems, cash flow forecasting, CAC and LTV, conversion rate optimization and marketing attribution. These are reader-intent terms, not claims about measured search volume.

The other 18 articles already have distinct, descriptive search titles. No hidden keyword blocks, keyword density targets, fake reviews, purchased links or invented results were added. Article summaries also appear in the visible library, so they were preserved.

## Implementation

- Every article keeps its own canonical URL and Article and BreadcrumbList data. Article data now includes language, free access, library membership and a raster search image with accurate dimensions. The one SVG article hero stays unchanged in the UI; search metadata uses the existing raster fallback.
- The Resources hub and seven populated topic pages have CollectionPage and ItemList data matching the published catalogue.
- Article sitemap entries include their search images. Existing publication and update dates are preserved instead of being refreshed for a deployment.
- `/resources/feed.xml` publishes all 27 articles as RSS with canonical URLs and real publication dates. The library advertises the feed in its metadata. The feed itself is noindex, follow.
- Search preview directives allow large image previews and unrestricted snippet length. Empty topics and missing pages retain noindex behaviour. APIs remain excluded by robots.txt.
- The IndexNow ownership file is intentionally public. `node scripts/submit-indexnow.mjs /resources /resources/article-slug` previews a notification offline. After deployment, add `--submit` once to verify ownership, check that every URL returns HTTP 200 without redirecting, and notify the official endpoint. Submit only changed canonical Resources pages, never private workspace URLs.

## Maintenance

Use actual Search Console and Bing query data to choose future article work. Keep the existing editorial method, primary citations, limitations and source checks. A search title should describe the page's actual answer. Do not change article dates without a substantive content review. Keep canonical URLs stable and preserve permanent redirects from the retired Advisory Journal.

Search engines decide crawling, indexing, snippets and rankings. A sitemap success or IndexNow receipt is not proof of indexing or a ranking improvement.

## Primary guidance

- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Google canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article)
- [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)
- [IndexNow protocol](https://www.indexnow.org/documentation)
