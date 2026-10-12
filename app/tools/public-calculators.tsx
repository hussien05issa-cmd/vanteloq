"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  calculateCashOrderPlan, calculateVehicleHoldingCost, cashOrderPlanCsv, vehicleHoldingCostCsv,
  PLANNING_TOOL_LIMITS, type CashOrderPlanInput, type CashPlanEntry, type PlanningToolError, type VehicleHoldingCostInput,
} from "../../domain/public-planning-tools";

const cashExample: CashOrderPlanInput = {
  asOfDate: "2026-10-11", openingCash: "25000.00", reconciled: true, horizonWeeks: "4",
  minimumBuffer: "5000.00", orderAmount: "9000.00", paymentWeek: "2",
  entries: [
    { id: "sample-1", label: "Expected customer collections", date: "2026-10-13", kind: "receipt", amount: "8000.00" },
    { id: "sample-2", label: "Supplier and payroll payments", date: "2026-10-16", kind: "obligation", amount: "10000.00" },
    { id: "sample-3", label: "Rent and other bills", date: "2026-10-23", kind: "obligation", amount: "15000.00" },
    { id: "sample-4", label: "Expected customer collections", date: "2026-10-27", kind: "receipt", amount: "14000.00" },
    { id: "sample-5", label: "Expected customer collections", date: "2026-11-03", kind: "receipt", amount: "6000.00" },
    { id: "sample-6", label: "Operating payments", date: "2026-11-05", kind: "obligation", amount: "4000.00" },
  ],
};
const vehicleExample: VehicleHoldingCostInput = {
  asOfDate: "2026-10-11", financedBalance: "25000.00", annualRate: "8.5", days: "30",
  dailyStorage: "5.00", dailyOther: "3.00", recordedCosts: "475.00",
};
const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 }).format(cents / 100);
const fieldError = (errors: PlanningToolError[], field: string) => errors.find(error => error.field === field)?.message;

function InputField({ id, label, value, onChange, help, error, type = "text", whole = false, maxLength = 24 }: {
  id: string; label: string; value: string; onChange: (value: string) => void; help: string; error?: string;
  type?: "text" | "date"; whole?: boolean; maxLength?: number;
}) {
  return <div className="tool-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type={type} inputMode={type === "text" ? (whole ? "numeric" : "decimal") : undefined}
      value={value} onChange={event => onChange(event.target.value)} required maxLength={maxLength}
      min={type === "date" ? "1900-01-01" : undefined} max={type === "date" ? "2100-12-31" : undefined}
      autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} />
    <p id={`${id}-help`} className="tool-field-help">{help}</p>
    {error && <p id={`${id}-error`} className="tool-field-error">{error}</p>}
  </div>;
}

function ExampleNotice({ edited, children }: { edited: boolean; children?: ReactNode }) {
  return <div className="tool-example-notice"><strong>{edited ? "Edited manual scenario" : "Fictional example loaded"}</strong>
    <p>{edited ? "Review every input. Unchanged example values may still be present." : "These amounts and dates are invented to demonstrate the calculation. Replace them with your own records and assumptions."} {children}</p>
  </div>;
}

function downloadCsv(contents: string | null, filename: string) {
  if (contents === null) return false;
  const url = URL.createObjectURL(new Blob(["\uFEFF", contents], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export function CashOrderPlanner() {
  const [input, setInput] = useState<CashOrderPlanInput>(cashExample);
  const [edited, setEdited] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  const nextId = useRef(7);
  const { value, errors } = calculateCashOrderPlan(input);
  const change = <K extends keyof CashOrderPlanInput>(key: K, next: CashOrderPlanInput[K]) => {
    setEdited(true); setDownloadStatus("");
    setInput(previous => ({ ...previous, [key]: next, ...(key === "openingCash" || key === "asOfDate" ? { reconciled: false } : {}) }));
  };
  const changeEntry = (index: number, key: keyof CashPlanEntry, next: string) => {
    change("entries", input.entries.map((entry, row) => row === index ? { ...entry, [key]: next } : entry));
  };
  const addEntry = (kind: CashPlanEntry["kind"]) => {
    if (input.entries.length >= PLANNING_TOOL_LIMITS.entries) return;
    change("entries", [...input.entries, { id: `manual-${nextId.current++}`, label: "", date: value?.weeks[0]?.startDate ?? "", kind, amount: "" }]);
  };
  const lowestAt = (week: number) => week ? `at the close of week ${week}` : "at the opening balance";
  return <section className="public-calculator" aria-labelledby="cash-input-title">
    <ExampleNotice edited={edited}>{!edited && "The reconciliation confirmation belongs to this fictional example."}</ExampleNotice>
    <form className="tool-form" onSubmit={event => event.preventDefault()}>
      <fieldset><legend id="cash-input-title">1. Set the cash starting point</legend>
        <InputField id="cash-as-of" label="Opening cash as of date" type="date" value={input.asOfDate} onChange={next => change("asOfDate", next)} help="Use the date through which you have reconciled the opening cash. Week 1 starts the following day." error={fieldError(errors, "asOfDate")} />
        <InputField id="cash-opening" label="Reconciled opening cash (CAD)" value={String(input.openingCash ?? "")} onChange={next => change("openingCash", next)} help="Enter cash from your reconciled records, excluding unused credit limits. Maximum $100,000,000; up to 2 decimal places." error={fieldError(errors, "openingCash")} />
        <div className="tool-checkbox"><input id="cash-reconciled" type="checkbox" checked={input.reconciled} onChange={event => change("reconciled", event.target.checked)} aria-invalid={Boolean(fieldError(errors, "reconciled"))} aria-describedby="cash-reconciled-help" />
          <label htmlFor="cash-reconciled">Opening cash matches reconciled records as of this date</label>
        </div><p id="cash-reconciled-help" className={fieldError(errors, "reconciled") ? "tool-field-error" : "tool-field-help"}>{fieldError(errors, "reconciled") ?? "Changing the opening amount or date clears this confirmation. The tool cannot verify your records."}</p>
        <InputField id="cash-horizon" label="Planning horizon (weeks)" whole value={String(input.horizonWeeks ?? "")} onChange={next => change("horizonWeeks", next)} help="Choose 1 to 13 complete weeks. Every week contains 7 days." error={fieldError(errors, "horizonWeeks")} />
        <InputField id="cash-buffer" label="Minimum cash buffer (CAD)" value={String(input.minimumBuffer ?? "")} onChange={next => change("minimumBuffer", next)} help="Choose your own reserve assumption. This amount is a threshold for comparison, not an additional payment. Maximum $100,000,000." error={fieldError(errors, "minimumBuffer")} />
      </fieldset>
      <fieldset><legend>2. Date your receipts and obligations</legend>
        <p className="tool-section-help">Enter when cash is expected to move. Include existing bills, payroll, taxes, debt payments and purchase commitments once. Do not include the proposed order here.</p>
        {input.entries.map((entry, index) => <fieldset className="tool-cash-row" key={entry.id}><legend>Cash row {index + 1}</legend>
          <div className="tool-field"><label htmlFor={`cash-row-${entry.id}-label`}>Description (optional)</label><input id={`cash-row-${entry.id}-label`} type="text" value={entry.label} maxLength={100} onChange={event => changeEntry(index, "label", event.target.value)} autoComplete="off" /></div>
          <div className="tool-field"><label htmlFor={`cash-row-${entry.id}-kind`}>Cash movement</label><select id={`cash-row-${entry.id}-kind`} value={entry.kind} onChange={event => changeEntry(index, "kind", event.target.value)}><option value="receipt">Receipt, cash coming in</option><option value="obligation">Obligation, cash going out</option></select></div>
          <InputField id={`cash-row-${entry.id}-date`} label="Cash movement date" type="date" value={entry.date} onChange={next => changeEntry(index, "date", next)} help="Use a date after the opening cash date and within the planning horizon." error={fieldError(errors, `entries.${index}.date`)} />
          <InputField id={`cash-row-${entry.id}-amount`} label="Amount (CAD)" value={String(entry.amount ?? "")} onChange={next => changeEntry(index, "amount", next)} help="Enter a nonnegative amount with up to 2 decimal places. Maximum $100,000,000." error={fieldError(errors, `entries.${index}.amount`)} />
          <button type="button" className="tool-button tool-button-subtle" onClick={() => change("entries", input.entries.filter((_, row) => row !== index))} aria-label={`Remove cash row ${index + 1}${entry.label ? `, ${entry.label}` : ""}`}>Remove row {index + 1}</button>
        </fieldset>)}
        {!input.entries.length && <p className="tool-section-help">No receipts or obligations are included. This is an explicit empty scenario; add every relevant cash movement before using it.</p>}
        <div className="tool-actions"><button type="button" className="tool-button" onClick={() => addEntry("receipt")} disabled={input.entries.length >= PLANNING_TOOL_LIMITS.entries}>Add receipt</button><button type="button" className="tool-button" onClick={() => addEntry("obligation")} disabled={input.entries.length >= PLANNING_TOOL_LIMITS.entries}>Add obligation</button></div>
        <p className="tool-field-help">{input.entries.length} of 52 rows used.</p>
      </fieldset>
      <fieldset><legend>3. Compare a proposed order</legend>
        <InputField id="cash-order" label="Proposed order cash payment (CAD)" value={String(input.orderAmount ?? "")} onChange={next => change("orderAmount", next)} help="Include the full cash payment expected in the selected week, including applicable tax, freight or fees. Use 0 to compare a scenario without an order. Maximum $100,000,000." error={fieldError(errors, "orderAmount")} />
        <InputField id="cash-payment-week" label="Order payment week" whole value={String(input.paymentWeek ?? "")} onChange={next => change("paymentWeek", next)} help="Choose a week within the horizon. The model deducts this payment once in that week." error={fieldError(errors, "paymentWeek")} />
      </fieldset>
    </form>
    <section className="tool-results" aria-labelledby="cash-results-title"><h2 id="cash-results-title">Cash scenario comparison</h2>
      {!value ? <p className="tool-validation-status" role="status">Calculation unavailable. Resolve the {errors.length} input {errors.length === 1 ? "issue" : "issues"} shown above. Missing values are never treated as zero.</p> : <>
        <p className="tool-section-help">All amounts are CAD. Lowest balance includes opening cash and each weekly close.</p>
        <div className="tool-comparison"><article><h3>Before the proposed order</h3><span className="tool-result-label">Lowest balance</span><strong>{money(value.baselineLowestCents)}</strong><p>{lowestAt(value.baselineLowestWeek)}.</p><p>Buffer {value.baselineBufferGapCents >= 0 ? "headroom" : "shortfall"}: <b>{money(Math.abs(value.baselineBufferGapCents))}</b></p></article>
          <article><h3>With the proposed order</h3><span className="tool-result-label">Lowest balance</span><strong>{money(value.scenarioLowestCents)}</strong><p>{lowestAt(value.scenarioLowestWeek)}.</p><p>Buffer {value.scenarioBufferGapCents >= 0 ? "headroom" : "shortfall"}: <b>{money(Math.abs(value.scenarioBufferGapCents))}</b></p></article></div>
        <p className="tool-result-status" role="status">{value.scenarioShortfallCents > 0 ? `The entered order scenario falls ${money(value.scenarioShortfallCents)} below your chosen buffer at its lowest point. Review the dates, assumptions and payment terms.` : "The entered order scenario stays at or above your chosen buffer at the opening balance and weekly closes."} This does not establish purchasing authority or guarantee payment coverage.</p>
        <div className="tool-table-scroll" tabIndex={0} role="region" aria-label="Weekly cash comparison, scroll horizontally to see all columns"><table><caption>Weekly balances, as of {value.asOfDate}. Opening cash: {money(value.openingCashCents)}.</caption><thead><tr><th scope="col">Week and dates</th><th scope="col">Receipts</th><th scope="col">Obligations</th><th scope="col">Order payment</th><th scope="col">Close before order</th><th scope="col">Close with order</th></tr></thead><tbody>{value.weeks.map(week => <tr key={week.week}><th scope="row">Week {week.week}<small>{week.startDate} to {week.endDate}</small></th><td>{money(week.receiptsCents)}</td><td>{money(week.obligationsCents)}</td><td>{money(week.orderPaymentCents)}</td><td>{money(week.baselineClosingCents)}</td><td>{money(week.scenarioClosingCents)}</td></tr>)}</tbody></table></div>
      </>}
      <div className="tool-actions"><button type="button" className="tool-button tool-button-primary" disabled={!value} onClick={() => { if (downloadCsv(cashOrderPlanCsv(input), "vanteloq-cash-order-scenario.csv")) setDownloadStatus("Scenario CSV download prepared, including the as of date and calculation method."); }}>Download scenario CSV</button>
        <button type="button" className="tool-button" onClick={() => { downloadCsv(cashOrderPlanCsv(cashExample), "vanteloq-cash-order-fictional-sample.csv"); setDownloadStatus("Fictional sample CSV download prepared."); }}>Download fictional sample CSV</button>
        <button type="button" className="tool-button tool-button-subtle" onClick={() => { setInput(cashExample); setEdited(false); setDownloadStatus(""); }}>Reset fictional example</button></div>
      <p className="tool-download-status" role="status">{downloadStatus}</p>
    </section>
  </section>;
}

export function VehicleHoldingCalculator() {
  const [input, setInput] = useState<VehicleHoldingCostInput>(vehicleExample);
  const [edited, setEdited] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  const { value, errors } = calculateVehicleHoldingCost(input);
  const change = <K extends keyof VehicleHoldingCostInput>(key: K, next: VehicleHoldingCostInput[K]) => { setEdited(true); setDownloadStatus(""); setInput(previous => ({ ...previous, [key]: next })); };
  return <section className="public-calculator" aria-labelledby="holding-input-title">
    <ExampleNotice edited={edited} />
    <form className="tool-form" onSubmit={event => event.preventDefault()}><fieldset><legend id="holding-input-title">Set your vehicle holding assumptions</legend>
      <InputField id="holding-as-of" label="Balance and recorded costs as of date" type="date" value={input.asOfDate} onChange={next => change("asOfDate", next)} help="Use the date for the financed balance and costs already recorded. The estimate covers additional days after this date." error={fieldError(errors, "asOfDate")} />
      <InputField id="holding-financed" label="Outstanding financed balance (CAD)" value={String(input.financedBalance ?? "")} onChange={next => change("financedBalance", next)} help="Enter outstanding financed principal, not the vehicle purchase price or total inventory cost. Use 0 if no balance is financed. Maximum $100,000,000; up to 2 decimal places." error={fieldError(errors, "financedBalance")} />
      <InputField id="holding-rate" label="Annual interest rate (%)" value={String(input.annualRate ?? "")} onChange={next => change("annualRate", next)} help="Use the annual rate you want to model, from 0% to 100%, with up to 4 decimal places. This is not a lender quote or APR calculation." error={fieldError(errors, "annualRate")} />
      <InputField id="holding-days" label="Additional holding days" whole value={String(input.days ?? "")} onChange={next => change("days", next)} help="Enter 0 to 3,650 whole days. The balance and rate are assumed constant throughout." error={fieldError(errors, "days")} />
      <InputField id="holding-storage" label="Daily storage cost (CAD)" value={String(input.dailyStorage ?? "")} onChange={next => change("dailyStorage", next)} help="Enter a daily allocation, or 0 if none applies. Maximum $100,000 per day; up to 2 decimal places." error={fieldError(errors, "dailyStorage")} />
      <InputField id="holding-other" label="Other daily holding costs (CAD)" value={String(input.dailyOther ?? "")} onChange={next => change("dailyOther", next)} help="Include the daily costs you want to model, such as an insurance allocation. Exclude financing and storage already entered. Maximum $100,000 per day." error={fieldError(errors, "dailyOther")} />
      <InputField id="holding-recorded" label="Recorded holding costs to date (CAD)" value={String(input.recordedCosts ?? "")} onChange={next => change("recordedCosts", next)} help="Enter costs already recorded through the as of date. They remain separate from the future estimate. Use 0 only if your records show none. Maximum $100,000,000." error={fieldError(errors, "recordedCosts")} />
    </fieldset></form>
    <section className="tool-results" aria-labelledby="holding-results-title"><h2 id="holding-results-title">Additional holding cost estimate</h2>
      {!value ? <p className="tool-validation-status" role="status">Calculation unavailable. Resolve the {errors.length} input {errors.length === 1 ? "issue" : "issues"} shown above. Missing values are never treated as zero.</p> : <>
        <div className="tool-total"><span className="tool-result-label">Estimated additional cost for {value.days} {value.days === 1 ? "day" : "days"}</span><strong>{money(value.estimatedAdditionalCents)}</strong><p role="status">For {value.days} additional days after {value.asOfDate}, ending {value.endDate}. This is a scenario estimate in CAD.</p></div>
        <dl className="tool-cost-breakdown"><div><dt>Estimated financing</dt><dd>{money(value.financingCents)}</dd></div><div><dt>Estimated storage and other daily costs</dt><dd>{money(value.dailyCostCents)}</dd></div><div className="tool-recorded-cost"><dt>Recorded holding costs as of {value.asOfDate}<small>Historical input, excluded from the additional estimate above</small></dt><dd>{money(value.recordedCostsCents)}</dd></div></dl>
        <div className="tool-worked-formula"><h3>Your calculation</h3><p>Financing: {money(value.financedBalanceCents)} × ({value.annualRate} ÷ 100) × {value.days} ÷ 365 = <b>{money(value.financingCents)}</b></p><p>Daily costs: ({money(value.dailyStorageCents)} + {money(value.dailyOtherCents)}) × {value.days} = <b>{money(value.dailyCostCents)}</b></p><p>Additional estimate: {money(value.financingCents)} + {money(value.dailyCostCents)} = <b>{money(value.estimatedAdditionalCents)}</b></p></div>
      </>}
      <div className="tool-actions"><button type="button" className="tool-button tool-button-primary" disabled={!value} onClick={() => { if (downloadCsv(vehicleHoldingCostCsv(input), "vanteloq-vehicle-holding-scenario.csv")) setDownloadStatus("Scenario CSV download prepared, including the as of date and formulas."); }}>Download scenario CSV</button>
        <button type="button" className="tool-button" onClick={() => { downloadCsv(vehicleHoldingCostCsv(vehicleExample), "vanteloq-vehicle-holding-fictional-sample.csv"); setDownloadStatus("Fictional sample CSV download prepared."); }}>Download fictional sample CSV</button>
        <button type="button" className="tool-button tool-button-subtle" onClick={() => { setInput(vehicleExample); setEdited(false); setDownloadStatus(""); }}>Reset fictional example</button></div><p className="tool-download-status" role="status">{downloadStatus}</p>
    </section>
  </section>;
}
