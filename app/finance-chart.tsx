"use client";

import { useId, useState } from "react";
import { formatBookloqMoney } from "../domain/bookloq-presentation";
import { csvCell } from "../domain/csv";

export type FinanceChartPoint = { label: string; detail: string; values: (number | null)[] };
export type FinanceChartSeries = { label: string; kind: "bar" | "line"; color: "blue" | "mint" | "coral" | "violet"; dashed?: boolean };

/** A presentation layer over already-authorized, deterministic minor-unit data.
 * Missing points break lines; zero is a real value; negative bars keep their sign. */
export default function FinanceChart({ title, description, points, series, currency, forecast = false, allowExport = false, emptyMessage = "No records are available for this period." }: {
  title: string; description: string; points: FinanceChartPoint[]; series: FinanceChartSeries[];
  currency: string; forecast?: boolean; allowExport?: boolean; emptyMessage?: string;
}) {
  const id = useId().replace(/:/g, "");
  const [selected, setSelected] = useState<number | null>(null);
  const values = points.flatMap(point => point.values).filter((value): value is number => value !== null && Number.isFinite(value));
  const available = values.length > 0;
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const extent = max - min || 100;
  const lower = min < 0 ? min - extent * .08 : 0, upper = max + extent * .12;
  const plot = { left: 84, right: 748, top: 24, bottom: 254 };
  const y = (value: number) => plot.bottom - (value - lower) / (upper - lower) * (plot.bottom - plot.top);
  const step = (plot.right - plot.left) / Math.max(1, points.length);
  const x = (index: number) => plot.left + step * (index + .5);
  const ticks = Array.from({ length: 5 }, (_, index) => lower + (upper - lower) * index / 4);
  const money = (value: number | null) => formatBookloqMoney(value, currency);
  const axisMoney = (value: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value / 100);
  const bars = series.map((item, index) => ({ ...item, index })).filter(item => item.kind === "bar");
  const paths = (seriesIndex: number) => {
    const segments: string[] = []; let active = "";
    points.forEach((point, index) => {
      const value = point.values[seriesIndex];
      if (value === null || value === undefined || !Number.isFinite(value)) { if (active) segments.push(active); active = ""; return; }
      active += `${active ? " L" : "M"}${x(index)},${y(value)}`;
    });
    if (active) segments.push(active);
    return segments;
  };
  const exportCsv = () => {
    const rows = [[title, currency], ["Period", ...series.map(item => `${item.label} (${currency})`)],
      ...points.map(point => [point.detail, ...point.values.map(value => value === null ? "Not available" : (value / 100).toFixed(2))])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${forecast ? "cash-forecast" : "cash-activity"}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="finance-chart" aria-labelledby={`${id}-title`}>
    <header><div><h3 id={`${id}-title`}>{title}</h3><p>{description}</p></div><span className="finance-chart-currency">{currency}{forecast ? " · Forecast" : " · Recorded"}</span></header>
    <ul className="finance-chart-legend" aria-label="Chart legend">{series.map(item => <li key={item.label}><i className={`series-${item.color} ${item.kind}${item.dashed ? " dashed" : ""}`}/>{item.label}</li>)}</ul>
    {available ? <><div className="finance-chart-scroll" role="region" tabIndex={0} aria-label={`${title} interactive chart. Scroll horizontally on a small screen.`}>
      <div className="finance-chart-canvas">
        <svg viewBox="0 0 780 298" aria-hidden="true" focusable="false">
          <defs>{series.map((item, index) => <linearGradient id={`${id}-fill-${index}`} key={index} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" className={`series-${item.color}`} stopColor="currentColor" stopOpacity=".23"/><stop offset="100%" className={`series-${item.color}`} stopColor="currentColor" stopOpacity=".025"/></linearGradient>)}</defs>
          {ticks.map((tick, index) => <g key={index}><line className="finance-chart-grid" x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)}/><text className="finance-chart-axis" x={plot.left - 12} y={y(tick) + 4} textAnchor="end">{axisMoney(tick)}</text></g>)}
          <line className="finance-chart-zero" x1={plot.left} x2={plot.right} y1={y(0)} y2={y(0)}/>
          {points.map((point, index) => <g key={point.detail}>
            <line className="finance-chart-grid vertical" x1={x(index)} x2={x(index)} y1={plot.top} y2={plot.bottom}/>
            {(points.length < 9 || index % 2 === 0 || index === points.length - 1) && <text className="finance-chart-axis" x={x(index)} y="283" textAnchor="middle">{point.label}</text>}
            {bars.map((item, barIndex) => { const value = point.values[item.index]; if (value === null || value === undefined) return null;
              const width = Math.min(26, step * .6 / Math.max(1, bars.length));
              return <rect key={item.index} className={`finance-chart-bar series-${item.color}`} x={x(index) + (barIndex - (bars.length - 1) / 2) * (width + 3) - width / 2} y={Math.min(y(0), y(value))} width={width} height={Math.abs(y(0) - y(value))} rx="4"/>; })}
          </g>)}
          {series.map((item, seriesIndex) => item.kind === "line" && <g key={item.label} className={`series-${item.color}`}>
            {item.color === "blue" && points.length > 1 && points.every(point => point.values[seriesIndex] !== null && Number.isFinite(point.values[seriesIndex])) && <path d={`${paths(seriesIndex)[0]} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${id}-fill-${seriesIndex})`} stroke="none"/>}
            {paths(seriesIndex).map((path, index) => <path key={index} d={path} fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={item.dashed ? "5 7" : undefined}/>)}
            {points.map((point, index) => point.values[seriesIndex] !== null && <circle key={point.detail} cx={x(index)} cy={y(point.values[seriesIndex]!)} r={selected === index ? 5 : 3.4} stroke="currentColor" strokeWidth="2" fill="#f7fbff"/>)}
          </g>)}
          {selected !== null && <line x1={x(selected)} x2={x(selected)} y1={plot.top} y2={plot.bottom} className="finance-chart-cursor"/>}
        </svg>
        <div className="finance-chart-hit-area" style={{ left: `${plot.left / 7.8}%`, right: `${(780 - plot.right) / 7.8}%`, top: `${plot.top / 2.98}%`, bottom: `${(298 - plot.bottom) / 2.98}%` }}>
          {points.map((point, index) => <button type="button" key={point.detail} aria-label={`${point.detail}. ${series.map((item, si) => `${item.label}: ${money(point.values[si])}`).join(". ")}`} aria-pressed={selected === index} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)} onKeyDown={event => {
            if (event.key === "Escape") setSelected(null);
            if (event.key === "ArrowRight") (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.focus();
            if (event.key === "ArrowLeft") (event.currentTarget.previousElementSibling as HTMLButtonElement | null)?.focus();
          }}/>) }
        </div>
      </div>
    </div>
    <div className="finance-chart-readout" aria-live="polite" aria-atomic="true">{selected !== null && points[selected] ? <><b>{points[selected].detail}</b>{series.map((item, index) => <span key={item.label}>{item.label} <strong>{money(points[selected].values[index])}</strong></span>)}</> : <p>Tap a period or use the arrow keys to inspect its exact values.</p>}</div>
    <details className="finance-chart-data"><summary>View data table</summary><div role="region" tabIndex={0} aria-label={`${title} data table`}><table><caption>{title}. {currency}. {forecast ? "Projected values, not recorded cash." : "Recorded bank activity in this reporting period."}</caption><thead><tr><th scope="col">Period</th>{series.map(item => <th scope="col" key={item.label}>{item.label}</th>)}</tr></thead><tbody>{points.map(point => <tr key={point.detail}><th scope="row">{point.detail}</th>{point.values.map((value, index) => <td key={index}>{money(value)}</td>)}</tr>)}</tbody></table></div>{allowExport && <button type="button" onClick={exportCsv}>Export chart CSV</button>}</details></> : <div className="finance-chart-empty"><b>{emptyMessage}</b><p>Missing evidence stays unavailable. No balance or trend has been assumed.</p></div>}
  </section>;
}
