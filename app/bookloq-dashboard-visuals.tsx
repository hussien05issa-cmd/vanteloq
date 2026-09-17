"use client";

import { useId, useState } from "react";
import type { BookLoQData } from "./bookloq-workspace";
import FinanceChart from "./finance-chart";
import { formatBookloqMoney } from "../domain/bookloq-presentation";

const periods = [
  { days: 30, label: "30 Days", key: "days30" },
  { days: 90, label: "90 Days", key: "days90" },
  { days: 365, label: "12 Months", key: "months12" },
] as const;

const percentage = (basisPoints: number) => `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 }).format(basisPoints / 100)}%`;
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

type OutflowCategory = { name: string; amountCents: number; shareBasisPoints: number };
const categoryColors = ["#245fce", "#087f78", "#586b8c", "#8c6cb2", "#788b9f"];

/** A parts-of-total view only when category cents reconcile to the supplied outflow total. */
export function OutflowCategoryDonut({ categories, totalCents, currency }: { categories: OutflowCategory[]; totalCents: number; currency: string }) {
  const id = useId().replaceAll(":", "");
  const [selected, setSelected] = useState<number | null>(null);
  const valid = Number.isSafeInteger(totalCents) && totalCents > 0 && categories.length > 0
    && categories.every(category => Number.isSafeInteger(category.amountCents) && category.amountCents >= 0)
    && categories.reduce((sum, category) => sum + category.amountCents, 0) === totalCents;
  if (!valid) return <p className="bq-category-unavailable">A category chart appears when the category amounts match the recorded outflow total.</p>;
  const ordered = [...categories].filter(category => category.amountCents > 0).sort((left, right) => right.amountCents - left.amountCents || left.name.localeCompare(right.name));
  const groups = ordered.length <= 5 ? ordered : [
    ...ordered.slice(0, 4),
    { name: "Remaining Categories", amountCents: ordered.slice(4).reduce((sum, category) => sum + category.amountCents, 0), shareBasisPoints: 0 },
  ];
  const segments = groups.map((category, index) => {
    const share = category.amountCents / totalCents * 100;
    const offset = groups.slice(0, index).reduce((sum, previous) => sum + previous.amountCents, 0) / totalCents * 100;
    return { ...category, share, offset, color: categoryColors[index] };
  });
  const activeIndex = selected !== null && segments[selected] ? selected : null;
  const active = activeIndex === null ? null : segments[activeIndex];
  const activeAmount = formatBookloqMoney(active?.amountCents ?? totalCents, currency);
  return <div className="bq-outflow-categories">
    <div className={`bq-category-visual${activeAmount.length > 12 ? " has-wide-amount" : ""}`}>
      <svg viewBox="0 0 140 140" role="img" aria-labelledby={`${id}-category-title ${id}-category-description`}>
        <title id={`${id}-category-title`}>Recorded cash outflows by category</title>
        <desc id={`${id}-category-description`}>Category amounts add up to {formatBookloqMoney(totalCents, currency)}. Use the labelled categories to inspect exact amounts.</desc>
        <circle cx="70" cy="70" r="51" fill="none" stroke="#e2e8f0" strokeWidth="14"/>
        {segments.map((segment, index) => <circle key={index} cx="70" cy="70" r="51" fill="none" pathLength="100" stroke={segment.color} strokeWidth="14" strokeDasharray={`${segment.share} ${100 - segment.share}`} strokeDashoffset={-segment.offset} transform="rotate(-90 70 70)" opacity={activeIndex === null || activeIndex === index ? 1 : .48}/>)}
      </svg>
      <div className="bq-category-centre" aria-live="polite" aria-atomic="true"><strong>{activeAmount}</strong><span>{active ? active.name : "Recorded Outflows"}</span></div>
    </div>
    <ul aria-label="Outflow categories">{segments.map((segment, index) => <li key={index}><button type="button" aria-pressed={activeIndex === index} onClick={() => setSelected(activeIndex === index ? null : index)}>
      <i style={{ background: segment.color }} aria-hidden="true"/><span>{segment.name}<small>{formatBookloqMoney(segment.amountCents, currency)}</small></span><b>{new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 }).format(segment.share)}%</b>
    </button></li>)}</ul>
    {ordered.length > 5 && <details><summary>View All {ordered.length} Categories</summary><dl>{ordered.map(category => <div key={category.name}><dt>{category.name}</dt><dd>{formatBookloqMoney(category.amountCents, currency)}</dd></div>)}</dl></details>}
  </div>;
}

/** Uses the server's complete, authorized cash summaries. It never estimates
 * account balances, profit, review counts or a cause from cash movement alone. */
export default function BookloqDashboardVisuals({ data, onReview }: { data: BookLoQData; onReview: () => void }) {
  const [days, setDays] = useState<30 | 90 | 365>(30);
  const id = useId();
  const selected = periods.find(period => period.days === days)!;
  const summary = data.cashActivity[selected.key];
  const allowed = data.transactionAccess?.available !== false;
  const available = allowed && summary.transactionCount > 0;
  const currency = data.settings?.baseCurrency ?? data.organization.currency;
  const money = (value: number | null) => formatBookloqMoney(value, currency);
  const largestCategory = available ? [...summary.categories].filter(category => category.amountCents > 0).sort((left, right) => right.amountCents - left.amountCents)[0] : undefined;
  const points = available ? summary.timeline.map(bucket => ({
    label: dateLabel(bucket.startDate),
    detail: `${bucket.startDate} to ${bucket.endDate}`,
    values: [bucket.inflowCents, -bucket.outflowCents, bucket.netCashFlowCents],
  })) : [];
  const demonstration = data.settings?.dataMode === "demonstration";

  return <section className="bookloq-dashboard-visuals" aria-labelledby={`${id}-heading`}>
    <header className="bq-cash-heading">
      <div><p className="bq-cash-eyebrow">{demonstration ? "Demonstration Records" : "Your Recorded Cash"}</p><h3 id={`${id}-heading`}>Follow the Money</h3><p>See what moved through your cash accounts, then review the supporting records.</p></div>
      <div className="bq-cash-periods" role="group" aria-label="Dashboard cash activity period">
        {periods.map(period => <button type="button" key={period.days} aria-pressed={days === period.days} onClick={() => setDays(period.days)}>{period.label}</button>)}
      </div>
    </header>
    {demonstration && <p className="bq-cash-demo-note">Fictional example records. These figures do not describe your business.</p>}
    <p className="bq-cash-period-label">{summary.startDate} to {summary.endDate} · {currency}{available ? ` · ${new Intl.NumberFormat("en-CA").format(summary.transactionCount)} recorded ${summary.transactionCount === 1 ? "transaction" : "transactions"}` : ""}</p>
    <div className="bq-cash-metrics" aria-label="Cash totals for the selected period">
      <article><span>Cash In</span><strong>{money(available ? summary.inflowCents : null)}</strong><small>Recorded inflows</small></article>
      <article><span>Cash Out</span><strong>{money(available ? summary.outflowCents : null)}</strong><small>Recorded outflows</small></article>
      <article><span>Net Movement</span><strong className={available && summary.netCashFlowCents < 0 ? "bq-cash-negative" : undefined}>{money(available ? summary.netCashFlowCents : null)}</strong><small>Inflows minus outflows, not profit</small></article>
    </div>
    <div className="bq-cash-detail-grid">
      <FinanceChart key={selected.key} title="Cash Movement" description="Inflows, outflows and net movement share the same scale. Outflows appear below zero." points={points} currency={currency} series={[
        { label: "Inflows", kind: "bar", color: "mint" },
        { label: "Outflows", kind: "bar", color: "coral" },
        { label: "Net Movement", kind: "line", color: "blue" },
      ]} allowExport={available && data.permissions.includes("export_data")} emptyMessage={!allowed ? "Your role does not include access to cash activity." : "No eligible bank activity is available for this period."}/>
      <aside className="bq-cash-observations" aria-label="Observations from the selected cash records">
        {available ? <>
          <article><span className="bq-cash-observation-label">Where Cash Went</span><h4>{largestCategory ? largestCategory.name : "No Recorded Outflows"}</h4>
            {largestCategory ? <><OutflowCategoryDonut key={selected.key} categories={summary.categories} totalCents={summary.outflowCents} currency={currency}/><p>{largestCategory.name} represents {percentage(largestCategory.shareBasisPoints)} of recorded outflows. Review the transactions before changing spending.</p></> : <p>This period contains {money(summary.inflowCents)} in inflows and no recorded cash outflows. Check that all intended cash accounts and dates are covered.</p>}
          </article>
          <article><span className="bq-cash-observation-label">Review Coverage</span><h4>{summary.categorizedBasisPoints < 10_000 ? "Finish Category Review" : summary.matchedBasisPoints < 10_000 ? "Review Supporting Records" : "Check the Source Coverage"}</h4>
            <dl><div><dt>Categorized</dt><dd>{percentage(summary.categorizedBasisPoints)}</dd></div><div><dt>Matched</dt><dd>{percentage(summary.matchedBasisPoints)}</dd></div></dl>
            <p>{summary.categorizedBasisPoints < 10_000 ? "Some recorded transactions still need a category. Review them to make the outflow breakdown more useful." : summary.matchedBasisPoints < 10_000 ? "Some recorded transactions still need supporting matches. Review bills, invoices and receipts." : "Every recorded transaction has a category and match. This does not establish that the bank statement is fully reconciled."}</p>
          </article>
        </> : <article className="bq-cash-empty-guide"><span className="bq-cash-observation-label">Build Your Cash Picture</span><h4>{allowed ? "Start With Verified Records" : "Cash Activity Is Restricted"}</h4><p>{allowed ? "Connect and sync your bank source or import a reviewed bank statement, then review its transactions. Only eligible records in your base currency appear here." : "Ask your workspace administrator for the bank transaction and payroll permissions needed to review this section."}</p></article>}
        {allowed && <button type="button" className="bq-cash-review" onClick={onReview}>Review Transactions <span aria-hidden="true">↗</span></button>}
      </aside>
    </div>
    <p className="bq-cash-boundary">Cash movements can include transfers, loans and taxes. They do not establish revenue, expenses or your current bank balance. Pending records and other currencies are excluded. {data.cashActivity.sourceBoundary}</p>
  </section>;
}
