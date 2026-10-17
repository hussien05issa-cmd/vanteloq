"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ExecutiveReport } from "../server/executive-report";
import { executiveAxis, formatExecutiveAxisValue } from "../domain/executive-presentation";
import { observationSegments, smoothChartPath, temporalLabelIndices } from "../domain/chart-geometry";
import { useChartWidth } from "./use-chart-width";
import { useMotionPreference } from "./use-motion-preference";

type Props = {
  metric: ExecutiveReport["metrics"][number]; currency: string;
  period: ExecutiveReport["period"]; onSetup: () => void;
  chart: "line" | "bar"; compact?: boolean; showTable?: boolean;
};
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value + "T00:00:00Z"));
const display = (value: number | null, unit: string, currency: string) => value === null ? "Not available" : unit === "money"
  ? new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100)
  : `${value.toLocaleString("en-CA", { maximumFractionDigits: 2 })}${unit === "percent" ? "%" : ""}`;
const metricDisplay = (value: number | null, unit: string, currency: string) => display(value === null ? null : unit === "percent" ? value * 100 : value, unit, currency);

export default function ExecutiveTrend({ metric, currency, period, onSetup, chart, compact = false, showTable = true }: Props) {
  const { ref, width } = useChartWidth(780, 280);
  const id = useId().replaceAll(":", "");
  const plotRef = useRef<SVGGElement>(null);
  const motion = useMotionPreference();
  const dataKey = `${metric.key}:${metric.trend.map(point => `${point.date}:${point.value}`).join("|")}`;
  const [inspection, setInspection] = useState<{ key: string; index: number } | null>(null);
  const hover = inspection?.key === dataKey ? inspection.index : null;
  const inspect = (index: number) => setInspection(previous => previous?.key === dataKey && previous.index === index ? previous : { key: dataKey, index });

  useEffect(() => {
    const plot = plotRef.current, svg = plot?.ownerSVGElement;
    if (!plot || !svg || !motion || typeof plot.animate !== "function") return;
    let animation: Animation | null = null;
    const stop = () => { animation?.cancel(); animation = null; };
    const reveal = () => {
      if (document.hidden || svg.contains(document.activeElement)) return;
      stop();
      animation = plot.animate([{ clipPath: "inset(0 100% 0 0)", opacity: .7 }, { clipPath: "inset(0 0 0 0)", opacity: 1 }], { duration: 500, easing: "cubic-bezier(.16,1,.3,1)" });
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { reveal(); observer?.disconnect(); }
    });
    if (observer) observer.observe(svg); else reveal();
    document.addEventListener("visibilitychange", stop);
    svg.addEventListener("pointerdown", stop); svg.addEventListener("focusin", stop);
    return () => { observer?.disconnect(); stop(); document.removeEventListener("visibilitychange", stop); svg.removeEventListener("pointerdown", stop); svg.removeEventListener("focusin", stop); };
  }, [dataKey, chart, motion]);

  const valid = metric.trend.map((point, index) => ({ ...point, index })).filter(point => point.value !== null && Number.isFinite(point.value) && Number.isFinite(Date.parse(point.date)));
  if (!valid.length) return <div className="executive-trend-empty" ref={ref}>
    <div className="executive-empty-axis" aria-hidden="true"><span>{metric.unit === "money" ? currency : metric.unit === "percent" ? "%" : "Count"}</span><span>—</span><span>—</span><span>—</span></div>
    <div className="executive-empty-plot"><div className="executive-empty-grid" aria-hidden="true"/><div className="executive-empty-message"><span className="executive-chart-symbol" aria-hidden="true">↗</span><b>Your {metric.label.toLowerCase()} trend</b><p>{metric.reason ?? "Add dated records to see this measure over time. A balance alone does not create a trend."}</p><button type="button" onClick={onSetup}>{metric.drill === "BookLoQ" ? "Open BookLoQ" : "Review Sources"}</button></div></div>
    <div className="executive-empty-dates"><span>{date(period.from)}</span><span>{date(period.to)}</span></div>
  </div>;

  const { min, max, ticks: axisTicks } = executiveAxis(valid.map(point => point.value!));
  const height = compact ? 190 : 250;
  const times = metric.trend.map(point => Date.parse(point.date));
  const first = Math.min(...valid.map(point => times[point.index])), last = Math.max(...valid.map(point => times[point.index]));
  const plotWidth = width - 82;
  const x = (index: number) => 58 + (last === first ? plotWidth / 2 : (times[index] - first) / (last - first) * plotWidth);
  const y = (value: number) => 22 + (max - value) / (max - min) * (height - 59);
  const segments = observationSegments(metric.trend.map(point => point.value), times, metric.trend.map((_, index) => x(index)), y, 86400000);
  const paths = segments.map(segment => smoothChartPath(metric.trend.slice(segment.firstIndex, segment.lastIndex + 1).map((point, offset) => ({ x: x(segment.firstIndex + offset), y: y(point.value!) }))));
  const point = hover === null ? null : metric.trend[hover];
  const active = point?.value !== null && point?.value !== undefined && Number.isFinite(point.value) ? hover : null;
  const readout = active === null ? valid.at(-1)! : metric.trend[active];
  const ticks = temporalLabelIndices(valid.map(point => x(point.index)), compact ? 66 : 80).map(index => valid[index].index);

  return <div className="executive-chart executive-chart-refined" ref={ref}>
    <div className="executive-chart-readout" aria-live="polite"><span className="executive-chart-frequency"><i aria-hidden="true"/>Daily {metric.unit === "money" ? `· ${currency}` : metric.unit === "percent" ? "· %" : "· Count"}</span><span className="executive-chart-value"><span>{active === null ? "Last recorded · " : ""}{date(readout.date)}</span><b>{metricDisplay(readout.value, metric.unit, currency)}</b></span></div>
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="group" aria-label={`${metric.label} by recorded date`} onPointerMove={event => {
      const bounds = event.currentTarget.getBoundingClientRect(), position = (event.clientX - bounds.left) / bounds.width * width;
      if (position < 58 || position > width - 24) return;
      inspect(valid.reduce((nearest, candidate) => Math.abs(x(candidate.index) - position) < Math.abs(x(nearest.index) - position) ? candidate : nearest).index);
    }} onPointerLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setInspection(null); }}>
      <defs><linearGradient id={id} x1="0" x2="1"><stop stopColor="#176dff"/><stop offset="1" stopColor="#633eb5"/></linearGradient><linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#418cff" stopOpacity=".2"/><stop offset="1" stopColor="#9380cc" stopOpacity=".015"/></linearGradient></defs>
      {axisTicks.map(value => <g key={value} className="executive-chart-grid"><line x1="58" x2={width - 24} y1={y(value)} y2={y(value)} stroke={value === 0 ? "#ccd8e8" : "#e5ebf4"} strokeDasharray={value === 0 ? undefined : "3 5"}/><text x="48" y={y(value) + 4} textAnchor="end" fill="#465a77" fontSize="11">{formatExecutiveAxisValue(value, metric.unit)}</text></g>)}
      <g ref={plotRef} className="executive-chart-data">
        {chart === "line" ? <>{segments.map((segment, index) => segment.firstIndex === segment.lastIndex ? <circle key={segment.firstIndex} cx={segment.firstX} cy={y(metric.trend[segment.firstIndex].value!)} r="4" fill="#326cdb"/> : <g key={segment.firstIndex}><path d={`${paths[index]} L${segment.lastX},${y(0)} L${segment.firstX},${y(0)} Z`} fill={`url(#${id}-area)`}/><path d={paths[index]} fill="none" stroke={`url(#${id})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/></g>)}<circle cx={x(valid.at(-1)!.index)} cy={y(valid.at(-1)!.value!)} r="4" fill="#633eb5" stroke="#fff" strokeWidth="2"/></> : valid.map(record => <rect key={`${record.date}:${record.index}`} x={x(record.index) - Math.min(16, plotWidth / metric.trend.length * .32)} y={Math.min(y(0), y(record.value!))} width={Math.min(32, plotWidth / metric.trend.length * .64)} height={Math.max(1, Math.abs(y(0) - y(record.value!)))} rx="4" fill={`url(#${id})`}/>)}
      </g>
      {active !== null && <g className="executive-chart-cursor" pointerEvents="none"><line x1={x(active)} x2={x(active)} y1="22" y2={height - 37} stroke="#a48acb" strokeDasharray="3 4"/><circle cx={x(active)} cy={y(metric.trend[active].value!)} r="10" fill="#7253ba1c"/><circle cx={x(active)} cy={y(metric.trend[active].value!)} r="4.5" fill="#426bdd" stroke="#fff" strokeWidth="2"/></g>}
      {valid.map(record => <circle key={`${record.date}:${record.index}`} cx={x(record.index)} cy={y(record.value!)} r="14" fill="transparent" stroke="transparent" tabIndex={active === record.index || (active === null && record.index === valid[0].index) ? 0 : -1} role="button" aria-label={`${record.date}: ${metricDisplay(record.value, metric.unit, currency)}`} onClick={() => inspect(record.index)} onFocus={() => inspect(record.index)} onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspect(record.index); }
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); const controls = Array.from(event.currentTarget.parentElement?.querySelectorAll('circle[role="button"]') ?? []), index = controls.indexOf(event.currentTarget), next = Math.max(0, Math.min(controls.length - 1, index + (event.key === "ArrowRight" ? 1 : -1))); (controls[next] as SVGElement | undefined)?.focus(); }
      }}/>)}
      {ticks.map((index, position) => <text key={index} x={x(index)} y={height - 9} textAnchor={position === 0 ? "start" : position === ticks.length - 1 ? "end" : "middle"} fontSize="11" fill="#465a77">{date(metric.trend[index].date)}</text>)}
    </svg>
    <p className="executive-chart-caption">{chart === "line" ? "Exact daily records. Curves connect observations; gaps stay visible." : "Exact daily records. Gaps stay visible."}</p>
    {showTable && <details><summary>View Data Table</summary><table><caption>{metric.label} by recorded date</caption><thead><tr><th scope="col">Date</th><th scope="col">{metric.label}</th></tr></thead><tbody>{metric.trend.map(record => <tr key={record.date}><td>{record.date}</td><td>{metricDisplay(record.value, metric.unit, currency)}</td></tr>)}</tbody></table></details>}
  </div>;
}
