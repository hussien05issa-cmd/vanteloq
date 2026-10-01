"use client";
import type { ExecutiveReport } from "../server/executive-report";

const money = (value: number | null, currency: string) => value === null ? "—" : new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value / 100);

/** Uses the same report and period as the KPI cards; never fetches a second total. */
export default function ExecutiveSummaryPanels({ report, currency, onRecords, onConnect }: {
  report: ExecutiveReport; currency: string; onRecords: () => void; onConnect: () => void;
}) {
  const revenue = report.metrics.find(metric => metric.key === "net_revenue");
  const profit = report.metrics.find(metric => metric.key === "gross_profit");
  const source = report.revenueSources;
  const rows = revenue?.trend.filter(point => point.value !== null).slice(-5).reverse() ?? [];
  const positiveSources = source?.sources.every(item => item.cents >= 0) && (source?.totalCents ?? 0) > 0;
  const palette = ["#286bd5", "#5b88df", "#7463c7", "#28999e", "#6b819c"];
  let offset = 0;
  const segments = positiveSources ? source!.sources.map((item, index) => {
    const start = offset; offset += item.cents / source!.totalCents * 100;
    return `${palette[index % palette.length]} ${start}% ${offset}%`;
  }).join(",") : undefined;
  return <div className="executive-summary-panels">
    <article className="executive-source-mix">
      <header><div><p>SALES COMPOSITION</p><h3>Revenue by Source</h3></div><button type="button" onClick={source ? onRecords : onConnect}>{source ? "View Records" : "Add a Source"} <span aria-hidden="true">↗</span></button></header>
      <div className="executive-mix-content"><div className="executive-mix-ring" style={segments ? { background: `conic-gradient(${segments})` } : undefined} role="img" aria-label={segments ? "Revenue share by source, exact amounts listed alongside" : "Empty revenue composition ring, no proportions available"}><div><strong>{money(source?.totalCents ?? null, currency)}</strong><small>Net revenue</small></div></div>
        <dl>{source?.sources.length ? source.sources.map((item, index) => <div key={item.key}><dt><i style={{ background: palette[index % palette.length] }}/>{item.label}</dt><dd>{money(item.cents, currency)}</dd></div>) : <><div><dt>Completed sales</dt><dd>—</dd></div><div><dt>Less returns</dt><dd>—</dd></div><div><dt>Sales tax</dt><dd>Excluded</dd></div></>}</dl></div>
      <p className="executive-panel-note">{source ? "Selected sales sources only. Bank deposits and payouts are not added as revenue." : "Connect your POS or review a sales import. This chart fills from the records you approve."}</p>
    </article>
    <article className="executive-recent-records"><header><div><p>RECORDED ACTIVITY</p><h3>Recent Daily Results</h3></div><button type="button" onClick={onRecords}>View Records <span aria-hidden="true">↗</span></button></header>
      <div className="executive-table-scroll"><table><caption className="sr-only">Latest recorded dates within the selected period</caption><thead><tr><th scope="col">Date</th><th scope="col">Net Revenue</th><th scope="col">Gross Profit</th></tr></thead><tbody>{rows.length ? rows.map(row => <tr key={row.date}><td>{new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(row.date + "T00:00:00Z"))}</td><td>{money(row.value, currency)}</td><td>{money(profit?.trend.find(point => point.date === row.date)?.value ?? null, currency)}</td></tr>) : <><tr className="executive-table-empty"><td colSpan={3}><b>Your activity belongs here.</b><span>Daily sales and recorded product costs appear together after your first review.</span></td></tr><tr aria-hidden="true"><td>—</td><td>—</td><td>—</td></tr><tr aria-hidden="true"><td>—</td><td>—</td><td>—</td></tr></>}</tbody></table></div>
      <p className="executive-panel-note">{rows.length ? "Missing dates and product costs remain visible. These are daily totals, not individual transactions." : "No sample transactions are included in your business results."}</p>
    </article>
  </div>;
}
