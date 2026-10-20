import type { ResourceArticle } from "./content";
import { absoluteUrl, DEFAULT_SOCIAL_IMAGE } from "../seo";

// Search previews use raster images. Keep the original artwork in the page UI.
export function articleSearchImage(article: ResourceArticle) {
  return article.hero && !/\.svg(?:[?#]|$)/i.test(article.hero.src)
    ? article.hero
    : { src: DEFAULT_SOCIAL_IMAGE, alt: "Vanteloq glass blue and silver logo", width: 1254, height: 1254 };
}

export function resourceCollectionJsonLd(path: string, name: string, description: string, articles: readonly ResourceArticle[]) {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#webpage`,
    url, name, description,
    inLanguage: "en-CA",
    isPartOf: { "@type": "WebSite", "@id": absoluteUrl("/#website"), name: "Vanteloq", url: absoluteUrl("/") },
    publisher: { "@id": absoluteUrl("/#organization") },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: articles.length,
      itemListElement: articles.map((article, index) => ({
        "@type": "ListItem", position: index + 1,
        name: article.title, url: absoluteUrl(`/resources/${article.slug}`),
      })),
    },
  };
}

export const RESOURCE_SEARCH_ROBOTS = {
  index: true, follow: true,
  "max-image-preview": "large" as const,
  "max-snippet": -1,
  "max-video-preview": -1,
};
