"use client";

import { useId, useState } from "react";
import { formatBookloqMoney } from "../domain/bookloq-presentation";
import { csvCell } from "../domain/csv";

export type FinanceChartPoint = { label: string; detail: string; values: (number | null)[] };
export type FinanceChartSeries = { label: string; kind: "bar" | "line"; color: "blue" | "mint" | "coral" | "violet"; dashed?: boolean };

/** Readable axes only: never round, interpolate or change the supplied cents. */
export function financeChartDomain(values: number[]) {
  let min = 0, max = 0;
  for (const value of values) if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  if (min === max) return { min: 0, max: 100, step: 20, ticks: [0, 20, 40, 60, 80, 100] };
  const padding = (max - min) * .08;
  const lower = min < 0 ? min - padding : 0, upper = max > 0 ? max + padding : 0;
  const rawStep = (upper - lower) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = Math.max(1, ([1, 2, 5, 10].find(factor => factor * magnitude >= rawStep) ?? 10) * magnitude);
  const first = Math.floor(lower / step), last = Math.ceil(upper / step);
  const ticks = Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step || 0);
  return { min: first * step || 0, max: last * step, step, ticks };
}

/** A presentation layer over already-authorized, deterministic minor-unit data.
 * Missing points break lines; zero is a real value; negative bars keep their sign. */
export default function FinanceChart({ title, description, points: sourcePoints, series, currency, forecast = false, allowExport = false, emptyMessage = "No records are available for this period." }: {
  title: string; description: string; points: FinanceChartPoint[]; series: FinanceChartSeries[];
  currency: string; forecast?: boolean; allowExport?: boolean; emptyMessage?: string;
}) {
  const id = useId().replace(/:/g, "");
  const [selected, setSelected] = useState<number | null>(null);
  // A sparse or non-finite presentation value must not become an SVG coordinate,
  // an exported zero or a mismatched table column. Do not alter finite cents.
  const points = sourcePoints.map(point => ({ ...point, values: series.map((_, index) => {
    const value = point.values[index];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }) }));
  const activeIndex = points.length ? Math.min(selected ?? points.length - 1, points.length - 1) : -1;
  const activePoint = points[activeIndex];
  const values = points.flatMap(point => point.values).filter((value): value is number => value !== null && Number.isFinite(value));
  const available = values.length > 0;
  const { min: lower, max: upper, step: tickStep, ticks } = financeChartDomain(values);
  const plot = { left: 84, right: 748, top: 24, bottom: 254 };
  const y = (value: number) => plot.bottom - (value - lower) / (upper - lower) * (plot.bottom - plot.top);
  const step = (plot.right - plot.left) / Math.max(1, points.length);
  const x = (index: number) => plot.left + step * (index + .5);
  const money = (value: number | null) => formatBookloqMoney(value, currency);
  const axisMoney = (value: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency, notation: Math.abs(value) >= 100_000 ? "compact" : "standard", minimumFractionDigits: 0, maximumFractionDigits: tickStep < 100 ? 2 : 1 }).format(value / 100);
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
    <ul className="finance-chart-legend" aria-label="Chart legend">{series.map(item => <li key={item.label}><i aria-hidden="true" className={`series-${item.color} ${item.kind}${item.dashed ? " dashed" : ""}`}/>{item.label}</li>)}</ul>
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
            {points.map((point, index) => point.values[seriesIndex] !== null && <circle key={point.detail} cx={x(index)} cy={y(point.values[seriesIndex]!)} r={activeIndex === index ? 5 : 3.4} stroke="currentColor" strokeWidth="2" fill="#f7fbff"/>)}
          </g>)}
          {activePoint && <line x1={x(activeIndex)} x2={x(activeIndex)} y1={plot.top} y2={plot.bottom} className="finance-chart-cursor"/>}
        </svg>
        <div className="finance-chart-hit-area" style={{ left: `${plot.left / 7.8}%`, right: `${(780 - plot.right) / 7.8}%`, top: `${plot.top / 2.98}%`, bottom: `${(298 - plot.bottom) / 2.98}%` }}>
          {points.map((point, index) => <button type="button" key={point.detail} tabIndex={activeIndex === index ? 0 : -1} aria-label={`${point.detail}. ${series.map((item, si) => `${item.label}: ${money(point.values[si])}`).join(". ")}`} aria-pressed={activeIndex === index} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)} onKeyDown={event => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const target = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
              (event.currentTarget.parentElement?.children[target] as HTMLButtonElement | undefined)?.focus();
            }
          }}/>) }
        </div>
      </div>
    </div>
    <div className="finance-chart-readout">
      <label htmlFor={`${id}-period`}>Inspect Period<select id={`${id}-period`} value={activeIndex} onChange={event => setSelected(Number(event.target.value))}>{points.map((point, index) => <option key={point.detail} value={index}>{point.detail}</option>)}</select></label>
      <dl aria-live="polite" aria-atomic="true">{series.map((item, index) => <div key={item.label}><dt><i className={`series-${item.color}`} aria-hidden="true"/>{item.label}</dt><dd>{money(activePoint.values[index])}</dd></div>)}</dl>
    </div>
    <details className="finance-chart-data"><summary>View data table</summary><div role="region" tabIndex={0} aria-label={`${title} data table`}><table><caption>{title}. {currency}. {forecast ? "Projected values, not recorded cash." : "Recorded bank activity in this reporting period."}</caption><thead><tr><th scope="col">Period</th>{series.map(item => <th scope="col" key={item.label}>{item.label}</th>)}</tr></thead><tbody>{points.map(point => <tr key={point.detail}><th scope="row">{point.detail}</th>{point.values.map((value, index) => <td key={index}>{money(value)}</td>)}</tr>)}</tbody></table></div>{allowExport && <button type="button" onClick={exportCsv}>Export chart CSV</button>}</details></> : <div className="finance-chart-empty"><b>{emptyMessage}</b><p>Missing evidence stays unavailable. No balance or trend has been assumed.</p></div>}
  </section>;
}
