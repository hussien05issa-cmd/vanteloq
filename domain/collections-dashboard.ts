import { exactSum, strictCalendarDay as day } from "./executive-metrics";

export const collectionBuckets = ["current", "1-30", "31-60", "61-90", "91+", "undated"] as const;
export type CollectionBucket = typeof collectionBuckets[number];
export type CollectionKind = "receivable" | "payable";
export type CollectionRecord = {
  id: string; kind: CollectionKind; reference: string; contactId: string; contactName: string;
  invoiceDate: string; dueDate: string | null; status: string; approvalStatus: string;
  totalCents: number; paidCents: number; currency: string; updatedAt: number | null;
};
export type OpenCollectionRecord = CollectionRecord & { outstandingCents: number; daysOverdue: number | null; bucket: CollectionBucket };
export const collectionWidgetIds = ["schedule", "aging", "actions"] as const;
export type CollectionsPreferences = { widgets: Array<{ id: typeof collectionWidgetIds[number]; visible: boolean }>; density: "comfortable" | "compact"; horizon: 7 | 30 | 90 };
export function normalizeCollectionsPreferences(input: unknown): CollectionsPreferences {
  const value = input && typeof input === "object" ? input as Partial<CollectionsPreferences> : {};
  const widgets: CollectionsPreferences["widgets"] = [];
  for (const item of Array.isArray(value.widgets) ? value.widgets : []) {
    if (item && collectionWidgetIds.includes(item.id) && !widgets.some(w => w.id === item.id)) widgets.push({ id: item.id, visible: item.visible !== false });
  }
  for (const id of collectionWidgetIds) if (!widgets.some(w => w.id === id)) widgets.push({ id, visible: true });
  return { widgets, density: value.density === "compact" ? "compact" : "comfortable", horizon: value.horizon === 7 || value.horizon === 90 ? value.horizon : 30 };
}

const closed = new Set(["draft", "void", "cancelled", "paid", "reconciled", "written_off"]);
function bucketForDays(due: number | null, now: number | null): CollectionBucket {
  if (due === null || now === null) return "undated";
  const age = now - due;
  return age <= 0 ? "current" : age <= 30 ? "1-30" : age <= 60 ? "31-60" : age <= 90 ? "61-90" : "91+";
}
export function collectionBucket(dueDate: string | null, asOf: string): CollectionBucket {
  return bucketForDays(day(dueDate), day(asOf));
}
/** Current document balances only. No historical backdating, FX or assumed receipts. */
export function buildCollectionsDashboard(input: CollectionRecord[], asOf: string, currency: string, horizon: 7 | 30 | 90 = 30) {
  const now = day(asOf);
  if (now === null) throw new Error("A valid business date is required.");
  let otherCurrencyCount = 0, invalidCount = 0;
  const records: OpenCollectionRecord[] = [];
  const dueDays = new Map<string | null, number | null>();
  const dueDay = (value: string | null) => {
    if (!dueDays.has(value)) dueDays.set(value, day(value));
    return dueDays.get(value)!;
  };
  for (const record of input) {
    if (closed.has(record.status)) continue;
    if (!Number.isSafeInteger(record.totalCents) || !Number.isSafeInteger(record.paidCents) || record.totalCents < 0 || record.paidCents < 0 || record.paidCents > record.totalCents) { invalidCount++; continue; }
    if (record.totalCents === record.paidCents) continue;
    if (record.currency.toUpperCase() !== currency.toUpperCase()) { otherCurrencyCount++; continue; }
    const due = dueDay(record.dueDate);
    records.push({ ...record, outstandingCents: record.totalCents - record.paidCents, daysOverdue: due === null ? null : Math.max(0, now - due), bucket: bucketForDays(due, now) });
  }
  const total = (items: OpenCollectionRecord[]) => exactSum(items.map(r => r.outstandingCents));
  const summarize = (kind: CollectionKind) => {
    const items = records.filter(r => r.kind === kind);
    const due = items.filter(r => { const date = dueDay(r.dueDate); return date !== null && date <= now + horizon - 1; });
    const overdue = items.filter(r => (r.daysOverdue ?? 0) > 0);
    return {
      totalCents: total(items), count: items.length, overdueCents: total(overdue), overdueCount: overdue.length,
      dueCents: total(due), dueCount: due.length,
      disputedCents: total(items.filter(r => r.status === "disputed")),
      unapprovedCents: kind === "payable" ? total(items.filter(r => !["approved", "not_required"].includes(r.approvalStatus))) : 0,
      aging: collectionBuckets.map(bucket => { const matches = items.filter(r => r.bucket === bucket); return { bucket, cents: total(matches), count: matches.length }; }),
    };
  };
  const receivables = summarize("receivable"), payables = summarize("payable");
  const step = horizon === 7 ? 1 : horizon === 30 ? 7 : 14;
  let cumulativeCents = 0;
  const schedule = Array.from({ length: Math.ceil(horizon / step) }, (_, index) => {
    const from = now + index * step, to = Math.min(now + horizon - 1, from + step - 1);
    const items = records.filter(r => { const date = dueDay(r.dueDate); return r.status !== "disputed" && date !== null && date >= from && date <= to; });
    const incomingCents = total(items.filter(r => r.kind === "receivable"));
    const outgoingCents = total(items.filter(r => r.kind === "payable"));
    cumulativeCents = exactSum([cumulativeCents, incomingCents, -outgoingCents]);
    return { from: new Date(from * 86_400_000).toISOString().slice(0, 10), to: new Date(to * 86_400_000).toISOString().slice(0, 10), incomingCents, outgoingCents, cumulativeCents };
  });
  const concentration = new Map<string, { contactId: string; contactName: string; cents: number }>();
  for (const record of records.filter(r => r.kind === "receivable")) {
    const key = record.contactId || record.id;
    const previous = concentration.get(key);
    concentration.set(key, { contactId: record.contactId, contactName: record.contactName, cents: exactSum([previous?.cents ?? 0, record.outstandingCents]) });
  }
  const largestCustomer = [...concentration.values()].sort((a, b) => b.cents - a.cents)[0] ?? null;
  const undatedCents = total(records.filter(r => r.bucket === "undated"));
  records.sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1) || b.outstandingCents - a.outstandingCents || a.id.localeCompare(b.id));
  return {
    asOf, currency, horizon, generatedAt: new Date().toISOString(), receivables, payables, schedule,
    largestCustomer: largestCustomer ? { ...largestCustomer, share: largestCustomer.cents / receivables.totalCents } : null,
    undatedCents, otherCurrencyCount, invalidCount, records,
    boundary: "Current invoice and bill balances after recorded payments, including tax. Drafts, voids, paid, reconciled and written-off records are excluded. Disputes remain in balances but not the due-date schedule. Bank matching alone does not record a payment. Credits require a recorded adjustment. These document totals may differ from posted ledger balances.",
  };
}
export type CollectionsDashboard = Omit<ReturnType<typeof buildCollectionsDashboard>, "records">;
export type CollectionsFilter = "all" | CollectionBucket | "overdue" | "due" | "disputed" | "unapproved";
export function filterCollections(records: OpenCollectionRecord[], kind: CollectionKind, filter: CollectionsFilter, asOf: string, horizon: number, search = "") {
  const now = day(asOf)!;
  const query = search.trim().toLowerCase();
  return records.filter(r => r.kind === kind && (!query || `${r.reference} ${r.contactName}`.toLowerCase().includes(query)) && (
    filter === "all" || filter === "overdue" && (r.daysOverdue ?? 0) > 0 || filter === "due" && day(r.dueDate) !== null && day(r.dueDate)! <= now + horizon - 1 || filter === "disputed" && r.status === "disputed" || filter === "unapproved" && r.kind === "payable" && !["approved", "not_required"].includes(r.approvalStatus) || r.bucket === filter
  ));
}
