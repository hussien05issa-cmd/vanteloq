export type EvidenceCoverageStatus = "ready" | "limited" | "missing" | "stale";

export type EvidenceCoverage = {
  status: EvidenceCoverageStatus;
  freshness: string;
  evidence: string[];
  missingInputs: string[];
};

export type MarketingOperatingCoverage = {
  customers: EvidenceCoverage;
  inventory: EvidenceCoverage;
  margin: EvidenceCoverage;
  cashReadiness: EvidenceCoverage;
  location: EvidenceCoverage;
};

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
  asOfDate: string;
  operatingCoverage: MarketingOperatingCoverage;
  marketingEvidence: EvidenceCoverage;
};

type OperatingCoverageKey = keyof MarketingOperatingCoverage;

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
  confidence: "high" | "medium" | "low" | "blocked";
  confidenceReason: string;
  evidence: string[];
  missingInputs: string[];
  actionOwner: string;
  actionDueDate: string;
  reviewMethod: string;
  sourceFreshness: string;
  operatingCoverage: Array<EvidenceCoverage & { key: OperatingCoverageKey; label: string }>;
};

type RecommendationCore = Omit<MarketingRecommendation,
  "confidence" | "confidenceReason" | "evidence" | "missingInputs" | "actionOwner" | "actionDueDate" | "reviewMethod" | "sourceFreshness" | "operatingCoverage"
>;

const clean = (value: string, fallback: string) => value.trim() || fallback;
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const dueDate = (asOfDate: string, days: number) => {
  const date = new Date(`${asOfDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const operatingLabels: Record<OperatingCoverageKey, string> = {
  customers: "Customer records",
  inventory: "Inventory readiness",
  margin: "Margin coverage",
  cashReadiness: "Cash readiness",
  location: "Location scope",
};
const operatingKeys = Object.keys(operatingLabels) as OperatingCoverageKey[];

function coverageFor(input: MarketingRecommendationInput, keys: OperatingCoverageKey[] = operatingKeys) {
  return keys.map((key) => ({ key, label: operatingLabels[key], ...input.operatingCoverage[key] }));
}

function defaultConfidence(input: MarketingRecommendationInput) {
  if (input.marketingEvidence.status === "ready" && input.hasAttributionData && input.hasSearchData) {
    return { confidence: "medium" as const, reason: "Recent recorded marketing evidence is available, but observed association does not establish causal impact." };
  }
  if (input.marketingEvidence.status === "stale") {
    return { confidence: "low" as const, reason: "The latest marketing evidence is stale, so the recommendation should be treated as a bounded test." };
  }
  return { confidence: "low" as const, reason: "Marketing evidence is incomplete or owner-entered, so the next action is framed as a measured test rather than a forecast." };
}

function packet(
  input: MarketingRecommendationInput,
  core: RecommendationCore,
  options: {
    confidence?: MarketingRecommendation["confidence"];
    confidenceReason?: string;
    evidence?: string[];
    missingInputs?: string[];
    reviewMethod: string;
    operatingKeys?: OperatingCoverageKey[];
    dueInDays?: number;
  },
): MarketingRecommendation {
  const inferred = defaultConfidence(input);
  return {
    ...core,
    confidence: options.confidence ?? inferred.confidence,
    confidenceReason: options.confidenceReason ?? inferred.reason,
    evidence: unique(["Owner-provided business and marketing profile", ...input.marketingEvidence.evidence, ...(options.evidence ?? [])]),
    missingInputs: unique(options.missingInputs ?? []),
    actionOwner: "Business owner",
    actionDueDate: dueDate(input.asOfDate, options.dueInDays ?? 14),
    reviewMethod: options.reviewMethod,
    sourceFreshness: input.marketingEvidence.freshness,
    operatingCoverage: coverageFor(input, options.operatingKeys),
  };
}

export function buildMarketingRecommendations(input: MarketingRecommendationInput): MarketingRecommendation[] {
  const model = clean(input.businessModel, "local business");
  const offer = clean(input.primaryOffer, "primary offer");
  const audience = clean(input.targetAudience, "ideal customers");
  const area = clean(input.serviceArea, "service area");
  const recommendations: MarketingRecommendation[] = [];

  if (input.googleProfileStatus !== "verified") {
    recommendations.push(packet(input, {
      id: "google-profile-foundation",
      category: "local_search",
      priority: "high",
      title: `Complete local discovery coverage for ${area}`,
      rationale: `${model} customers often need accurate location, hours, service and contact information before taking action. The profile status shown here is owner-provided and is not a live Google connection.`,
      action: `Claim and verify the Google Business Profile, then align the business category, ${offer}, service area, hours, photos and website destination with the real customer experience.`,
      metrics: ["Business Profile views", "calls", "directions", "website clicks"],
      evidenceNeeded: ["Verified profile ownership", "accurate business details"],
      sourceLabel: "Google Business Profile documentation",
      sourceUrl: "https://developers.google.com/my-business/content/overview",
    }, {
      evidence: [`Owner-reported profile status: ${input.googleProfileStatus}`],
      missingInputs: ["Authorized Google Business Profile verification"],
      reviewMethod: "After owner verification, compare the profile details with the website and location record. Do not aggregate Business Profile performance data in this workspace.",
      operatingKeys: ["location"],
    }));
  }

  recommendations.push(packet(input, {
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
  }, {
    missingInputs: [
      ...(!input.websiteUrl ? ["Business website"] : []),
      ...(!input.hasSearchData ? ["Search performance baseline"] : []),
      ...input.operatingCoverage.customers.missingInputs,
      ...input.operatingCoverage.location.missingInputs,
    ],
    reviewMethod: "Review search visits, contact actions and qualified customer outcomes after 28 days against the prior aligned period. Treat movement as observed association, not proof of causation.",
    operatingKeys: ["customers", "location"],
  }));

  recommendations.push(packet(input, {
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
  }, {
    missingInputs: [
      ...(!input.hasAttributionData ? ["Matched journey outcomes"] : []),
      ...input.operatingCoverage.customers.missingInputs,
    ],
    reviewMethod: "Compare the completed action rate and qualified outcome rate for the same source, location and observation window before and after the change.",
    operatingKeys: ["customers", "location"],
  }));

  if (!input.hasAttributionData || !input.hasSearchData) {
    recommendations.push(packet(input, {
      id: "measurement-contract",
      category: "measurement",
      priority: "high",
      title: "Build the measurement chain before scaling spend",
      rationale: "Channel recommendations become more reliable when discovery, website or call actions, leads, customers and POS revenue share a privacy-preserving journey reference.",
      action: "Import search visibility and journey events, keep source event IDs idempotent, map campaign and local-discovery actions to qualified outcomes, and review attribution limitations before changing budget.",
      metrics: ["measured journeys", "unattributed outcomes", "revenue by source", "gross profit by source"],
      evidenceNeeded: ["search observations", "touchpoints", "lead records", "customer or POS transactions"],
      sourceLabel: "Google Search Console API",
      sourceUrl: "https://developers.google.com/webmaster-tools/v1/searchanalytics/query",
    }, {
      confidence: "low",
      confidenceReason: "This recommendation identifies a measurement gap. It does not infer campaign performance from missing records.",
      missingInputs: input.marketingEvidence.missingInputs,
      reviewMethod: "Confirm that each imported record retains its source, scope, date, status and pseudonymous journey reference, then measure the unmatched outcome rate before any spend change.",
    }));
  }

  if (input.primaryGoal === "sales") {
    const requiredKeys: OperatingCoverageKey[] = ["inventory", "margin", "cashReadiness", "location"];
    const requiredCoverage = coverageFor(input, requiredKeys);
    const blocked = requiredCoverage.some((item) => item.status !== "ready");
    const missingInputs = requiredCoverage.flatMap((item) => item.missingInputs);
    recommendations.push(packet(input, {
      id: "commercial-guardrail",
      category: "measurement",
      priority: "high",
      title: "Protect margin, cash and availability before launching a promotion",
      rationale: "A campaign can increase orders while reducing contribution, consuming protected cash or creating stockouts. Promotion advice must use current margin, inventory, cash readiness and verified location scope before budget is approved.",
      action: blocked
        ? "Do not launch or increase a promotion yet. Resolve the blocked inventory, margin, cash and location checks, then choose a bounded product and location test with an approved budget ceiling and stop rule."
        : "Choose products and locations with sufficient inventory, calculate the post-discount margin, confirm protected cash remains available, reserve stock for expected demand, and set a stop rule if margin, cash or inventory falls below the approved threshold.",
      metrics: ["post-discount gross margin", "sell-through", "stockout rate", "contribution after marketing cost", "cash headroom"],
      evidenceNeeded: ["product margin", "location-level inventory", "location sales history", "cash safety threshold", "approved campaign cost"],
      sourceLabel: "Vanteloq operating evidence contract",
      sourceUrl: "/resources/analytics/what-should-small-business-dashboard-show",
    }, {
      confidence: blocked ? "blocked" : "high",
      confidenceReason: blocked
        ? "One or more material operating checks are missing, limited or stale, so promotion advice is blocked."
        : "Current inventory, margin, cash readiness and location evidence cover the material operating checks for a bounded experiment.",
      evidence: requiredCoverage.flatMap((item) => item.evidence),
      missingInputs,
      reviewMethod: "At the end of the approved observation window, compare post-discount margin, contribution after marketing cost, stock availability and cash headroom with the pre-campaign baseline and stop thresholds.",
      operatingKeys: requiredKeys,
    }));
  }

  recommendations.push(packet(input, {
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
  }, {
    missingInputs: [
      ...(!input.websiteUrl ? ["Business website"] : []),
      ...(!input.hasSearchData ? ["Search Console or owner-imported search baseline"] : []),
    ],
    reviewMethod: "Record the indexed-page and search-performance baseline, apply one bounded technical change, then review the same property and page scope after 28 days.",
    operatingKeys: ["location"],
  }));

  return recommendations;
}
