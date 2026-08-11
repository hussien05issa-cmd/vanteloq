import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleReviewInsights } from "../domain/google-review-insights.ts";

test("Google review insights use aggregate themes without reviewer identity", () => {
  const insight = buildGoogleReviewInsights([
    { ratingMilli: 2_000, comment: "The wait was slow and the line was long", reviewedAt: "2026-08-01" },
    { ratingMilli: 3_000, comment: "Long wait but friendly staff", reviewedAt: "2026-08-02" },
    { ratingMilli: 5_000, comment: "Friendly staff and excellent quality", reviewedAt: "2026-08-03" },
    { ratingMilli: 5_000, comment: "Excellent quality and value", reviewedAt: "2026-08-04" },
    { ratingMilli: 4_000, comment: "Helpful service", reviewedAt: "2026-08-05" },
  ]);
  assert.equal(insight.reviewCount, 5);
  assert.equal(insight.lowRatingCount, 2);
  assert.equal(insight.themes.find((theme) => theme.key === "wait_time")?.lowRatingMentions, 2);
  assert.ok(insight.recommendations.some((item) => item.id === "google-review-wait_time"));
  assert.match(insight.privacyBoundary, /Reviewer names.*not stored/i);
});

test("review recommendations stay empty when there is no source evidence", () => {
  const insight = buildGoogleReviewInsights([]);
  assert.equal(insight.available, false);
  assert.equal(insight.averageRating, null);
  assert.deepEqual(insight.recommendations, []);
});
