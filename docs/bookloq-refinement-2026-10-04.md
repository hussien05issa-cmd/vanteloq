# BookLoQ refinement: 4 October 2026

This is the first implementation increment following the supplied 46-phase master brief. Phase 0 audit preceded edits. It extends the existing product and does not claim a complete replacement for established accounting platforms.

## What changed

| Owner task | Implemented improvement | Accounting boundary |
| --- | --- | --- |
| Set up live books | Reviewed starting chart, fiscal-start month, first/nonoverlapping later periods and six close controls; owner/admin plus journal/period grants required | No opening balances, transactions or journal entries are invented. Existing imported bank accounts remain. Conflicting chart codes stop setup without overwriting them. |
| Post a manual journal | Tenant-owned active contacts, request-content replay checks and audit inside the same D1 batch | Exactly balanced integer-cent entries. A changed request cannot reuse an earlier posting key. |
| Review a bank transaction | Search merchant, category, source system or external reference; open private original receipt, then explicitly confirm evidence | A supporting match does not post an expense, settle an invoice or complete statement reconciliation. |
| Avoid duplicate matches | Atomic match confirmation rechecks current transaction and target state, currency and source mode | Competing different matches cannot both succeed through the supported endpoint. |
| Close a period | Select one period, see only its controls/progress, lock only a nonempty complete checklist; authorized reopening records a reason | Reviewer completion is not automated verification or an audit opinion. Locked controls reject edits. |
| Retain financial history | Archived accounts remain in posted balance calculations | A bank disconnection cannot remove one side of a retained balanced journal. |
| Respect restricted access | Hide contact identities, copied source text and denied supporting-record references; retain anonymous confirmed-match status | Financial values and identity access are distinct. Full statements require the entire relevant financial permission set. |
| Replace a bank connection | Correlate each Plaid row to its bank account and approved current Item | A replacement connection does not promote retained old transactions. Stored history is preserved. |
| Enter tax precisely | Exact 0.001 percentage-point input and integer-cent rounding | Combined GST/QST PDF creation remains blocked until separate component disclosure exists. No tax filing or jurisdiction engine is claimed. |
| Find the offer on the homepage | Clear BookLoQ invoice/collections, statement/evidence, ledger/period and 13-week cash highlights | No claim that missing reconciliation, AP posting, payment execution or payroll workflows are available. |

## Data and deployment

Financial records remain in the existing D1 tables. Supabase supplies authentication; it is not this ledger's database. Private originals retain R2 and document permission/scan checks. This increment adds `POST /api/v1/bookloq/setup`, no database migration, no provider credential changes, and no customer financial entries. The tax column's source comment documents supported SQLite precision; existing integer basis-point values retain their arithmetic.

Setup uses one atomic D1 batch and a concurrency guard. Canonical account/period IDs, unique constraints, overlap conditions, source-mode checks and retained audit evidence prevent accidental duplicate setup. A downstream failure rolls back its account, period, checklist and audit creation.

## Verification

- 82 focused domain, component, migrated-D1 and current-source API tests passed. Includes setup rollback/replay/concurrency, bank-first preservation, ledger balancing, tax precision, receipt evidence guards, period selection, permission redaction and replacement-source isolation.
- Both new built-worker setup tests passed against isolated migrated D1 and authentication fixtures, including subscription/add-on gates, permission denial, tenant isolation and CSRF. The 11-test intelligence-flow suite and the invoice security flow passed against the final Worker. Cash/ledger/collections regressions also passed in the broader run. Test batches overlap and are not summed. The initial broad run was stopped after fixture failures; the affected intelligence suite passed on its complete separate rerun with current consent fixtures and exact-payload journal retry assertions.
- Production build, Worker/RSC/migration artifact validation and typecheck passed. Full lint reported zero errors and 17 pre-existing warnings.
- Browser: single-column setup at 390px had no horizontal overflow; native date entry and failed-save value retention passed. Month-end selection showed only the selected period, locked edits were disabled, empty checklists were unready, failed lock/reopen preserved state, and Escape closed the transaction drawer. Source-reference search opened the intended transaction. A denied receipt showed an inline failure with no match.
- Browser security blocked opening a local `blob:` PDF. It was not worked around. PDF-opening and final receipt-confirmation browser acceptance remain unverified; receipt loading/permission logic and PDF generation have isolated test coverage.
- No signed-in customer production mutation was performed during this verification. Public deployed checks and GitHub/source identifiers belong in the publication receipt.

## Full brief still open

The complete [accounting audit](bookloq-audit/accounting-2026-10-04.md), [UI inventory](bookloq-audit/ui-2026-10-04.md) and [official product benchmark](bookloq-audit/benchmark-2026-10-04.md) remain the scope register. Major next dependencies include:

1. Document recognition and allocation: invoice issuance to ledger, partial payments, credits/refunds, supplier bill approval/posting/payment evidence, and reversals.
2. Actual statement reconciliation: opening/closing statement figures, cleared journal entries, differences, saved progress, completion evidence and controlled reopening.
3. Consistent date/as-of financial reports, general-ledger drilldown, complete exports and accountant handover.
4. Reviewed opening balances, chart management, finance-role consistency and accounting basis policy.
5. Separate tax components, jurisdiction/effective-date rules and working papers before any filing claim.
6. Remaining payroll, fixed-asset, migration, automation and multi-entity lifecycles. Existing display/schema fields do not establish these workflows.

Future changes must update relevant UI, permissions, audit, data deletion/retention, policy statements and feature availability together. No provider approval or production recovery readiness is inferred from this increment.
