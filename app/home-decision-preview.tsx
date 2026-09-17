"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { demoAnalysis, type DemoLocation } from "../domain/product-demo";
import FinanceChart from "./finance-chart";
import VanteloqAiLogo from "./vanteloq-ai-logo";
const money = (value: number, decimals = 0) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value / 100);
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(date + "T00:00:00Z"));
const shiftDate = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
export default function HomeDecisionPreview() {
  const [location, setLocation] = useState<DemoLocation>("all");
  const { kpis, weeks, rows } = useMemo(() => demoAnalysis(location, "complete"), [location]);
  const current = kpis.current!;
  const points = weeks.map((week, index) => {
    const from = shiftDate(kpis.previous!.start, index * 7), to = shiftDate(from, 6);
    const previousRows = rows.filter(row => row.date >= from && row.date <= to);
    const previousSales = previousRows.length && previousRows.every(row => row.netSalesCents !== null)
      ? previousRows.reduce((total, row) => total + row.netSalesCents!, 0) : null;
    return { label: "Week " + (index + 1), detail: dateLabel(week.from) + " to " + dateLabel(week.to), values: [week.salesCents, previousSales] };
  });
  return <div className="home-live-proof home-product-preview">
    <header><div><span className="home-proof-dot"/><strong>Northline Retail</strong></div><span>SAMPLE STORE</span></header>
    <div className="home-live-proof-top"><div><small>NET SALES · MAY 29 TO JUN 25</small><strong>{money(current.netSalesCents!)}</strong><span>{kpis.salesChangePercent!.toFixed(1)}% vs previous 28 days</span></div><label><span className="sr-only">Sample location</span><select aria-label="Sample location" value={location} data-public-event="demo_engaged" onChange={event => setLocation(event.target.value as DemoLocation)}><option value="all">Both shops</option><option value="central">Central shop</option><option value="riverside">Riverside shop</option></select></label></div>
    <dl className="home-sample-metrics"><div><dt>Transactions</dt><dd>{current.transactions!.toLocaleString("en-CA")}</dd></div><div><dt>Average basket</dt><dd>{money(current.averageTransactionCents!, 2)}</dd></div><div><dt>Gross margin</dt><dd>{current.grossMarginPercent!.toFixed(1)}%</dd></div></dl>
    <FinanceChart title="Weekly net sales" description="Compare each week with the corresponding week in the previous 28 days." points={points} series={[{ label: "May 29 to Jun 25", kind: "bar", color: "blue" }, { label: "May 1 to May 28", kind: "line", color: "violet", dashed: true }]} currency="CAD" sample/>
    <div className="home-proof-insight"><VanteloqAiLogo size={34} decorative/><div><strong>What changed behind the total?</strong><p>Compare baskets, product mix and discounts. Open the records before deciding what to change.</p><Link href={"/demo?location=" + location + "#retail"} data-public-event="demo_engaged">Show me why <span aria-hidden="true">↗</span></Link></div></div>
    <footer>Fictional records · Working calculations · Try the location selector</footer>
  </div>;
}
