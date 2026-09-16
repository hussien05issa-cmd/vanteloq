"use client";

import { useId } from "react";
import type { DailyImportReview } from "../server/daily-metric-import";
import "./daily-import-review.css";

const metrics = [
  ["grossSalesCents", "Gross sales"], ["netSalesCents", "Net sales"],
  ["costOfGoodsCents", "Cost of goods"], ["transactionCount", "Transactions"],
  ["unitsSold", "Units sold"], ["refundsCents", "Refunds"],
  ["discountsCents", "Discounts"], ["labourCostCents", "Labour cost"],
  ["labourCostReported", "Labour cost supplied"], ["inventoryValueCents", "Inventory value"],
  ["cashBalanceCents", "Operating cash"], ["accountsPayableCents", "Accounts payable"],
] as const;

function display(key: string, values: Record<string, string | number | null>) {
  if (key === "labourCostCents" && !values.labourCostReported) return "Not provided";
  const value = values[key];
  if (value === null || value === undefined) return "Not provided";
  if (key === "labourCostReported") return value ? "Yes" : "No";
  const number = Number(value);
  return key.endsWith("Cents")
    ? (number / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : number.toLocaleString();
}

export default function DailyImportReviewPanel({ review, reason, onReasonChange, busy, onConfirm, onCancel }: {
  review: DailyImportReview; reason: string; onReasonChange: (value: string) => void;
  busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const id = useId();
  return <section className="card daily-import-review" aria-labelledby={`${id}-title`}>
    <div className="card-head"><div><p className="card-kicker">REVIEW BEFORE SAVING</p>
      <h3 id={`${id}-title`}>Review Daily Record Changes</h3></div>
      <span>{review.rows.length} existing · {review.newRows} new</span>
    </div>
    <p>The import replaces the saved values below. Connected POS records stay protected. Correct those records in your POS, then sync again.</p>
    <p className="daily-import-review-note">Amounts use your workspace currency. Open a date to compare every field.</p>
    <div className="daily-import-review-records">
      {review.rows.map((row, index) => <details key={`${row.businessDate}:${row.locationRef}`} open={index === 0}>
        <summary><span>{row.businessDate} · {row.locationRef}</span><span>Compare Values</span></summary>
        <div className="daily-import-review-table"><table><thead><tr><th scope="col">Metric</th><th scope="col">Saved</th><th scope="col">New Value</th></tr></thead>
          <tbody>{metrics.map(([key, label]) => {
            const before = display(key, row.before); const after = display(key, row.after);
            return <tr key={key} data-changed={before !== after || undefined}><th scope="row">{label}</th><td>{before}</td><td>{after}{before !== after && <span className="daily-import-changed-label"> Changed</span>}</td></tr>;
          })}</tbody></table></div>
      </details>)}
    </div>
    <label className="daily-import-review-reason" htmlFor={`${id}-reason`}>Reason for the Correction <span aria-hidden="true">*</span>
      <textarea id={`${id}-reason`} value={reason} onChange={(event) => onReasonChange(event.target.value)}
        minLength={3} maxLength={300} required rows={3} disabled={busy} aria-describedby={`${id}-note`}
        placeholder="For example, corrected the net sales total against the source report." />
    </label>
    <p id={`${id}-note`} className="daily-import-review-note">The original values, replacement values and your reason are saved in the audit history.</p>
    <div className="daily-import-review-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel Import</button>
      <button type="button" className="primary" disabled={busy || reason.trim().length < 3} onClick={onConfirm}>
        {busy ? "Saving…" : "Save Reviewed Import"}
      </button></div>
  </section>;
}
