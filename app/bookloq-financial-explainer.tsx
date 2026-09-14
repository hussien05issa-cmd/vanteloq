"use client";
import { buildProfitBreakdown, type PostedProfit } from "../domain/bookloq-profit-breakdown";
import { formatBookloqMoney } from "../domain/bookloq-presentation";

export default function BookloqFinancialExplainer({ profit, available, currency, currentCashCents, canViewCash, openReports, openTransactions }: {
  profit: PostedProfit; available: boolean; currency: string; currentCashCents: number | null;
  canViewCash: boolean; openReports: () => void; openTransactions: () => void;
}) {
  const rows = buildProfitBreakdown(profit, available);
  const extent = Math.max(1, ...(rows?.map(row => Math.abs(row.cents)) ?? []));
  const money = (value: number | null) => formatBookloqMoney(value, currency);
  return <details className="bookloq-number-guide">
    <summary><span><strong>Understand Your Numbers</strong><small>Profit, cash and the records behind them</small></span><span className="disclosure-plus" aria-hidden="true">+</span></summary>
    <div className="bookloq-number-body">
      <div className="bookloq-number-grid">
        <section className="bookloq-profit-explanation" aria-label="Posted profit breakdown">
          <h3>Where Revenue Goes</h3><p>All posted ledger entries · {currency}. Costs and results share the same scale. Negative values extend left of zero.</p>
          {rows ? <><div className="bookloq-profit-rows">{rows.map(row => <div key={row.label} className="bookloq-profit-row" data-kind={row.kind}>
            <div><span>{row.label}</span><strong>{money(row.cents)}</strong></div>
            <div className="bookloq-profit-track" aria-hidden="true"><i style={{ left: `${row.cents < 0 ? 50 - Math.abs(row.cents) / extent * 50 : 50}%`, width: `${Math.abs(row.cents) / extent * 50}%` }} data-negative={row.cents < 0}/></div>
            <small>{row.explanation}</small>
          </div>)}</div><p className="bookloq-number-note">These are posted totals, not a completeness check. Unposted expenses, missing costs and incorrect classifications can change the result.</p></> : <p className="bookloq-number-empty">A profit breakdown needs available, internally consistent posted records. Review the ledger before relying on this chart.</p>}
          <button type="button" onClick={openReports}>Review Financial Statements <span aria-hidden="true">→</span></button>
        </section>
        <section className="bookloq-cash-explanation"><h3>Why Profit Is Not Cash</h3>
          {canViewCash && <div className="bookloq-cash-value"><span>Current Available Bank Cash</span><strong>{money(currentCashCents)}</strong><small>{currentCashCents === null ? "A verified, current bank balance is required." : "A point-in-time balance, separate from ledger profit."}</small></div>}
          <dl><div><dt>A Customer Has Not Paid Yet</dt><dd>A posted invoice can increase revenue before the cash arrives.</dd></div><div><dt>You Buy Inventory</dt><dd>Paying a supplier uses cash. The inventory cost becomes an expense as the goods are sold.</dd></div><div><dt>You Repay a Loan</dt><dd>Principal repayment reduces cash and the loan balance. Interest is accounted for separately.</dd></div></dl>
          <p className="bookloq-number-note">Compare the same dates and accounting basis. Check source records before deciding why a balance changed.</p>
          <button type="button" onClick={openTransactions}>Open Supporting Transactions <span aria-hidden="true">→</span></button>
        </section>
      </div>
    </div>
  </details>;
}
