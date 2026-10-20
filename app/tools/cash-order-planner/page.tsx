import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryShell from "../../discovery-shell";
import { CashOrderPlanner } from "../public-calculators";
import "../tool-pages.css";

export const metadata: Metadata = {
  title: "Cash order planner | Free weekly cash calculator | Vanteloq",
  description: "Compare dated cash receipts and obligations with a proposed inventory order payment over 1 to 13 weeks. See lowest balances, reserve gaps and transparent weekly calculations.",
  alternates: { canonical: "/tools/cash-order-planner" },
  openGraph: { title: "Cash order planner | Vanteloq", description: "Compare a proposed order with your dated cash assumptions and chosen buffer.", url: "/tools/cash-order-planner", type: "website" },
};

export default function CashOrderPlannerPage() {
  return <DiscoveryShell className="public-tools-page"><main className="tool-page-main" id="discovery-main" tabIndex={-1}>
    <nav className="tool-breadcrumb" aria-label="Breadcrumb"><Link href="/tools">Planning tools</Link><span aria-hidden="true">/</span><span>Cash order planner</span></nav>
    <header className="tool-page-hero"><p className="tool-eyebrow">FREE CASH SCENARIO CALCULATOR</p><h1>Cash order planner</h1><p>Compare the cash timing of a proposed order with dated receipts, existing obligations and a minimum buffer you choose. The result shows the lowest balance before and after the order.</p><p className="tool-privacy-note">No account or bank connection is required. Calculator inputs are not uploaded.</p></header>
    <CashOrderPlanner />
    <section className="tool-method" aria-labelledby="cash-method-title"><h2 id="cash-method-title">How the cash calculation works</h2>
      <p className="tool-formula">Weekly closing cash = weekly opening cash + dated receipts − dated obligations − proposed order payment</p>
      <p>The next week starts with the previous week’s closing cash. Week 1 begins the day after the reconciled opening cash date. The proposed order is one cash payment in the selected week. The before-order comparison omits that payment.</p>
      <p>The lowest balance is the minimum of the opening cash and every weekly closing balance. Buffer headroom or shortfall equals that lowest balance minus your minimum buffer. The buffer is a comparison threshold, so it is not deducted as an expense.</p>
      <h3>What the scenario assumes</h3><p>Every receipt arrives and every obligation is paid on its entered date and for its entered amount. Only entered movements are included. Use one currency, CAD, and include each payment once. Opening cash already includes movements through its as of date.</p>
      <p>Weekly closes can conceal a shortage within a week. Check daily timing before making a commitment. Delayed collections, unentered bills, changing costs and payment terms can change the outcome. A positive buffer does not prove that an order is affordable or that funds are available today.</p>
      <p>This is a planning comparison, not a guarantee, purchasing authorization, lender assessment or accounting or tax advice. Amounts use exact cents. Missing, negative, nonfinite, out-of-range or overly precise inputs withhold the result.</p>
      <p>Method context: <a href="https://www.bdc.ca/en/articles-tools/entrepreneur-toolkit/templates-business-guides/cash-flow-calculator">BDC’s cash flow planning explanation</a> describes comparing expected cash inflows and outflows over a weekly or monthly horizon. This calculator’s order comparison and reserve are explicit user assumptions.</p>
      <p><Link href="/tools/vehicle-holding-cost">Estimate vehicle holding costs</Link>, or <Link href="/resources">read the business guides</Link>.</p>
    </section>
  </main></DiscoveryShell>;
}
