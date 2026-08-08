export type GrowthTouchpoint = {
  id: string;
  occurredAt: string;
  source: string;
  stage: "discovery" | "website" | "phone_call" | "lead" | "customer";
  journeyRef: string;
};

export type GrowthTransaction = {
  id: string;
  occurredAt: string;
  journeyRef: string;
  revenueCents: number;
  grossProfitCents: number | null;
};

export type SearchVisibilityObservation = {
  query: string;
  observedDate: string;
  position: number;
  discoveryActions: number | null;
};

export function buildGrowthIntelligence(input: {
  touchpoints: readonly GrowthTouchpoint[];
  transactions: readonly GrowthTransaction[];
  searchVisibility: readonly SearchVisibilityObservation[];
}) {
  if (!input.touchpoints.length) return { status: "unavailable" as const, reason: "Connect a verified discovery, website, call, or campaign source to calculate attribution.", channels: [], insight: null };
  const byJourney = new Map<string, GrowthTouchpoint[]>();
  for (const point of input.touchpoints) byJourney.set(point.journeyRef, [...(byJourney.get(point.journeyRef) ?? []), point]);
  const sourceMap = new Map<string, { source: string; leads: Set<string>; customers: Set<string>; transactions: number; revenueCents: number; grossProfitCents: number | null }>();
  for (const [journeyRef, points] of byJourney) {
    const first = [...points].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0];
    const row = sourceMap.get(first.source) ?? { source: first.source, leads: new Set(), customers: new Set(), transactions: 0, revenueCents: 0, grossProfitCents: 0 };
    if (points.some((point) => point.stage === "lead" || point.stage === "phone_call")) row.leads.add(journeyRef);
    if (points.some((point) => point.stage === "customer")) row.customers.add(journeyRef);
    for (const transaction of input.transactions.filter((item) => item.journeyRef === journeyRef)) {
      row.transactions += 1; row.revenueCents += transaction.revenueCents;
      row.grossProfitCents = row.grossProfitCents === null || transaction.grossProfitCents === null ? null : row.grossProfitCents + transaction.grossProfitCents;
    }
    sourceMap.set(first.source, row);
  }
  const channels = [...sourceMap.values()].map((row) => ({ source: row.source, leads: row.leads.size, customers: row.customers.size, transactions: row.transactions, revenueCents: row.revenueCents, grossProfitCents: row.grossProfitCents })).sort((a, b) => b.revenueCents - a.revenueCents);
  const observations = [...input.searchVisibility].sort((a, b) => a.observedDate.localeCompare(b.observedDate));
  let insight: null | { title: string; explanation: string; estimatedDiscoveryActionChange: number | null; confidence: "measured" | "directional" } = null;
  if (observations.length >= 2) {
    const previous = observations.at(-2)!; const current = observations.at(-1)!;
    const measured = previous.discoveryActions !== null && current.discoveryActions !== null;
    insight = {
      title: `“${current.query}” moved from position ${previous.position} to ${current.position}.`,
      explanation: measured ? "The discovery-action change is measured from connected search visibility records; it is an association, not proof of causation." : "Ranking changed, but discovery-action impact is unavailable until Google Business performance is connected.",
      estimatedDiscoveryActionChange: measured ? current.discoveryActions! - previous.discoveryActions! : null,
      confidence: measured ? "measured" : "directional",
    };
  }
  return { status: "available" as const, reason: null, channels, insight };
}
