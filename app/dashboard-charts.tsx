"use client";

type TrendPoint = {
  date: string;
  netSalesCents: number;
  grossProfitCents: number;
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
  const labelIndexes = new Set(
    [0, Math.floor((data.length - 1) / 2), data.length - 1].filter(
      (value) => value >= 0,
    ),
  );

  return (
    <div className="business-trend">
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
          <linearGradient id="sales-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5b5bd6" stopOpacity="0.24" />
            <stop offset="1" stopColor="#5b5bd6" stopOpacity="0" />
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
          <polygon points={salesArea} fill="url(#sales-area)" />
          <polyline points={sales} className="trend-sales-line" />
          <polyline points={profit} className="trend-profit-line" />
          {data.map((point, index) => {
            if (!labelIndexes.has(index)) return null;
            const x = data.length === 1 ? 0 : (index / (data.length - 1)) * chartWidth;
            return (
              <text key={point.date} x={x} y={chartHeight + 24} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} className="trend-axis-label">
                {new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${point.date}T00:00:00Z`))}
              </text>
            );
          })}
        </g>
      </svg>
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
        <span><small>After payables</small><b>{hasData ? format(available) : "—"}</b></span>
      </div>
      <dl className="cash-ring-details">
        <div><dt><i className="cash-dot" />Operating cash</dt><dd>{cashCents == null ? "Not connected" : format(cash)}</dd></div>
        <div><dt><i className="payable-dot" />Accounts payable</dt><dd>{payableCents == null ? "Not connected" : format(payable)}</dd></div>
        <div><dt><i className="available-dot" />Uncommitted balance</dt><dd>{hasData ? format(available) : "Not calculated"}</dd></div>
      </dl>
    </div>
  );
}

export type { Tone, TrendPoint };
