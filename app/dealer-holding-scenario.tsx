"use client";
import { useState, type FormEvent } from "react";
import { dealerHoldingEligibility, dealerHoldingScenario, dealerScenarioAmount, dealerScenarioDays, type DealerHoldingResult, type DealerScenarioPermissions, type DealerScenarioStock } from "../domain/dealer-holding-scenario";
import { FormInput, FieldLabel } from "./form-primitives";

type Props = { stock: DealerScenarioStock & { stockNumber: string; askingCents: number | null }; permissions: DealerScenarioPermissions; disabled?: boolean };
const money = (value: number | null, currency: string) => value === null ? "Not available" : new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" }).format(value / 100);
const boundary = "Future price, waiting time and daily cost are owner assumptions. These figures exclude unprovided costs and are not realized gross or net profit. This comparison does not record a sale or change stock.";

export function DealerHoldingResults({ result, currency }: { result: DealerHoldingResult; currency: string }) {
  if (!result.available) return null;
  return <section className="dl-holding-results" aria-label="Offer and waiting scenario" aria-live="polite"><h4>Scenario estimate before unprovided costs</h4><dl className="dl-facts">
    <div><dt>Offer today less posted cost</dt><dd>{money(result.offerContributionCents, currency)}</dd></div>
    <div><dt>Additional holding-cost assumption</dt><dd>{money(result.holdingCostCents, currency)}</dd></div>
    <div><dt>Future amount less posted and additional holding costs</dt><dd>{money(result.futureContributionCents, currency)}</dd></div>
    <div><dt>Future scenario minus offer-today scenario</dt><dd>{money(result.differenceCents, currency)}</dd></div>
    <div><dt>Future vehicle amount to match the offer-today scenario</dt><dd>{money(result.futurePriceToMatchCents, currency)}</dd></div>
  </dl><p className="dl-hint">The matching amount assumes all other costs and terms are equal. Review preparation, availability and any additional selling costs before deciding.</p></section>;
}

export default function DealerHoldingScenario({ stock, permissions, disabled = false }: Props) {
  const [offer, setOffer] = useState(""), [future, setFuture] = useState(""), [daily, setDaily] = useState(""), [days, setDays] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<DealerHoldingResult | null>(null), [error, setError] = useState("");
  if (!permissions.costs || !permissions.profit) return null;
  const eligibility = dealerHoldingEligibility(stock, permissions);
  const change = (set: (value: string) => void, value: string) => { set(value); setResult(null); setError(""); };
  function calculate(event: FormEvent) {
    event.preventDefault(); setResult(null); setError("");
    try {
      const next = dealerHoldingScenario(stock, permissions, { offerNowCents: dealerScenarioAmount(offer), futurePriceCents: dealerScenarioAmount(future), dailyHoldingCents: dealerScenarioAmount(daily), waitingDays: dealerScenarioDays(days), additionalCostConfirmed: confirmed });
      if (!next.available) { setError(next.reason ?? "Review these assumptions."); return; }
      setResult(next);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review the scenario inputs."); }
  }
  return <details className="dl-holding-scenario"><summary>Compare an offer with additional waiting</summary>
    <p className="dl-hint">One scenario for stock {stock.stockNumber}. {boundary}</p>
    {eligibility ? <p className="dl-notice">{eligibility}</p> : <>
      <p className="dl-hint">Reviewed complete posted cost: <strong>{money(stock.postedCostCents, stock.currency)}</strong>. The same cost is used in both scenarios.</p>
      <form onSubmit={calculate}><fieldset disabled={disabled}><legend>Review your assumptions</legend>
        <label><FieldLabel>Offer amount today to compare ({stock.currency})</FieldLabel><FormInput required inputMode="decimal" value={offer} maxLength={20} hint="Vehicle amount before tax. Enter 0 only for a reviewed zero." onChange={event => change(setOffer, event.target.value)}/></label>
        <label><FieldLabel>Assumed future vehicle sale amount ({stock.currency})</FieldLabel><FormInput required inputMode="decimal" value={future} maxLength={20} hint={stock.askingCents === null ? "No asking amount is recorded. Enter an explicit future-price assumption." : `Current asking reference: ${money(stock.askingCents, stock.currency)}. An asking amount is not a confirmed offer.`} onChange={event => change(setFuture, event.target.value)}/></label>
        <label><FieldLabel>Additional daily holding cost ({stock.currency})</FieldLabel><FormInput required inputMode="decimal" value={daily} maxLength={20} hint="Use a supported forward daily amount. Exclude every cost already in the posted-cost total. Unknown stays blank." onChange={event => change(setDaily, event.target.value)}/></label>
        <label><FieldLabel>Assumed additional waiting days</FieldLabel><FormInput required inputMode="numeric" value={days} maxLength={3} hint="Whole calendar days from 0 through 730. This is additional waiting from now." onChange={event => change(setDays, event.target.value)}/></label>
        <label className="dl-check"><input type="checkbox" required checked={confirmed} onChange={event => { setConfirmed(event.target.checked); setResult(null); setError(""); }}/><span>I reviewed the daily cost and excluded costs already in the posted-cost total.</span></label>
        <button type="submit">Compare assumptions</button>
      </fieldset></form>
      {error && <p className="dl-error" role="alert">{error}</p>}
      {result && <DealerHoldingResults result={result} currency={stock.currency}/>}
    </>}
  </details>;
}
