export type MarketingPlanDraft = {
  title: string;
  channel: "content" | "google" | "meta" | "email" | "local" | "website";
  eventType: "campaign" | "content" | "audit" | "offer" | "follow_up";
  objective: string;
  notes: string;
};

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function isGrowthTimestamp(value: string): boolean {
  if (isCalendarDate(value)) return true;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && isCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value))
    && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}

export function campaignSlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Produces a link only. It does not fetch destinations, install tracking or send data. */
export function buildCampaignLink(input: { destination: string; source: string; medium: string; campaign: string; content?: string }): { url: string; error: null } | { url: null; error: string } {
  let url: URL;
  try { url = new URL(input.destination.trim()); } catch { return { url: null, error: "Enter a complete HTTPS landing-page address." }; }
  const localHost = /^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\.|\.(?:localhost|local|internal)$/i.test(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") || localHost) return { url: null, error: "Use a public HTTPS landing page without embedded credentials." };
  // Marketing links are public. Refuse common account and recovery parameters.
  const parameterKeys = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
  if (parameterKeys.some((key) => /token|secret|password|email|session|auth|^code$|^key$/i.test(key)) || /@[\w.-]+\.[a-z]{2,}/i.test(decodeURIComponentSafe(url.pathname + url.search + url.hash))) return { url: null, error: "Remove personal information, account links and security parameters before creating a public campaign link." };
  const values = { utm_source: input.source, utm_medium: input.medium, utm_campaign: input.campaign, utm_content: input.content ?? "" };
  for (const [key, value] of Object.entries(values)) {
    const normalized = campaignSlug(value);
    if ((!normalized && key !== "utm_content") || (normalized && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(normalized))) return { url: null, error: "Use short campaign labels with letters, numbers, spaces or underscores. Source, medium and campaign are required." };
    url.searchParams.delete(key);
    if (normalized) url.searchParams.set(key, normalized);
  }
  if (url.toString().length > 1500) return { url: null, error: "Use a shorter landing-page address (up to 1,500 characters including campaign labels)." };
  return { url: url.toString(), error: null };
}

function decodeURIComponentSafe(value: string) { try { return decodeURIComponent(value); } catch { return value; } }

export const marketingReviewGuides = [
  { id: "search", title: "Search is changing. Keep the fundamentals strong.", detail: "Review indexed pages, useful answers and internal links. Google does not require special AI markup to appear in its AI search features. Visibility is never guaranteed.", cadence: "Review monthly and after significant site changes", source: "Google Search guidance", url: "https://developers.google.com/search/docs/appearance/ai-features", channel: "website" as const, measure: "Compare Search Console clicks and impressions for the same pages and period. Record indexing issues separately." },
  { id: "measurement", title: "Keep campaign names consistent across channels.", detail: "Use the same campaign label for one initiative and distinct sources for each platform. Case and naming differences can split reports. Test the landing page before sharing.", cadence: "Check before each campaign", source: "Google Analytics campaign guidance", url: "https://support.google.com/analytics/answer/10917952?hl=en", channel: "content" as const, measure: "Verify source, medium and campaign in acquisition reports after consented visits are recorded. Do not tag internal navigation." },
  { id: "attribution", title: "Separate reported credit from proven business impact.", detail: "Different attribution models can assign credit differently. Do not add platform conversions together or interpret a before-and-after increase as causal lift.", cadence: "Review weekly and before changing spend", source: "Google Analytics attribution guidance", url: "https://support.google.com/analytics/answer/10596866?hl=en", channel: "website" as const, measure: "Record the source, model, date range and business outcome. Use a controlled experiment where feasible; check stock, margin and capacity before promotion." },
] as const;
