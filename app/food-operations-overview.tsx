"use client";
import { useId, useState } from "react";
import { FOOD_REVIEW_DATE_MAX, FOOD_REVIEW_DATE_MIN, FOOD_REVIEW_KINDS, foodOperationalReview, foodReviewDateRangeError, foodReviewToday } from "../domain/food-analytics";
import { sectorReport, type SectorKind, type SectorRecord } from "../domain/sector-operations";
import "./food-operations-overview.css";

type Props = {
  records: readonly SectorRecord[]; kinds: readonly SectorKind[]; partial: boolean;
  location: { id: string; name: string; currency: string; timezone: string };
  recipes: readonly { id: string; label: string }[]; onOpen: (record: SectorRecord) => void;
};
const quantity = (value: number | null) => value === null ? "Not available" : new Intl.NumberFormat("en-CA", { maximumFractionDigits: 3 }).format(value / 1000);
const integer = (value: number | null) => value === null ? "Not available" : new Intl.NumberFormat("en-CA").format(value);
const percent = (value: number | null) => value === null ? "Not available" : `${(value / 100).toFixed(1)}%`;
const money = (value: number | null, currency: string) => {
  if (value === null) return "Not available";
  const format = new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" });
  return format.format(value / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
};
export default function FoodOperationsOverview(props: Props) {
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [clockError, setClockError] = useState("");
  function today() {
    const date = foodReviewToday(props.location.timezone, new Date());
    if (!date) { setClockError("The location's business date could not be determined."); return; }
    setClockError(""); setFrom(date); setTo(date);
  }
  return <FoodOperationsReviewView {...props} from={from} to={to} clockError={clockError} onFromChange={setFrom} onToChange={setTo} onToday={today} onClear={() => { setFrom(""); setTo(""); setClockError(""); }}/>;
}
type ReviewViewProps = Props & { from: string; to: string; clockError?: string; onFromChange: (date: string) => void; onToChange: (date: string) => void; onToday: () => void; onClear: () => void };
export function FoodOperationsReviewView({ records, kinds, partial, location, recipes, onOpen, from, to, clockError, onFromChange, onToChange, onToday, onClear }: ReviewViewProps) {
  const dateErrorId = useId();
  if (!kinds.some(kind => FOOD_REVIEW_KINDS.includes(kind))) return null;
  const dateError = foodReviewDateRangeError({ from, to });
  const review = dateError ? null : foodOperationalReview(records, { locationId: location.id, from, to });
  const selectedKind = (kind: SectorKind) => kinds.includes(kind);
  return <section className="food-operations-review" aria-label="Prep and service review">
    <header><div><h3>Prep and service review</h3><p>{location.name} · {location.timezone}. Reviewed operational records in the selected workflow view.</p></div></header>
    <div className="food-review-controls"><label>Review from<input type="date" min={FOOD_REVIEW_DATE_MIN} max={FOOD_REVIEW_DATE_MAX} value={from} aria-invalid={Boolean(dateError)} aria-describedby={dateError ? dateErrorId : undefined} onChange={event => onFromChange(event.target.value)}/></label><label>Review through<input type="date" min={FOOD_REVIEW_DATE_MIN} max={FOOD_REVIEW_DATE_MAX} value={to} aria-invalid={Boolean(dateError)} aria-describedby={dateError ? dateErrorId : undefined} onChange={event => onToChange(event.target.value)}/></label><button type="button" onClick={onToday}>Location today</button><button type="button" onClick={onClear}>All source dates</button></div>
    {clockError && <p role="alert">{clockError}</p>}
    {dateError && <p id={dateErrorId} role="alert">{dateError}</p>}
    {partial && <p className="food-review-limited" role="status">Partial view. More saved records are available. Load the remaining records below before using this review as a location total.</p>}
    {review && <>
      <p className="sector-note">{review.records.length} reviewed records in this date range. {review.excludedStates} draft or cancelled records excluded.{review.undated > 0 ? ` ${review.undated} reviewed records have no valid activity date and are excluded.` : ""}</p>
      {selectedKind("prep_batch") && <section aria-label="Batch yield and waste"><h4>Batch yield and waste</h4><p className="sector-note">By preparation date and recipe. Unusable portions ÷ prepared portions measures production loss. Usable output is the batch result, not current stock or unsold waste. Ingredient cost per usable portion divides the aggregate recorded ingredient cost by its usable output, rounded once to the currency minor unit. It excludes labour, packaging and other unprovided costs.</p>{review.batches.length ? <div className="food-review-table" tabIndex={0} role="region" aria-label="Scrollable source comparison"><table><thead><tr><th>Recipe</th><th>Reviewed batches</th><th>Prepared portions</th><th>Usable portions</th><th>Unusable portions</th><th>Production loss</th><th>Ingredient cost</th><th>Ingredient cost per usable portion</th></tr></thead><tbody>{review.batches.map((group, index) => <tr key={`${group.recipeId}:${group.currency}:${index}`}><th scope="row">{recipes.find(recipe => recipe.id === group.recipeId)?.label ?? group.records[0].title}<details><summary>Source batches</summary>{group.records.map(record => <button key={record.id} type="button" onClick={() => onOpen(record)}>{record.title} · {String(record.values.preparedDate)}</button>)}</details></th><td>{group.records.length}<small>{group.completeBatches} with quantity coverage</small></td><td>{quantity(group.preparedMilli)}</td><td>{quantity(group.usableMilli)}</td><td>{quantity(group.unusableMilli)}</td><td>{percent(group.wasteBasisPoints)}</td><td>{money(group.ingredientCost, group.currency)}</td><td>{money(group.ingredientCostPerUsablePortion, group.currency)}</td></tr>)}</tbody></table></div> : <p>No reviewed production batches match these dates.</p>}</section>}
      {selectedKind("service_period") && <section aria-label="Service-period comparison"><h4>Service-period comparison</h4><p className="sector-note">By recorded business date. Compare each source period separately because service windows may overlap. Rates need confirmed sales, time and cost coverage. Variance is actual minus plan. Review paid time alongside demand and service quality.</p>{review.services.length ? <div className="food-review-table" tabIndex={0} role="region" aria-label="Scrollable source comparison"><table><thead><tr><th>Service period</th><th>Sales versus plan</th><th>Paid minutes versus plan</th><th>Completed orders</th><th>Late order rate</th><th>Labour / net sales</th><th>Sales per paid hour</th></tr></thead><tbody>{review.services.map(record => {
        const report = sectorReport(record), metric = (label: string) => report.metrics.find(row => row.label === label)?.value ?? null;
        return <tr key={record.id}><th scope="row"><button type="button" onClick={() => onOpen(record)}>{String(record.values.daypart ?? record.title)}</button><small>{String(record.values.serviceDate)} · {record.source}</small></th><td>{money(metric("Sales versus plan"), record.currency)}</td><td>{integer(metric("Paid minutes versus plan"))}</td><td>{record.values.orders == null ? "Not available" : String(record.values.orders)}{record.values.coverageComplete !== true && <small>Coverage not confirmed</small>}</td><td>{percent(metric("Late order rate"))}<small>Late ÷ completed orders</small></td><td>{percent(metric("Labour cost / net sales"))}</td><td>{money(metric("Sales per paid hour"), record.currency)}</td></tr>;
      })}</tbody></table></div> : <p>No reviewed service periods match these dates.</p>}</section>}
      {selectedKind("delivery_order") && <section aria-label="Delivery contribution review"><h4>Delivery contribution review</h4><p className="sector-note">By source as-of date, which may differ from order or payout date. Contribution deducts recorded platform fees, other withheld amounts, food, packaging and attributable labour from net food sales. It is not net profit.</p>{review.deliveries.length ? <div className="food-review-table" tabIndex={0} role="region" aria-label="Scrollable source comparison"><table><thead><tr><th>Provider</th><th>Reviewed orders</th><th>Net food sales</th><th>Contribution</th><th>Contribution / sales</th><th>Settlement review</th></tr></thead><tbody>{review.deliveries.map(group => <tr key={`${group.provider}:${group.currency}`}><th scope="row">{group.provider}<details><summary>Source orders</summary>{group.records.map(record => <button key={record.id} type="button" onClick={() => onOpen(record)}>{String(record.values.orderRef ?? record.title)} · {record.sourceDate}</button>)}</details></th><td>{group.records.length}<small>{group.costCompleteOrders} with cost coverage</small></td><td>{money(group.netSales, group.currency)}</td><td>{money(group.contribution, group.currency)}</td><td>{percent(group.contributionBasisPoints)}</td><td>{group.unresolvedSettlements} unresolved<small>{group.unknownSettlements} awaiting evidence</small></td></tr>)}</tbody></table></div> : <p>No reviewed delivery orders match these source dates.</p>}</section>}
    </>}
    <details className="food-review-boundary"><summary>Measurements that need additional records</summary><p>Kitchen queue length, station preparation time and restaurant occupancy need order events, station timestamps, seats and table status. Production loss does not include later spoilage or remakes. These saved reviews do not provide that evidence.</p></details>
  </section>;
}
