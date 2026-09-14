"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { DEMO_LOCATIONS, demoAnalysis, demoScenario, type DemoLocation, type DemoQuality } from "../domain/product-demo";
import BookloqDemo from "./bookloq-demo";
import RetailDemo from "./retail-demo";
import { demoRetailSection } from "../domain/public-journey";
import { retailDemoInput } from "../domain/retail-demo";
import VanteloqAiLogo from "./vanteloq-ai-logo";

const money = (cents: number | null) => cents === null ? "Unavailable" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(cents / 100);
const preciseMoney = (cents: number | null) => cents === null ? "Missing" : new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
const percent = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(1)}%`;
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const views = ["Overview", "Retail intelligence", "Source records", "Scenario lab", "BookLoQ cash"] as const;

export default function ProductDemo({ standalone = false }: { standalone?: boolean }) {
  const id = useId();
  const Heading = standalone ? "h1" : "h2";
  const [location, setLocation] = useState<DemoLocation>("all");
  const [quality, setQuality] = useState<DemoQuality>("complete");
  const [view, setView] = useState<typeof views[number]>("Overview");
  const [retailSection, setRetailSection] = useState<NonNullable<ReturnType<typeof demoRetailSection>>>("Why it changed");
  useEffect(() => {
    const chooseView = () => {
      const section = demoRetailSection(window.location.hash);
      if (window.location.hash === "#bookloq") queueMicrotask(() => setView("BookLoQ cash"));
      else if (section) queueMicrotask(() => { setRetailSection(section); setView("Retail intelligence"); });
    };
    const requestedLocation = new URLSearchParams(window.location.search).get("location");
    if (requestedLocation === "central" || requestedLocation === "riverside") queueMicrotask(() => setLocation(requestedLocation));
    chooseView(); window.addEventListener("hashchange", chooseView);
    return () => window.removeEventListener("hashchange", chooseView);
  }, []);
  const [recordPage, setRecordPage] = useState(0);
  const [recordType, setRecordType] = useState<"daily" | "lines">("daily");
  const [price, setPrice] = useState(0);
  const [cost, setCost] = useState(0);
  const [suggestions, setSuggestions] = useState(true);
  const { rows, currentRows, kpis, weeks } = demoAnalysis(location, quality);
  const current = kpis.current!, previous = kpis.previous!;
  const projection = demoScenario(current.netSalesCents!, current.grossProfitCents, price, cost);
  const marginChange = current.grossMarginPercent !== null && previous.grossMarginPercent !== null && kpis.comparisonComplete ? current.grossMarginPercent - previous.grossMarginPercent : null;
  const recordDates = new Set(rows.map(row => row.date + ":" + row.locationRef));
  const sourceLines = retailDemoInput(location, quality === "missing-cost").lines.filter(line => recordDates.has(line.soldAt.slice(0,10) + ":" + line.outletRef)).sort((a,b) => b.soldAt.localeCompare(a.soldAt) || a.saleId.localeCompare(b.saleId));
  const recordCount = recordType === "daily" ? rows.length : sourceLines.length;
  const visibleRows = rows.slice(recordPage * 8, recordPage * 8 + 8);
  const reset = () => { setRecordType("daily"); setRetailSection("Why it changed"); setLocation("all"); setQuality("complete"); setView("Overview"); setRecordPage(0); setPrice(0); setCost(0); setSuggestions(true); };

  return <section className="product-demo" id="demo" aria-labelledby={`${id}-title`}>
    <div className="demo-intro">
      <div><p className="demo-eyebrow">EXPLORE THE PRODUCT</p><Heading id={`${id}-title`}>Try a question.<br/><em>Follow the answer.</em></Heading></div>
      <div><p>Choose a question below. Then switch locations, inspect the records or test a cash decision in the sample workspace.</p><span className="demo-no-account">No signup · Fictional data · Runs in your browser</span></div>
    </div>
    <div className="demo-guided-start" role="group" aria-label="Choose a guided demo"><button type="button" data-public-event="demo_engaged" onClick={() => { setView("Retail intelligence"); setRetailSection("Why it changed"); }}>1. Why did sales change?</button><button type="button" data-public-event="demo_engaged" onClick={() => { setView("Retail intelligence"); setRetailSection("Inventory"); }}>2. Which stock needs attention?</button><button type="button" data-public-event="demo_engaged" onClick={() => setView("BookLoQ cash")}>3. What is the cash impact?</button></div>
    <div className="demo-app">
      <header className="demo-app-header"><div><span className="demo-workspace-icon">N</span><div><strong>Northline Retail</strong><small>Interactive sample workspace</small></div></div><span className="demo-sample-label">SAMPLE DATA</span><button type="button" onClick={reset}>Reset demo</button></header>
      <div className="demo-toolbar">
        <div className="demo-view-switch" role="group" aria-label="Demo views">{views.map(item => <button type="button" key={item} data-public-event="demo_view" aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}</div>
        {view !== "BookLoQ cash" && <label>Location<select aria-label="Demo location" value={location} onChange={event => { setLocation(event.target.value as DemoLocation); setRecordPage(0); }}><option value="all">Both shops</option><option value="central">Central shop</option><option value="riverside">Riverside shop</option></select></label>}
      </div>
      <div className="demo-content">
        {view === "Retail intelligence" && (quality === "missing-days" ? <div className="demo-quality limited" role="status"><strong>The comparison period is incomplete.</strong><p>The missing-week scenario is still active. Restore the fictional records before exploring revenue drivers, repeat purchases and inventory velocity.</p><button type="button" onClick={() => setQuality("complete")}>Restore the missing week</button></div> : <RetailDemo location={location} initialSection={retailSection} missingCost={quality === "missing-cost"} onMissingCost={missing => setQuality(missing ? "missing-cost" : "complete")}/>)}
        {view !== "BookLoQ cash" && view !== "Retail intelligence" && <><div className="demo-period"><div><strong>{view === "Scenario lab" ? "Model a decision" : view === "Source records" ? "Follow the evidence" : "Performance, with context"}</strong><span>May 29 to June 25, 2026 · CAD · Sales exclude tax</span></div><label>Test data quality<select aria-label="Demo data quality" value={quality} onChange={event => { setQuality(event.target.value as DemoQuality); setRecordPage(0); }}><option value="complete">Complete records</option><option value="missing-cost">One cost is missing</option><option value="missing-days">Prior week is missing</option></select></label></div>
        <p className={`demo-quality ${quality === "complete" ? "complete" : "limited"}`} role="status">{quality === "missing-cost" ? "Cost gap detected. Gross profit, margin and scenarios are unavailable until the missing cost is supplied." : quality === "missing-days" ? "Incomplete baseline. Current totals remain visible; growth comparisons are unavailable." : `${currentRows.length} current-period daily records · Complete 28-day comparison across the selected shops`}</p></>}
        {view === "BookLoQ cash" && <BookloqDemo/>}
        {view === "Overview" && <>
          <div className="demo-kpis" aria-live="polite" aria-atomic="true">
            <article><span>Net sales</span><strong>{money(current.netSalesCents)}</strong><small>{kpis.salesChangePercent === null ? "Comparison unavailable" : `${kpis.salesChangePercent >= 0 ? "+" : ""}${percent(kpis.salesChangePercent)} vs prior 28 days`}</small></article>
            <article><span>Gross profit</span><strong>{money(current.grossProfitCents)}</strong><small>Net sales less product cost</small></article>
            <article><span>Gross margin</span><strong>{percent(current.grossMarginPercent)}</strong><small>{marginChange === null ? "Comparison unavailable" : `${marginChange.toFixed(1)} percentage points`}</small></article>
            <article><span>Average transaction</span><strong>{preciseMoney(current.averageTransactionCents)}</strong><small>{current.transactions?.toLocaleString("en-CA")} completed transactions</small></article>
          </div>
          <div className="demo-overview-grid">
            <div className="demo-chart"><header><div><h3>Sales across the period</h3><p>Calculated from the selected daily records</p></div><span>NET SALES</span></header><div className="demo-bars">{weeks.map(week => <div key={week.label}><strong>{money(week.salesCents)}</strong><div className="demo-bar-track"><div style={{ height: `${week.salesCents / Math.max(...weeks.map(item => item.salesCents)) * 100}%` }}/></div><span>{week.label}</span><small>{dateLabel(week.from)} to {dateLabel(week.to)}</small></div>)}</div><button type="button" onClick={() => { setRecordPage(0); setView("Source records"); }}>Inspect the underlying records →</button></div>
            <aside className="demo-insight"><div className="demo-insight-heading"><VanteloqAiLogo size={30} decorative/><span>Evidence brief<small>CALCULATED INSIGHT</small></span></div><h3>{quality === "missing-cost" ? "Sales are visible. Margin needs evidence." : quality === "missing-days" ? "A trend needs a complete baseline." : "Sales changed. Follow the evidence."}</h3><p>{quality === "missing-cost" ? "One daily record has no product cost. Treating that gap as zero would overstate profit, so the calculation stays unavailable." : quality === "missing-days" ? "Seven days are absent from the comparison period. Comparing these totals would confuse missing records with a change in performance." : `Net sales ${kpis.salesChangePercent! >= 0 ? "increased" : "decreased"} ${percent(Math.abs(kpis.salesChangePercent!))}, while gross margin ${marginChange! >= 0 ? "rose" : "fell"} ${Math.abs(marginChange!).toFixed(1)} percentage points. Compare basket counts, discounts and product costs to investigate the movement.`}</p><div className="demo-evidence-note"><strong>What to check next</strong><p>{quality === "complete" ? "Review product costs and sales mix before changing prices. These daily totals do not establish what caused the change." : "Resolve the source gap, then compare equivalent periods before making a decision."}</p></div><button type="button" onClick={() => { setRetailSection("Why it changed"); setView(quality === "complete" ? "Retail intelligence" : "Source records"); }}>{quality === "complete" ? "Investigate the revenue change →" : "Review the evidence →"}</button><small className="demo-ai-disclosure">Rule-based demo explanation, not a live AI response.</small></aside>
          </div>
        </>}
        {view === "Source records" && <div className="demo-records">
          <div className="demo-records-heading"><div><h3>Every total has a starting point.</h3><p>Daily summaries and their receipt lines come from the same fictional POS records used by Retail intelligence. Discounts are already included in net sales.</p></div><span>{recordCount} records</span></div><div className="demo-view-switch" role="group" aria-label="Source record detail"><button aria-pressed={recordType === "daily"} onClick={() => { setRecordType("daily"); setRecordPage(0); }}>Daily summaries</button><button aria-pressed={recordType === "lines"} onClick={() => { setRecordType("lines"); setRecordPage(0); }}>Receipt lines</button></div>
          {recordType === "daily" ? <div className="demo-table-scroll" tabIndex={0} role="region" aria-label="Scrollable sample source records"><table><caption>Selected source records in Canadian dollars</caption><thead><tr><th scope="col">Business date</th><th scope="col">Location</th><th scope="col">Net sales</th><th scope="col">Product cost</th><th scope="col">Gross profit</th><th scope="col">Transactions</th></tr></thead><tbody>{visibleRows.map(row => <tr key={`${row.date}-${row.locationRef}`}><td>{dateLabel(row.date)}, 2026</td><td>{DEMO_LOCATIONS[row.locationRef as keyof typeof DEMO_LOCATIONS]}</td><td>{preciseMoney(row.netSalesCents)}</td><td className={row.grossProfitCents === null ? "missing-value" : ""}>{preciseMoney(row.grossProfitCents === null ? null : row.netSalesCents! - row.grossProfitCents)}</td><td>{preciseMoney(row.grossProfitCents)}</td><td>{row.transactions}</td></tr>)}</tbody></table></div> : <div className="demo-table-scroll" tabIndex={0} role="region" aria-label="Sample receipt lines"><table><caption>Fictional receipt lines, the source of retail and overview totals</caption><thead><tr><th scope="col">Date / receipt</th><th scope="col">Location</th><th scope="col">Product / SKU</th><th scope="col">Units</th><th scope="col">Net sales</th><th scope="col">Cost</th></tr></thead><tbody>{sourceLines.slice(recordPage * 8, recordPage * 8 + 8).map(line => <tr key={line.saleId + ":" + line.lineId}><td>{line.soldAt.slice(0,10)}<small>{line.saleId}</small></td><td>{DEMO_LOCATIONS[line.outletRef as keyof typeof DEMO_LOCATIONS]}</td><td>{line.name}<small>{line.sku}</small></td><td>{line.quantityMilli / 1000}</td><td>{preciseMoney(line.netCents)}</td><td>{preciseMoney(line.costCents)}</td></tr>)}</tbody></table></div>}
          <div className="demo-pagination"><span aria-live="polite">Records {recordPage * 8 + 1} to {Math.min((recordPage + 1) * 8, recordCount)} of {recordCount}</span><button type="button" disabled={recordPage === 0} onClick={() => setRecordPage(page => page - 1)}>Previous records</button><button type="button" disabled={(recordPage + 1) * 8 >= recordCount} onClick={() => setRecordPage(page => page + 1)}>Next records</button></div>
          <div className="demo-formulas"><article><small>GROSS PROFIT</small><strong>Net sales − product cost</strong><p>Missing cost makes the profit total unavailable.</p></article><article><small>GROSS MARGIN</small><strong>Gross profit ÷ net sales × 100</strong><p>Margin comparisons use percentage points.</p></article><article><small>SALES GROWTH</small><strong>Change ÷ prior sales × 100</strong><p>Requires complete, equivalent 28-day periods.</p></article></div>
        </div>}
        {view === "Scenario lab" && <div className="demo-scenario"><div><span className="demo-scenario-badge">ASSUMPTIONS, NOT ACTUALS</span><h3>What if your prices or costs change?</h3><p>Hold sales volume and product mix constant. Adjust one assumption and see its effect on gross profit. This is a sensitivity model, not a demand forecast.</p><label htmlFor={`${id}-price`}>Selling price change <output>{price > 0 ? "+" : ""}{price}%</output></label><input id={`${id}-price`} type="range" min={-20} max={20} step={1} value={price} onChange={event => setPrice(Number(event.target.value))}/><div className="demo-range-labels"><span>−20%</span><span>+20%</span></div><label htmlFor={`${id}-cost`}>Product cost change <output>{cost > 0 ? "+" : ""}{cost}%</output></label><input id={`${id}-cost`} type="range" min={-10} max={30} step={1} value={cost} onChange={event => setCost(Number(event.target.value))}/><div className="demo-range-labels"><span>−10%</span><span>+30%</span></div><button type="button" onClick={() => { setPrice(0); setCost(0); }}>Reset assumptions</button></div><aside aria-live="polite"><small>MODELLED GROSS PROFIT</small><strong>{money(projection?.profitCents ?? null)}</strong><p>{projection ? `${projection.profitChangeCents >= 0 ? "+" : ""}${money(projection.profitChangeCents)} vs the sample baseline` : "Complete product costs are needed to model a scenario."}</p><dl><div><dt>Modelled net sales</dt><dd>{money(projection?.salesCents ?? null)}</dd></div><div><dt>Modelled product cost</dt><dd>{money(projection?.costCents ?? null)}</dd></div><div><dt>Modelled gross margin</dt><dd>{percent(projection?.marginPercent ?? null)}</dd></div></dl><p className="demo-model-limit">Excludes demand changes, tax, rent, labour and other operating costs. Gross profit is not net business profit. No price or purchase is changed.</p></aside></div>}
        {view !== "BookLoQ cash" && <div className="demo-prompts"><button type="button" className="demo-suggestions-toggle" aria-expanded={suggestions} aria-controls={`${id}-suggestions`} onClick={() => setSuggestions(open => !open)}>{suggestions ? "Hide guided questions" : "Show guided questions"}</button>{suggestions && <div id={`${id}-suggestions`}>{view === "Retail intelligence" ? <><button type="button" onClick={() => setRetailSection("Products")}>Which products drive revenue?</button><button type="button" onClick={() => setRetailSection("Baskets")}>What is purchased together?</button><button type="button" onClick={() => setRetailSection("Inventory")}>Which stock needs a review?</button></> : <><button type="button" onClick={() => { setView("Overview"); setQuality("complete"); }}>What changed in performance?</button><button type="button" onClick={() => { setView("Overview"); setQuality("missing-cost"); }}>What if a cost is missing?</button><button type="button" onClick={() => { setView("Scenario lab"); setPrice(5); setCost(0); }}>What if prices rise 5%?</button></>}</div>}</div>}
      </div>
      <footer className="demo-app-footer"><span>Fictional business. Real {view === "BookLoQ cash" ? "cash-flow" : "KPI"} calculation logic.</span><span>No account connection · No AI provider request · No saved demo data</span></footer>
    </div>
    <div className="demo-conversion"><div><h3>Your next decision, with your own data.</h3><p>Check your connection, choose a plan and review your first records.</p></div><Link data-public-event="signup_start" href="/?start=signup">Create your workspace →</Link><Link data-public-event="pricing_view" href="/pricing">View plans & pricing →</Link></div>
    <div className="demo-proof-links"><p>Inspect how it works, including its limits.</p><a href={`https://github.com/hussien05issa-cmd/vanteloq/blob/main/domain/${view === "BookLoQ cash" ? "thirteen-week-cash-flow" : view === "Retail intelligence" ? "retail-intelligence" : "advisor-kpis"}.ts`} target="_blank" rel="noopener noreferrer">View the calculation source ↗</a><a href="/privacy">Read the privacy policy →</a><Link href="/#connections">Check provider availability →</Link></div>
  </section>;
}

