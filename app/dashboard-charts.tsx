"use client";

import { useId, useState } from "react";
import { chartDomain, chartY, quantityLabel } from "../domain/workspace-presentation";
import WorkspaceIcon from "./workspace-icon";

type TrendPoint = { date: string; netSalesCents: number; grossProfitCents: number | null; transactionCount?: number };
type IntradayPoint = { hour: number; label: string; netSalesCents: number; grossProfitCents: number | null; transactionCount: number };
type Tone = "indigo" | "emerald" | "cyan" | "amber" | "rose";
type PlotPoint = { key: string; label: string; shortLabel: string; netSalesCents: number; grossProfitCents: number | null; transactionCount?: number };
const toneColour: Record<Tone, string> = {
  indigo: "#245fce", emerald: "#087f78", cyan: "#087da5", amber: "#a96813", rose: "#b43c55",
};
function fullMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}
function axisMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency", currency, notation: Math.abs(cents) >= 100000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(cents) < 1000 ? 2 : 1,
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
  if (!values.length || !values.some(Number.isFinite)) return null;
  return <svg className="metric-sparkline" viewBox="0 0 112 36" aria-hidden="true"><path d={linePath(values, 112, 30, chartDomain(values))} transform="translate(0 3)" fill="none" stroke={toneColour[tone]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function ChartEmpty({ intraday = false }: { intraday?: boolean }) {
  return <div className="workspace-chart-empty">
    <span className="workspace-empty-mark" aria-hidden="true"><WorkspaceIcon name="Reports"/></span>
    <strong>{intraday ? "No completed sales received today" : "No verified daily records in this period"}</strong>
    <p>{intraday ? "Hourly activity will appear after your source returns transactions with verified timestamps." : "Choose a period containing approved records, or review your data connection."}</p>
  </div>;
}

/** The plot, record selector and data table share the same unmodified source values. */
function FinancialSeriesChart({ data, currency, title, intraday = false }: {
  data: PlotPoint[]; currency: string; title: string; intraday?: boolean;
}) {
  const id = useId().replaceAll(":", "");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedIndex = Math.max(0, selectedKey == null ? data.length - 1 : data.findIndex((point) => point.key === selectedKey));
  const active = data[selectedIndex];
  if (!active) return <ChartEmpty intraday={intraday}/>;
  const plotWidth = 636, plotHeight = 184, left = 66, top = 16;
  const domain = chartDomain(data.flatMap((point) => [point.netSalesCents, ...(point.grossProfitCents == null ? [] : [point.grossProfitCents])]));
  const salesPath = linePath(data.map((point) => point.netSalesCents), plotWidth, plotHeight, domain);
  const profitPath = linePath(data.map((point) => point.grossProfitCents), plotWidth, plotHeight, domain);
  const zeroY = chartY(0, plotHeight, domain);
  const firstX = xAt(0, data.length, plotWidth), lastX = xAt(data.length - 1, data.length, plotWidth);
  const area = `${salesPath} L${lastX},${zeroY} L${firstX},${zeroY} Z`;
  const activeX = xAt(selectedIndex, data.length, plotWidth);
  const labels = new Set(Array.from({ length: Math.min(6, data.length) }, (_, index) => Math.round(index * (data.length - 1) / Math.max(1, Math.min(6, data.length) - 1))));
  const profitAvailable = data.some((point) => point.grossProfitCents != null);
  return <div className="workspace-series-chart">
    <div className="chart-legend"><span><i className="legend-sales" aria-hidden="true"/>Net sales</span><span><i className="legend-profit" aria-hidden="true"/>Gross profit{!profitAvailable && " unavailable"}</span></div>
    <div className="workspace-chart-plot">
      <svg viewBox="0 0 720 238" role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-description`}>Negative values are shown below zero. Use the record selector or expand the data table for exact amounts.</desc>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#245fce" stopOpacity=".14"/><stop offset="1" stopColor="#245fce" stopOpacity=".015"/></linearGradient></defs>
        {domain.ticks.map((value, index) => {
          const y = top + chartY(value, plotHeight, domain);
          return <g key={index}><line className="trend-gridline" x1={left} x2={left + plotWidth} y1={y} y2={y}/><text className="trend-axis-label" x={left - 12} y={y + 4} textAnchor="end">{axisMoney(value, currency)}</text></g>;
        })}
        <g transform={`translate(${left} ${top})`}>
          <line className="chart-zero-line" x1="0" x2={plotWidth} y1={zeroY} y2={zeroY}/>
          {data.length > 1 && <path d={area} fill={`url(#${id})`}/>}
          <path d={salesPath} className="trend-sales-line"/><path d={profitPath} className="trend-profit-line"/>
          <g className="chart-active-marker" aria-hidden="true"><line x1={activeX} x2={activeX} y1="0" y2={plotHeight}/><circle cx={activeX} cy={chartY(active.netSalesCents, plotHeight, domain)} r="4.5" className="active-sales-point"/>{active.grossProfitCents != null && <circle cx={activeX} cy={chartY(active.grossProfitCents, plotHeight, domain)} r="4" className="active-profit-point"/>}</g>
          {data.map((point, index) => {
            const x = xAt(index, data.length, plotWidth);
            const zone = plotWidth / Math.max(1, data.length - 1);
            return <g key={point.key}>
              {labels.has(index) && <text className="trend-axis-label" x={x} y={plotHeight + 25} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{point.shortLabel}</text>}
              <rect className="chart-hit-zone" x={Math.max(0, x - zone / 2)} y="0" width={Math.min(zone, plotWidth - Math.max(0, x - zone / 2))} height={plotHeight} onPointerEnter={() => setSelectedKey(point.key)} onClick={() => setSelectedKey(point.key)}/>
            </g>;
          })}
        </g>
      </svg>
    </div>
    <div className="workspace-chart-readout">
      <label htmlFor={`${id}-record`}>Inspect record<select id={`${id}-record`} value={active.key} onChange={(event) => setSelectedKey(event.target.value)}>{data.map((point) => <option key={point.key} value={point.key}>{point.label}</option>)}</select></label>
      <dl aria-live="polite" aria-atomic="true"><div><dt>Net sales</dt><dd>{fullMoney(active.netSalesCents, currency)}</dd></div><div><dt>Gross profit</dt><dd>{active.grossProfitCents == null ? "Not available" : fullMoney(active.grossProfitCents, currency)}</dd></div>{active.transactionCount != null && <div><dt>Transactions</dt><dd>{active.transactionCount.toLocaleString("en-CA")}</dd></div>}</dl>
    </div>
    <details className="workspace-chart-data"><summary>View chart data <span>{quantityLabel(data.length, "record")}</span></summary><div className="workspace-table-scroll">
      <table><caption>{title}. Amounts in {currency}.</caption><thead><tr><th scope="col">{intraday ? "Time" : "Date"}</th><th scope="col">Net sales</th><th scope="col">Gross profit</th><th scope="col">Transactions</th></tr></thead><tbody>{data.map((point) => <tr key={point.key}><th scope="row">{point.label}</th><td>{fullMoney(point.netSalesCents, currency)}</td><td>{point.grossProfitCents == null ? "Not available" : fullMoney(point.grossProfitCents, currency)}</td><td>{point.transactionCount ?? "Not supplied"}</td></tr>)}</tbody></table>
    </div></details>
  </div>;
}
export function BusinessTrendChart({ data, currency }: { data: TrendPoint[]; currency: string }) {
  const points = data.filter((point) => Number.isFinite(point.netSalesCents) && !Number.isNaN(Date.parse(`${point.date}T00:00:00Z`))).map((point) => ({
    ...point, grossProfitCents: point.grossProfitCents != null && Number.isFinite(point.grossProfitCents) ? point.grossProfitCents : null, key: point.date,
    label: new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${point.date}T00:00:00Z`)),
    shortLabel: new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${point.date}T00:00:00Z`)),
  }));
  return <FinancialSeriesChart data={points} currency={currency} title="Daily net sales and gross profit"/>;
}
export function IntradaySalesChart({ data, currency }: { data: IntradayPoint[]; currency: string }) {
  const points = data.filter((point) => Number.isFinite(point.netSalesCents)).map((point) => ({
    ...point, grossProfitCents: point.grossProfitCents != null && Number.isFinite(point.grossProfitCents) ? point.grossProfitCents : null, key: String(point.hour), shortLabel: point.label,
  }));
  if (!points.some((point) => point.transactionCount > 0 || point.netSalesCents !== 0 || (point.grossProfitCents ?? 0) !== 0)) return <ChartEmpty intraday/>;
  return <FinancialSeriesChart data={points} currency={currency} title="Today's net sales and gross profit by hour" intraday/>;
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
  const hasData = cashCents != null && payableCents != null;
  const cash = Math.max(cashCents ?? 0, 0);
  const payable = Math.max(payableCents ?? 0, 0);
  const available = Math.max(cash - payable, 0);
  const covered = Math.min(cash, payable);
  const total = Math.max(available + covered, 1);
  const availableShare = available / total;
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const format = (value: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value / 100);

  return (
    <div className="cash-ring-layout">
      <div className="cash-ring">
        <svg viewBox="0 0 120 120" role="img" aria-label="Cash remaining after accounts payable">
          <circle cx="60" cy="60" r={radius} className="cash-ring-track" />
          {hasData && (
            <circle
              cx="60"
              cy="60"
              r={radius}
              className="cash-ring-available"
              strokeDasharray={`${circumference * availableShare} ${circumference}`}
            />
          )}
        </svg>
        <span><small>After payables</small><b>{hasData ? format(available) : "Not available"}</b></span>
      </div>
      <dl className="cash-ring-details">
        <div><dt><i className="cash-dot" />Operating cash</dt><dd>{cashCents == null ? "Not connected" : format(cash)}</dd></div>
        <div><dt><i className="payable-dot" />Accounts payable</dt><dd>{payableCents == null ? "Not connected" : format(payable)}</dd></div>
        <div><dt><i className="available-dot" />Uncommitted balance</dt><dd>{hasData ? format(available) : "Not calculated"}</dd></div>
      </dl>
    </div>
  );
}

export type { IntradayPoint, Tone, TrendPoint };
