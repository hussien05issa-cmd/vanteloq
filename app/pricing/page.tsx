import type { Metadata } from "next";
import Link from "next/link";
import { PLANS, ADDONS, type FeatureKey } from "../../server/entitlements/catalog";
import PublicPageNav from "../public-page-nav";
import PublicPlanCards from "../public-plan-cards";
import CustomPlanCallout from "../custom-plan-callout";
import PlanFit from "../plan-fit";
import { planSelectionUrl } from "../../shared/plan-selection";
export const metadata: Metadata = { title: "Vanteloq pricing | Monthly plans and BookLoQ", description: "Compare Vanteloq monthly plans and choose BookLoQ as a $39 CAD add-on or a $59 CAD standalone finance workspace.", alternates: { canonical: "/pricing" }, openGraph: { title: "Vanteloq pricing | Monthly plans and BookLoQ", description: "Compare Vanteloq plans and choose BookLoQ with Vanteloq or on its own.", url: "/pricing", type: "website" } };
const vanteloqPlans = [PLANS.starter, PLANS.growth, PLANS.pro] as const;
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
 <PublicPageNav/>
 <main className="product-help"><p className="demo-eyebrow">PLANS & PRICING</p><h1>Start with the product that fits.</h1><p>Monthly pricing in Canadian dollars. Choose Vanteloq for retail operations and analytics, then add BookLoQ, or subscribe to BookLoQ as its own finance workspace.</p>
 <div className="pricing-reassurance"><span>Monthly billing</span><span>Cancel before renewal</span><Link href="/#connections">Check your integrations first →</Link></div><PlanFit/>
 <PublicPlanCards showStandalone={false}/>
 <section className="plan-comparison" aria-labelledby="comparison-title"><div><p className="demo-eyebrow">COMPARE THE DETAILS</p><h2 id="comparison-title">What’s included?</h2><p>Plan access is separate from source availability. Each business connects and reviews its own records.</p></div>
 <div className="plan-table-scroll" role="region" aria-label="Scrollable plan comparison" tabIndex={0}><table><caption>Vanteloq plan features</caption><thead><tr><th scope="col">Capability</th>{vanteloqPlans.map(p=><th scope="col" key={p.key}>{p.displayName}</th>)}</tr></thead><tbody>{comparisons.map(row=><tr key={row.feature}><th scope="row">{row.label}<small>{row.detail}</small></th>{vanteloqPlans.map(p=><td key={p.key}>{p.features.includes(row.feature)?<span className="plan-included">Included</span>:<span className="plan-not-included">Not included</span>}</td>)}</tr>)}</tbody></table></div></section>
 <section className="public-bookloq-price" aria-labelledby="bookloq-pricing-title"><div><p className="demo-eyebrow">COMMERCE-FIRST FINANCE WORKSPACE</p><h2 id="bookloq-pricing-title">Choose BookLoQ with Vanteloq or on its own.</h2><p>BookLoQ organizes source documents, invoices, transaction review and evidence matching, balanced journals, financial statements and 13-week cash review. It does not file returns, move money or certify that the books are complete.</p><Link href="/demo#bookloq">Try the fictional cash planning demo →</Link></div><div className="public-bookloq-price-options"><article><span>WITH A VANTELOQ PLAN</span><strong>+${ADDONS.bookloq.prices.month.amountCents/100}<small> CAD / month</small></strong><p>Shares the workspace, permissions and source infrastructure already included with Vanteloq.</p><Link className="bookloq-addon-action" href="#plan-starter">Choose a Vanteloq plan ↑</Link></article><article><span>BOOKLOQ STANDALONE</span><strong>${PLANS.bookloq.prices.month.amountCents/100}<small> CAD / month</small></strong><p>Includes its own secured workspace, source handling, permissions and BookLoQ access.</p><Link data-public-event="plan_selected" href={planSelectionUrl({plan:"bookloq",bookloq:false})}>Choose BookLoQ →</Link></article></div></section><CustomPlanCallout/>
 <div className="pricing-questions"><details><summary>Do I need to connect a bank to start?</summary><p>No. Start with a supported sales source or structured CSV import. Bank-based cash measures require an authorized, verified connection. Plaid production activation is still required.</p></details><details><summary>Can I change plans later?</summary><p>Workspace billing opens Stripe’s billing portal for available changes and cancellation. Review the effective date and any prorated charges before confirming a change.</p></details><details><summary>Does this replace my accountant?</summary><p>No. BookLoQ organizes records and checks arithmetic. It does not file tax returns, move bank funds or certify that your books are complete. Keep your accountant involved in accounting and tax decisions.</p></details></div>
 <div className="demo-conversion"><div><h2>See what your next decision could look like.</h2><p>Explore fictional records with the same calculation logic used in a workspace.</p></div><Link href="/demo">Explore the demo →</Link></div>
 <footer className="pricing-footer"><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/#connections">Integration availability</Link></footer>
 </main></div>;
}
