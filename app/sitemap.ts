import type { MetadataRoute } from "next";
import { RESOURCE_ARTICLES, RESOURCE_CATEGORIES, getArticlesByCategory } from "./resources/content";
import { absoluteUrl } from "./seo";
import { FEATURE_GUIDES } from "./features/content";

export default function sitemap(): MetadataRoute.Sitemap {
  const articleEntries: MetadataRoute.Sitemap = RESOURCE_ARTICLES.map((article) => ({
    url: absoluteUrl(`/resources/${article.slug}`),
    lastModified: article.updated,
    changeFrequency: "monthly",
    priority: 0.75,
  }));

  const categoryEntries: MetadataRoute.Sitemap = RESOURCE_CATEGORIES
    .filter((category) => getArticlesByCategory(category.slug).length > 0)
    .map((category) => ({
      url: absoluteUrl(`/resources/${category.slug}`),
      changeFrequency: "weekly",
      priority: 0.7,
    }));

  // These pages were authored on this date. Existing routes without an
  // established content date intentionally omit lastModified.
  const discoveryEntries: MetadataRoute.Sitemap = [
    "/solutions",
    "/solutions/dealerships",
    "/solutions/cafes",
    "/solutions/restaurants",
    "/integrations",
    "/integrations/square",
    "/integrations/lightspeed-r",
    "/tools",
    "/tools/cash-order-planner",
    "/tools/vehicle-holding-cost",
    "/about",
    "/about/editorial",
  ].map((path) => ({
    url: absoluteUrl(path),
    lastModified: "2026-10-11",
    changeFrequency: "monthly",
    priority: path.startsWith("/about") ? 0.5 : 0.8,
  }));

  return [
    { url: absoluteUrl("/"), changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/help"), changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/pricing"), changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/contact"), changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/book-demo"), changeFrequency: "monthly", priority: 0.7 },
    {
      url: absoluteUrl("/advisory"),
      // The hero and its search/share image metadata were updated on this date.
      lastModified: "2026-10-16",
      changeFrequency: "monthly",
      priority: 0.85,
      images: [absoluteUrl("/brand/advisory/vanteloq-advisory-signal-path-1280.webp")],
    },
    { url: absoluteUrl("/workspace"), lastModified: "2026-10-16", changeFrequency: "monthly", priority: 0.85 },
    { url: absoluteUrl("/custom-plan"), changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/demo"), changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/solutions/retail"), changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/how-it-works"), changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/resources"), changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/legal"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/privacy"), changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/terms"), changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/cookies"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/data-processing"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/subprocessors"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/social"), changeFrequency: "monthly", priority: 0.6 },
    ...discoveryEntries,
    ...categoryEntries,
    ...Object.keys(FEATURE_GUIDES).map(slug => ({url: absoluteUrl("/features/" + slug), changeFrequency: "monthly" as const, priority: 0.8})),
    ...articleEntries,
  ];
}
