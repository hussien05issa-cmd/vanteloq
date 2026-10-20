# Vanteloq v1.0 Origin: connected-workflow increment

Review date: October 11, 2026. Baseline: Sites release 355. Publication and GitHub receipts are separate from this source record.

This increment implements the highest-priority findings from the feature and production gap review. SQL/query means database correctness and performance, as confirmed by the owner, rather than a customer query editor. No new migration, database reset, production deletion or live financial transaction is required.

## Implemented behaviour

| Area | Result | Deliberate boundary |
| --- | --- | --- |
| Historical margins | Owner-entered costs retain effective dates and audit history. A new price cannot silently replace an earlier known cost. Signed returns and explicit zero costs retain their meaning. | A first cost does not certify unknown historical costs. This is not a full FIFO or weighted-average inventory layer implementation. |
| Statement-backed cash | Completed, compatible reconciliations provide a dated cash scenario, with outstanding withdrawals deducted and expected receipts excluded from spendable cash. | Stale, reopened, incomplete, mixed-date or mixed-currency evidence cannot authorise purchasing. A scenario is distinct from a current bank balance. |
| Supplier bills | Save, review, approve, post AP, record an existing payment, match an exact bank outflow and reverse through retained accounting evidence. Whole-order matching checks accepted receiving and exact totals. | The product does not send money. Partial billing, credits, foreign currencies, discounts and non-recoverable tax need separate implementation/review. |
| Purchasing obligations | BookLoQ, its 13-week forecast and Purchasing use the same dated supplier exposure. Linked PO and bill amounts are not counted twice. Funding shortfalls remain signed and visible. | Unrecorded rent, payroll, tax or other commitments are not invented. Missing dates or incompatible amounts/currencies block decision capacity. |
| Reports | Supported provider product, inventory, customer and supplier entries open the existing analytics engines. Connection, period and permitted locations remain explicit. | Presence of records is not certified provider completeness. Limited dimension/transaction previews are labelled; unimplemented reports remain planned. |
| Measured outcomes | Outcomes link actual tasks/findings. Reviewed net sales can fill exact, equal completed periods from authoritative source records. Saved revisions retain the original evidence fingerprint. | Unsupported metrics remain manual. Source changes require reopening and refreshing before completion. Before/after observations do not establish causation. |
| Corrections and permissions | Supporting bank matches can be unlinked with a reason and retained audit. Both matching and unmatching require bank, reconciliation, payroll and target-specific access. | Unlinking supporting evidence does not reverse a posted journal or delete an invoice payment. Protected reconciliation must be reopened through its controlled workflow. |
| SQL/query | Exact bank-source lookup works beyond the 200-row recent list. Provider coverage uses bounded existence queries in one batch; location lists avoid parameter-limit expansion. | Local query plans and timings do not establish hosted capacity or customer latency. No arbitrary SQL access was introduced. |
| Interface | Supplier bills use a single-column review form with dark/light surfaces and desktop/mobile containment. Report drilldowns retain source context. The compact BookLoQ lockup stays inside its rail. | This is a focused refinement, not a completed role-based navigation redesign or an audit of every populated production screen. |

## Verification

The focused native regression run passed 113 checks with no failures on October 11. It included migrated local D1 bank workflows, supplier posting/payment corrections and source-linked outcomes, plus exact scope, historical costs, forecast and query tests. Sandbox-native startup failed before application execution; the same sequential suite passed outside that sandbox. No live tenant records were used.

Additional current-source HTTP checks exercise matching/unmatching for invoice, supplier-bill and receipt evidence. They deny each missing required permission and prove posted journal, journal lines, invoice payment, accounting event and original bank movement remain unchanged after unlinking. Final type, lint, build and publication evidence belongs in the deployment receipt.

The fictional read-only component preview verifies supplier-bill forms at 390 × 844 and desktop dimensions, both themes, horizontal containment, closing and keyboard recovery. Demo writes remain disabled. A preview cannot establish live billing, provider delivery, source completeness or customer accounting acceptance.

## Remaining acceptance work

- Verify the published workflows in a signed-in owner workspace without creating unapproved financial records.
- Verify actual populated production database and private-file restoration into a separate environment.
- Establish an authorised unattended sync schedule and show completed pulls, replay safety and reconciliation. The Sites owner response exposed no schedules at the start of this increment.
- Complete each provider's public permissions/distribution and reconcile permitted production totals independently.
- Continue partial/credit/FX supplier workflows, broader outcome metrics and reporting completeness certification as explicit development work.

## Engineering records

- `docs/research/historical-cost-protection-2026-10-11.md`, plus the inventory-cost runtime tests.
- `docs/research/measured-outcomes-2026-10-11.md`.
- `docs/research/sql-query-review-2026-10-11.md`.
- `tests/supplier-bill-accounting.test.ts`, `tests/bookloq-cash-contract-http.test.mjs` and `tests/bookloq-supporting-match-http.test.mjs`.

The canonical record remains `docs/Vanteloq-v1.0-Origin.md`; this evidence supplements it. Historic test, legal and migration records are retained.
