"use client";

import { useId, useState } from "react";
import { chartDomain, chartY, quantityLabel } from "../domain/workspace-presentation";
import WorkspaceIcon from "./workspace-icon";
import { cumulativeSalesHours } from "../domain/intraday-sales";
import "./dashboard-chart-polish.css";
import { useChartWidth } from "./use-chart-width";
import { temporalPositions, temporalLabelIndices, observationSegments } from "../domain/chart-geometry";
import { financialChartDomain } from "../domain/financial-chart-domain";
import { summarizeRecordedTrend } from "../domain/recorded-trend-summary";

type TrendPoint = { date: string; netSalesCents: number; grossProfitCents: number | null; transactionCount?: number };
type IntradayPoint = { hour: number; label: string; netSalesCents: number; grossProfitCents: number | null; transactionCount: number };
type Tone = "indigo" | "emerald" | "cyan" | "amber" | "rose";
type PlotPoint = { key: string; label: string; shortLabel: string; netSalesCents: number; grossProfitCents: number | null; transactionCount?: number; comparisonCents?: number | null };
const toneColour: Record<Tone, string> = {
  indigo: "#245fce", emerald: "#087f78", cyan: "#087da5", amber: "#a96813", rose: "#b43c55",
};
function fullMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}
function axisMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency", currency, notation: Math.abs(cents) >= 100000 ? "compact" : "standard",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(cents) < 1000 ? 2 : Math.abs(cents) >= 100000 ? 1 : 0,
  }).format(cents / 100);
}
function xAt(index: number, length: number, width: number) {
  return length === 1 ? width / 2 : index * width / (length - 1);
}
function linePath(values: (number | null)[], width: number, height: number, domain: ReturnType<typeof chartDomain>) {
  let connected = false;
  return values.map((value, index) => {
    if (value == null || !Number.isFinite(value)) { connected = false; return ""; }
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${xAt(index, values.length, width).toFixed(2)},${chartY(value, height, domain).toFixed(2)}`;
  }).join(" ");
}
export function MetricSparkline({ values, tone }: { values: number[]; tone: Tone }) {
  const id = useId().replaceAll(":", "");
  if (!values.length || !values.some(Number.isFinite)) return null;
  const path = linePath(values, 220, 42, chartDomain(values));
  const complete = values.length > 1 && values.every(Number.isFinite);
  return <svg className="metric-sparkline" viewBox="0 0 220 50" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id={`${id}-spark`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={toneColour[tone]} stopOpacity=".08"/><stop offset="1" stopColor={toneColour[tone]} stopOpacity="0"/></linearGradient></defs>
    <g transform="translate(0 3)">{complete && <path className="metric-sparkline-fill" d={`${path} L220,47 L0,47 Z`} fill={`url(#${id}-spark)`}/>}<path d={path} fill="none" stroke={toneColour[tone]} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/></g>
  </svg>;
}
function ChartEmpty({ intraday = false }: { intraday?: boolean }) {
  return <div className="workspace-chart-empty">
    <span className="workspace-empty-mark" aria-hidden="true"><WorkspaceIcon name="Reports"/></span>
    <strong>{intraday ? "No completed sales received today" : "No verified daily records in this period"}</strong>
    <p>{intraday ? "Hourly activity will appear after your source returns transactions with verified timestamps." : "Choose a period containing approved records, or review your data connection."}</p>
  </div>;
}

/** The plot, record selector and data table share the same unmodified source values. */
function FinancialSeriesChart({ data, currency, title, intraday = false, comparisonLabel }: {
  data: PlotPoint[]; currency: string; title: string; intraday?: boolean; comparisonLabel?: string;
}) {
  const id = useId().replaceAll(":", "");
  const { ref: plotRef, width: chartWidth } = useChartWidth(720, 280);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [series, setSeries] = useState<"both" | "sales" | "profit">("both");
  const matchingIndex = selectedKey == null ? -1 : data.findIndex((point) => point.key === selectedKey);
  const selectedIndex = matchingIndex < 0 ? data.length - 1 : matchingIndex;
  const active = data[selectedIndex];
  if (!active) return <ChartEmpty intraday={intraday}/>;
  const plotHeight = chartWidth < 480 ? 238 : 300, left = chartWidth < 480 ? 52 : 66, top = 18, plotWidth = chartWidth - left - 18;
  const domain = financialChartDomain(data.flatMap((point) => [point.netSalesCents, ...(point.grossProfitCents == null ? [] : [point.grossProfitCents]), ...(point.comparisonCents == null ? [] : [point.comparisonCents])]));
  const times = data.map(point => intraday ? Number(point.key) : Date.parse(`${point.key}T00:00:00Z`));
  const positions = temporalPositions(times, plotWidth);
  const interval = intraday ? 1 : 86_400_000;
  const ordinate = (value: number) => chartY(value, plotHeight, domain);
  const salesSegments = observationSegments(data.map(point => point.netSalesCents), times, positions, ordinate, interval);
  const profitSegments = observationSegments(data.map(point => point.grossProfitCents), times, positions, ordinate, interval);
  const comparisonSegments = observationSegments(data.map(point => point.comparisonCents ?? null), times, positions, ordinate, interval);
  const zeroY = chartY(0, plotHeight, domain);
  const activeX = positions[selectedIndex];
  const labels = new Set(temporalLabelIndices(positions, Math.max(88, plotWidth / 6)));
  const profitAvailable = data.some((point) => point.grossProfitCents != null);
  const visibleSeries = series === "profit" && !profitAvailable ? "sales" : series;
  return <div className={`workspace-series-chart commerce-chart financial-explorer series-${visibleSeries}`}>
    <div className="financial-explorer-toolbar">
      <div className="financial-series-switch" role="group" aria-label="Visible chart series">
        {([["both", "Both"], ["sales", "Net Sales"], ["profit", "Gross Profit"]] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={visibleSeries === value} disabled={value === "profit" && !profitAvailable} onClick={() => setSeries(value)}>{label}</button>)}
      </div>
    </div>
    <p className="commerce-chart-context">{currency} · {intraday ? "Business-local time" : "Recorded daily values"}</p>
    <div className="chart-legend">{visibleSeries !== "profit" && <span><i className="legend-sales" aria-hidden="true"/>Net sales</span>}{comparisonLabel && visibleSeries !== "profit" && <span><i className="legend-comparison" aria-hidden="true"/>{comparisonLabel}</span>}{visibleSeries !== "sales" && <span><i className="legend-profit" aria-hidden="true"/>Gross profit{!profitAvailable && " unavailable"}</span>}</div>
    <div className="workspace-chart-plot" ref={plotRef} tabIndex={0} role="region" aria-label="Interactive financial chart. Use left and right arrow keys to inspect records." onKeyDown={event => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const next = Math.max(0,Math.min(data.length - 1,selectedIndex + (event.key === "ArrowRight" ? 1 : -1))); setSelectedKey(data[next].key); }}>
      <svg viewBox={`0 0 ${chartWidth} ${plotHeight + 58}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-description`}>Negative values are shown below zero. Missing observation dates leave gaps. Use the record selector or expand the data table for exact amounts.</desc>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2d7be9" stopOpacity=".16"/><stop offset="1" stopColor="#2d7be9" stopOpacity=".015"/></linearGradient></defs>
        {domain.ticks.map((value, index) => {
          const y = top + chartY(value, plotHeight, domain);
          return <g key={index}><line className="trend-gridline" x1={left} x2={left + plotWidth} y1={y} y2={y}/><text className="trend-axis-label" x={left - 12} y={y + 4} textAnchor="end">{axisMoney(value, currency)}</text></g>;
        })}
        <g transform={`translate(${left} ${top})`}>
          <line className="chart-zero-line" x1="0" x2={plotWidth} y1={zeroY} y2={zeroY}/>
          {salesSegments.filter(segment => segment.lastIndex > segment.firstIndex).map(segment => <path className="trend-sales-area" key={`area-${segment.firstIndex}`} d={`${segment.path} L${segment.lastX},${zeroY} L${segment.firstX},${zeroY} Z`} fill={`url(#${id})`}/>)}
          {comparisonLabel && <path d={comparisonSegments.map(segment => segment.path).join(" ")} className="trend-comparison-line"/>}
          <path d={salesSegments.map(segment => segment.path).join(" ")} className="trend-sales-line"/><path d={profitSegments.map(segment => segment.path).join(" ")} className="trend-profit-line"/>
          {[
            { segments: salesSegments, value: (index: number) => data[index].netSalesCents, className: "active-sales-point" },
            { segments: profitSegments, value: (index: number) => data[index].grossProfitCents, className: "active-profit-point" },
            ...(comparisonLabel ? [{ segments: comparisonSegments, value: (index: number) => data[index].comparisonCents ?? null, className: "comparison-observation-point" }] : []),
          ].flatMap(series => series.segments.filter(segment => segment.firstIndex === segment.lastIndex && (segment.firstIndex !== selectedIndex || series.className === "comparison-observation-point")).map(segment => <circle key={`${series.className}-${segment.firstIndex}`} cx={segment.firstX} cy={ordinate(series.value(segment.firstIndex)!)} r="2.5" className={series.className}/>))}
          <g className="chart-active-marker" aria-hidden="true"><line x1={activeX} x2={activeX} y1="0" y2={plotHeight}/><circle cx={activeX} cy={chartY(active.netSalesCents, plotHeight, domain)} r="3.5" className="active-sales-point"/>{active.grossProfitCents != null && <circle cx={activeX} cy={chartY(active.grossProfitCents, plotHeight, domain)} r="3.5" className="active-profit-point"/>}</g>
          {data.map((point, index) => {
            const x = positions[index];
            const zoneStart = index === 0 ? 0 : (positions[index - 1] + x) / 2;
            const zoneEnd = index === data.length - 1 ? plotWidth : (x + positions[index + 1]) / 2;
            return <g key={point.key}>
              {labels.has(index) && <text className="trend-axis-label" x={x} y={plotHeight + 25} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{point.shortLabel}</text>}
              <rect className="chart-hit-zone" x={zoneStart} y="0" width={Math.max(0, zoneEnd - zoneStart)} height={plotHeight} onPointerMove={() => setSelectedKey(point.key)} onClick={() => setSelectedKey(point.key)}/>
            </g>;
          })}
        </g>
      </svg>
    </div>
    <div className="workspace-chart-readout">
      <label htmlFor={`${id}-record`}>{intraday ? "Selected Hour" : "Selected Day"}<select id={`${id}-record`} value={active.key} onChange={(event) => setSelectedKey(event.target.value)}>{data.map((point) => <option key={point.key} value={point.key}>{point.label}</option>)}</select></label>
      <dl aria-live="polite" aria-atomic="true"><div className="chart-selection-announcement"><dt>{intraday ? "Selected hour" : "Selected day"}</dt><dd>{active.label}</dd></div><div><dt>Net sales</dt><dd data-negative={active.netSalesCents < 0 || undefined}>{fullMoney(active.netSalesCents, currency)}</dd></div>{comparisonLabel && <div><dt>{comparisonLabel}</dt><dd data-negative={active.comparisonCents != null && active.comparisonCents < 0 || undefined}>{active.comparisonCents == null ? "Not available" : fullMoney(active.comparisonCents, currency)}</dd></div>}<div><dt>Gross profit</dt><dd data-negative={active.grossProfitCents != null && active.grossProfitCents < 0 || undefined}>{active.grossProfitCents == null ? "Not available" : fullMoney(active.grossProfitCents, currency)}</dd></div>{active.transactionCount != null && <div><dt>Transactions</dt><dd>{active.transactionCount.toLocaleString("en-CA")}</dd></div>}</dl>
    </div>
    <details className="workspace-chart-data"><summary>View chart data <span>{quantityLabel(data.length, "record")}</span></summary><div className="workspace-table-scroll">
      <table><caption>{title}. Amounts in {currency}.</caption><thead><tr><th scope="col">{intraday ? "Time" : "Date"}</th><th scope="col">Net sales</th>{comparisonLabel && <th scope="col">{comparisonLabel}</th>}<th scope="col">Gross profit</th><th scope="col">Transactions</th></tr></thead><tbody>{data.map((point) => <tr key={point.key}><th scope="row">{point.label}</th><td>{fullMoney(point.netSalesCents, currency)}</td>{comparisonLabel && <td>{point.comparisonCents == null ? "Not available" : fullMoney(point.comparisonCents, currency)}</td>}<td>{point.grossProfitCents == null ? "Not available" : fullMoney(point.grossProfitCents, currency)}</td><td>{point.transactionCount ?? "Not supplied"}</td></tr>)}</tbody></table>
    </div></details>
  </div>;
}
export function BusinessTrendChart({ data, currency }: { data: TrendPoint[]; currency: string }) {
  const [range, setRange] = useState<30 | 90 | "all">("all");
  const points = data.filter((point) => Number.isFinite(point.netSalesCents) && !Number.isNaN(Date.parse(`${point.date}T00:00:00Z`))).map((point) => ({
    ...point, grossProfitCents: point.grossProfitCents != null && Number.isFinite(point.grossProfitCents) ? point.grossProfitCents : null, key: point.date,
    label: new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${point.date}T00:00:00Z`)),
    shortLabel: new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${point.date}T00:00:00Z`)),
  })).sort((left, right) => left.key.localeCompare(right.key));
  const latest = points.at(-1);
  const cutoff = latest && range !== "all" ? Date.parse(`${latest.key}T00:00:00Z`) - (range - 1) * 86_400_000 : -Infinity;
  const shown = points.filter(point => Date.parse(`${point.key}T00:00:00Z`) >= cutoff);
  const summary = summarizeRecordedTrend(shown);
  const peakLabel = shown.find(point => point.key === summary.peakDay?.date)?.label;
  return <div className="business-performance-explorer">
    {!!points.length && <>
      <div className="performance-range-toolbar"><p>{shown[0]?.label} to {shown.at(-1)?.label}<span>{quantityLabel(shown.length,"recorded day")} · Missing dates stay blank</span></p><div className="financial-series-switch" role="group" aria-label="Chart date range">{([30,90,"all"] as const).map(value => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{value === "all" ? "Available Records" : `${value} Days`}</button>)}</div></div>
      <dl className="performance-summary" aria-label="Selected recorded period summary">
        <div className="performance-summary-primary"><dt>Recorded Net Sales</dt><dd data-negative={summary.netSalesCents !== null && summary.netSalesCents < 0 || undefined}>{summary.netSalesCents === null ? "Not available" : fullMoney(summary.netSalesCents,currency)}</dd><small>{currency} · Selected records, after returns</small></div>
        <div><dt>Average per Recorded Day</dt><dd data-negative={summary.averageSalesPerRecordedDayCents !== null && summary.averageSalesPerRecordedDayCents < 0 || undefined}>{summary.averageSalesPerRecordedDayCents === null ? "Not available" : fullMoney(summary.averageSalesPerRecordedDayCents,currency)}</dd><small>Across {quantityLabel(summary.recordedDayCount,"recorded day")}</small></div>
        <div><dt>Peak Recorded Day</dt><dd data-negative={summary.peakDay !== null && summary.peakDay.netSalesCents < 0 || undefined}>{summary.peakDay === null ? "Not available" : fullMoney(summary.peakDay.netSalesCents,currency)}</dd><small>{peakLabel ?? "Not available"}</small></div>
      </dl>
    </>}
    <FinancialSeriesChart data={shown} currency={currency} title="Daily net sales and gross profit"/>
  </div>;
}
export function IntradaySalesChart({ data, currency, comparison, comparisonDate, asOf, timeZone = "UTC" }: {
  data: IntradayPoint[]; currency: string; comparison?: IntradayPoint[];
  comparisonDate?: string; asOf?: string | null; timeZone?: string;
}) {
  const [cumulative, setCumulative] = useState(false);
  const clean = (rows: IntradayPoint[]) => rows.filter((point) => Number.isFinite(point.netSalesCents)).map((point) => ({
    ...point, grossProfitCents: point.grossProfitCents != null && Number.isFinite(point.grossProfitCents) ? point.grossProfitCents : null, key: String(point.hour), shortLabel: point.label,
  }));
  const current = clean(data), previous = comparison ? clean(comparison) : [];
  const previousByHour = new Map((cumulative ? cumulativeSalesHours(previous) : previous).map((point) => [point.hour, point.netSalesCents]));
  const points = (cumulative ? cumulativeSalesHours(current) : current).map((point) => ({ ...point, key: String(point.hour), shortLabel: point.label, comparisonCents: previousByHour.get(point.hour) ?? null }));
  const hasActivity = [...current, ...previous].some((point) => point.transactionCount > 0 || point.netSalesCents !== 0 || (point.grossProfitCents ?? 0) !== 0);
  const updated = asOf && Number.isFinite(Date.parse(asOf)) ? new Intl.DateTimeFormat("en-CA", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(asOf)) : null;
  const previousLabel = comparisonDate ? new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${comparisonDate}T12:00:00Z`)) : "Last week";
  return <div className="intraday-sales-view">
    <div className="intraday-chart-toolbar"><div><strong>{cumulative ? "Sales accumulated through the day" : "Sales received in each hour"}</strong><p>{updated ? `Source records through ${updated}.` : "Approved transaction records, in business time."}</p></div><div className="chart-mode-toggle" role="group" aria-label="Sales chart view"><button type="button" aria-pressed={!cumulative} onClick={() => setCumulative(false)}>Hourly</button><button type="button" aria-pressed={cumulative} onClick={() => setCumulative(true)}>Running total</button></div></div>
    {hasActivity ? <FinancialSeriesChart data={points} currency={currency} title={cumulative ? "Cumulative net sales, comparison and gross profit" : "Today's net sales and gross profit by hour"} comparisonLabel={previous.length ? `${previousLabel} net sales` : undefined} intraday/> : <ChartEmpty intraday/>}
    <p className="intraday-chart-note">{previous.length ? "Compared with the same weekday last week through the same local time. The latest hour may be incomplete." : "A matched comparison appears when every selected source has usable history. The latest hour may be incomplete."} Gross profit is net sales less recorded product cost, not net business profit. Updates follow approved imports.</p>
  </div>;
}

export function CashPositionRing({
  cashCents,
  payableCents,
  currency,
}: {
  cashCents: number | null | undefined;
  payableCents: number | null | undefined;
  currency: string;
}) {
  const cash = cashCents != null && Number.isFinite(cashCents) ? cashCents : null;
  const payable = payableCents != null && Number.isFinite(payableCents) ? payableCents : null;
  const remaining = cash !== null && payable !== null ? cash - payable : null;
  const rows = [{ label: "Operating cash", value: cash, tone: "cash" }, { label: "Accounts payable", value: payable, tone: "payables" }, { label: "Cash less payables", value: remaining, tone: "remaining" }];
  const scale = Math.max(...rows.map((row) => Math.abs(row.value ?? 0)), 1);

  return (
    <div className="cash-position-bridge">
      <div className={`cash-bridge-result${remaining != null && remaining < 0 ? " is-shortfall" : ""}`}><span>Cash less recorded payables</span><strong>{remaining == null ? "Not available" : fullMoney(remaining, currency)}</strong><small>{remaining == null ? "Both balances are needed for this calculation." : remaining < 0 ? "Recorded payables exceed operating cash." : "A balance check, not a spending limit."}</small></div>
      <dl className="cash-bridge-rows">{rows.map((row) => <div key={row.tone}><dt>{row.label}</dt><dd>{row.value == null ? "Not available" : fullMoney(row.value, currency)}</dd><div className="cash-bridge-track" aria-hidden="true"><i className={`${row.tone}${row.value != null && row.value < 0 ? " is-negative" : ""}`} style={{ width: `${Math.abs(row.value ?? 0) / scale * 50}%`, left: `${row.value != null && row.value < 0 ? 50 - Math.abs(row.value) / scale * 50 : 50}%` }}/></div></div>)}</dl>
      <p>Other obligations, future receipts and payment dates are not included. Review the cash forecast before committing funds.</p>
    </div>
  );
}

export type { IntradayPoint, Tone, TrendPoint };
