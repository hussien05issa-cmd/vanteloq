export type MarketingRecommendationInput = {
  businessModel: string;
  primaryOffer: string;
  targetAudience: string;
  serviceArea: string;
  primaryGoal: "leads" | "visits" | "sales" | "awareness";
  websiteUrl: string;
  googleProfileStatus: "not_set" | "claimed" | "verified";
  hasAttributionData: boolean;
  hasSearchData: boolean;
};

export type MarketingRecommendation = {
  id: string;
  category: "local_search" | "content" | "conversion" | "measurement" | "technical";
  priority: "high" | "medium";
  title: string;
  rationale: string;
  action: string;
  metrics: string[];
  evidenceNeeded: string[];
  sourceLabel: string;
  sourceUrl: string;
};

const clean = (value: string, fallback: string) => value.trim() || fallback;

export function buildMarketingRecommendations(input: MarketingRecommendationInput): MarketingRecommendation[] {
  const model = clean(input.businessModel, "local business");
  const offer = clean(input.primaryOffer, "primary offer");
  const audience = clean(input.targetAudience, "ideal customers");
  const area = clean(input.serviceArea, "service area");
  const recommendations: MarketingRecommendation[] = [];

  if (input.googleProfileStatus !== "verified") {
    recommendations.push({
      id: "google-profile-foundation",
      category: "local_search",
      priority: "high",
      title: `Complete local discovery coverage for ${area}`,
      rationale: `${model} customers often need accurate location, hours, service and contact information before taking action.`,
      action: `Claim and verify the Google Business Profile, then align the business category, ${offer}, service area, hours, photos and website destination with the real customer experience.`,
      metrics: ["Business Profile views", "calls", "directions", "website clicks"],
      evidenceNeeded: ["Verified profile ownership", "accurate business details"],
      sourceLabel: "Google Business Profile documentation",
      sourceUrl: "https://developers.google.com/my-business/content/overview",
    });
  }

  recommendations.push({
    id: "service-intent-page",
    category: "content",
    priority: "high",
    title: `${area} offer page for ${audience}`,
    rationale: `A focused page helps people and search engines understand who the ${model} serves, what it offers, and where it operates.`,
    action: `Create or improve one useful page about ${offer} for ${audience} in ${area}. Use a clear page title, descriptive heading, proof, pricing context where appropriate, original images with alt text, and one primary contact action.`,
    metrics: ["qualified organic visits", "contact actions", "lead-to-customer rate"],
    evidenceNeeded: ["website analytics", "lead source", "completed customer outcome"],
    sourceLabel: "Google SEO Starter Guide",
    sourceUrl: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
  });

  recommendations.push({
    id: "lead-path",
    category: "conversion",
    priority: "high",
    title: `Shorten the path from interest to ${input.primaryGoal}`,
    rationale: `Marketing traffic has limited value unless ${audience} can take a clear next step and the business can connect that step to an outcome.`,
    action: `Use one primary action for ${offer}, such as request a quote, book, call, visit, or buy. Keep the form short, confirm what happens next, preserve campaign source parameters, and record the eventual sale or qualified lead.`,
    metrics: ["action rate", "qualified leads", "cost per qualified lead", "lead-to-sale rate"],
    evidenceNeeded: ["landing-page visits", "submitted actions", "POS or CRM outcome"],
    sourceLabel: "Google Analytics campaign measurement guidance",
    sourceUrl: "https://developers.google.com/analytics/devguides/collection/ga4/campaigns",
  });

  if (!input.hasAttributionData || !input.hasSearchData) {
    recommendations.push({
      id: "measurement-contract",
      category: "measurement",
      priority: "high",
      title: "Build the measurement chain before scaling spend",
      rationale: "Channel recommendations become more reliable when discovery, website or call actions, leads, customers and POS revenue share a privacy-preserving journey reference.",
      action: "Import search visibility and journey events, keep source event IDs idempotent, map campaign and local-discovery actions to qualified outcomes, and review attribution limitations before changing budget.",
      metrics: ["measured journeys", "unattributed outcomes", "revenue by source", "gross profit by source"],
      evidenceNeeded: ["search observations", "touchpoints", "lead records", "customer or POS transactions"],
      sourceLabel: "Google Business Profile Performance API",
      sourceUrl: "https://developers.google.com/my-business/reference/performance/rest",
    });
  }

  recommendations.push({
    id: "technical-baseline",
    category: "technical",
    priority: "medium",
    title: `Technical search baseline for ${model}`,
    rationale: "Search engines need crawlable pages, clear titles and useful descriptions; owners need valid conversion and discovery data to judge results.",
    action: `Verify the ${input.websiteUrl || "business website"} in Search Console, submit a sitemap, review indexing and page experience, fix broken links, and use descriptive internal links between the homepage, ${offer}, proof, and contact pages.`,
    metrics: ["indexed pages", "search clicks", "search impressions", "conversion action rate"],
    evidenceNeeded: ["Search Console property", "sitemap", "page-level analytics"],
    sourceLabel: "Google Search Console documentation",
    sourceUrl: "https://developers.google.com/search/docs/monitor-debug/search-console-start",
  });

  return recommendations;
}
