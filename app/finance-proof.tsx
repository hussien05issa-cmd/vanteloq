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
  return <section className="finance-proof" id="bookloq-proof" aria-labelledby="finance-proof-title"><div><ProductBrandLogo product="bookloq" variant="full" className="bookloq-proof-wordmark"/><p className="demo-eyebrow">BOOKLOQ · FINANCE WORKSPACE</p><h2 id="finance-proof-title">A profitable month can still leave you short of cash.</h2><p>Create an invoice, review what is owed and plan your next commitment. BookLoQ brings financial records and cash decisions into one workspace, on its own or alongside Vanteloq.</p><ul><li><strong>Keep collections visible.</strong> Create invoice PDFs and review outstanding balances and follow-ups.</li><li><strong>Review before recording.</strong> Import a bank statement, inspect supporting documents and confirm matching records.</li><li><strong>Know what your books contain.</strong> Set up your chart and periods, post balanced journals and review cumulative statements.</li><li><strong>Look ahead.</strong> Plan 13 weeks of cash with dated commitments and visible assumptions.</li></ul><div className="bookloq-public-links"><a href="#inside-bookloq">Explore invoices and bills →</a><Link href="/features/financial-review">Explore BookLoQ features →</Link></div></div><div className="finance-proof-example"><span>INTERACTIVE EXAMPLE · CAD</span><h3>What happens when an entry is missing?</h3><p>Remove a fictional $1,000 debit and see which checks flag the difference.</p><label><input type="checkbox" checked={missing} onChange={event => setMissing(event.target.checked)}/> Simulate a missing journal line</label><FinancialReviewCard statements={statements} available currency="CAD"/><small>The same arithmetic checks used in BookLoQ. Fictional values, with no workspace records or AI request.</small></div></section>;
}
