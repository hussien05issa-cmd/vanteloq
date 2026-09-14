export type OperatingPillar = "sales" | "money" | "inventory" | "operations" | "data";

export type OperatingDecision = {
  id: string;
  pillar: OperatingPillar;
  priority: "critical" | "high" | "medium" | "low";
  score: number;
  title: string;
  decision: string;
  evidence: string[];
  missing: string[];
  confidence: "high" | "medium" | "low";
  approval: "owner_review" | "authorized_user";
  sourceRef: string;
};

export type OperatingSystemInput = {
  ready: boolean;
  currency: string;
  source: { rowCount: number; verifiedDays?: number; freshness: string; latestBusinessDate: string | null };
  balances: null | {
    cashBalanceCents: number | null;
    accountsPayableCents: number | null;
    inventoryValueCents: number | null;
  };
  insights: {
    id: string;
    severity: "critical" | "attention" | "opportunity" | "informational";
    title: string;
    whatHappened: string;
    recommendedAction: string;
    financialImpact: string;
    confidence: "high" | "medium" | "low";
    evidence: string[];
    missingInformation: string[];
  }[];
  dataQuality: { status: string; missingDimensions: string[] };
};

const priorityScore = {
  critical: 100,
  attention: 78,
  opportunity: 58,
  informational: 32,
} as const;

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function rankedPriority(score: number): OperatingDecision["priority"] {
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function buildOperatingSystem(input: OperatingSystemInput) {
  if (!input.ready) {
    return {
      status: "blocked" as const,
      mode: "evidence_required" as const,
      preliminaryPurchasingCapacityCents: null,
      purchasingCapacityLabel: "Unavailable until cash and commitments are verified",
      pillars: [
        { id: "sales", label: "Sales", state: "needs_source" },
        { id: "money", label: "Money", state: "needs_source" },
        { id: "inventory", label: "Inventory", state: "needs_source" },
        { id: "operations", label: "Operations", state: "ready" },
      ],
      decisions: [] as OperatingDecision[],
      guardrails: ["No facts, no recommendation", "Sensitive actions always require approval", "Every decision keeps its evidence"],
    };
  }

  const decisions: OperatingDecision[] = input.insights.map((insight) => {
    const base = priorityScore[insight.severity];
    const freshnessPenalty = input.source.freshness === "stale" ? 24 : input.source.freshness === "aging" ? 10 : 0;
    const confidencePenalty = insight.confidence === "low" ? 12 : insight.confidence === "medium" ? 4 : 0;
    const score = Math.max(1, base - freshnessPenalty - confidencePenalty);
    return {
      id: `decision:${insight.id}`,
      pillar: insight.id.includes("margin") || insight.id.includes("sales") ? "sales" : insight.id.includes("labour") ? "operations" : "data",
      priority: rankedPriority(score),
      score,
      title: insight.title,
      decision: insight.recommendedAction,
      evidence: [insight.whatHappened, insight.financialImpact, ...insight.evidence],
      missing: insight.missingInformation,
      confidence: insight.confidence,
      approval: "owner_review",
      sourceRef: insight.id,
    };
  });

  const cash = input.balances?.cashBalanceCents ?? null;
  const payable = input.balances?.accountsPayableCents ?? null;
  const preliminaryPurchasingCapacityCents = cash === null || payable === null ? null : Math.max(0, cash - payable);
  if (cash !== null && payable !== null && payable > cash) {
    const shortfall = payable - cash;
    decisions.push({
      id: "decision:cash-commitment-gap",
      pillar: "money",
      priority: "critical",
      score: 96,
      title: "Recorded payables exceed the latest cash balance",
      decision: "Sequence supplier payments and verify payroll, rent, tax and debt dates before approving new purchasing.",
      evidence: [`Cash: ${money(cash, input.currency)}`, `Accounts payable: ${money(payable, input.currency)}`, `Recorded gap: ${money(shortfall, input.currency)}`],
      missing: ["Payroll commitments", "Rent schedule", "Tax reserve", "Debt payments", "Expected receipts"],
      confidence: input.source.freshness === "current" ? "high" : "medium",
      approval: "owner_review",
      sourceRef: "balances:cash-ap",
    });
  }

  decisions.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    status: input.dataQuality.status === "usable" ? "operational" as const : "limited" as const,
    mode: "retail_owner" as const,
    preliminaryPurchasingCapacityCents,
    purchasingCapacityLabel: preliminaryPurchasingCapacityCents === null
      ? "Needs cash and payable balances"
      : "Preliminary only: cash less recorded payables; unmodeled obligations excluded",
    pillars: [
      { id: "sales", label: "Sales", state: input.dataQuality.status === "usable" && input.source.freshness === "current" ? "operational" : "limited" },
      { id: "money", label: "Money", state: cash !== null && payable !== null ? "limited" : "needs_source" },
      { id: "inventory", label: "Inventory", state: input.balances?.inventoryValueCents != null ? "limited" : "needs_source" },
      { id: "operations", label: "Operations", state: "operational" },
    ],
    decisions,
    guardrails: ["No autonomous payments or orders", "Permission-filtered before delivery", "Evidence, confidence and missing inputs stay visible"],
  };
}
