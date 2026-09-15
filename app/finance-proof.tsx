"use client";
import { useState } from "react";
import Link from "next/link";
import FinancialReviewCard from "./financial-review-card";
import ProductBrandLogo from "./product-brand-logo";

export default function FinanceProof() {
  const [missing, setMissing] = useState(false);
  const statements = {
    trialBalance: { totalDebitCents: missing ? 4_100_000 : 4_200_000, totalCreditCents: 4_200_000 },
    balanceSheet: { assetCents: missing ? 2_900_000 : 3_000_000, liabilityCents: 800_000, equityCents: 2_200_000 },
    profitAndLoss: { revenueCents: 2_000_000, expenseCents: 1_200_000, cogsCents: 900_000, grossProfitCents: 1_100_000, operatingProfitCents: 800_000 },
  };
  return <section className="finance-proof" id="bookloq-proof" aria-labelledby="finance-proof-title"><div><ProductBrandLogo product="bookloq" variant="full" className="bookloq-proof-wordmark"/><p className="demo-eyebrow">BOOKLOQ + VANTELOQ AI</p><h2 id="finance-proof-title">Clear Books.<br/>Better Cash Decisions.</h2><p>Bring bookkeeping, financial statements and cash flow planning into one workspace. Follow a number back to its records, review what needs attention and ask Vanteloq AI to explain the evidence.</p><ul><li>Profit and loss, balance sheet and journal checks</li><li>Transaction reconciliation and month-end review</li><li>13-week cash forecasts with visible assumptions</li><li>Bills, invoices and supporting documents together</li></ul><div className="bookloq-public-links"><a href="/demo#bookloq">Try the Cash Forecast →</a><Link href="/features/financial-review">Explore BookLoQ Features →</Link></div></div><div className="finance-proof-example"><span>INTERACTIVE EXAMPLE · CAD</span><h3>Would you catch a missing entry?</h3><p>Remove a fictional $1,000 debit and inspect which checks flag the difference.</p><label><input type="checkbox" checked={missing} onChange={event => setMissing(event.target.checked)}/> Simulate a missing journal line</label><FinancialReviewCard statements={statements} available currency="CAD"/><small>The same arithmetic checks used in BookLoQ. Fictional values, with no workspace records or AI request.</small></div></section>;
}
