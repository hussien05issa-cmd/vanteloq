"use client";

import type { BookloqAdvertisingSpend } from "../domain/bookloq-advertising-spend";
import "./bookloq-advertising-spend.css";

type Context = "expenses" | "budget" | "cash" | "reports";
const descriptions: Record<Context, string> = {
  expenses: "Compare Meta’s reported spend with the invoice and the advertising expense recorded in your books.",
  budget: "Compare imported advertising spend with the matching category budget. Posted actuals remain separate.",
  cash: "Review advertising costs before planning a payment. Reported spend does not prove money left your bank.",
  reports: "Advertising belongs in the books after review. An unpaid bill, a card charge and a bank payment affect different accounts.",
};
function sourceMoney(amount: number | null, currency: string | null, exponent: number | null) {
  if (amount === null || !currency || exponent === null) return "Review source amount";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" }).format(amount / 10 ** exponent);
}
function money(cents: number | null, currency: string) {
  return cents === null ? "Review required" : new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
}
function importedAt(timestamp: number | null) {
  return timestamp ? `${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(timestamp * 1000)} UTC` : "Sync required";
}

export default function BookloqAdvertisingSpendPanel({ spend, context }: { spend?: BookloqAdvertisingSpend; context: Context }) {
  if (!spend || spend.status === "restricted" || !spend.accounts.length) return null;
  return <details className="bookloq-ad-spend" open={context === "expenses"}>
    <summary><span><strong>Meta advertising spend</strong><span>{spend.status === "available" ? "Imported for review" : "Source review needed"}</span></span><span className="bookloq-ad-spend-chevron" aria-hidden="true">⌄</span></summary>
    <div className="bookloq-ad-spend-body">
      <p>{descriptions[context]}</p>
      <div className="bookloq-ad-spend-accounts">{spend.accounts.map(account => <article key={account.accountRef}>
        <header><span><strong>{account.accountName}</strong><small>{account.scopeKind === "organization" ? "Company account" : "Location account"} · {account.currency ?? "Currency needs review"}</small></span><span className={`bookloq-ad-spend-state ${account.status === "ready" ? "ready" : "review"}`}>{account.status === "ready" ? "Ready to compare" : "Needs review"}</span></header>
        <strong className="bookloq-ad-spend-amount">{sourceMoney(account.amountMinor, account.currency, account.currencyExponent)}</strong>
        <p>{account.periodStart && account.periodEnd ? `${account.periodStart} to ${account.periodEnd}` : "Reporting period needs review"} · {account.dayCount} reported days</p>
        <small>Imported {importedAt(account.lastSyncedAt)} · {account.reportingTimezone ?? "Timezone needs review"}</small>
        {account.reviewReasons.length > 0 && <ul className="bookloq-ad-spend-reasons">{account.reviewReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      </article>)}</div>
      <p className="bookloq-ad-source-link"><a href="#workspace/marketing">View Meta source reports</a></p>
      {context === "budget" && spend.budgets.length > 0 && <div className="bookloq-ad-budget-table" role="region" aria-label="Advertising source spend by budget period" tabIndex={0}><table><caption>Source spend by advertising budget period</caption><thead><tr><th>Budget period</th><th>Scope</th><th>Meta reported spend</th><th>Review</th></tr></thead><tbody>{spend.budgets.map(budget => <tr key={budget.budgetId}><td>{budget.periodStart} to {budget.periodEnd}</td><td>{budget.locationRef === "all" ? "Company" : "Location"}</td><td>{money(budget.reportedSpendCents, spend.baseCurrency)}</td><td>{budget.status === "ready" ? "Compare with posted actuals" : budget.reviewReasons.join(" ") || "No spend records in this period"}</td></tr>)}</tbody></table></div>}
      <details className="bookloq-ad-accounting"><summary>How this reaches your financial reports</summary><dl>
        <div><dt>Expense and budget</dt><dd>Review the provider invoice, currency and taxes. Post the advertising expense once. A source report is supporting evidence, not another expense.</dd></div>
        <div><dt>Cash planning</dt><dd>Use the reviewed payment date and unpaid obligation when planning cash. Match the actual payment to its bank or card record.</dd></div>
        <div><dt>Balance sheet</dt><dd>A reviewed unpaid invoice can affect payables; a card charge can affect the card liability. A settled bank payment affects cash. Reported ad spend is not automatically an asset or cash movement.</dd></div>
      </dl><p>{spend.boundary}</p></details>
    </div>
  </details>;
}
