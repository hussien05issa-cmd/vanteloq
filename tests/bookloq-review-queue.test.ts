import assert from "node:assert/strict";
import test from "node:test";
import { buildBookloqReviewQueue } from "../domain/bookloq-review-queue.ts";

const empty = { alerts: [], transactions: [], bills: [], closeItems: [], documents: [], asOf: "2026-09-19" } as const;

test("review queue ranks blocked close work and overdue material items ahead of routine document review", () => {
  const items = buildBookloqReviewQueue({
    ...empty,
    transactions: [{ id: "tx-1", postingDate: "2026-09-18", description: "Processor deposit", amountCents: 300_000, sourceSystem: "bank", categorizationStatus: "suggested", reconciliationStatus: "unreconciled", confidenceBasisPoints: 6_500 }],
    bills: [{ id: "bill-1", billNumber: "B-1", dueDate: "2026-08-01", status: "open", totalCents: 400_000, paidCents: 0, supplierName: "Example Supplier", approvalStatus: "pending" }],
    closeItems: [{ id: "close-1", title: "Reconcile clearing account", status: "blocked", dueDate: "2026-09-15", blocker: "Settlement evidence is missing" }],
    documents: [{ id: "doc-1", fileName: "receipt.pdf", status: "review_required", securityState: "clean", extractionStatus: "complete", createdAt: 1_758_153_600 }],
  });
  assert.equal(items.length, 4);
  assert.equal(items[0].kind, "bill");
  assert.equal(items[1].kind, "close");
  assert.equal(items.at(-1)?.kind, "document");
  assert.match(items.find(item => item.kind === "transaction")?.reason ?? "", /Category needs confirmation.*Not matched or reconciled/);
});

test("review queue excludes completed work and preserves zero or missing impact as unknown", () => {
  const items = buildBookloqReviewQueue({
    ...empty,
    alerts: [
      { id: "open", status: "open", severity: "attention", title: "Review source", explanation: "Evidence is incomplete", dollarImpactCents: null, confidence: "low", recommendedAction: "Open source", createdAt: 1_758_153_600, supportingRecordsJson: "[\"bill:bill-1\"]" },
      { id: "closed", status: "resolved", severity: "critical", title: "Resolved", explanation: "Done", dollarImpactCents: 99_999_999, confidence: "high", recommendedAction: "None", createdAt: 1_758_153_600 },
    ],
    transactions: [{ id: "done", postingDate: "2026-09-18", description: "Reviewed", amountCents: 0, sourceSystem: "bank", categorizationStatus: "confirmed", reconciliationStatus: "reconciled", confidenceBasisPoints: 10_000 }],
    bills: [{ id: "paid", billNumber: "B-2", dueDate: "2026-08-01", status: "paid", totalCents: 100_000, paidCents: 100_000, supplierName: "Supplier", approvalStatus: "approved" }],
    closeItems: [{ id: "done-close", title: "Close", status: "complete", dueDate: null, blocker: "" }],
    documents: [{ id: "approved", fileName: "approved.pdf", status: "approved", securityState: "clean", extractionStatus: "complete", createdAt: 1_758_153_600 }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "alert:open");
  assert.equal(items[0].amountCents, null);
  assert.equal(items[0].confidence, "low");
  assert.equal(items[0].target, "Bills");
  assert.equal(items[0].evidenceRef, "bill:bill-1");
});

test("review queue ignores malformed alert evidence instead of inventing a destination", () => {
  const items = buildBookloqReviewQueue({
    ...empty,
    alerts: [{ id: "bad-evidence", status: "open", severity: "attention", title: "Review source", explanation: "Evidence is malformed", dollarImpactCents: null, confidence: "low", recommendedAction: "Open source", createdAt: 1_758_153_600, supportingRecordsJson: "not-json" }],
  });
  assert.equal(items[0].target, "Transactions");
  assert.equal(items[0].evidenceRef, null);
});

test("review queue never invents a past-due item from an invalid date", () => {
  const items = buildBookloqReviewQueue({
    ...empty,
    bills: [{ id: "bad-date", billNumber: "B-3", dueDate: "unknown", status: "open", totalCents: 100_000, paidCents: 0, supplierName: "Supplier", approvalStatus: "pending" }],
  });
  assert.deepEqual(items, []);
});

test("evidence matching does not remove a transaction before reconciliation is complete", () => {
  const items = buildBookloqReviewQueue({
    ...empty,
    transactions: [{ id: "matched-only", postingDate: "2026-09-18", description: "Processor payout", amountCents: 250_000, sourceSystem: "bank", categorizationStatus: "confirmed", reconciliationStatus: "matched", confidenceBasisPoints: 9_000 }],
  });
  assert.equal(items.length, 1);
  assert.match(items[0].reason, /Matched to evidence but not reconciled/);
  assert.match(items[0].nextAction, /remaining difference/);
});
