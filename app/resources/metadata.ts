import type { ResourceArticle } from "./content";

export const RESOURCE_CATEGORIES = [
  {
    slug: "inventory",
    name: "Inventory",
    seoTitle: "Inventory Guides for Small Businesses | Vanteloq",
    shortName: "Inventory",
    description: "Practical methods for stock accuracy, turnover, replenishment, expiry risk and product-level decisions.",
  },
  {
    slug: "finance",
    name: "Finance",
    seoTitle: "Finance Guides for Small Businesses | Vanteloq",
    shortName: "Finance",
    description: "Clear explanations of margin, cash flow, cost of goods sold and the financial measures operators use every week.",
  },
  {
    slug: "analytics",
    name: "Business analytics",
    seoTitle: "Business Analytics Guides for Small Businesses | Vanteloq",
    shortName: "Analytics",
    description: "Build useful dashboards, choose decision-ready KPIs and turn operating data into actions with traceable definitions.",
  },
  {
    slug: "marketing",
    name: "Marketing",
    seoTitle: "Marketing Guides for Small Businesses | Vanteloq",
    shortName: "Marketing",
    description: "Measure advertising and local marketing without confusing platform-reported conversions with proven business profit.",
  },
  {
    slug: "operations",
    name: "Operations",
    seoTitle: "Operations Guides for Small Businesses | Vanteloq",
    shortName: "Operations",
    description: "Systems for daily work, management routines, accountability and multi-location operating visibility.",
  },
  {
    slug: "ai",
    name: "AI for business",
    seoTitle: "AI for Business Guides for Small Businesses | Vanteloq",
    shortName: "AI",
    description: "Responsible ways to use AI for analysis and decision support while keeping evidence, privacy and human review in the loop.",
  },
  {
    slug: "pos",
    name: "POS data",
    seoTitle: "POS Data Guides for Small Businesses | Vanteloq",
    shortName: "POS",
    description: "Get more value from point-of-sale reports, transaction data, product performance and source-system reconciliation.",
  },
] as const;

export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number]["slug"];

export type ResourceArticleSummary = Pick<ResourceArticle, "slug" | "title" | "description" | "category"> & { readingTime: number };

export function getCategory(slug: string) {
  return RESOURCE_CATEGORIES.find((category) => category.slug === slug);
}

export function getReadingTime(article: ResourceArticle | ResourceArticleSummary) {
  if ("readingTime" in article) return article.readingTime;
  const words = [
    article.title,
    article.dek,
    article.quickAnswer,
    ...article.sections.flatMap((section) => [
      section.heading,
      ...(section.paragraphs ?? []),
      ...(section.bullets ?? []),
      ...(section.numbered ?? []),
      section.formula?.label ?? "",
      section.formula?.value ?? "",
      section.formula?.example ?? "",
      section.callout?.title ?? "",
      section.callout?.body ?? "",
      ...(section.table?.headers ?? []),
      ...(section.table?.rows.flat() ?? []),
    ]),
  ]
    .join(" ")
    .trim()
    .split(/\s+/).length;

  return Math.max(3, Math.ceil(words / 200));
}
