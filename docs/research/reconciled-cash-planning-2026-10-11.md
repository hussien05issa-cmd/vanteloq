# Reconciled cash planning and dated obligations

Implementation date: 2026-10-11. These controls improve operational planning; they do not certify statutory reporting or establish a current available bank balance.

## Source and accounting boundaries

IAS 7 distinguishes cash movements from accounting income, requires reconciliation of cash components, and excludes non-cash investing/financing transactions from the cash-flow statement. Vanteloq's 13-week operational scenario remains separate from that statement. Merchant account balances remain subject to their source eligibility and restrictions; they are not automatically certified cash equivalents. [IFRS Foundation, IAS 7](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/)

Cloudflare documents D1 batches as transactional, with rollback when a statement fails. Reconciliation completion therefore retains the bank evidence, ledger links, history and audit atomically. The new read loader uses one organization-scoped SQL statement to read its account coverage and latest reconciliation state, avoiding independently timed balance and status queries. A planning read does not authorize a future payment. [Cloudflare D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

## Implemented contracts

- Live Plaid balances and reconciled statement scenarios retain different labels and dates.
- Statement fallback requires every base-currency cash account to have a retained approved manual statement and a completed latest run on one common closing date. Reopened, missing, inconsistent or damaged evidence withholds the entire balance.
- Outstanding withdrawals reduce scenario opening cash. Outstanding receipts do not increase spendable cash. Uncleared journal reversal pairs cancel only when both cash lines remain uncleared and are exact opposites.
- A statement older than 48 hours, or subsequent bank, ledger or unreviewed statement movements, permits only an explicitly dated scenario. Current purchasing authority is withheld.
- The latest completed reconciliation cannot fall back through a later reopened run. Existing sources and audit history are retained.
- A supplier bill and its PO share one exposure. Recorded payments reduce that exposure once. The bill's balance uses its own due date; only the remaining unbilled PO amount uses the committed cash date.
- Unreviewed bills stay reserved conservatively. Expected customer invoice receipts never inflate purchasing capacity.
- Foreign-currency obligations, linked PO/bill currency mismatches and undated purchase exposure block purchasing capacity. No exchange rate, tax remittance, rent or payroll amount is inferred.
- The common contract covers recorded obligations. Other commitments need a recorded dated bill or an explicit owner scenario. Existing forecast scenario extras are browser-only assumptions, not posted or persisted liabilities.

## Verification boundary

Tests use isolated local D1 and fictional records. They check paid PO/bill deduplication, due-date allocation, unknown currency/date blocking, signed statement cash, stale source withholding, missing account coverage, retained reversals, tenant isolation, denial, and reopening. These checks do not verify production statement completeness, production restoration, live Plaid approval, unattended sync completion or subscriber billing.
