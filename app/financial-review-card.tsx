import { buildFinancialReview, type FinancialReviewStatements } from "../domain/financial-review";

export default function FinancialReviewCard({ statements, available, currency }: { statements: FinancialReviewStatements; available: boolean; currency: string }) {
  const review = buildFinancialReview(statements, available);
  const format = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "CAD" }).format(cents / 100);
  return <details className="financial-review-card" data-status={review.status}>
    <summary><span><small>LEDGER REVIEW</small><strong>{review.status === "balanced" ? "Four arithmetic checks passed" : review.status === "needs_review" ? "A statement difference needs review" : "Posted ledger evidence required"}</strong></span><span>Inspect checks <i aria-hidden="true">+</i></span></summary>
    <div className="financial-review-checks">{review.checks.map(check => <div key={check.id}><span><b>{check.label}</b><small>{check.formula}</small></span><strong data-status={check.status}>{check.differenceCents === null ? "Unavailable" : check.differenceCents === 0 ? "Balanced" : `${format(check.differenceCents)} difference`}</strong></div>)}</div>
    <p>{review.boundary}</p>
  </details>;
}
