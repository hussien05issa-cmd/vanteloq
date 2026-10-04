"use client";
import "./billing.css";
import Link from "next/link";
import {PLAN_HIGHLIGHTS} from "../server/entitlements/presentation";
import { useState } from "react";
import { PLANS, ADDONS, FREE_PLAN } from "../server/entitlements/catalog";
import { planSelectionUrl } from "../shared/plan-selection";
const vanteloqPlans = [PLANS.starter, PLANS.growth, PLANS.pro] as const;

export default function PublicPlanCards({ compact = false, showStandalone = true }: { compact?: boolean; showStandalone?: boolean }) {
  const [bookloq, setBookloq] = useState(false);
  return <><article className="free-plan-card public-free-plan" id={compact ? undefined : "plan-free"}><div><span className="plan-audience">FREE · NO EXPIRY</span><h3>Start with Free</h3><p>Use your own records. No card required.</p><ul>{FREE_PLAN.highlights.map(line => <li key={line}>{line}</li>)}</ul></div><aside><strong>$0<small> CAD</small></strong><a data-public-event="plan_selected" href={planSelectionUrl({plan:"free",bookloq:false})}>Start Free</a><small>Upgrade in Settings whenever you need more.</small></aside></article><div className="public-trial-notice"><strong>Paid plans start with a 7-day trial.</strong><p>Available on your workspace’s first subscription. Payment method required. Your selected plan renews monthly after the trial unless you cancel in Manage Billing before the first charge date shown at checkout.</p></div><label className="public-addon-choice"><input type="checkbox" checked={bookloq} onChange={event => setBookloq(event.target.checked)}/><span>Add BookLoQ accounting and cash planning <strong>+${ADDONS.bookloq.prices.month.amountCents/100} CAD / month</strong></span></label>
  <div className="public-price-grid">{vanteloqPlans.map(plan => <article key={plan.key} id={compact ? undefined : "plan-" + plan.key} className={plan.key === "growth" ? "plan-growth" : ""}>
    <span className="plan-audience">{plan.key === "starter" ? "For one location" : plan.key === "growth" ? "For a growing team" : "For a larger operation"}</span><h3>{plan.displayName}</h3>
    <strong>${(plan.prices.month.amountCents + (bookloq ? ADDONS.bookloq.prices.month.amountCents : 0)) / 100}<small> CAD / month</small></strong>
    <p>{plan.key === "starter" ? "Understand daily sales and margins." : plan.key === "growth" ? "Bring inventory and a growing team into the picture." : "Compare a larger operation with advanced reporting."}</p>
    <ul><li>Up to {plan.limits.activeLocations} active {plan.limits.activeLocations === 1 ? "location" : "locations"} · {plan.limits.users} team members</li>{PLAN_HIGHLIGHTS[plan.key].map(line=><li key={line}>{line}</li>)}{bookloq && <li>BookLoQ included in this total</li>}</ul>
    <a data-public-event="plan_selected" href={planSelectionUrl({plan:plan.key,bookloq})}>Try {plan.displayName} free for 7 days →</a>
  </article>)}</div><p className="pricing-tax-note">Prices shown apply after the trial. Monthly billing, plus any applicable taxes shown at checkout. {bookloq ? "Displayed prices include BookLoQ as the $39 CAD add-on." : "BookLoQ is available for $39 CAD with a Vanteloq plan or $59 CAD on its own."} <Link href="/pricing">Compare every plan feature →</Link></p>
  {showStandalone && <article className="public-bookloq-standalone" id={compact ? undefined : "plan-bookloq"}>
    <div><span className="plan-audience">BOOKLOQ ON ITS OWN</span><h3>Financial review without a Vanteloq plan</h3><p>Use BookLoQ as a secured finance workspace for source documents, invoices, evidence matching, reviewed books and 13-week cash planning.</p><ul><li>Up to {PLANS.bookloq.limits.activeLocations} active location and {PLANS.bookloq.limits.users} team members</li><li>Vanteloq AI can explain permitted BookLoQ summaries, but it cannot post, pay or approve decisions</li></ul></div>
    <aside><strong>${PLANS.bookloq.prices.month.amountCents / 100}<small> CAD / month</small></strong><a data-public-event="plan_selected" href={planSelectionUrl({plan:"bookloq",bookloq:false})}>Try BookLoQ free for 7 days →</a><small>BookLoQ is $39 CAD/month when added to a Vanteloq plan because it shares that workspace and source infrastructure.</small></aside>
  </article>}
  </>;
}
