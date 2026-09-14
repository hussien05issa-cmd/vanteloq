"use client";
import Link from "next/link";
import { useState } from "react";
import { PLANS, ADDONS } from "../server/entitlements/catalog";
import { planSelectionUrl } from "../shared/plan-selection";
export default function PublicPlanCards({ compact = false }: { compact?: boolean }) {
  const [bookloq, setBookloq] = useState(false);
  return <><label className="public-addon-choice"><input type="checkbox" checked={bookloq} onChange={event => setBookloq(event.target.checked)}/><span>Add BookLoQ accounting and cash planning <strong>+$39 CAD / month</strong></span></label>
  <div className="public-price-grid">{Object.values(PLANS).map(plan => <article key={plan.key} id={compact ? undefined : "plan-" + plan.key} className={plan.key === "growth" ? "plan-growth" : ""}>
    <span className="plan-audience">{plan.key === "starter" ? "For one location" : plan.key === "growth" ? "For a growing team" : "For a larger operation"}</span><h3>{plan.displayName}</h3>
    <strong>${(plan.prices.month.amountCents + (bookloq ? ADDONS.bookloq.prices.month.amountCents : 0)) / 100}<small> CAD / month</small></strong>
    <p>{plan.key === "starter" ? "Understand daily sales and margins." : plan.key === "growth" ? "Bring inventory and a growing team into the picture." : "Compare a larger operation with advanced reporting."}</p>
    <ul><li>Up to {plan.limits.activeLocations} active {plan.limits.activeLocations === 1 ? "location" : "locations"} · {plan.limits.users} team members</li><li>{plan.key === "starter" ? "Sales, margin and Vanteloq AI" : plan.key === "growth" ? "Expiry, stock velocity and supplier analytics" : "Advanced location comparisons and exports"}</li>{bookloq && <li>BookLoQ included in this total</li>}</ul>
    <Link data-public-event="plan_selected" href={planSelectionUrl({plan:plan.key,bookloq})}>Choose {plan.displayName} →</Link>
  </article>)}</div><p className="pricing-tax-note">Monthly billing. Taxes and final total are shown before payment. {bookloq ? "Displayed prices include BookLoQ." : "BookLoQ is optional."} <Link href="/pricing">Compare every plan feature →</Link></p></>;
}
