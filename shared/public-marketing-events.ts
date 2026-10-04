/** Public interactions use fixed labels only. Never read input values or URLs here. */
const EVENT_PROPERTIES = {
  demo_view: ["section", "step", "industry"],
  demo_engaged: ["section", "step", "industry"],
  signup_start: ["section", "plan"],
  plan_selected: ["section", "plan"],
  pricing_view: ["section", "plan"],
  compatibility_checked: ["section", "provider"],
  hero_play: ["section"],
  hero_pause: ["section"],
  hero_replay: ["section"],
  story_step_selected: ["section", "step"],
  industry_selected: ["section", "industry"],
  ai_example_selected: ["section", "step"],
} as const;

const PROPERTY_VALUES = {
  section: new Set(["header", "hero", "story", "questions", "industries", "ai", "pricing", "final_cta", "footer", "connections", "demo", "retail_landing"]),
  step: new Set(["sources", "overview", "comparison", "review", "connect", "understand", "decide", "sales", "stock", "cash"]),
  industry: new Set(["retail", "restaurants", "cafes", "dealerships", "multi_location"]),
  plan: new Set(["free", "starter", "growth", "pro", "bookloq", "custom"]),
  provider: new Set(["csv", "manual", "lightspeed_r", "lightspeed_x", "square", "slack", "shopify", "shopify_pos", "stripe", "moneris", "plaid", "quickbooks", "xero", "google", "meta", "doordash", "uber_eats", "deel", "clover"]),
};

const DATASET_KEYS = {
  section: "publicSection",
  step: "publicStep",
  industry: "publicIndustry",
  plan: "publicPlan",
  provider: "publicProvider",
} as const;

export type PublicMarketingEventName = keyof typeof EVENT_PROPERTIES;
export type PublicMarketingProperty = keyof typeof PROPERTY_VALUES;

export function publicMarketingEvent(dataset: Readonly<Record<string, string | undefined>>) {
  const candidate = dataset.publicEvent;
  // Completion events deliberately have no DOM-click path. inquiry_sent is
  // emitted separately only after the contact endpoint confirms success.
  if (!candidate || !Object.hasOwn(EVENT_PROPERTIES, candidate)) return null;
  const name = candidate as PublicMarketingEventName;
  const properties: Partial<Record<PublicMarketingProperty, string>> = {};
  for (const property of EVENT_PROPERTIES[name]) {
    const value = dataset[DATASET_KEYS[property]];
    if (typeof value === "string" && PROPERTY_VALUES[property].has(value)) {
      properties[property] = value;
    }
  }
  return { name, properties };
}

