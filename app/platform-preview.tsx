"use client";

import { useState } from "react";
import { CashPositionRing, IntradaySalesChart, type IntradayPoint } from "./dashboard-charts";
import ProductBrandLogo from "./product-brand-logo";

// Public examples only. Never connect this preview to a customer session or API.
const exampleHours: IntradayPoint[] = [18240, 31680, 48950, 61280, 55400, 74320, 82160, 38920].map((netSalesCents, index) => ({
  hour: index + 8, label: `${index + 8 > 12 ? index - 4 : index + 8} ${index + 8 >= 12 ? "p.m." : "a.m."}`,
  netSalesCents, grossProfitCents: Math.round(netSalesCents * 0.38), transactionCount: [4, 7, 10, 12, 11, 15, 17, 8][index],
}));
const previousHours = exampleHours.map((row, index) => ({ ...row, netSalesCents: Math.round(row.netSalesCents * [0.9, 1.1, 0.85, 0.95, 1.05, 0.8, 0.9, 0.85][index]) }));
const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

export default function PlatformPreview() {
  const [view, setView] = useState<"sales" | "cash">("sales");
  const [missingCosts, setMissingCosts] = useState(false);
  const [shortfall, setShortfall] = useState(false);
  const rows = missingCosts ? exampleHours.map((row) => ({ ...row, grossProfitCents: null })) : exampleHours;
  const netSales = exampleHours.reduce((sum, row) => sum + row.netSalesCents, 0);
  return <article className="platform-product-preview operating-shell" aria-label="Interactive Vanteloq product preview">
    <header className="platform-preview-masthead"><ProductBrandLogo product="vanteloq"/><div><strong>Inside your workspace</strong><span>Interactive preview · Example data</span></div></header>
    <div className="platform-preview-switch" role="group" aria-label="Choose a product preview">
      <button type="button" aria-pressed={view === "sales"} onClick={() => setView("sales")}>Sales pulse</button>
      <button type="button" aria-pressed={view === "cash"} onClick={() => setView("cash")}>BookLoQ cash</button>
    </div>
    <div className="platform-preview-content" key={view}>
      <header className="platform-preview-heading"><div><p className="card-kicker">{view === "sales" ? "COMMAND CENTRE" : "BOOKLOQ · CASH CONTEXT"}</p><h3>{view === "sales" ? "See the trading day take shape." : "Know what the balance leaves out."}</h3></div></header>
      {view === "sales" ? <>
        <dl className="platform-preview-metrics"><div><dt>Net sales</dt><dd>{money(netSales)}</dd></div><div><dt>Gross profit</dt><dd>{missingCosts ? "Not available" : money(exampleHours.reduce((sum, row) => sum + (row.grossProfitCents ?? 0), 0))}</dd></div><div><dt>Transactions</dt><dd>{exampleHours.reduce((sum, row) => sum + row.transactionCount, 0)}</dd></div></dl>
        <label className="platform-preview-control"><input type="checkbox" checked={missingCosts} onChange={(event) => setMissingCosts(event.target.checked)}/>Try the missing-cost state</label>
        <IntradaySalesChart data={rows} comparison={previousHours} currency="CAD" comparisonDate="2026-08-31" asOf="2026-09-07T21:30:00Z" timeZone="America/Edmonton"/>
      </> : <>
        <p className="platform-preview-intro">Compare recorded cash with payables, then review the forecast before committing funds.</p>
        <label className="platform-preview-control"><input type="checkbox" checked={shortfall} onChange={(event) => setShortfall(event.target.checked)}/>Try a cash shortfall</label>
        <CashPositionRing cashCents={1284500} payableCents={shortfall ? 1600050 : 743250} currency="CAD"/>
      </>}
    </div>
    <footer className="platform-preview-footer">These are the same chart components used in Vanteloq, populated with fictional CAD records. Connected views depend on approved source data and workspace access. No live records are accessed here.</footer>
  </article>;
}
