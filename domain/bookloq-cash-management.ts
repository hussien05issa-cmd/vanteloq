export type BusinessCashTransaction = {
  postingDate: string;
  amountCents: number;
  category: string;
  categorized: boolean;
  matched: boolean;
  /** Number of source rows represented by a server-side aggregate. */
  recordCount?: number;
};

export type TransactionMatchCandidate = {
  id: string;
  kind: "supplier_bill" | "customer_invoice" | "receipt";
  date: string;
  amountCents: number;
  label: string;
  reference?: string | null;
};

export function normalizeCategoryRuleText(value: string) {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function safeRatioBasisPoints(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round(numerator * 10_000 / denominator) : 0;
}

function subtractDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

export function buildBusinessCashSummary(transactions: BusinessCashTransaction[], asOf: string, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("Cash activity requires a reporting window of 1 to 366 days.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf) throw new Error("Cash activity requires a valid reporting date.");
  const startDate = subtractDays(asOf, Math.max(1, days) - 1);
  const included = transactions.filter((transaction) => transaction.postingDate >= startDate && transaction.postingDate <= asOf);
  for (const item of included) {
    if (!Number.isSafeInteger(item.amountCents) || !Number.isSafeInteger(item.recordCount ?? 1) || (item.recordCount ?? 1) < 1) throw new Error("Cash activity amounts and record counts must preserve integer precision.");
  }
  const add = (left: number, right: number) => { const sum = left + right; if (!Number.isSafeInteger(sum)) throw new Error("Cash activity exceeds safe integer precision."); return sum; };
  const countRecords = (items: BusinessCashTransaction[]) => items.reduce((sum, item) => sum + (item.recordCount ?? 1), 0);
  const inflowCents = included.filter((transaction) => transaction.amountCents > 0).reduce((sum, transaction) => add(sum, transaction.amountCents), 0);
  const outflowCents = included.filter((transaction) => transaction.amountCents < 0).reduce((sum, transaction) => add(sum, Math.abs(transaction.amountCents)), 0);
  const categoryTotals = new Map<string, number>();
  for (const transaction of included.filter((item) => item.amountCents < 0)) {
    categoryTotals.set(transaction.category, (categoryTotals.get(transaction.category) ?? 0) + Math.abs(transaction.amountCents));
  }
  const categories = [...categoryTotals.entries()]
    .map(([name, amountCents]) => ({ name, amountCents, shareBasisPoints: safeRatioBasisPoints(amountCents, outflowCents) }))
    .sort((left, right) => right.amountCents - left.amountCents || left.name.localeCompare(right.name));
  const count = countRecords(included);
  // Use the exact reporting interval for both chart and headline totals. No
  // browser clock, independent currency filter or capped transaction page.
  const bucketCount = Math.min(days, days > 90 ? 12 : 6);
  const timeline = Array.from({ length: bucketCount }, (_, index) => {
    const firstDay = Math.floor(index * days / bucketCount);
    const lastDay = Math.floor((index + 1) * days / bucketCount) - 1;
    const from = subtractDays(startDate, -firstDay);
    const to = subtractDays(startDate, -lastDay);
    const period = included.filter(item => item.postingDate >= from && item.postingDate <= to);
    const inflow = period.reduce((sum, item) => sum + Math.max(0, item.amountCents), 0);
    const outflow = period.reduce((sum, item) => sum + Math.max(0, -item.amountCents), 0);
    return { startDate: from, endDate: to, inflowCents: inflow, outflowCents: outflow, netCashFlowCents: inflow - outflow, transactionCount: countRecords(period) };
  });
  return {
    startDate,
    endDate: asOf,
    transactionCount: count,
    inflowCents,
    outflowCents,
    netCashFlowCents: inflowCents - outflowCents,
    averageDailyOutflowCents: Math.round(outflowCents / Math.max(1, days)),
    categorizedBasisPoints: safeRatioBasisPoints(countRecords(included.filter((item) => item.categorized)), count),
    matchedBasisPoints: safeRatioBasisPoints(countRecords(included.filter((item) => item.matched)), count),
    categories,
    timeline,
  };
}

function tokenOverlap(left: string, right: string) {
  const ignored = new Set(["inc", "ltd", "corp", "the", "invoice", "inv", "payment", "bill"]);
  const leftTokens = new Set(normalizeCategoryRuleText(left).split(" ").filter((token) => token.length > 2 && !ignored.has(token)));
  const rightTokens = normalizeCategoryRuleText(right).split(" ").filter((token) => token.length > 2 && !ignored.has(token));
  return rightTokens.some((token) => leftTokens.has(token));
}

export function rankTransactionMatches(
  transaction: { id: string; postingDate: string; amountCents: number; description: string },
  candidates: TransactionMatchCandidate[],
) {
  const transactionText = normalizeCategoryRuleText(transaction.description);
  return candidates.map((candidate) => {
    let confidenceBasisPoints = 0;
    const reasons: string[] = [];
    if (Math.abs(transaction.amountCents) === Math.abs(candidate.amountCents)) {
      confidenceBasisPoints += 5_500;
      reasons.push("Exact amount");
    }
    const reference = candidate.reference ? normalizeCategoryRuleText(candidate.reference) : "";
    if (reference && transactionText.includes(reference)) {
      confidenceBasisPoints += 2_000;
      reasons.push("Reference found");
    }
    const dayDistance = Math.abs((Date.parse(`${transaction.postingDate}T00:00:00Z`) - Date.parse(`${candidate.date}T00:00:00Z`)) / 86_400_000);
    if (dayDistance <= 7) {
      confidenceBasisPoints += 1_500;
      reasons.push("Date within 7 days");
    }
    if (tokenOverlap(transaction.description, candidate.label)) {
      confidenceBasisPoints += 1_000;
      reasons.push("Name overlap");
    }
    return {
      transactionId: transaction.id,
      candidateId: candidate.id,
      kind: candidate.kind,
      label: candidate.label,
      confidenceBasisPoints: Math.min(10_000, confidenceBasisPoints),
      reasons,
      requiresConfirmation: true as const,
    };
  }).filter((candidate) => candidate.confidenceBasisPoints >= 5_500)
    .sort((left, right) => right.confidenceBasisPoints - left.confidenceBasisPoints || left.label.localeCompare(right.label));
}
