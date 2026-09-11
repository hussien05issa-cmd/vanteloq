"use client";

import { useState } from "react";
import { calculateScenario, type ScenarioInputs } from "../domain/scenario-model";

type Source = { days: number; netSalesCents: number; labourCostCents: number; grossMarginRate: number | null; averageTransactionCents: number | null };
const empty = { sales: "", margin: "", fixed: "", labour: "", aov: "", salesChange: "0", marginChange: "0", costChange: "0" };

export default function ScenarioPlanner({ source, currency }: { source: Source | null; currency: string }) {
  const [inputs, setInputs] = useState(empty);
  const [sourceNote, setSourceNote] = useState("Enter amounts for the same period. Nothing is assumed or saved to your books.");
  const incomplete = Object.values(inputs).some(value => value.trim() === "");
  let result: ReturnType<typeof calculateScenario> | null = null;
  let error = "";
  if (!incomplete) {
    try { result = calculateScenario(Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, Number(value)])) as ScenarioInputs); }
    catch (caught) { error = caught instanceof Error ? caught.message : "Check your inputs."; }
  }
  const money = (value: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  const set = (key: keyof ScenarioInputs, value: string) => setInputs(current => ({ ...current, [key]: value }));
  const field = (key: keyof ScenarioInputs, name: string, hint: string, min?: number, max?: number) => <label key={key} htmlFor={`scenario-${key}`}><span>{name}</span><input id={`scenario-${key}`} type="number" inputMode="decimal" step="any" min={min} max={max} value={inputs[key]} aria-describedby={`scenario-${key}-hint`} onChange={event => set(key, event.target.value)}/><small id={`scenario-${key}-hint`}>{hint}</small></label>;
  const useSource = () => {
    if (!source) return;
    setInputs(current => ({ ...current, sales: String(source.netSalesCents / 100), margin: source.grossMarginRate === null ? "" : String(Math.round(source.grossMarginRate * 10000) / 100), labour: String(source.labourCostCents / 100), aov: source.averageTransactionCents === null ? "" : String(source.averageTransactionCents / 100) }));
    setSourceNote(`Copied totals covering ${source.days} recorded days from the current view. This is not automatically a calendar month. Enter fixed costs for that same period; review copied values before relying on the result.`);
  };
  return <div className="content scenario-page scenario-workbench">
    <section className="page-intro"><div><p>DECISION MODELLING</p><h2>See the trade-off before you commit.</h2><span>Explore how sales, margin and costs change profit. Every result comes from your inputs.</span></div><span className="scenario-mode">Private calculation · {currency}</span></section>
    <div className="scenario-layout">
      <section className="card scenario-inputs" aria-labelledby="scenario-input-title">
        <header className="scenario-section-head"><div><p>YOUR BASELINE</p><h3 id="scenario-input-title">One period. Consistent inputs.</h3></div>{source && <button type="button" onClick={useSource}>Use source totals</button>}</header>
        <p className="scenario-source-note" role="status">{sourceNote}</p>
        <div className="manual-grid">
          {field("sales", `Net sales (${currency})`, "After discounts and refunds; exclude sales tax.", 0)}
          {field("margin", "Gross margin (%)", "Gross profit ÷ net sales × 100, not markup.", 0, 100)}
          {field("fixed", `Other operating costs (${currency})`, "Exclude product costs and labour entered separately.", 0)}
          {field("labour", `Labour cost (${currency})`, "Use the same period as sales.", 0)}
          {field("aov", `Average transaction (${currency})`, "Enter 0 if unknown; transaction targets will be unavailable.", 0)}
        </div>
        <h3>What changes?</h3><div className="manual-grid">
          {field("salesChange", "Sales change (%)", "For example, 10 means a 10% increase.", -100)}
          {field("marginChange", "Margin change (percentage points)", "For example, +2 changes 40% to 42%.", -100, 100)}
          {field("costChange", `Cost adjustment (${currency})`, "Positive adds costs; negative models a saving.")}
        </div><button type="button" className="scenario-reset" onClick={() => { setInputs(empty); setSourceNote("Inputs cleared. Enter amounts for the same period."); }}>Clear inputs</button>
      </section>
      <section className="scenario-results" aria-label="Scenario results" aria-live="polite" aria-atomic="true">
        {!result ? <div className="scenario-empty"><span className="scenario-empty-icon" aria-hidden="true">ƒ</span><h3>{error ? "Check the assumptions" : "Build your scenario"}</h3><p>{error || "Complete the baseline to see profit, break-even sales and the change from your starting point. Enter 0 for costs that do not apply."}</p><small>No example figures are mixed with your business data.</small></div> : <>
          <div className="scenario-profit"><small>MODELLED PROFIT FOR THIS PERIOD</small><b className={result.profit < 0 ? "negative" : ""}>{money(result.profit)}</b><span>{result.profitChange >= 0 ? "+" : ""}{money(result.profitChange)} from baseline profit of {money(result.baselineProfit)}</span></div>
          <div className="scenario-calculation"><small>HOW THE RESULT IS BUILT</small><dl><div><dt>Adjusted net sales</dt><dd>{money(result.projectedSales)}</dd></div><div><dt>Gross profit at {result.projectedMargin.toFixed(1)}%</dt><dd>{money(result.grossProfit)}</dd></div><div><dt>Less operating costs and labour</dt><dd>{money(result.projectedFixed)}</dd></div><div><dt>Modelled profit</dt><dd>{money(result.profit)}</dd></div></dl></div>
          <div><small>BREAK-EVEN SALES</small><b>{result.breakEven === null ? "Not achievable" : money(result.breakEven)}</b><span>{result.breakEven === null ? "A positive gross margin is needed to cover these costs." : result.transactions === null ? "Enter an average transaction above 0 to calculate the transaction target." : `${result.transactions.toLocaleString()} transactions at ${money(Number(inputs.aov))} each`}</span></div>
        </>}
        <p className="scenario-boundary">This is a sensitivity calculation, not a prediction or spend approval. It excludes tax, debt principal, working capital and payment timing unless you include them in your assumptions. Use BookLoQ Cash Flow for dated obligations.</p>
      </section>
    </div>
  </div>;
}
