import type { MetadataRoute } from "next";
import { RESOURCE_ARTICLES, RESOURCE_CATEGORIES } from "./resources/content";
import { absoluteUrl } from "./seo";
import { FEATURE_GUIDES } from "./features/content";

export default function sitemap(): MetadataRoute.Sitemap {
  const latestResourceUpdate = RESOURCE_ARTICLES.map((article) => article.updated).sort().at(-1) ?? "2026-08-11";
  const articleEntries: MetadataRoute.Sitemap = RESOURCE_ARTICLES.map((article) => ({
    url: absoluteUrl(`/resources/${article.slug}`),
    lastModified: article.updated,
    changeFrequency: "monthly",
    priority: 0.75,
  }));

  const categoryEntries: MetadataRoute.Sitemap = RESOURCE_CATEGORIES.map((category) => ({
    url: absoluteUrl(`/resources/${category.slug}`),
    lastModified: RESOURCE_ARTICLES.filter((article) => article.category === category.slug)
      .map((article) => article.updated)
      .sort()
      .at(-1) ?? "2026-08-10",
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [
    { url: absoluteUrl("/"), lastModified: latestResourceUpdate, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/help"), lastModified: "2026-09-11", changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/pricing"), lastModified: "2026-09-11", changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/contact"), lastModified: "2026-09-13", changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/custom-plan"), lastModified: "2026-09-13", changeFrequency: "monthly", priority: 0.6 },
    { url: absoluteUrl("/demo"), lastModified: "2026-09-11", changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/resources"), lastModified: latestResourceUpdate, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/legal"), lastModified: "2026-08-24", changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/privacy"), lastModified: "2026-08-24", changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/terms"), lastModified: "2026-08-24", changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/cookies"), lastModified: "2026-08-24", changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/data-processing"), lastModified: "2026-08-24", changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/subprocessors"), lastModified: "2026-08-24", changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/social"), lastModified: "2026-09-15", changeFrequency: "monthly", priority: 0.6 },
    ...categoryEntries,
    ...Object.keys(FEATURE_GUIDES).map(slug => ({url: absoluteUrl("/features/" + slug), lastModified: "2026-09-13", changeFrequency: "monthly" as const, priority: 0.8})),
    ...articleEntries,
  ];
}
