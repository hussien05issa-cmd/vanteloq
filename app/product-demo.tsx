"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { DEMO_LOCATIONS, demoAnalysis, demoScenario, type DemoLocation, type DemoQuality } from "../domain/product-demo";
import VanteloqAiLogo from "./vanteloq-ai-logo";

const money = (cents: number | null) => cents === null ? "Unavailable" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(cents / 100);
const preciseMoney = (cents: number | null) => cents === null ? "Missing" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
const percent = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(1)}%`;
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const views = ["Overview", "Source records", "Scenario lab"] as const;

export default function ProductDemo({ standalone = false }: { standalone?: boolean }) {
  const id = useId();
  const Heading = standalone ? "h1" : "h2";
  const [location, setLocation] = useState<DemoLocation>("all");
  const [quality, setQuality] = useState<DemoQuality>("complete");
  const [view, setView] = useState<typeof views[number]>("Overview");
  const [recordPage, setRecordPage] = useState(0);
  const [price, setPrice] = useState(0);
  const [cost, setCost] = useState(0);
  const [suggestions, setSuggestions] = useState(true);
  const { rows, currentRows, kpis, weeks } = demoAnalysis(location, quality);
  const current = kpis.current!, previous = kpis.previous!;
  const projection = demoScenario(current.netSalesCents!, current.grossProfitCents, price, cost);
  const marginChange = current.grossMarginPercent !== null && previous.grossMarginPercent !== null && kpis.comparisonComplete ? current.grossMarginPercent - previous.grossMarginPercent : null;
  const visibleRows = rows.slice(recordPage * 8, recordPage * 8 + 8);
  const reset = () => { setLocation("all"); setQuality("complete"); setView("Overview"); setRecordPage(0); setPrice(0); setCost(0); setSuggestions(true); };

  return <section className="product-demo" id="demo" aria-labelledby={`${id}-title`}>
    <div className="demo-intro">
      <div><p className="demo-eyebrow">EXPLORE THE PRODUCT</p><Heading id={`${id}-title`}>See the numbers.<br/><em>Check the thinking.</em></Heading></div>
      <div><p>Take a sample retail business for a spin. Switch locations, inspect the source records and test a decision before you connect your own data.</p><span className="demo-no-account">No signup · Fictional data · Runs in your browser</span></div>
    </div>
    <div className="demo-app">
      <header className="demo-app-header"><div><span className="demo-workspace-icon">N</span><div><strong>Northline Retail</strong><small>Interactive sample workspace</small></div></div><span className="demo-sample-label">SAMPLE DATA</span><button type="button" onClick={reset}>Reset demo</button></header>
      <div className="demo-toolbar">
        <div className="demo-view-switch" role="group" aria-label="Demo views">{views.map(item => <button type="button" key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}</div>
        <label>Location<select aria-label="Demo location" value={location} onChange={event => { setLocation(event.target.value as DemoLocation); setRecordPage(0); }}><option value="all">Both shops</option><option value="central">Central shop</option><option value="riverside">Riverside shop</option></select></label>
      </div>
      <div className="demo-content">
        <div className="demo-period"><div><strong>{view === "Scenario lab" ? "Model a decision" : view === "Source records" ? "Follow the evidence" : "Performance, with context"}</strong><span>May 29 to June 25, 2026 · CAD · Sales exclude tax</span></div><label>Test data quality<select aria-label="Demo data quality" value={quality} onChange={event => { setQuality(event.target.value as DemoQuality); setRecordPage(0); }}><option value="complete">Complete records</option><option value="missing-cost">One cost is missing</option><option value="missing-days">Prior week is missing</option></select></label></div>
        <p className={`demo-quality ${quality === "complete" ? "complete" : "limited"}`} role="status">{quality === "missing-cost" ? "Cost gap detected. Gross profit, margin and scenarios are unavailable until the missing cost is supplied." : quality === "missing-days" ? "Incomplete baseline. Current totals remain visible; growth comparisons are unavailable." : `${currentRows.length} current-period daily records · Complete 28-day comparison across the selected shops`}</p>
        {view === "Overview" && <>
          <div className="demo-kpis" aria-live="polite" aria-atomic="true">
            <article><span>Net sales</span><strong>{money(current.netSalesCents)}</strong><small>{kpis.salesChangePercent === null ? "Comparison unavailable" : `+${percent(kpis.salesChangePercent)} vs prior 28 days`}</small></article>
            <article><span>Gross profit</span><strong>{money(current.grossProfitCents)}</strong><small>Net sales less product cost</small></article>
            <article><span>Gross margin</span><strong>{percent(current.grossMarginPercent)}</strong><small>{marginChange === null ? "Comparison unavailable" : `${marginChange.toFixed(1)} percentage points`}</small></article>
            <article><span>Average transaction</span><strong>{preciseMoney(current.averageTransactionCents)}</strong><small>{current.transactions?.toLocaleString("en-CA")} completed transactions</small></article>
          </div>
          <div className="demo-overview-grid">
            <div className="demo-chart"><header><div><h3>Sales across the period</h3><p>Calculated from the selected daily records</p></div><span>NET SALES</span></header><div className="demo-bars">{weeks.map(week => <div key={week.label}><strong>{money(week.salesCents)}</strong><div className="demo-bar-track"><div style={{ height: `${week.salesCents / Math.max(...weeks.map(item => item.salesCents)) * 100}%` }}/></div><span>{week.label}</span><small>{dateLabel(week.from)} to {dateLabel(week.to)}</small></div>)}</div><button type="button" onClick={() => { setRecordPage(0); setView("Source records"); }}>Inspect the underlying records →</button></div>
            <aside className="demo-insight"><div className="demo-insight-heading"><VanteloqAiLogo size={30} decorative/><span>Evidence brief<small>CALCULATED INSIGHT</small></span></div><h3>{quality === "missing-cost" ? "Sales are visible. Margin needs evidence." : quality === "missing-days" ? "A trend needs a complete baseline." : "Sales grew. Margin deserves a closer look."}</h3><p>{quality === "missing-cost" ? "One daily record has no product cost. Treating that gap as zero would overstate profit, so the calculation stays unavailable." : quality === "missing-days" ? "Seven days are absent from the comparison period. Comparing these totals would confuse missing records with a change in performance." : `Net sales increased ${percent(kpis.salesChangePercent)}, while gross margin fell ${Math.abs(marginChange!).toFixed(1)} percentage points. More sales do not automatically mean a stronger margin.`}</p><div className="demo-evidence-note"><strong>What to check next</strong><p>{quality === "complete" ? "Review product costs and sales mix before changing prices. These daily totals do not establish what caused the change." : "Resolve the source gap, then compare equivalent periods before making a decision."}</p></div><button type="button" onClick={() => setView(quality === "complete" ? "Scenario lab" : "Source records")}>{quality === "complete" ? "Test a pricing assumption →" : "Review the evidence →"}</button><small className="demo-ai-disclosure">Rule-based demo explanation, not a live AI response.</small></aside>
          </div>
        </>}
        {view === "Source records" && <div className="demo-records">
          <div className="demo-records-heading"><div><h3>Every total has a starting point.</h3><p>Fictional daily POS summaries, including the prior comparison period. Discounts and returns are already reflected in net sales.</p></div><span>{rows.length} records</span></div>
          <div className="demo-table-scroll" tabIndex={0} role="region" aria-label="Scrollable sample source records"><table><caption>Selected source records in Canadian dollars</caption><thead><tr><th scope="col">Business date</th><th scope="col">Location</th><th scope="col">Net sales</th><th scope="col">Product cost</th><th scope="col">Gross profit</th><th scope="col">Transactions</th></tr></thead><tbody>{visibleRows.map(row => <tr key={`${row.date}-${row.locationRef}`}><td>{dateLabel(row.date)}, 2026</td><td>{DEMO_LOCATIONS[row.locationRef as keyof typeof DEMO_LOCATIONS]}</td><td>{preciseMoney(row.netSalesCents)}</td><td className={row.grossProfitCents === null ? "missing-value" : ""}>{preciseMoney(row.grossProfitCents === null ? null : row.netSalesCents! - row.grossProfitCents)}</td><td>{preciseMoney(row.grossProfitCents)}</td><td>{row.transactions}</td></tr>)}</tbody></table></div>
          <div className="demo-pagination"><span aria-live="polite">Records {recordPage * 8 + 1} to {Math.min((recordPage + 1) * 8, rows.length)} of {rows.length}</span><button type="button" disabled={recordPage === 0} onClick={() => setRecordPage(page => page - 1)}>Previous records</button><button type="button" disabled={(recordPage + 1) * 8 >= rows.length} onClick={() => setRecordPage(page => page + 1)}>Next records</button></div>
          <div className="demo-formulas"><article><small>GROSS PROFIT</small><strong>Net sales − product cost</strong><p>Missing cost makes the profit total unavailable.</p></article><article><small>GROSS MARGIN</small><strong>Gross profit ÷ net sales × 100</strong><p>Margin comparisons use percentage points.</p></article><article><small>SALES GROWTH</small><strong>Change ÷ prior sales × 100</strong><p>Requires complete, equivalent 28-day periods.</p></article></div>
        </div>}
        {view === "Scenario lab" && <div className="demo-scenario"><div><span className="demo-scenario-badge">ASSUMPTIONS, NOT ACTUALS</span><h3>What if your prices or costs change?</h3><p>Hold sales volume and product mix constant. Adjust one assumption and see its effect on gross profit. This is a sensitivity model, not a demand forecast.</p><label htmlFor={`${id}-price`}>Selling price change <output>{price > 0 ? "+" : ""}{price}%</output></label><input id={`${id}-price`} type="range" min={-20} max={20} step={1} value={price} onChange={event => setPrice(Number(event.target.value))}/><div className="demo-range-labels"><span>−20%</span><span>+20%</span></div><label htmlFor={`${id}-cost`}>Product cost change <output>{cost > 0 ? "+" : ""}{cost}%</output></label><input id={`${id}-cost`} type="range" min={-10} max={30} step={1} value={cost} onChange={event => setCost(Number(event.target.value))}/><div className="demo-range-labels"><span>−10%</span><span>+30%</span></div><button type="button" onClick={() => { setPrice(0); setCost(0); }}>Reset assumptions</button></div><aside aria-live="polite"><small>MODELLED GROSS PROFIT</small><strong>{money(projection?.profitCents ?? null)}</strong><p>{projection ? `${projection.profitChangeCents >= 0 ? "+" : ""}${money(projection.profitChangeCents)} vs the sample baseline` : "Complete product costs are needed to model a scenario."}</p><dl><div><dt>Modelled net sales</dt><dd>{money(projection?.salesCents ?? null)}</dd></div><div><dt>Modelled product cost</dt><dd>{money(projection?.costCents ?? null)}</dd></div><div><dt>Modelled gross margin</dt><dd>{percent(projection?.marginPercent ?? null)}</dd></div></dl><p className="demo-model-limit">Excludes demand changes, tax, rent, labour and other operating costs. Gross profit is not net business profit. No price or purchase is changed.</p></aside></div>}
        <div className="demo-prompts"><button type="button" className="demo-suggestions-toggle" aria-expanded={suggestions} aria-controls={`${id}-suggestions`} onClick={() => setSuggestions(open => !open)}>{suggestions ? "Hide guided questions" : "Show guided questions"}</button>{suggestions && <div id={`${id}-suggestions`}><button type="button" onClick={() => { setView("Overview"); setQuality("complete"); }}>What changed in performance?</button><button type="button" onClick={() => { setView("Overview"); setQuality("missing-cost"); }}>What if a cost is missing?</button><button type="button" onClick={() => { setView("Scenario lab"); setPrice(5); setCost(0); }}>What if prices rise 5%?</button></div>}</div>
      </div>
      <footer className="demo-app-footer"><span>Fictional business. Real KPI calculation logic.</span><span>No account connection · No AI provider request · No saved demo data</span></footer>
    </div>
    <div className="demo-proof-links"><p>Inspect how it works, including its limits.</p><a href="https://github.com/hussien05issa-cmd/vanteloq/blob/main/domain/advisor-kpis.ts" target="_blank" rel="noopener noreferrer">View the calculation source ↗</a><a href="/privacy">Read the privacy policy →</a><Link href="/#connections">Check provider availability →</Link></div>
  </section>;
}

