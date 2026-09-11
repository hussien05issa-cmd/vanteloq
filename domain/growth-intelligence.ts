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
  sourceSystem?: string;
};

export function buildJourneyCoverage(touchpoints: readonly GrowthTouchpoint[], transactions: readonly GrowthTransaction[]) {
  const stages = { discovery: new Set<string>(), website: new Set<string>(), contact: new Set<string>(), customer: new Set<string>(), purchase: new Set<string>() };
  const firstTouch = new Map<string, number>();
  for (const point of touchpoints) {
    const occurred = Date.parse(point.occurredAt);
    if (!Number.isFinite(occurred)) continue;
    firstTouch.set(point.journeyRef, Math.min(firstTouch.get(point.journeyRef) ?? Infinity, occurred));
    stages[point.stage === "phone_call" || point.stage === "lead" ? "contact" : point.stage].add(point.journeyRef);
  }
  let matchedTransactions = 0;
  for (const transaction of transactions) {
    const first = firstTouch.get(transaction.journeyRef);
    if (first !== undefined && Date.parse(transaction.occurredAt) >= first) { matchedTransactions++; stages.purchase.add(transaction.journeyRef); }
  }
  return { journeys: firstTouch.size, stages: Object.fromEntries(Object.entries(stages).map(([stage, refs]) => [stage, refs.size])) as Record<keyof typeof stages, number>, matchedTransactions, unmatchedTransactions: transactions.length - matchedTransactions };
}

/** Compare like-for-like observations, never unrelated queries or source systems. */
export function comparableSearchSeries<T extends SearchVisibilityObservation | { query: string; observedDate: string; position: number; sourceSystem: string }>(rows: readonly T[]) {
  const groups = new Map<string, Map<string, T | null>>();
  for (const row of rows) {
    if (!Number.isFinite(row.position) || row.position <= 0 || !Number.isFinite(Date.parse(row.observedDate))) continue;
    const key = JSON.stringify([row.query, row.sourceSystem ?? "unspecified"]);
    const days = groups.get(key) ?? new Map<string, T | null>();
    // Ambiguous duplicate-day observations are excluded, not silently averaged.
    if (days.has(row.observedDate)) { days.set(row.observedDate, null); continue; }
    days.set(row.observedDate, row); groups.set(key, days);
  }
  return [...groups].map(([key, days]) => ({ key, rows: [...days.values()].filter((row): row is T => row !== null).sort((a, b) => a.observedDate.localeCompare(b.observedDate)) })).filter((group) => group.rows.length);
}

export function buildGrowthIntelligence(input: {
  touchpoints: readonly GrowthTouchpoint[];
  transactions: readonly GrowthTransaction[];
  searchVisibility: readonly SearchVisibilityObservation[];
}) {
  if (!input.touchpoints.length) return { status: "unavailable" as const, reason: "Connect a verified discovery, website, call, or campaign source to calculate attribution.", channels: [], insight: null };
  const byJourney = new Map<string, GrowthTouchpoint[]>();
  for (const point of input.touchpoints) {
    if (!Number.isFinite(Date.parse(point.occurredAt))) continue;
    const points = byJourney.get(point.journeyRef) ?? [];
    points.push(point); byJourney.set(point.journeyRef, points);
  }
  const transactionsByJourney = new Map<string, GrowthTransaction[]>();
  for (const transaction of input.transactions) {
    const transactions = transactionsByJourney.get(transaction.journeyRef) ?? [];
    transactions.push(transaction); transactionsByJourney.set(transaction.journeyRef, transactions);
  }
  const sourceMap = new Map<string, { source: string; leads: Set<string>; customers: Set<string>; transactions: number; revenueCents: number; grossProfitCents: number | null }>();
  for (const [journeyRef, points] of byJourney) {
    const first = points.reduce((earliest, point) => Date.parse(point.occurredAt) < Date.parse(earliest.occurredAt) ? point : earliest);
    const row = sourceMap.get(first.source) ?? { source: first.source, leads: new Set(), customers: new Set(), transactions: 0, revenueCents: 0, grossProfitCents: 0 };
    if (points.some((point) => point.stage === "lead" || point.stage === "phone_call")) row.leads.add(journeyRef);
    if (points.some((point) => point.stage === "customer")) row.customers.add(journeyRef);
    for (const transaction of transactionsByJourney.get(journeyRef) ?? []) {
      if (!(Date.parse(transaction.occurredAt) >= Date.parse(first.occurredAt))) continue;
      row.transactions += 1; row.revenueCents += transaction.revenueCents;
      row.grossProfitCents = row.grossProfitCents === null || transaction.grossProfitCents === null ? null : row.grossProfitCents + transaction.grossProfitCents;
    }
    sourceMap.set(first.source, row);
  }
  const channels = [...sourceMap.values()].map((row) => ({ source: row.source, leads: row.leads.size, customers: row.customers.size, transactions: row.transactions, revenueCents: row.revenueCents, grossProfitCents: row.grossProfitCents })).sort((a, b) => b.revenueCents - a.revenueCents);
  const observations = comparableSearchSeries(input.searchVisibility).filter((group) => group.rows.length >= 2).sort((a, b) => b.rows.at(-1)!.observedDate.localeCompare(a.rows.at(-1)!.observedDate))[0]?.rows ?? [];
  let insight: null | { title: string; explanation: string; estimatedDiscoveryActionChange: number | null; confidence: "measured" | "directional" } = null;
  if (observations.length >= 2) {
    const previous = observations.at(-2)!; const current = observations.at(-1)!;
    const measured = previous.discoveryActions !== null && current.discoveryActions !== null;
    insight = {
      title: `“${current.query}” moved from position ${previous.position} to ${current.position}.`,
      explanation: measured ? "This compares the same query and source. The recorded discovery-action change is an association, not proof of causation." : "This compares the same query and source. No matched discovery-action evidence was provided, so business impact is unavailable.",
      estimatedDiscoveryActionChange: measured ? current.discoveryActions! - previous.discoveryActions! : null,
      confidence: measured ? "measured" : "directional",
    };
  }
  return { status: "available" as const, reason: null, channels, insight };
}
