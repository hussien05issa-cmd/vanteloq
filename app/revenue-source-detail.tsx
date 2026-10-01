"use client";

import type { RevenueAttribution } from "../server/revenue-attribution";
import { formatRecordedTimestamp } from "../domain/executive-presentation";
import "./revenue-source-detail.css";

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
function importedTime(timestamp: string | null) {
  const formatted = formatRecordedTimestamp(timestamp);
  return formatted ? `Imported ${formatted}` : "Import time unavailable";
}

/** Source evidence belongs beside the selected trend, not on every KPI tile. */
export default function RevenueSourceDetail({ attribution, currency, onOpenRecords }: {
  attribution: RevenueAttribution; currency: string; onOpenRecords: () => void;
}) {
  if (!attribution) return null;
  return <section className="revenue-source-detail" aria-label="Revenue data sources">
    <header><h4>Data Sources</h4><span>{attribution.recordCount.toLocaleString("en-CA")} daily record{attribution.recordCount === 1 ? "" : "s"}</span></header>
    <ul>{attribution.sources.map(source => <li key={source.key}>
      <div><strong>{source.label}</strong><small>{importedTime(source.updatedAt)}</small></div>
      <span>{money(source.cents, currency)}</span>
    </li>)}</ul>
    <div className="revenue-source-total"><span>Net Revenue</span><strong>{money(attribution.totalCents, currency)}</strong></div>
    <details><summary>Calculation</summary><p>Completed sales after recorded discounts, less returns and refunds. Sales tax is excluded. Refunds are already included in these net amounts.</p><p>Only the selected sales sources are combined. Payments, payouts and bank deposits are not added as revenue. Import times reflect the oldest contributing record for each source; they do not imply complete coverage.</p></details>
    <button type="button" onClick={onOpenRecords}>View Source Data <span aria-hidden="true">→</span></button>
  </section>;
}
