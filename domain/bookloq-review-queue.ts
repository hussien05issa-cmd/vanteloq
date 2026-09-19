export type BookloqReviewPriority = "high" | "medium" | "low";
export type BookloqReviewTarget = "Transactions" | "Bills" | "Month-End" | "Documents";

export type BookloqReviewItem = Readonly<{
  id: string;
  kind: "alert" | "transaction" | "bill" | "close" | "document";
  title: string;
  reason: string;
  priority: BookloqReviewPriority;
  amountCents: number | null;
  ageDays: number | null;
  owner: string;
  nextAction: string;
  target: BookloqReviewTarget;
  source: string;
  confidence: "high" | "medium" | "low" | null;
  score: number;
  sourceRef: string;
  evidenceRef: string | null;
}>;

type AlertInput = Readonly<{ id: string; status: string; severity: string; title: string; explanation: string; dollarImpactCents: number | null; confidence: string; recommendedAction: string; createdAt: number; supportingRecordsJson?: string }>;
type TransactionInput = Readonly<{ id: string; postingDate: string; description: string; amountCents: number; sourceSystem: string; categorizationStatus: string; reconciliationStatus: string; confidenceBasisPoints: number }>;
type BillInput = Readonly<{ id: string; billNumber: string; dueDate: string; status: string; totalCents: number; paidCents: number; supplierName: string; approvalStatus: string }>;
type CloseInput = Readonly<{ id: string; title: string; status: string; dueDate: string | null; blocker: string }>;
type DocumentInput = Readonly<{ id: string; fileName: string; status: string; securityState: string; extractionStatus: string; createdAt: number }>;

export type BookloqReviewQueueInput = Readonly<{
  alerts: readonly AlertInput[];
  transactions: readonly TransactionInput[];
  bills: readonly BillInput[];
  closeItems: readonly CloseInput[];
  documents: readonly DocumentInput[];
  asOf: string;
}>;

const DAY_MS = 86_400_000;
const severityScore = { critical: 1_000, attention: 700, opportunity: 400, informational: 200 } as const;

function dateEpoch(value: string) {
  const epoch = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(epoch) ? epoch : null;
}

function secondsEpoch(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function ageDays(asOfEpoch: number, value: number | null) {
  return value === null ? null : Math.max(0, Math.floor((asOfEpoch - value) / DAY_MS));
}

function amountWeight(cents: number | null) {
  return cents === null ? 0 : Math.min(400, Math.round(Math.abs(cents) / 1_000));
}

function normalizeConfidence(value: string): "high" | "medium" | "low" | null {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function alertEvidence(value: string | undefined): { target: BookloqReviewTarget; ref: string | null } {
  if (!value) return { target: "Transactions", ref: null };
  try {
    const references = JSON.parse(value);
    if (!Array.isArray(references)) return { target: "Transactions", ref: null };
    for (const reference of references) {
      if (typeof reference !== "string") continue;
      const [kind] = reference.split(":", 1);
      if (kind === "bill") return { target: "Bills", ref: reference };
      if (kind === "document") return { target: "Documents", ref: reference };
      if (kind === "close") return { target: "Month-End", ref: reference };
      if (kind === "transaction") return { target: "Transactions", ref: reference };
    }
  } catch {
    // Invalid evidence JSON must never change the accounting workflow target.
  }
  return { target: "Transactions", ref: null };
}

export function buildBookloqReviewQueue(input: BookloqReviewQueueInput): BookloqReviewItem[] {
  const asOfEpoch = dateEpoch(input.asOf) ?? Date.now();
  const items: BookloqReviewItem[] = [];

  for (const alert of input.alerts) {
    if (alert.status !== "open") continue;
    const priority: BookloqReviewPriority = alert.severity === "critical" ? "high" : alert.severity === "attention" ? "medium" : "low";
    const age = ageDays(asOfEpoch, secondsEpoch(alert.createdAt));
    const evidence = alertEvidence(alert.supportingRecordsJson);
    items.push({
      id: `alert:${alert.id}`,
      kind: "alert",
      title: alert.title,
      reason: alert.explanation,
      priority,
      amountCents: alert.dollarImpactCents,
      ageDays: age,
      owner: "Unassigned",
      nextAction: alert.recommendedAction,
      target: evidence.target,
      source: "BookLoQ financial alert",
      confidence: normalizeConfidence(alert.confidence),
      score: (severityScore[alert.severity as keyof typeof severityScore] ?? 200) + amountWeight(alert.dollarImpactCents) + Math.min(age ?? 0, 90),
      sourceRef: alert.id,
      evidenceRef: evidence.ref,
    });
  }

  for (const transaction of input.transactions) {
    const categoryOpen = transaction.categorizationStatus !== "confirmed";
    const reconciliationOpen = transaction.reconciliationStatus !== "reconciled";
    if (!categoryOpen && !reconciliationOpen) continue;
    const amount = Math.abs(transaction.amountCents);
    const lowConfidence = transaction.confidenceBasisPoints < 7_000;
    const priority: BookloqReviewPriority = amount >= 250_000 || lowConfidence ? "high" : amount >= 50_000 ? "medium" : "low";
    const age = ageDays(asOfEpoch, dateEpoch(transaction.postingDate));
    const reconciliationReason = transaction.reconciliationStatus === "matched"
      ? "Matched to evidence but not reconciled"
      : "Not matched or reconciled";
    const openReasons = [categoryOpen ? "Category needs confirmation" : "", reconciliationOpen ? reconciliationReason : ""].filter(Boolean);
    items.push({
      id: `transaction:${transaction.id}`,
      kind: "transaction",
      title: transaction.description || "Transaction needs review",
      reason: openReasons.join(". "),
      priority,
      amountCents: amount,
      ageDays: age,
      owner: "Unassigned",
      nextAction: categoryOpen
        ? "Confirm the category and supporting evidence"
        : transaction.reconciliationStatus === "matched"
          ? "Review the remaining difference before reconciliation"
          : "Match the record to supporting evidence",
      target: "Transactions",
      source: transaction.sourceSystem ? `${transaction.sourceSystem} transaction` : "Imported transaction",
      confidence: transaction.confidenceBasisPoints >= 8_500 ? "high" : transaction.confidenceBasisPoints >= 7_000 ? "medium" : "low",
      score: 550 + amountWeight(amount) + (lowConfidence ? 180 : 0) + Math.min(age ?? 0, 90),
      sourceRef: transaction.id,
      evidenceRef: `transaction:${transaction.id}`,
    });
  }

  for (const bill of input.bills) {
    const outstanding = Math.max(0, bill.totalCents - bill.paidCents);
    const dueEpoch = dateEpoch(bill.dueDate);
    const overdueDays = dueEpoch === null ? null : Math.max(0, Math.floor((asOfEpoch - dueEpoch) / DAY_MS));
    const isFinal = ["paid", "void", "written_off"].includes(bill.status);
    if (isFinal || outstanding === 0 || overdueDays === null || overdueDays === 0) continue;
    const priority: BookloqReviewPriority = overdueDays >= 30 || outstanding >= 250_000 ? "high" : "medium";
    items.push({
      id: `bill:${bill.id}`,
      kind: "bill",
      title: `${bill.billNumber} · ${bill.supplierName}`,
      reason: `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue. Approval: ${bill.approvalStatus.replaceAll("_", " ")}.`,
      priority,
      amountCents: outstanding,
      ageDays: overdueDays,
      owner: "Unassigned",
      nextAction: "Review the bill, evidence and payment status",
      target: "Bills",
      source: "Accounts payable",
      confidence: "high",
      score: 650 + amountWeight(outstanding) + Math.min(overdueDays, 120),
      sourceRef: bill.id,
      evidenceRef: `bill:${bill.id}`,
    });
  }

  for (const item of input.closeItems) {
    if (item.status === "complete") continue;
    const age = item.dueDate ? ageDays(asOfEpoch, dateEpoch(item.dueDate)) : null;
    const blocked = item.status === "blocked";
    items.push({
      id: `close:${item.id}`,
      kind: "close",
      title: item.title,
      reason: item.blocker || `Month-end control is ${item.status.replaceAll("_", " ")}.`,
      priority: blocked ? "high" : "medium",
      amountCents: null,
      ageDays: age,
      owner: "Unassigned",
      nextAction: blocked ? "Resolve the recorded blocker before period lock" : "Complete and document this close control",
      target: "Month-End",
      source: "Month-end checklist",
      confidence: "high",
      // A blocked close control can invalidate every downstream statement, so it
      // outranks ordinary transaction review even when no dollar impact can be
      // measured from the current records.
      score: (blocked ? 1_050 : 520) + Math.min(age ?? 0, 90),
      sourceRef: item.id,
      evidenceRef: `close:${item.id}`,
    });
  }

  for (const document of input.documents) {
    if (!["uploaded", "review_required"].includes(document.status)) continue;
    const age = ageDays(asOfEpoch, secondsEpoch(document.createdAt));
    const securityBlocked = document.securityState !== "clean";
    const extractionFailed = document.extractionStatus === "failed";
    const priority: BookloqReviewPriority = securityBlocked || extractionFailed ? "high" : "medium";
    const reason = securityBlocked
      ? `Security state is ${document.securityState.replaceAll("_", " ")}.`
      : extractionFailed
        ? "Document reading failed and needs attention."
        : document.extractionStatus === "complete"
          ? "Extracted fields still require human review."
          : "The original file is waiting for scan, extraction or review.";
    items.push({
      id: `document:${document.id}`,
      kind: "document",
      title: document.fileName,
      reason,
      priority,
      amountCents: null,
      ageDays: age,
      owner: "Unassigned",
      nextAction: "Compare the original document with the proposed fields",
      target: "Documents",
      source: "Private document workspace",
      confidence: document.extractionStatus === "complete" ? "medium" : null,
      score: (priority === "high" ? 720 : 480) + Math.min(age ?? 0, 90),
      sourceRef: document.id,
      evidenceRef: `document:${document.id}`,
    });
  }

  return items.sort((a, b) => b.score - a.score || (b.amountCents ?? -1) - (a.amountCents ?? -1) || a.title.localeCompare(b.title));
}
