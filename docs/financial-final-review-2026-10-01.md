# Financial calculation final review

Review date: October 1, 2026. Scope: the current local Vanteloq checkout, selected accounting calculations and financial imports. This review did not access live customer financial records, invoke provider syncs, change live subscribers, or deploy the application. Source fixes below are local and require the parent release validation.

## Outcome

Two reproducible financial import defects were established: Square return/currency normalization and signed manual daily summaries. Square changes were implemented in the four files listed below. The parent agent implemented the signed CSV/API change separately. No additional high-impact invoice or ledger defect was established in this bounded review.

This is a software calculation review. Balanced arithmetic alone cannot establish complete books, correct tax treatment, a completed bank reconciliation, or an audit opinion.

## Findings and disposition

### F1. Square exchanges and refunds overstated recorded net sales

**Severity: high. Status: corrected locally, provider-backed end-to-end production verification outstanding.**

Before the change, Square normalization stored the new-sale order total and tax without interpreting return_amounts or net_amounts. The daily rollup clamped total minus tax at zero, counted every order as one positive sale, and inserted zero refunds. Return line items did not reach the cost model.

Reproduction, using the numeric exchange example in Square's official documentation:

| Component | Total including tax, cents | Tax, cents | Revenue excluding tax, cents |
|---|---:|---:|---:|
| New item | 1,250 | 250 | 1,000 |
| Returned item | 1,875 | 375 | 1,500 |
| Net effect | -625 | -125 | -500 |

The previous path published +1,000 cents. The correct net sale is -500 cents, an overstatement of 1,500 cents. A custom cash refund is not automatically the same thing as returned item revenue or a quantity reversal. Square documents both separate sale/return amounts and custom refunds without original item allocation. [Square returns and exchanges](https://developer.squareup.com/docs/orders-api/order-returns-exchanges), accessed October 1, 2026.

**Implemented contract:**

- [server/integrations/square-financials.ts:50](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/square-financials.ts:50) normalizes the new sale and the itemized return as separate stable events.
- The original order ID identifies the sale. A return-prefixed order ID identifies the return event. An absent component is a zero-value voided event so source corrections remove the old component.
- Item totals and taxes must reconcile exactly to their corresponding order totals. Provider net amounts must reconcile to sale minus return when returns or net amounts are present.
- Returned lines carry negative quantities and negative tax-exclusive revenue, with their provider-supplied original item reference. Existing owner unit costs can then produce a signed cost reversal. The adapter does not invent product references, costs, or returned quantities.
- [server/integrations/sync/square.ts:128](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/sync/square.ts:128) removes only item IDs absent from the refreshed snapshot, avoiding stale returned lines after a correction while preserving surviving historical cost snapshots. Newly returned archived items with a nonzero saved unit cost but no applicable cost reversal require review because the existing shared cost updater excludes archived products. Existing archived lines also require review before changing their quantity or product reference, preserving the historical quantity/product/cost snapshot as one unit.
- [server/integrations/sync/square.ts:168](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/sync/square.ts:168) preserves signed net sales. The daily refund column receives positive tax-exclusive item return value. This column is **not** a claim to reproduce Square's cash-refund or settlement reports.
- [server/integrations/square-financials.ts:110](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/square-financials.ts:110) retains the existing units convention: units count completed sold items; return events do not add another sale transaction or sold unit. Returned quantities remain visible in source lines.

**Limits retained intentionally:** custom amount refunds without original item allocation, aggregate returns without complete itemized amounts, returned tips, service charges, cash rounding and newly uncosted archived-item returns require review and are blocked from publication. This is a supported-data boundary, not an assertion that those provider records are invalid.

### F2. Square source money lost currency and included tips in revenue

**Severity: high. Status: corrected locally.**

The old money helper read amount and discarded currency. A USD amount could enter a CAD workspace unchanged. A CAD order collecting 12,500 cents, including 500 cents tax and 2,000 cents tip, previously yielded 12,000 cents of revenue; item revenue is 10,000 cents.

[server/integrations/square-financials.ts:24](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/square-financials.ts:24) and [server/integrations/sync/square.ts:82](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/sync/square.ts:82) now require matching workspace currency for order, return, catalog price and payment monetary data. Required money without currency, foreign currency, fractional cents, unsafe integers and nonfinite amounts are rejected. No exchange rate is guessed. Order tips are excluded before the staged sale total is stored, and line totals provide an independent reconciliation.

Square defines total money, total tax and total tip separately, and defines net amounts as sale money less return money. [Square Order object](https://developer.squareup.com/reference/square/objects/Order), accessed October 1, 2026.

**Trust and migration behavior:** historical data normalized by the earlier importer is not silently certified by a code update.

1. [server/integrations/square-financials.ts:9](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/square-financials.ts:9) restarts an unverified financial cursor while preserving pagination for the new financial version.
2. [server/integrations/sync/square.ts:48](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/sync/square.ts:48) starts from the normal history window and extends to the earliest existing staged sale if required.
3. The connection moves to staging and its previous approval is cleared for this historical rebuild.
4. Before final publication, [server/integrations/sync/square.ts:139](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/sync/square.ts:139) requires every latest staged event to carry the new financial version. Unavailable historical orders keep the source in staging for review.
5. A failed sync withdraws promotion approval for that connection, guarded by its lease ownership. The prior daily snapshot remains stored, but it must not be treated as an approved current source after failure.
6. Successful rebuilds use the existing review and approval workflow. No new ledger, migration table, exchange-rate store, or provider write is introduced.

A future production rollout therefore requires an explicit historical resync/review. Sources with unsupported refund allocation will remain blocked until a separately reviewed policy is implemented.

### F3. Manual daily imports rejected legitimate signed amounts

**Severity: medium. Status: parent agent implemented locally; parent owns the regression result.**

The original CSV money parser accepted only nonnegative values, including net sales, cost of goods and cash balance. An overdrawn cash balance of -25.00 was rejected even though the API already allowed negative cash. A refund-only day with negative net sales or reversed cost was also rejected by CSV/API validation even though the signed database contract supports it.

Smallest correction: permit a leading minus only for net sales, cost of goods and cash balance; align API minima for net sales and cost of goods. Gross sales, refunds, discounts, unit counts and transaction counts remain nonnegative.

Current source evidence: [domain/daily-summary-csv.ts:43](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/daily-summary-csv.ts:43), [domain/daily-summary-csv.ts:60](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/daily-summary-csv.ts:60), [server/validation.ts:576](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/validation.ts:576). The parent reported an actual database regression preserving -1,025 cents net sales, -401 cents cost and -2,503 cents cash. That execution is parent-owned evidence, not a separate rerun by this reviewer.

## Calculation contract

| Area | Required interpretation and invariants | Current source |
|---|---|---|
| Money | Persist integer minor currency units. Validate safe integers. Use exact intermediate arithmetic for multiplication and aggregates. Currency belongs to each source contract; do not add foreign amounts under one label. | [domain/invoice-amounts.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/invoice-amounts.ts); [domain/executive-metrics.ts:37](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/executive-metrics.ts:37) |
| Invoice lines | Quantity is in thousandths; price is cents; rate is basis points. Round each computed line subtotal and line tax consistently, then sum the rounded lines. The preview and persisted invoice must share that path. | [domain/invoice-amounts.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/invoice-amounts.ts); [domain/invoice.ts:90](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/invoice.ts:90) |
| Invoice and bill balances | Remaining amount is max(total minus paid, zero). Partial payments affect aging and committed cash. Draft, void, cancelled, paid, reconciled and written-off status rules must be explicit. | [domain/executive-metrics.ts:96](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/executive-metrics.ts:96); [app/api/v1/bookloq/route.ts:193](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/route.ts:193) |
| Tax | Tax is distinct from sales revenue. A calculated tax amount does not establish registration, taxability, place of supply, exemption eligibility or complete provincial tax coverage. Imported provider tax is reconciled, not recomputed with a guessed rate. | [domain/invoice-amounts.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/invoice-amounts.ts); [server/integrations/square-financials.ts:50](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/square-financials.ts:50) |
| Sales | Net sale revenue excludes tax and tips, incorporates discounts once, and retains itemized return reversals. Product margins require known costs. Zero known cost and missing cost must remain distinguishable. | [server/integrations/square-financials.ts:110](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/square-financials.ts:110); [server/inventory-costs.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/inventory-costs.ts) |
| Ledger posting | Each line has either a positive debit or a positive credit. Total debits equal total credits before posting. Reversals swap the original sides without mutating the original source lines. | [server/bookloq.ts:161](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/bookloq.ts:161); [server/bookloq.ts:195](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/bookloq.ts:195) |
| Statements | Asset and expense effects use debit less credit; liability, equity and revenue effects use credit less debit. Account-class treatment preserves contra accounts, sales returns and draws. Trial-balance totals, the accounting equation and recorded earnings reconcile separately. | [server/bookloq.ts:244](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/bookloq.ts:244); [domain/executive-metrics.ts:49](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/executive-metrics.ts:49) |
| Earnings | Gross profit equals operating revenue less cost of goods. Recorded net earnings equal recorded revenue less recorded expenses. These figures do not include expenses absent from the ledger. | [domain/financial-review.ts:21](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/financial-review.ts:21) |
| Ratios | A missing or unsuitable denominator produces unavailable rather than infinity or a fabricated zero. Return/loss periods can have signed numerators. A ratio is not a substitute for source completeness. | [domain/financial-review.ts:14](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/financial-review.ts:14); [domain/executive-metrics.ts:44](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/executive-metrics.ts:44) |
| Cash movement | Summarize actual signed cash-account ledger movements. Internal cash transfers net to zero. Mixed or ambiguous counterpart classifications remain unclassified. Do not derive cash flow by renaming net sales or net profit. | [domain/executive-metrics.ts:75](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/executive-metrics.ts:75) |
| Bank statements | Opening balance plus inflows minus outflows must equal closing balance exactly. Reviewed statement rows are historical evidence; import must not imply a live bank feed, current bank balance or automatic journal posting. | [domain/bank-statement.ts:37](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/bank-statement.ts:37); [server/bank-statement.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/bank-statement.ts) |
| Settlements | A sale, its tax, tip, fee, refund and bank settlement are different facts. Preserve provider lineage and timing. Matching transaction evidence is not an automatic update of invoice paid amounts or a new ledger entry. | [app/api/v1/bookloq/route.ts:449](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/route.ts:449) |
| Forecasts | Opening verified cash plus timed inflows minus timed outflows equals projected closing cash. Subtract partial payments, prevent purchase-order/bill double counting, and label scenario assumptions. A scenario must not become a second persisted ledger. | [domain/thirteen-week-cash-flow.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/thirteen-week-cash-flow.ts); [domain/forecast-cash.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/forecast-cash.ts) |

The statement boundary is already explicit in [domain/financial-review.ts:40](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/financial-review.ts:40): these are cumulative posted balances and mechanical checks. This review did not recast them as audited or complete period financial statements.

## Accounting and tax references

All sources below were accessed October 1, 2026.

- The CRA describes GST/HST rounding to the nearest cent, with half a cent or more rounded upward. It also permits combining same-rate taxable item prices before computing and rounding tax. The tested per-line method is a consistent implemented method; this report does not assert it is the sole permitted method. Federal GST/HST and provincial PST must not be conflated. The CRA directs provincial PST calculation questions to the relevant provincial authority. [CRA RC4022, General Information for GST/HST Registrants, rounding and provincial sales tax](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4022/general-information-gst-hst-registrants.html).
- IAS 7 supplies a general financial reporting reference for distinguishing cash-flow categories and cash from noncash movements. The application's simplified classifier is not a claim of IFRS compliance, and this report does not infer which accounting framework applies to a particular customer. [IFRS Foundation, IAS 7](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/).
- Return item identity and source references are provider data, not something the importer should fabricate. [Square OrderReturnLineItem](https://developer.squareup.com/reference/square/objects/OrderReturnLineItem). The official returns guide and Order schema linked in F1 and F2 establish the aggregate interpretation used here.

## Verification evidence

### Baseline audit

Before the local Square fix, the following focused set passed **67 tests, zero failures**, approximately 42 seconds:

    node scripts/test.mjs tests/invoice.test.ts tests/bookloq.test.ts tests/financial-review.test.ts tests/executive-metrics.test.ts tests/bookloq-review-regressions.test.ts tests/thirteen-week-cash-flow.test.ts tests/daily-metric-import.test.ts tests/square.test.ts tests/bank-statement.test.ts

Passing these tests did not refute F1 or F2, because the original Square tests did not exercise order-level returns, tips or currency.

Existing useful coverage includes exact invoice cents and half-up rounding, balanced journals, reversal immutability, contra account statement treatment, partial payment aging, purchase commitment deduplication, bank-statement reconciliation and import duplication boundaries.

### Square change validation

The updated focused suite passed **38 tests, zero failures**:

    node scripts/test.mjs tests/square.test.ts tests/square-financials.test.ts tests/inventory-costs.test.ts tests/intraday-sales.test.ts

The new tests exercise ordinary sales, discount preservation, tips, the official exchange arithmetic, refund-only days, known signed cost reversals, removed-return tombstones, currency mismatch and missing currency, unsafe money, unallocated refunds, inconsistent aggregate amounts, service charge/rounding refusal, quantity precision, duplicate item identity, legacy cursor restart and archived snapshot consistency. An actual SQLite regression rejects changed archived quantities or product references while preserving unchanged historical cost snapshots and isolating provider accounts.

[tests/square-sync-flow.test.mjs](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/tests/square-sync-flow.test.mjs) was extended to test actual D1 persistence through the built worker: exchange and returned cost, archived-return refusal and reviewed recovery, same-ID archived quantity change, duplicate resync, removed-return correction, currency failure withdrawing approval, and the existing atomic daily replacement/lease races. The refreshed local build passed this actual D1 flow: **1 test, zero failures, 20.1 seconds**. Its expected 409 and 500 logs are assertions for premature approval, archived quantity changes, uncosted archived returns, foreign currency, injected database failure and lost publication leases. Command: `node scripts/test.mjs tests/square-sync-flow.test.mjs`. The run used an isolated local Miniflare database and mocked provider responses, not a live Square seller.

Local typechecking passed after replacing BigInt literal syntax with the repository's compatible BigInt constructor form. The parent owns the final build, full-suite result and release decision. No production Square account or actual bank settlement was verified in this subtask.

## Changed files and remaining limits

This reviewer changed only:

- [server/integrations/sync/square.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/sync/square.ts)
- [server/integrations/square-financials.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/square-financials.ts)
- [tests/square-financials.test.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/tests/square-financials.test.ts)
- [tests/square-sync-flow.test.mjs](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/tests/square-sync-flow.test.mjs)

The signed CSV/API fix is a separate parent change. This report is outside the checkout.

The importer remains read-only with respect to Square. It does not initiate refunds, payments, inventory writes or bank transfers. Existing stored payment amounts remain payment facts; this change does not add a settlement engine. Historical source availability, seller-specific business-day cutoffs, original historical inventory valuation, full custom-refund allocation and financial source completeness remain explicit review boundaries.

No additional invoice, partial-payment, reversal or statement math defect was established by this bounded pass. That conclusion should not be broadened into a blanket production readiness or accounting compliance claim.
