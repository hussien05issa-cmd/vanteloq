export function bookloqMetricCount(value: number | null | undefined) {
  return value == null ? "Not available" : String(value);
}

export function bookloqHealthPresentation(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  const score = Math.max(0, Math.min(100, value));
  return { score, degrees: score * 3.6 };
}

export function formatBookloqMoney(value: number | null | undefined, currency: string) {
  return value == null || !Number.isFinite(value) ? "Not available"
    : new Intl.NumberFormat("en-CA", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value === 0 ? 0 : value / 100);
}

export function bookloqPositionMessage(input: { alert?: { title: string; explanation: string }; currentCashCents: number | null; revenueCents: number | null; dataMode?: string }) {
  if (input.dataMode === "demonstration") return { title: "Exploring a demonstration workspace", detail: "These figures are examples. They do not describe your business or authorize spending." };
  if (input.alert) return { title: input.alert.title, detail: input.alert.explanation };
  if (input.currentCashCents === null && input.revenueCents === null) return { title: "Build your financial picture", detail: "Add source records and review your accounts to make cash and profit available. No alerts does not mean the books are complete." };
  if (input.currentCashCents === null || input.revenueCents === null) return { title: "Your financial picture is incomplete", detail: "Some figures are available. Review missing sources before making cash or profitability decisions." };
  return { title: "Review your current financial position", detail: "No open alerts appear in the available records. Check source freshness, reconciliation and outstanding obligations before acting." };
}
