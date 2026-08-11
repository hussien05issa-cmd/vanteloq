"use client";

import { useId, useMemo, useState } from "react";

type TrendPoint = {
  date: string;
  netSalesCents: number;
  grossProfitCents: number;
  transactionCount?: number;
};

type IntradayPoint = {
  hour: number;
  label: string;
  netSalesCents: number;
  grossProfitCents: number;
  transactionCount: number;
};

type Tone = "indigo" | "emerald" | "cyan" | "amber" | "rose";

const toneColour: Record<Tone, string> = {
  indigo: "#5b5bd6",
  emerald: "#059669",
  cyan: "#0891b2",
  amber: "#d97706",
  rose: "#e11d48",
};

function compactMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

function fullMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function readableDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function tickIndexes(length: number, maximum = 7) {
  if (length <= maximum) return new Set(Array.from({ length }, (_, index) => index));
  return new Set(Array.from({ length: maximum }, (_, index) => Math.round(index * (length - 1) / (maximum - 1))));
}

function points(values: number[], width: number, height: number, maximum: number) {
  if (!values.length) return "";
  const step = values.length === 1 ? width : width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - (value / maximum) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function MetricSparkline({
  values,
  tone,
}: {
  values: number[];
  tone: Tone;
}) {
  const maximum = Math.max(...values, 1);
  const line = points(values, 112, 30, maximum);
  const fill = line ? `0,30 ${line} 112,30` : "";
  return (
    <svg className="metric-sparkline" viewBox="0 0 112 32" aria-hidden="true">
      <polygon points={fill} fill={`${toneColour[tone]}18`} />
      <polyline
        points={line}
        fill="none"
        stroke={toneColour[tone]}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BusinessTrendChart({
  data,
  currency,
}: {
  data: TrendPoint[];
  currency: string;
}) {
  const gradientId = useId().replaceAll(":", "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 720;
  const height = 228;
  const plotLeft = 54;
  const plotRight = 16;
  const plotTop = 14;
  const plotBottom = 34;
  const chartWidth = width - plotLeft - plotRight;
  const chartHeight = height - plotTop - plotBottom;
  const maximum = Math.max(
    ...data.flatMap((point) => [point.netSalesCents, point.grossProfitCents]),
    1,
  );
  const sales = points(
    data.map((point) => point.netSalesCents),
    chartWidth,
    chartHeight,
    maximum,
  );
  const profit = points(
    data.map((point) => point.grossProfitCents),
    chartWidth,
    chartHeight,
    maximum,
  );
  const salesArea = sales
    ? `0,${chartHeight} ${sales} ${chartWidth},${chartHeight}`
    : "";
  const yTicks = [1, 0.75, 0.5, 0.25, 0];
  const labelIndexes = useMemo(() => tickIndexes(data.length), [data.length]);
  const active = activeIndex === null ? null : data[activeIndex];
  const activeX = activeIndex === null || data.length <= 1 ? 0 : (activeIndex / (data.length - 1)) * chartWidth;
  const activeSalesY = active ? chartHeight - (Math.max(0, active.netSalesCents) / maximum) * chartHeight : 0;
  const previous = activeIndex !== null && activeIndex > 0 ? data[activeIndex - 1] : null;
  const change = active && previous && previous.netSalesCents
    ? (active.netSalesCents - previous.netSalesCents) / Math.abs(previous.netSalesCents)
    : null;

  return (
    <div className="business-trend interactive-chart">
      <div className="chart-legend" aria-hidden="true">
        <span><i className="legend-sales" />Net sales</span>
        <span><i className="legend-profit" />Gross profit</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Net sales and gross profit by day"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2563eb" stopOpacity="0.24" />
            <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => {
          const y = plotTop + chartHeight * (1 - tick);
          return (
            <g key={tick}>
              <line x1={plotLeft} x2={width - plotRight} y1={y} y2={y} className="trend-gridline" />
              <text x={plotLeft - 10} y={y + 4} textAnchor="end" className="trend-axis-label">
                {compactMoney(maximum * tick, currency)}
              </text>
            </g>
          );
        })}
        <g transform={`translate(${plotLeft} ${plotTop})`}>
          <polygon points={salesArea} fill={`url(#${gradientId})`} />
          <polyline points={sales} className="trend-sales-line" />
          <polyline points={profit} className="trend-profit-line" />
          {active && (
            <g aria-hidden="true" className="chart-active-marker">
              <line x1={activeX} x2={activeX} y1={0} y2={chartHeight} />
              <circle cx={activeX} cy={activeSalesY} r="4.5" className="active-sales-point" />
              <circle cx={activeX} cy={chartHeight - (Math.max(0, active.grossProfitCents) / maximum) * chartHeight} r="4" className="active-profit-point" />
            </g>
          )}
          {data.map((point, index) => {
            const x = data.length === 1 ? 0 : (index / (data.length - 1)) * chartWidth;
            return (
              <g key={point.date}>
                {labelIndexes.has(index) && (
                  <text x={x} y={chartHeight + 24} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} className="trend-axis-label">
                    {new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${point.date}T00:00:00Z`))}
                  </text>
                )}
                <rect
                  className="chart-hit-zone"
                  x={Math.max(0, x - chartWidth / Math.max(data.length, 1) / 2)}
                  y={0}
                  width={Math.max(12, chartWidth / Math.max(data.length, 1))}
                  height={chartHeight}
                  tabIndex={0}
                  role="button"
                  aria-label={`${readableDate(point.date)}. Net sales ${fullMoney(point.netSalesCents, currency)}. Gross profit ${fullMoney(point.grossProfitCents, currency)}${point.transactionCount == null ? "" : `. ${point.transactionCount} transactions`}.`}
                  onFocus={() => setActiveIndex(index)}
                  onBlur={() => setActiveIndex(null)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                />
              </g>
            );
          })}
        </g>
      </svg>
      {active && (
        <div className="chart-tooltip" role="status" style={{ left: `${Math.min(86, Math.max(14, ((plotLeft + activeX) / width) * 100))}%`, top: `${Math.max(8, ((plotTop + activeSalesY) / height) * 100 - 8)}%` }}>
          <strong>{readableDate(active.date)}</strong>
          <span><i className="legend-sales" />Net sales <b>{fullMoney(active.netSalesCents, currency)}</b></span>
          <span><i className="legend-profit" />Gross profit <b>{fullMoney(active.grossProfitCents, currency)}</b></span>
          <small>{active.netSalesCents ? `${new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 }).format(active.grossProfitCents / active.netSalesCents)} margin` : "No sales recorded"}{active.transactionCount == null ? "" : ` · ${active.transactionCount} transactions`}{change === null ? "" : ` · ${new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(change)} vs prior day`}</small>
        </div>
      )}
    </div>
  );
}

export function IntradaySalesChart({
  data,
  currency,
}: {
  data: IntradayPoint[];
  currency: string;
}) {
  const gradientId = useId().replaceAll(":", "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 760;
  const height = 250;
  const plotLeft = 60;
  const plotRight = 18;
  const plotTop = 16;
  const plotBottom = 36;
  const chartWidth = width - plotLeft - plotRight;
  const chartHeight = height - plotTop - plotBottom;
  const values = data.map((point) => Math.max(0, point.netSalesCents));
  const maximum = Math.max(...values, 1);
  const line = points(values, chartWidth, chartHeight, maximum);
  const profitLine = points(data.map((point) => Math.max(0, point.grossProfitCents)), chartWidth, chartHeight, maximum);
  const area = line ? `0,${chartHeight} ${line} ${chartWidth},${chartHeight}` : "";
  const yTicks = [1, 0.5, 0];
  const labelHours = new Set([0, 6, 12, 18, 23]);
  const total = values.reduce((sum, value) => sum + value, 0);
  const active = activeIndex === null ? null : data[activeIndex];
  const activeX = activeIndex === null || data.length <= 1 ? 0 : (activeIndex / (data.length - 1)) * chartWidth;
  const activeY = active ? chartHeight - (Math.max(0, active.netSalesCents) / maximum) * chartHeight : 0;

  if (total === 0) {
    return (
      <div className="intraday-empty" role="img" aria-label="No completed sales have been received for today">
        <div className="intraday-empty-grid" aria-hidden="true"><i/><i/><i/><i/></div>
        <span><b>No completed sales received today</b><small>The graph will populate by hour as the connected R-Series account returns completed transactions.</small></span>
      </div>
    );
  }

  return (
    <div className="intraday-sales-chart interactive-chart">
      <div className="chart-legend" aria-hidden="true"><span><i className="legend-sales" />Net sales</span><span><i className="legend-profit" />Gross profit</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Today&apos;s net sales by hour">
        <title>Today&apos;s net sales by hour</title>
        <desc>{`${compactMoney(total, currency)} in net sales across ${data.reduce((sum, point) => sum + point.transactionCount, 0)} completed transactions.`}</desc>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#176ac3" stopOpacity="0.28" />
            <stop offset="1" stopColor="#176ac3" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => {
          const y = plotTop + chartHeight * (1 - tick);
          return (
            <g key={tick}>
              <line x1={plotLeft} x2={width - plotRight} y1={y} y2={y} className="trend-gridline" />
              <text x={plotLeft - 11} y={y + 4} textAnchor="end" className="trend-axis-label">
                {compactMoney(maximum * tick, currency)}
              </text>
            </g>
          );
        })}
        <g transform={`translate(${plotLeft} ${plotTop})`}>
          <polygon points={area} fill={`url(#${gradientId})`} />
          <polyline points={line} className="intraday-sales-line" />
          <polyline points={profitLine} className="intraday-profit-line" />
          {active && <g aria-hidden="true" className="chart-active-marker"><line x1={activeX} x2={activeX} y1={0} y2={chartHeight} /><circle cx={activeX} cy={activeY} r="4.5" className="active-sales-point" /><circle cx={activeX} cy={chartHeight - (Math.max(0, active.grossProfitCents) / maximum) * chartHeight} r="4" className="active-profit-point" /></g>}
          {data.map((point, index) => {
            const x = data.length === 1 ? 0 : (index / (data.length - 1)) * chartWidth;
            const y = chartHeight - (Math.max(0, point.netSalesCents) / maximum) * chartHeight;
            return (
              <g key={point.hour}>
                {point.netSalesCents > 0 && <circle cx={x} cy={y} r="3.5" className="intraday-sales-point" />}
                {labelHours.has(point.hour) && (
                  <text x={x} y={chartHeight + 25} textAnchor={point.hour === 0 ? "start" : point.hour === 23 ? "end" : "middle"} className="trend-axis-label">
                    {point.label}
                  </text>
                )}
                <rect
                  className="chart-hit-zone"
                  x={Math.max(0, x - chartWidth / 48)}
                  y={0}
                  width={Math.max(14, chartWidth / 24)}
                  height={chartHeight}
                  tabIndex={0}
                  role="button"
                  aria-label={`${point.label}. Net sales ${fullMoney(point.netSalesCents, currency)}. Gross profit ${fullMoney(point.grossProfitCents, currency)}. ${point.transactionCount} transactions.`}
                  onFocus={() => setActiveIndex(index)}
                  onBlur={() => setActiveIndex(null)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                />
              </g>
            );
          })}
        </g>
      </svg>
      {active && (
        <div className="chart-tooltip" role="status" style={{ left: `${Math.min(86, Math.max(14, ((plotLeft + activeX) / width) * 100))}%`, top: `${Math.max(12, ((plotTop + activeY) / height) * 100 - 8)}%` }}>
          <strong>{active.label}</strong>
          <span><i className="legend-sales" />Net sales <b>{fullMoney(active.netSalesCents, currency)}</b></span>
          <span><i className="legend-profit" />Gross profit <b>{fullMoney(active.grossProfitCents, currency)}</b></span>
          <small>{active.transactionCount} completed transaction{active.transactionCount === 1 ? "" : "s"}</small>
        </div>
      )}
    </div>
  );
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
