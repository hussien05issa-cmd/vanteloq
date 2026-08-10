import type { MetadataRoute } from "next";
import { RESOURCE_ARTICLES, RESOURCE_CATEGORIES } from "./resources/content";
import { absoluteUrl } from "./seo";

export default function sitemap(): MetadataRoute.Sitemap {
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
    { url: absoluteUrl("/"), lastModified: "2026-08-10", changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/resources"), lastModified: "2026-08-10", changeFrequency: "weekly", priority: 0.9 },
    ...categoryEntries,
    ...articleEntries,
  ];
}
