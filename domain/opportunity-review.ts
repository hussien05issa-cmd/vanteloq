import type { OperatingDecision } from "../server/operating-system";

export const reviewStatuses = ["reviewed", "monitoring", "snoozed", "resolved", "dismissed"] as const;
export type ReviewStatus = typeof reviewStatuses[number];
export const reviewLabels: Record<ReviewStatus, string> = { reviewed: "In review", monitoring: "Monitoring", snoozed: "Snoozed", resolved: "Resolved", dismissed: "Dismissed" };
export type OpportunityReview = {
  id: string; ruleId: string; scopeKey: string; scopeLabel: string;
  period: { from: string; to: string }; snapshot: OperatingDecision;
  status: ReviewStatus; snoozedUntil: string | null; version: number;
  createdAt: string; updatedAt: string;
  events: { id: string; status: ReviewStatus; note: string; actor: string; at: string }[];
  task: null | { id: number; title: string; status: string; assignee: string; dueDate: string | null };
};

export function reviewIsActive(review: Pick<OpportunityReview, "status" | "snoozedUntil">, now = Date.now()) {
  return review.status !== "resolved" && review.status !== "dismissed"
    && (review.status !== "snoozed" || !review.snoozedUntil || Date.parse(review.snoozedUntil) <= now);
}

export function reviewDisplayStatus(review: Pick<OpportunityReview, "status" | "snoozedUntil" | "task">, now = Date.now()) {
  if (review.status === "snoozed" && reviewIsActive(review, now)) return "Review due";
  if (review.status === "reviewed" && review.task) return "Action created";
  return reviewLabels[review.status];
}

// Stored evidence can contain multiple financial dimensions. On every read,
// require the same data permissions used to create it, including free-text notes.
export const evidencePermissions = ["metrics.revenue", "metrics.profit", "metrics.cash", "payroll.totals", "inventory.value"] as const;
export function canReadReview(required: string[], current: readonly string[]) {
  return required.every(permission => current.includes(permission));
}

export function validateReviewChange(value: Record<string, unknown>, now = Date.now()) {
  if (Object.keys(value).some(key => !["id", "version", "status", "note", "snoozedUntil"].includes(key))) throw new Error("Unexpected review field.");
  if (typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id)) throw new Error("Select a saved opportunity.");
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1) throw new Error("Refresh the opportunity before saving.");
  if (!reviewStatuses.includes(value.status as ReviewStatus)) throw new Error("Choose a valid review status.");
  if (value.note != null && typeof value.note !== "string") throw new Error("Enter a text note.");
  const note = typeof value.note === "string" ? value.note.trim() : "";
  if (note.length > 1000) throw new Error("Keep the note under 1,000 characters.");
  const status = value.status as ReviewStatus;
  if ((status === "resolved" || status === "dismissed") && !note) throw new Error("Add a reason or observed outcome before closing this opportunity.");
  let snoozedUntil: string | null = null;
  if (status === "snoozed") {
    const time = typeof value.snoozedUntil === "string" ? Date.parse(value.snoozedUntil) : NaN;
    if (!Number.isFinite(time) || time <= now || time > now + 90 * 86400000) throw new Error("Choose a future review time within 90 days.");
    snoozedUntil = new Date(time).toISOString();
  } else if (value.snoozedUntil != null) throw new Error("A review time is only used for snoozed opportunities.");
  return { id: value.id, version: Number(value.version), status, note, snoozedUntil };
}
