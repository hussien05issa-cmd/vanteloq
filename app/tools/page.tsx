import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryShell from "../discovery-shell";
import "./tool-pages.css";

export const metadata: Metadata = {
  title: "Free business planning calculators | Vanteloq",
  description: "Compare an inventory order against dated cash assumptions, or estimate additional vehicle holding costs. Free calculators with visible formulas and editable fictional examples.",
  alternates: { canonical: "/tools" },
  openGraph: { title: "Free business planning calculators | Vanteloq", description: "Manual cash and vehicle holding cost scenarios with clear assumptions.", url: "/tools", type: "website" },
};

export default function ToolsPage() {
  return <DiscoveryShell className="public-tools-page"><main className="tool-page-main" id="discovery-main" tabIndex={-1}>
    <header className="tool-page-hero"><p className="tool-eyebrow">FREE PLANNING TOOLS</p><h1>Test the numbers behind your next operating decision.</h1><p>Use a manual scenario to examine cash timing or the cost of holding a vehicle. Each calculator starts with a clearly labelled fictional example and shows how the result is calculated.</p></header>
    <div className="tool-hub-grid"><article className="tool-hub-card"><span className="tool-eyebrow">CASH TIMING</span><h2><Link href="/tools/cash-order-planner">Cash order planner</Link></h2><p>Enter dated receipts, obligations and a proposed order payment. Compare the lowest opening or weekly closing cash balance before and after the order against your own reserve.</p><Link className="tool-text-link" href="/tools/cash-order-planner">Open cash order planner →</Link></article>
      <article className="tool-hub-card"><span className="tool-eyebrow">VEHICLE INVENTORY</span><h2><Link href="/tools/vehicle-holding-cost">Vehicle holding cost calculator</Link></h2><p>Estimate additional financing, storage and other daily costs for a holding period. Keep the estimate separate from costs you have already recorded.</p><Link className="tool-text-link" href="/tools/vehicle-holding-cost">Open vehicle holding calculator →</Link></article></div>
    <section className="tool-method"><h2>A scenario you can inspect</h2><p>No account or bank connection is required. Calculator inputs are not uploaded. You can edit the example, view the method and download a CSV containing the as of date, inputs and formulas.</p><p>These tools calculate the assumptions you enter. They do not verify records, authorize purchases, guarantee cash coverage or provide credit, accounting or tax advice.</p><p><Link href="/resources">Read the business guides</Link> for more context, or <Link href="/demo">explore the fictional Vanteloq demo</Link>.</p></section>
  </main></DiscoveryShell>;
}
