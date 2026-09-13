import type { Metadata } from "next";
import Link from "next/link";
import { PLANS, ADDONS, type FeatureKey } from "../../server/entitlements/catalog";
import ProductBrandLogo from "../product-brand-logo";
import CustomPlanCallout from "../custom-plan-callout";
import PlanFit from "../plan-fit";
export const metadata: Metadata = { title: "Vanteloq pricing | Monthly plans and BookLoQ", description: "Compare Vanteloq monthly plans in Canadian dollars, team and location limits, and the optional BookLoQ add-on.", alternates: { canonical: "/pricing" }, openGraph: { title: "Vanteloq pricing | Monthly plans and BookLoQ", description: "Compare monthly plans, team and location limits, and the optional BookLoQ add-on.", url: "/pricing", type: "website" } };
const comparisons: {label:string;feature:FeatureKey;detail:string}[]=[
 {label:"Sales and gross margin",feature:"products.margin",detail:"Revenue, product costs and source coverage."},
 {label:"Vanteloq AI",feature:"ai.basic",detail:"Business analysis and app help, powered by OpenAI."},
 {label:"Lots and expiry",feature:"inventory.expiry",detail:"Track dated stock and review expiry risk."},
 {label:"Inventory velocity and stock cover",feature:"inventory.velocity",detail:"Requires reviewed sales and inventory inputs."},
 {label:"Supplier analytics",feature:"supplier.analytics",detail:"Review supported purchasing and supplier records."},
 {label:"Advanced location comparisons",feature:"multi_location.advanced",detail:"Compare permitted locations with equivalent source coverage."},
 {label:"Advanced reporting and exports",feature:"reporting.exports",detail:"Available records and role permissions determine each export."},
];
export default function PricingPage() {
 return <div className="public-site demo-page pricing-page">
 <header className="demo-page-nav"><Link href="/" aria-label="Vanteloq home"><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong></Link><Link href="/demo">Try the demo</Link><Link href="/help">Help centre</Link></header>
 <main className="product-help"><p className="demo-eyebrow">PLANS & PRICING</p><h1>Start with the plan that fits.</h1><p>Monthly pricing in Canadian dollars. Choose the room your team needs, then add BookLoQ for accounting and cash planning.</p>
 <div className="pricing-reassurance"><span>Monthly billing</span><span>Cancel before renewal</span><Link href="/#connections">Check your integrations first →</Link></div><PlanFit/>
 <div className="public-price-grid">{Object.values(PLANS).map(plan=><article key={plan.key} id={"plan-"+plan.key} className={plan.key==="growth"?"plan-growth":""}><span className="plan-audience">{plan.key==="starter"?"For one location":plan.key==="growth"?"For a growing team":"For a larger operation"}</span><h2>{plan.displayName}</h2><strong>{"$"}{plan.prices.month.amountCents/100}<small> CAD / month</small></strong><p>{plan.description}</p><ul><li>Up to {plan.limits.activeLocations} active {plan.limits.activeLocations===1?"location":"locations"}</li><li>Up to {plan.limits.users} team members</li><li>Sales, margin and source review</li><li>Vanteloq AI, powered by OpenAI</li></ul><Link data-public-event="signup_start" href="/?start=signup">Create a workspace →</Link></article>)}</div>
 <p className="pricing-tax-note">Taxes and the final total are shown at checkout. AI availability depends on the configured provider.</p>
 <section className="plan-comparison" aria-labelledby="comparison-title"><div><p className="demo-eyebrow">COMPARE THE DETAILS</p><h2 id="comparison-title">What’s included?</h2><p>Plan access is separate from source availability. Each business connects and reviews its own records.</p></div>
 <div className="plan-table-scroll" role="region" aria-label="Scrollable plan comparison" tabIndex={0}><table><caption>Vanteloq plan features</caption><thead><tr><th scope="col">Capability</th>{Object.values(PLANS).map(p=><th scope="col" key={p.key}>{p.displayName}</th>)}</tr></thead><tbody>{comparisons.map(row=><tr key={row.feature}><th scope="row">{row.label}<small>{row.detail}</small></th>{Object.values(PLANS).map(p=><td key={p.key}>{p.features.includes(row.feature)?<span className="plan-included">Included</span>:<span className="plan-not-included">Not included</span>}</td>)}</tr>)}</tbody></table></div></section>
 <section className="public-bookloq-price"><div><p className="demo-eyebrow">OPTIONAL FINANCE WORKSPACE</p><h2>BookLoQ</h2><p>Balanced journals, financial statements, reconciliation, bills, receivables and 13-week cash review. Requires a base plan and the appropriate finance permissions.</p><Link href="/demo#bookloq">Try the cash planning demo →</Link></div><strong>+{"$"}{ADDONS.bookloq.prices.month.amountCents/100}<small> CAD / month</small></strong></section><CustomPlanCallout/>
 <div className="pricing-questions"><details><summary>Do I need to connect a bank to start?</summary><p>No. Start with a supported sales source or structured CSV import. Bank-based cash measures require an authorized, verified connection. Plaid production activation is still required.</p></details><details><summary>Can I change plans later?</summary><p>Workspace billing opens Stripe’s billing portal for available changes and cancellation. Review the effective date and any prorated charges before confirming a change.</p></details><details><summary>Does this replace my accountant?</summary><p>No. BookLoQ organizes records and checks arithmetic. It does not file tax returns, move bank funds or certify that your books are complete. Keep your accountant involved in accounting and tax decisions.</p></details></div>
 <div className="demo-conversion"><div><h2>See what your next decision could look like.</h2><p>Explore fictional records with the same calculation logic used in a workspace.</p></div><Link href="/demo">Explore the demo →</Link></div>
 <footer className="pricing-footer"><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/#connections">Integration availability</Link></footer>
 </main></div>;
}
