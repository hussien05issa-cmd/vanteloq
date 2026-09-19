"use client";
import Link from "next/link";
import { useState } from "react";
import { PLANS, ADDONS } from "../server/entitlements/catalog";
import { planSelectionUrl } from "../shared/plan-selection";
const vanteloqPlans = [PLANS.starter, PLANS.growth, PLANS.pro] as const;

export default function PublicPlanCards({ compact = false, showStandalone = true }: { compact?: boolean; showStandalone?: boolean }) {
  const [bookloq, setBookloq] = useState(false);
  return <><label className="public-addon-choice"><input type="checkbox" checked={bookloq} onChange={event => setBookloq(event.target.checked)}/><span>Add BookLoQ accounting and cash planning <strong>+$39 CAD / month</strong></span></label>
  <div className="public-price-grid">{vanteloqPlans.map(plan => <article key={plan.key} id={compact ? undefined : "plan-" + plan.key} className={plan.key === "growth" ? "plan-growth" : ""}>
    <span className="plan-audience">{plan.key === "starter" ? "For one location" : plan.key === "growth" ? "For a growing team" : "For a larger operation"}</span><h3>{plan.displayName}</h3>
    <strong>${(plan.prices.month.amountCents + (bookloq ? ADDONS.bookloq.prices.month.amountCents : 0)) / 100}<small> CAD / month</small></strong>
    <p>{plan.key === "starter" ? "Understand daily sales and margins." : plan.key === "growth" ? "Bring inventory and a growing team into the picture." : "Compare a larger operation with advanced reporting."}</p>
    <ul><li>Up to {plan.limits.activeLocations} active {plan.limits.activeLocations === 1 ? "location" : "locations"} · {plan.limits.users} team members</li><li>{plan.key === "starter" ? "Sales, margin and Vanteloq AI" : plan.key === "growth" ? "Expiry, stock velocity and supplier analytics" : "Advanced location comparisons and exports"}</li>{bookloq && <li>BookLoQ included in this total</li>}</ul>
    <Link data-public-event="plan_selected" href={planSelectionUrl({plan:plan.key,bookloq})}>Choose {plan.displayName} →</Link>
  </article>)}</div><p className="pricing-tax-note">Monthly billing. Taxes and final total are shown before payment. {bookloq ? "Displayed prices include BookLoQ as the $39 CAD add-on." : "BookLoQ is available for $39 CAD with a Vanteloq plan or $59 CAD on its own."} <Link href="/pricing">Compare every plan feature →</Link></p>
  {showStandalone && <article className="public-bookloq-standalone" id={compact ? undefined : "plan-bookloq"}>
    <div><span className="plan-audience">BOOKLOQ ON ITS OWN</span><h3>Financial review without a Vanteloq plan</h3><p>Use BookLoQ as a secured finance workspace for source documents, invoices, evidence matching, reviewed books and 13-week cash planning.</p><ul><li>Up to {PLANS.bookloq.limits.activeLocations} active location and {PLANS.bookloq.limits.users} team members</li><li>Vanteloq AI can explain permitted BookLoQ summaries, but it cannot post, pay or approve decisions</li></ul></div>
    <aside><strong>${PLANS.bookloq.prices.month.amountCents / 100}<small> CAD / month</small></strong><Link data-public-event="plan_selected" href={planSelectionUrl({plan:"bookloq",bookloq:false})}>Choose BookLoQ →</Link><small>BookLoQ is $39 CAD/month when added to a Vanteloq plan because it shares that workspace and source infrastructure.</small></aside>
  </article>}
  </>;
}
