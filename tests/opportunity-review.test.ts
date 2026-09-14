import test from "node:test";
import assert from "node:assert/strict";
import { canReadReview, reviewDisplayStatus, reviewIsActive, validateReviewChange } from "../domain/opportunity-review";

const now = Date.parse("2026-09-14T12:00:00Z");
const input = { id: "d37f3189-63cf-46a1-848b-8d4bd3c1da00", version: 1, status: "monitoring", note: "Check receipts." };
test("snoozed reviews return to attention when due; closed reviews remain archived", () => {
  assert.equal(reviewIsActive({ status: "snoozed", snoozedUntil: "2026-09-15T12:00:00Z" }, now), false);
  assert.equal(reviewIsActive({ status: "snoozed", snoozedUntil: "2026-09-14T12:00:00Z" }, now), true);
  assert.equal(reviewDisplayStatus({ status: "snoozed", snoozedUntil: "2026-09-14T12:00:00Z", task: null }, now), "Review due");
  for (const status of ["resolved", "dismissed"] as const) assert.equal(reviewIsActive({ status, snoozedUntil: null }, now), false);
});
test("review changes require bounded notes, valid future reminders and explicit closure reasons", () => {
  assert.equal(validateReviewChange(input, now).note, "Check receipts.");
  assert.throws(() => validateReviewChange({ ...input, status: "resolved", note: " " }, now), /reason/);
  assert.throws(() => validateReviewChange({ ...input, status: "dismissed", note: "" }, now), /reason/);
  assert.throws(() => validateReviewChange({ ...input, note: "x".repeat(1001) }, now), /1,000/);
  assert.throws(() => validateReviewChange({ ...input, snapshot: "forged" }, now), /Unexpected/);
  assert.throws(() => validateReviewChange({ ...input, version: 0 }, now), /Refresh/);
  for (const snoozedUntil of ["invalid", "2026-09-14T10:00:00Z", "2027-09-14T10:00:00Z"]) assert.throws(() => validateReviewChange({ ...input, status: "snoozed", snoozedUntil }, now), /future/);
  assert.equal(validateReviewChange({ ...input, status: "snoozed", snoozedUntil: "2026-09-15T12:00:00Z" }, now).snoozedUntil, "2026-09-15T12:00:00.000Z");
});
test("saved evidence permissions fail closed after access is reduced", () => {
  assert.equal(canReadReview(["metrics.revenue", "metrics.profit"], ["metrics.revenue"]), false);
  assert.equal(canReadReview(["metrics.revenue"], ["metrics.revenue", "metrics.profit"]), true);
});
