export function buildGoogleResourceReadiness(input: {
  locationId: string;
  analyticsPropertyRef: string | null;
  analyticsScopeRef?: string | null;
  searchConsoleSiteRef: string | null;
  searchConsoleScopeRef?: string | null;
  businessProfileLocationRef: string | null;
}) {
  const missing = [
    !input.analyticsPropertyRef ? "Google Analytics property" : null,
    !input.searchConsoleSiteRef ? "Search Console site" : null,
    !input.businessProfileLocationRef ? "Google Business Profile location" : null,
  ].filter((value): value is string => Boolean(value));
  const scopeMatches = (scopeRef: string | null | undefined) => scopeRef === "organization" || scopeRef === input.locationId;
  const scopeReady = scopeMatches(input.analyticsScopeRef) && scopeMatches(input.searchConsoleScopeRef);
  const ready = missing.length === 0 && scopeReady;
  return {
    locationId: input.locationId,
    status: ready ? "ready" as const : "selection_required" as const,
    missing,
    canCombineMeasurements: false,
    boundary: missing.length || !scopeReady
      ? "Choose each missing Google resource, assign its organization or owned-location scope, then approve a warning-free sample."
      : "Google resources are selected. Each approved property or site remains a separate measurement series with its own scope and lineage.",
  };
}

type LocalCandidate = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  classification: "unclassified" | "competitor" | "partner" | "opportunity";
  category: string;
};

export function buildLocalOpportunityModel(input: {
  centre: { latitude: number; longitude: number } | null;
}) {
  return {
    centre: input.centre,
    status: input.centre ? "provider_not_configured" as const : "coordinates_required" as const,
    source: { name: "OpenStreetMap", attributionUrl: "https://www.openstreetmap.org/copyright", live: false },
    candidates: [] as LocalCandidate[],
    boundary: "No nearby places are loaded until a reviewed OSM-derived provider is configured. Future candidates will remain neutral until the owner classifies them.",
  };
}

export function buildProfileHealthChecklist(input: {
  businessType: string;
  profile: {
    verified: boolean;
    websiteRecorded: boolean;
    phoneRecorded: boolean;
    hoursRecorded: boolean;
  };
}) {
  const normalizedBusinessType = input.businessType.trim().toLocaleLowerCase("en-CA");
  const item = (id: string, label: string, complete: boolean | null, why: string) => ({
    id,
    label,
    status: complete === null ? "review_in_google" as const : complete ? "complete" as const : "action_required" as const,
    why,
  });
  const items = [
    item("verification", "Keep the profile verified", input.profile.verified, "Verification is required for reliable owner-managed profile data."),
    item("primary-category", "Confirm the primary category", null, "Review this directly in the authorized Google account."),
    item(normalizedBusinessType === "retail" ? "retail-hours" : "business-hours", "Record regular hours in Vanteloq", input.profile.hoursRecorded, "Accurate hours support consistent owner records."),
    item("website", "Record the correct website landing page", input.profile.websiteRecorded, "The owner record should point to the active website."),
    item("phone", "Record the public phone number", input.profile.phoneRecorded, "Calls should reach the active business."),
    item("special-hours", "Review special hours", null, "Review holiday and exceptional hours directly in Google."),
    item("attributes-photos", "Review attributes and current photos", null, "Review these directly in Google without copying content into Vanteloq."),
    item("review-response", "Respond to new customer reviews", null, "Use the on-demand response queue. Every reply requires confirmation before it is published to Google."),
  ];
  return {
    businessType: input.businessType,
    completedCount: items.filter((entry) => entry.status === "complete").length,
    actionRequiredCount: items.filter((entry) => entry.status === "action_required").length,
    items,
    disclaimer: "This checklist supports profile completeness and customer experience. Review content is fetched on demand and is not retained by Vanteloq. Completion does not guarantee ranking, placement, traffic, or revenue.",
  };
}
