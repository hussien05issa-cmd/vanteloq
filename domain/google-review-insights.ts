export type GoogleReviewEvidence = {
  ratingMilli: number;
  comment: string;
  reviewedAt: string;
};

export type GoogleReviewTheme = {
  key: "service" | "wait_time" | "availability" | "value" | "quality";
  label: string;
  mentions: number;
  lowRatingMentions: number;
};

export type GoogleReviewRecommendation = {
  id: string;
  title: string;
  rationale: string;
  action: string;
  evidence: string;
};

const THEMES: Array<{ key: GoogleReviewTheme["key"]; label: string; terms: string[] }> = [
  { key: "service", label: "Service", terms: ["service", "staff", "friendly", "helpful", "rude"] },
  { key: "wait_time", label: "Wait time", terms: ["wait", "slow", "delay", "line", "queue"] },
  { key: "availability", label: "Availability", terms: ["stock", "available", "selection", "sold out", "inventory"] },
  { key: "value", label: "Price & value", terms: ["price", "value", "expensive", "affordable", "cost"] },
  { key: "quality", label: "Quality", terms: ["quality", "fresh", "product", "broken", "excellent"] },
];

export function buildGoogleReviewInsights(rows: GoogleReviewEvidence[]) {
  const themes: GoogleReviewTheme[] = THEMES.map((theme) => {
    const matching = rows.filter((row) => {
      const comment = row.comment.toLowerCase();
      return theme.terms.some((term) => comment.includes(term));
    });
    return {
      key: theme.key,
      label: theme.label,
      mentions: matching.length,
      lowRatingMentions: matching.filter((row) => row.ratingMilli <= 3_000).length,
    };
  }).filter((theme) => theme.mentions > 0).sort((left, right) => right.lowRatingMentions - left.lowRatingMentions || right.mentions - left.mentions);
  const reviewCount = rows.length;
  const averageRating = reviewCount ? rows.reduce((sum, row) => sum + row.ratingMilli, 0) / reviewCount / 1_000 : null;
  const lowRatingCount = rows.filter((row) => row.ratingMilli <= 3_000).length;
  const fiveStarCount = rows.filter((row) => row.ratingMilli === 5_000).length;
  const lastReviewAt = rows.map((row) => row.reviewedAt).sort().at(-1) ?? null;
  const recommendations: GoogleReviewRecommendation[] = [];
  const concern = themes.find((theme) => theme.lowRatingMentions >= 2);
  if (concern) {
    recommendations.push({
      id: `google-review-${concern.key}`,
      title: `Investigate the ${concern.label.toLowerCase()} pattern`,
      rationale: `${concern.lowRatingMentions} lower-rated reviews mention ${concern.label.toLowerCase()}. This is a repeated signal, not a causal finding.`,
      action: `Review the operating process behind ${concern.label.toLowerCase()}, choose one bounded fix, assign an owner, and compare the next 10 reviews with this baseline.`,
      evidence: `${concern.mentions} total mentions · ${concern.lowRatingMentions} in reviews rated three stars or lower`,
    });
  }
  if (reviewCount >= 5 && averageRating !== null && averageRating < 4.2) {
    recommendations.push({
      id: "google-review-response-loop",
      title: "Close the review response and follow-up loop",
      rationale: `The recorded average is ${averageRating.toFixed(1)} across ${reviewCount} reviews, with ${lowRatingCount} rated three stars or lower.`,
      action: "Respond to recent reviews from Google, log the operational issue category without copying personal information, and review whether the same issue appears again after the fix.",
      evidence: `${reviewCount} reviews · ${lowRatingCount} lower-rated reviews`,
    });
  }
  if (reviewCount >= 5 && averageRating !== null && averageRating >= 4.5) {
    const proofTheme = themes.find((theme) => theme.mentions >= 2);
    recommendations.push({
      id: "google-review-proof",
      title: "Turn the strongest review pattern into verifiable proof",
      rationale: `${fiveStarCount} of ${reviewCount} recorded reviews are five-star${proofTheme ? `, and ${proofTheme.label.toLowerCase()} is a repeated theme` : ""}.`,
      action: `Use the verified aggregate pattern${proofTheme ? ` around ${proofTheme.label.toLowerCase()}` : ""} on the relevant website page. Do not copy reviewer names or comments without permission.`,
      evidence: `${reviewCount} reviews · ${averageRating.toFixed(1)} average rating`,
    });
  }
  return {
    available: reviewCount > 0,
    reviewCount,
    averageRating,
    lowRatingCount,
    fiveStarShare: reviewCount ? fiveStarCount / reviewCount : null,
    lastReviewAt,
    themes,
    recommendations,
    privacyBoundary: "Reviewer names and profile photos are not stored. Recommendations use aggregate ratings and recurring comment themes.",
  };
}
