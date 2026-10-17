"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  buildOnboardingFirstInsight, ONBOARDING_CSV_HEADERS, ONBOARDING_CSV_MAX_BYTES,
  parseOnboardingSourceCsv, onboardingPreviewCurrencyIssue,
  type OnboardingFirstInsight, type OnboardingInsightSession, type OnboardingSourcePreview,
} from "../domain/onboarding-first-insight";
import "./onboarding-first-insight.css";

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const locationName = (reference: string) => reference === "all" ? "All locations (source summary)" : reference;

export function OnboardingInsightResult({ source, insight, locationRef }: {
  source: OnboardingSourcePreview; insight: OnboardingFirstInsight; locationRef: string;
}) {
  const id = useId(), format = (cents: number) => money(cents, source.currency);
  const currencyIssue = onboardingPreviewCurrencyIssue(source.currency);
  if (currencyIssue) return <article className="onboarding-insight-result" aria-labelledby={`${id}-title`}><h4 id={`${id}-title`}>CSV preview unavailable for this currency</h4><p>{currencyIssue}</p></article>;
  const comparison = insight.kind === "comparison" ? insight : null;
  const title = comparison
    ? comparison.changeCents < 0 ? `Recorded net sales fell by ${format(Math.abs(comparison.changeCents))}` : comparison.changeCents > 0 ? `Recorded net sales rose by ${format(comparison.changeCents)}` : "Recorded net sales were unchanged across these periods"
    : insight.kind === "discounts" ? `Your file records ${format(insight.discountsCents)} in discounts`
    : insight.kind === "incomplete_day" ? "Your file includes an unfinished or future business date"
    : insight.kind === "recorded_sales" ? `Your file records ${format(insight.netSalesCents)} in net sales` : "Review your source records";
  return <article className="onboarding-insight-result" aria-labelledby={`${id}-title`}>
    <p className="onboarding-insight-kicker">YOUR RECORDS · LOCAL CSV PREVIEW</p>
    <h4 id={`${id}-title`}>{title}</h4>
    <p>{locationName(locationRef)} · {insight.from} to {insight.to}</p>
    {comparison && <>
      <dl className="onboarding-insight-values"><div><dt>{comparison.from} to {comparison.to}</dt><dd>{format(comparison.currentCents)}</dd></div><div><dt>{comparison.previousFrom} to {comparison.previousTo}</dt><dd>{format(comparison.previousCents)}</dd></div></dl>
      <p>{comparison.changePercent === null ? "Percentage change is unavailable because the prior total is zero or negative." : `${Math.abs(comparison.changePercent).toFixed(1)}% ${comparison.changeCents < 0 ? "lower" : comparison.changeCents > 0 ? "higher" : "change"} than the previous seven days.`} Both periods contain all seven supplied business dates.</p>
      <p><strong>Start your review with {comparison.largestDay.currentDate}.</strong> Recorded net sales were {format(comparison.largestDay.currentCents)}, compared with {format(comparison.largestDay.previousCents)} on {comparison.largestDay.previousDate}. Check the underlying sales before changing hours, promotions or orders.</p>
      <p className="onboarding-insight-definition">Calculation: sum of net_sales for the newest seven completed dates minus the preceding seven dates, for the same location. The file identifies daily movement; it does not establish its cause.</p>
    </>}
    {insight.kind === "discounts" && <>
      <p>{insight.discountRate === null ? "A discount rate is unavailable because recorded gross sales are zero." : `Recorded discounts equal ${insight.discountRate.toFixed(1)}% of ${format(insight.grossSalesCents)} in gross sales.`} Discount amounts are supplied for every date shown.</p>
      <p><strong>Review the promotion settings behind these discounts.</strong> Confirm that they match the offers you intended before changing prices.</p>
      <p className="onboarding-insight-definition">Calculation: sum of supplied discounts. Rate: supplied discounts ÷ supplied gross_sales × 100. This is recorded discount activity, not a profit or lost-sales estimate.</p>
    </>}
    {insight.kind === "recorded_sales" && <>
      <p><strong>Start by checking this total against the original report.</strong> Discount values are supplied on {insight.discountsCovered} of {insight.completeDays} dates, so a complete discount finding is unavailable.</p>
      <p className="onboarding-insight-definition">Calculation: sum of supplied net_sales for this location and the completed business dates shown. Each missing date remains missing.</p>
    </>}
    {insight.kind === "incomplete_day" && <>
      <p>The file records {format(insight.netSalesCents)} in net sales for these dates. Current and future business dates are excluded from completed-period comparisons.</p>
      <p><strong>Choose an export covering completed business dates</strong> to receive a dated discount finding or a fully covered sales comparison.</p>
    </>}
    {insight.missingComparisonDates.length > 0 && <details className="onboarding-insight-coverage"><summary>Sales comparison needs {insight.missingComparisonDates.length} more business dates</summary><p>Missing dates in the two seven-day periods ending {insight.to}: {insight.missingComparisonDates.join(", ")}. A confirmed zero-sales day must have an explicit row containing zero.</p></details>}
    {insight.excludedCurrentOrFutureRows > 0 && insight.kind !== "incomplete_day" && <p className="onboarding-insight-definition">{insight.excludedCurrentOrFutureRows} current or future daily record{insight.excludedCurrentOrFutureRows === 1 ? " is" : "s are"} excluded from this finding.</p>}
    <details className="onboarding-insight-evidence"><summary>Show the records ({insight.records.length})</summary>
      <p>Source: {source.fileName}. CSV row numbers include the header and any blank lines. Dates are supplied business dates in {source.timeZone}; amounts use {source.currency}. Net sales are taken from net_sales without subtracting refunds or discounts a second time.</p>
      <div className="onboarding-insight-table" role="region" aria-label="Contributing CSV records" tabIndex={0}><table>
        <caption>Exact daily records contributing to this finding, {locationName(locationRef)}</caption>
        <thead><tr><th scope="col">CSV row</th><th scope="col">Business date</th><th scope="col">Net sales</th><th scope="col">Gross sales</th><th scope="col">Discounts</th><th scope="col">Refunds</th><th scope="col">COGS</th><th scope="col">Transactions</th><th scope="col">Units</th></tr></thead>
        <tbody>{insight.records.map(row => <tr key={row.sourceLine}><th scope="row">{row.sourceLine}</th><td>{row.businessDate}</td><td>{format(row.netSalesCents)}</td><td>{format(row.grossSalesCents)}</td><td>{row.discountsReported ? format(row.discountsCents) : "Not supplied"}</td><td>{row.refundsReported ? format(row.refundsCents) : "Not supplied"}</td><td>{format(row.costOfGoodsCents)}</td><td>{row.transactionCount}</td><td>{row.unitsSold}</td></tr>)}</tbody>
      </table></div>
    </details>
    <p className="onboarding-insight-privacy">This preview has not created financial records. After setup, review the same CSV in Reports before importing it into your workspace.</p>
  </article>;
}

export default function OnboardingFirstInsight({ currency, timeZone, maxRows, value, onChange, disabled = false }: {
  currency: string; timeZone: string; maxRows: number; value: OnboardingInsightSession | null;
  onChange: (next: OnboardingInsightSession | null) => void; disabled?: boolean;
}) {
  const id = useId(), inputRef = useRef<HTMLInputElement>(null), readGeneration = useRef(0);
  const [reading, setReading] = useState(false), [error, setError] = useState("");
  useEffect(() => () => { readGeneration.current++; }, []);
  const currencyIssue = onboardingPreviewCurrencyIssue(currency);
  const sameReporting = !currencyIssue && value?.source.currency === currency && value?.source.timeZone === timeZone && value.source.records.length <= maxRows;
  let insight: OnboardingFirstInsight | null = null, calculationError = "";
  if (value?.reportingConfirmed && sameReporting) {
    try { insight = buildOnboardingFirstInsight(value.source, value.locationRef); }
    catch (caught) { calculationError = caught instanceof Error ? caught.message : "The finding could not be calculated. Review the source file."; }
  }
  async function chooseFile(file: File | undefined) {
    const generation = ++readGeneration.current;
    setError(""); onChange(null);
    if (!file) { setReading(false); return; }
    setReading(true);
    try {
      if (file.size > ONBOARDING_CSV_MAX_BYTES) throw new Error("Choose a CSV no larger than 256 KiB.");
      const text = await file.text();
      if (generation !== readGeneration.current) return;
      const source = parseOnboardingSourceCsv(text, { fileName: file.name, currency, timeZone, maxRows });
      onChange({ source, locationRef: source.records[0].locationRef, reportingConfirmed: false });
    } catch (caught) {
      if (generation === readGeneration.current) setError(caught instanceof Error ? caught.message : "The CSV could not be read. Select it again. No rows were imported.");
    } finally { if (generation === readGeneration.current) setReading(false); }
  }
  const locations = value ? [...new Set(value.source.records.map(row => row.locationRef))] : [];
  return <section className="onboarding-first-insight" aria-labelledby={`${id}-heading`} aria-busy={reading}>
    <h3 id={`${id}-heading`}>See an insight from your own records</h3>
    <p>Choose a daily-summary sales CSV for an optional preview before you finish setup. Your file is read in this browser session. It is not uploaded or sent to AI.</p>
    {currencyIssue && <p id={`${id}-currency-issue`} className="onboarding-insight-error" role="status">{currencyIssue}</p>}
    <label className="onboarding-insight-file" htmlFor={`${id}-file`}>Daily-summary CSV <span>(Optional)</span>
      <input ref={inputRef} id={`${id}-file`} type="file" accept=".csv,text/csv" disabled={disabled || reading || Boolean(currencyIssue)} onChange={event => void chooseFile(event.target.files?.[0])} aria-invalid={Boolean(error)} aria-describedby={`${id}-file-hint${error ? ` ${id}-file-error` : ""}${currencyIssue ? ` ${id}-currency-issue` : ""}`}/>
    </label>
    <p id={`${id}-file-hint`} className="onboarding-insight-hint">Maximum {maxRows} supported daily records and 256 KiB. Use one record per business date and location. No sample amounts are added.</p>
    <details className="onboarding-insight-format"><summary>Required CSV format</summary><p>Start with the header below. Required columns are business_date (YYYY-MM-DD), gross_sales, net_sales, cogs, transactions and units. Money is in currency units with up to two decimal places. Transactions and units are whole numbers. Use zero only for a recorded zero.</p><code>{ONBOARDING_CSV_HEADERS}</code><p>Location, discounts, refunds and currency are optional. Missing discounts and refunds remain visibly unavailable. A currency column, when supplied, must match {currency} on every row. This preview requires the Vanteloq daily-summary format; a provider export may need its columns prepared first.</p></details>
    {reading && <p role="status">Checking the selected file in your browser…</p>}
    {error && <p id={`${id}-file-error`} className="onboarding-insight-error" role="alert">Daily-summary CSV: {error}</p>}
    {value && <>
      <p className="onboarding-insight-checked" role="status">{value.source.fileName}: {value.source.records.length} daily record{value.source.records.length === 1 ? "" : "s"} checked. No rows imported.</p>
      {locations.length > 1 && <label className="onboarding-insight-location" htmlFor={`${id}-location`}>Location to review<select id={`${id}-location`} value={value.locationRef} disabled={disabled} onChange={event => onChange({ ...value, locationRef: event.target.value })}>{locations.map(reference => <option key={reference} value={reference}>{locationName(reference)}</option>)}</select><span>Each location is reviewed separately. All-location summaries are never added to individual locations.</span></label>}
      {!sameReporting && !currencyIssue && <p className="onboarding-insight-error" role="alert">Your reporting settings or available record limit changed. Reselect the file to check up to {maxRows} records using {currency} and {timeZone}.</p>}
      <label className="onboarding-insight-confirm" htmlFor={`${id}-confirm`}><input id={`${id}-confirm`} type="checkbox" checked={Boolean(value.reportingConfirmed && sameReporting)} disabled={disabled || !sameReporting} onChange={event => onChange({ ...value, reportingConfirmed: event.target.checked })}/><span>I confirm the source amounts use {currency}, business_date follows my reporting dates in {timeZone}, and earlier dates contain complete daily summaries for their locations. <small>Dates are used as supplied, without timezone conversion. Only completed dates can enter a period comparison.</small></span></label>
      {calculationError && <p className="onboarding-insight-error" role="alert">{calculationError}</p>}
      {insight && <OnboardingInsightResult source={value.source} insight={insight} locationRef={value.locationRef}/>}
      <button type="button" className="onboarding-insight-remove" disabled={disabled || reading} onClick={() => { readGeneration.current++; onChange(null); setError(""); if (inputRef.current) inputRef.current.value = ""; }}>Remove selected file</button>
    </>}
    <p className="onboarding-insight-privacy">The preview remains available while you move through this setup session. Save progress saves your setup choices for 48 hours; reselect your CSV when you resume after leaving this page.</p>
  </section>;
}
