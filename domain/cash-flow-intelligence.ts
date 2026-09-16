export type CashFlowItem = {
  id: string;
  label: string;
  dueDate: string;
  amountCents: number;
  direction: "in" | "out";
  certainty: "confirmed" | "probable" | "estimated";
  category?: "supplier" | "payroll" | "rent" | "tax" | "debt" | "other";
};

export type CashFlowIntelligence = {
  status: "available" | "unavailable";
  liquidity30Cents: number | null;
  liquidity60Cents: number | null;
  purchasingCapacityCents: number | null;
  risk: "low" | "moderate" | "high" | "unavailable";
  minimumCashCents: number | null;
  minimumCashDate: string | null;
  warning: string | null;
  evidence: string[];
};

const DAY = 86_400_000;

function endDate(asOf: string, days: number) {
  return new Date(Date.parse(`${asOf}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}

function closingCash(openingCashCents: number, items: readonly CashFlowItem[], through: string) {
  return openingCashCents + items
    .filter((item) => item.dueDate <= through)
    .reduce((sum, item) => sum + (item.direction === "in" ? item.amountCents : -item.amountCents), 0);
}

export function calculateCashFlowIntelligence(input: {
  openingCashCents: number | null;
  safetyThresholdCents: number;
  items: readonly CashFlowItem[];
  asOf: string;
}): CashFlowIntelligence {
  if (input.openingCashCents === null) {
    return { status: "unavailable", liquidity30Cents: null, liquidity60Cents: null, purchasingCapacityCents: null, risk: "unavailable", minimumCashCents: null, minimumCashDate: null, warning: null, evidence: ["A verified opening cash balance is required."] };
  }
  // These are outstanding items, not settled historical movements. An overdue
  // balance remains due today; expected receipts never become confirmed cash.
  const eligible = input.items.filter((item) => item.amountCents > 0)
    .map((item) => ({ ...item, dueDate: item.dueDate < input.asOf ? input.asOf : item.dueDate }));
  const liquidity30Cents = closingCash(input.openingCashCents, eligible, endDate(input.asOf, 30));
  const liquidity60Cents = closingCash(input.openingCashCents, eligible, endDate(input.asOf, 60));
  const confirmed60 = eligible.filter((item) => item.direction === "out" && item.certainty === "confirmed" && item.dueDate <= endDate(input.asOf, 60));
  const purchasingCapacityCents = Math.max(0, input.openingCashCents - input.safetyThresholdCents - confirmed60.reduce((sum, item) => sum + item.amountCents, 0));
  let running = input.openingCashCents;
  let minimumCashCents = running;
  let minimumCashDate = input.asOf;
  // Daily balances must not change with the database's row order.
  const dailyNet = new Map<string, number>();
  for (const item of eligible.filter((item) => item.dueDate <= endDate(input.asOf, 60))) {
    dailyNet.set(item.dueDate, (dailyNet.get(item.dueDate) ?? 0) + (item.direction === "in" ? item.amountCents : -item.amountCents));
  }
  for (const [date, net] of [...dailyNet].sort(([a], [b]) => a.localeCompare(b))) {
    running += net;
    if (running < minimumCashCents) { minimumCashCents = running; minimumCashDate = date; }
  }
  const risk = minimumCashCents < 0 ? "high" : minimumCashCents < input.safetyThresholdCents ? "moderate" : "low";
  const supplier = confirmed60.filter((item) => item.category === "supplier").sort((a, b) => b.amountCents - a.amountCents)[0];
  const laterObligations = supplier ? confirmed60.filter((item) => item.id !== supplier.id) : [];
  const cashAfterPayingToday = supplier ? input.openingCashCents - supplier.amountCents : input.openingCashCents;
  let warning: string | null = null;
  if (supplier) {
    let scenarioCash = cashAfterPayingToday;
    for (const item of [...laterObligations].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      scenarioCash -= item.amountCents;
      if (scenarioCash < input.safetyThresholdCents) {
        warning = `Paying ${supplier.label} in full today would move projected cash below the safety threshold by ${item.dueDate}, before ${item.label}.`;
        break;
      }
    }
  }
  return {
    status: "available", liquidity30Cents, liquidity60Cents, purchasingCapacityCents,
    risk, minimumCashCents, minimumCashDate, warning,
    evidence: [
      `Opening cash as of ${input.asOf}.`,
      `${confirmed60.length} confirmed obligations included through ${endDate(input.asOf, 60)}.`,
      "Outstanding overdue items are carried into today. Minimum cash uses daily closing balances over 60 days, not intraday payment order.",
      "Probable receivables affect liquidity but are excluded from purchasing capacity.",
    ],
  };
}
