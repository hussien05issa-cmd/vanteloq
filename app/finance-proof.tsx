"use client";
import { useState } from "react";
import FinancialReviewCard from "./financial-review-card";

export default function FinanceProof() {
  const [missing, setMissing] = useState(false);
  const statements = {
    trialBalance: { totalDebitCents: missing ? 4_100_000 : 4_200_000, totalCreditCents: 4_200_000 },
    balanceSheet: { assetCents: missing ? 2_900_000 : 3_000_000, liabilityCents: 800_000, equityCents: 2_200_000 },
    profitAndLoss: { revenueCents: 2_000_000, expenseCents: 1_200_000, cogsCents: 900_000, grossProfitCents: 1_100_000, operatingProfitCents: 800_000 },
  };
  return <section className="finance-proof" aria-labelledby="finance-proof-title"><div><p className="demo-eyebrow">BOOKLOQ + VANTELOQ AI</p><h2 id="finance-proof-title">Check the numbers.<br/>Understand the decision.</h2><p>Review the accounting equation, follow cash pressure across 13 weeks and ask AI to explain the permitted evidence. The calculations stay visible, and you stay in control.</p><ul><li>Balanced journals and traceable statement totals</li><li>Confirmed obligations separated from expected cash</li><li>Financial explanations grounded in approved records</li></ul><a href="/demo#bookloq">Try the cash decision demo →</a></div><div className="finance-proof-example"><span>INTERACTIVE EXAMPLE · CAD</span><h3>Would you catch a missing entry?</h3><p>Remove a fictional $1,000 debit and inspect which checks flag the difference.</p><label><input type="checkbox" checked={missing} onChange={event => setMissing(event.target.checked)}/> Simulate a missing journal line</label><FinancialReviewCard statements={statements} available currency="CAD"/><small>The same arithmetic checks used in BookLoQ. Fictional values, with no workspace records or AI request.</small></div></section>;
}
