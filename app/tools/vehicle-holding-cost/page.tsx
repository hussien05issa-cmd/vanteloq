import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryShell from "../../discovery-shell";
import { VehicleHoldingCalculator } from "../public-calculators";
import "../tool-pages.css";

export const metadata: Metadata = {
  title: "Vehicle holding cost calculator | Free inventory tool | Vanteloq",
  description: "Estimate additional vehicle financing, storage and daily holding costs using outstanding financed balance, annual rate and days. See formulas and recorded costs separately.",
  alternates: { canonical: "/tools/vehicle-holding-cost" },
  openGraph: { title: "Vehicle holding cost calculator | Vanteloq", description: "A transparent additional vehicle holding cost estimate with editable assumptions.", url: "/tools/vehicle-holding-cost", type: "website" },
};

export default function VehicleHoldingCostPage() {
  return <DiscoveryShell className="public-tools-page"><main className="tool-page-main" id="discovery-main" tabIndex={-1}>
    <nav className="tool-breadcrumb" aria-label="Breadcrumb"><Link href="/tools">Planning tools</Link><span aria-hidden="true">/</span><span>Vehicle holding cost</span></nav>
    <header className="tool-page-hero"><p className="tool-eyebrow">FREE VEHICLE INVENTORY CALCULATOR</p><h1>Vehicle holding cost calculator</h1><p>Estimate the additional cost of holding a vehicle for more days. Use the outstanding financed balance and your own daily cost assumptions, while keeping recorded costs to date separate.</p><p className="tool-privacy-note">No account or lender connection is required. Calculator inputs are not uploaded.</p></header>
    <VehicleHoldingCalculator />
    <section className="tool-method" aria-labelledby="holding-method-title"><h2 id="holding-method-title">How the holding estimate works</h2>
      <p className="tool-formula">Financing estimate = outstanding financed balance × (annual rate ÷ 100) × days ÷ 365</p>
      <p className="tool-formula">Daily cost estimate = (daily storage + other daily costs) × days</p>
      <p className="tool-formula">Additional holding estimate = financing estimate + daily cost estimate</p>
      <p>The financing input is outstanding financed principal, not the purchase price or the vehicle’s total recorded inventory cost. For example, a fictional $30,000 vehicle with $20,000 financed uses $20,000 in the financing formula.</p>
      <h3>Assumptions and limits</h3><p>This model uses simple interest, a fixed 365-day year, a constant financed balance and annual rate, and constant daily costs. It does not compound interest or model principal repayments, rate changes, lender fees, tax treatment, depreciation, market value changes or sale proceeds. Your financing agreement may calculate charges differently.</p>
      <p>Financing is calculated at full precision, then rounded to the nearest cent, with half cents rounded up. Daily dollar inputs allow up to two decimal places. The annual percentage allows up to four. Missing, negative, nonfinite, out-of-range or overly precise inputs withhold the result.</p>
      <p>Recorded costs are the historical amount you enter as of the selected date. They are displayed separately and are excluded from the additional estimate. This calculator does not verify those records or establish profit, inventory valuation, an APR, a lender quote or credit, accounting or tax advice.</p>
      <p><Link href="/tools/cash-order-planner">Compare an order with dated cash timing</Link>, or <Link href="/resources">read the business guides</Link>.</p>
    </section>
  </main></DiscoveryShell>;
}
