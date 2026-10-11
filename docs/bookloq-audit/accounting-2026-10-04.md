# BookLoQ phase 0 accounting, server, and security audit

Reviewed 2026-10-04 against the current working tree under `work/vanteloq` (HEAD observed: `f5c9d1c`). This is a source audit of the full supplied BookLoQ master brief, especially phases 4–19, 23–24, 26–29, and 36–39. It is a pre-remediation snapshot. A separate subsequent implementation must record which findings it resolves.

No production database, customer information, credentials, provider connection, payment, email, or deployment was changed. No build or runtime tests were run for this audit. Existing test files are evidence of intended coverage, not a claim that they currently pass. Paths below are relative to `work/vanteloq` unless stated otherwise.

## Decision

Keep the existing integer-money utilities, manual journal posting/reversal, permission framework, private document pipeline, invoice generation, source-qualified cash planning, and banking import controls. BookLoQ is a partially implemented bookkeeping and financial intelligence product. It is not yet a complete operational accounting system.

The largest dependency is live accounting setup. Only the demonstration route creates BookLoQ settings, periods, and the initial chart of accounts. Manual posting requires an existing open accounting period. A new live customer therefore cannot initialize a usable ledger through the reviewed production API. The next dependency is posting from business documents: invoices can be created and emailed, but this does not post receivables, revenue, tax, or a payment allocation. Supplier bills and completed reconciliations currently have schema/read models but no production creation workflow.

Treat the brief as a staged product program. Shipping a menu or a populated demonstration does not implement the underlying accounting lifecycle.

## Architecture and boundaries

- **Authentication:** Supabase authentication supplies verified user identity through `server/authorization.ts` and related authentication helpers.
- **Financial storage:** `db/index.ts` uses Cloudflare D1 through Drizzle; `db/schema.ts` defines the ledger. The financial ledger is not a Supabase/Postgres database protected by finance RLS policies. Tenant isolation depends on trusted server context, scoped SQL, authorization, and D1 constraints/triggers.
- **Files:** private R2 objects and `workspace_documents` records; financial routes use document security status and tenant ownership. Generated invoice PDFs are stored as trusted generated content. Uploaded statement data requires the reviewed document workflow.
- **Entitlements:** `server/entitlements/catalog.ts`, `server/entitlements/engine.ts`, and `domain/paid-feature-routing.ts` define BookLoQ add-on/standalone and feature gates. Major financial routes call `requireAccess`, `requireAddon`, and granular permissions. Actions also resolve an action-specific feature. Keep these gates on new endpoints.
- **Locations:** core BookLoQ rejects location-limited accounts. An organization-wide user selecting a location gets filtered transactions/budgets, while statements, balances, tax, bills, and invoices remain organization-wide. The response explicitly states this boundary. This is not complete location accounting.
- **Money:** integer minor units are the schema convention. Important pure calculations use BigInt and safe-integer boundaries. Manual journals are limited to the workspace base currency; this is not a foreign exchange accounting engine.
- **Source trust:** cash logic distinguishes demonstration records, source approval, freshness, missing values, and foreign-currency commitments. Bank/statement imports do not automatically become journal entries. Preserve this separation.

## Inventory against the brief

Classification: **Implemented** means a substantive code path exists, not production acceptance certification. **Partial** means a useful subset exists. **Schema/read only** means data fields or display exist without the requested write lifecycle. **Missing** means no implementation was found in the inspected API/server/schema paths. **Broken** identifies a concrete inconsistency described below.

| Capability | Classification | Current evidence and limit |
| --- | --- | --- |
| Tenant-authenticated financial API | Implemented, refine | BookLoQ routes derive organization from `requireAccess` and scope SQL. Audit foreign reference validation and granular field permissions below. |
| Live accounting onboarding | Missing, blocking dependency | `app/api/v1/bookloq/demo/route.ts:69–79` is the only settings/period seed. `journals/route.ts:65–69` requires an existing period. `SettingsPanel` is read-only. |
| Chart of accounts | Partial | `financial_accounts` supports five account types, normal balance, hierarchy metadata, system keys, archive flags. `actions/route.ts` creates only custom revenue/expense categories. Full chart lifecycle, opening balances, and approved accounting templates are missing. |
| Manual double-entry posting | Implemented, refine | `server/bookloq.ts:journalInput` validates dates, integer cents, either debit or credit, balanced totals and line count. `journals/route.ts` validates active tenant accounts and posts header/lines in one D1 batch. No draft journal save/approval workflow. |
| Reversal journals | Implemented, refine | PATCH inserts reversed lines and marks original reversed atomically. Reporting includes original and reversing entry, correctly cancelling them. Database uniqueness prevents a second reversal of the same original. Reversal payload binding and source-line checks need improvement. |
| Closed-period posting guard | Implemented | `drizzle/0039_journal_period_guards.sql` guards journal insert/post at database execution time, so a period lock between initial read and write cannot admit a new posting. |
| Ledger immutability and integrity | Partial | Header balance and individual line checks exist. No database guard was found that equates header totals with all journal lines or makes all posted-line updates/deletes immutable. Current manual route computes lines correctly; future posting engines must not rely solely on header checks. |
| Automatic invoice/bill/expense postings | Missing | Invoice create stores draft invoice/lines/PDF, leaves ledger link null; email changes delivery/status only. No reviewed production supplier-bill creation or expense-to-ledger posting endpoint. |
| Opening balances and year-end close | Missing | No production initialization/import balancing workflow, retained-earnings close workflow, or opening-balance review found. |
| Accounting periods | Partial | Schema, posting guards, lock/unlock actions exist. Creation is demo-only. No production period generation, overlap prevention, fiscal policy migration or close approval chain. |
| Bank connection | Implemented, externally dependent | `server/integrations/plaid.ts` has credentials, leases, sync, promotion, disconnection and deletion handling. This audit did not verify production credentials, consent, or a working live institution. One replaceable `legacy` Plaid Item is the supported connection path. |
| Bank transaction ingestion | Implemented, refine | Financial transactions preserve provider IDs and source states, independently from the ledger. Categories and saved suggestion rules exist. No automatic journal posting is claimed. Reconnection trust scope needs a regression test. |
| Statement import | Implemented, retain | `server/bank-statement.ts`, `statements/route.ts`, `domain/bank-statement.ts`, and `drizzle/0051*` enforce reviewed rows, fingerprints, totals, same-currency manual accounts, overlap/duplicate guards, and guarded undo. Explicit `postedToLedger: false`. |
| Categorization | Partial | Confirm category and save rule exist. Editing does not repair or create ledger entries; categorization currently lacks removed/posted/reconciled transaction safeguards. |
| Supporting-evidence match | Partial, integrity defect | Transaction-to-bill/invoice/receipt link exists with tenant, currency, direction, and document checks. It is not payment posting, a reconciled statement, or a split allocation. Concurrent confirmation can produce multiple confirmed links. No unmatch action exists. |
| Bank reconciliation wizard | Schema/read only | `reconciliations` has statement/book balance metadata, difference, status. Actual production writes were not found; only demo inserts. `BankingPanel` shows records and guidance. No start/complete/undo reconciliation engine or statement-row-to-ledger allocation workflow. |
| Customer invoices | Partial | `invoices/route.ts`, `domain/invoice.ts`, `server/invoice-pdf.ts`: validated line calculations, customer snapshot, atomic document/invoice/line persistence, PDF. `invoices/email/route.ts`: server sender configuration, private clean file, provider idempotency, email status. Sending is not accounting issuance/posting. |
| Invoice payments and credits | Missing | No payment allocations, partial-payment posting, overpayment/customer credit lifecycle, credit note journal, write-off adjustment or payment reversal engine found. `paid_cents` and statuses exist but production payment mutation does not. |
| Estimates and recurring invoices | Missing | No complete estimate conversion, recurring schedule issuance/posting, or credit note lifecycle found. |
| Collections | Implemented subset | `collections/route.ts` aggregates full same-currency/source-mode issued unpaid records before pagination, with identity permission and a capacity failure boundary. `server/workflow-followup.ts` supports recorded follow-up/promises/reminders. This is not payment settlement. |
| Supplier bills/AP | Schema/read only | Bills, due dates, paid amounts, approval fields, attachments and cash projections exist. Only demo insertion was found. Native create/edit/approve/post/pay/credit/reverse workflow is missing. Purchasing purchase orders remain a separate operational record. |
| Receipts/document review | Implemented subset | Shared document security/extraction/review pipeline; private files and source evidence exist. A reviewed receipt does not automatically establish a booked expense or tax credit. |
| Expense claims/reimbursement | Missing | No employee expense claim, split coding, approval and reimbursement posting lifecycle found in the BookLoQ paths. |
| Financial reports | Partial | `buildFinancialStatements` creates cumulative P&L/balance sheet/trial balance. `ReportsPanel` honestly labels cumulative posted balances, not period-specific statutory statements. `server/executive-finance.ts` has a separate period-filtered accounting read model. These implementations need alignment. |
| Period comparisons/GL drill-through | Partial/missing | Executive financial metrics support defined periods and prior comparisons. BookLoQ reports lack complete date/as-of controls, general ledger line drill-through, and a complete financial statement export pipeline. |
| Exports | Partial | Local CSV for displayed rows; PDF/XLSX report controls explicitly disabled. No server-side complete export job, durable export audit, or accountant bundle. Large capped tables cannot be treated as complete exports. |
| Custom report builder | Missing | No financial report definition/dimension/filter/template engine found. General Vanteloq reports are not a replacement for a BookLoQ ledger report builder. |
| Cash intelligence | Implemented subset, retain | Full-scope calculation queries, source-qualified cash, 13-week schedule, dated commitments, confidence categories, PO/bill de-duplication, foreign currency and missing-date withholding. Not a guarantee of payment or a statistical forecast. |
| Budgets | Partial, identity bug | Persisted revenue/expense category budgets and scoped actuals exist. Re-upsert returns/audits a new unused ID. No budget versioning/approval or complete forecast scenarios. |
| Taxes | Partial | Integer rate calculation, generic per-line tax fields and GST collected/recoverable accounts. No tax-code registry, effective-dated jurisdiction rules, place-of-supply engine, recoverability policy, filing period/adjustment ledger or filing integration. |
| Cash/accrual policy | Schema/read only | `bookloq_settings.accounting_basis` is displayed but does not drive alternative report/posting engines. Do not advertise a functional report basis switch. |
| Month-end checklist | Partial | Stored items, status updates and lock/unlock exist. No production checklist generation; no reliable automated evidence dependency; locked checklist items remain mutable; lock read/write can race. |
| Audit trail | Partial, integrity defect | Trusted actor and organization are stored by `server/audit.ts`. Financial writes generally commit before audit insert. Failure can leave unaudited committed change. The BookLoQ audit query omits some financial resource types and the UI omits actor identity. |
| Finance roles/accountant access | Partial/duplicated | Generic granular `access_roles`/`team_members` is enforced. `bookloq_role_assignments` enumerates accountant/AP/AR roles but is not read by effective permissions. Coarse `context.role` checks can override granted granular finance permissions. No complete accountant access lifecycle. |
| Payroll | Manual journal boundary | Response explicitly says `manual_journals_only`. No native payroll calculation/remittance/run/payment system should be inferred. |
| Multi-location accounting | Partial | Transactions/budgets have dimensions. Most ledger/report/bill/tax records remain organization-wide. No approved allocation, inter-location transfers, department accounting or consolidation engine. |
| QuickBooks/Xero migration | Missing as migration | Existing provider/report integration is not historical ledger migration. No reviewed mapping, opening-balance reconciliation, exception queue, rollback and migration reconciliation package found. |
| Automation | Partial | Category suggestions and collections follow-up delivery exist. No general validated accounting trigger/approval/posting automation engine. Never auto-post AI/category suggestions as journals. |
| AI explanations | Partial, retain limits | Rule-based guidance and advisor context preserve missing-data/source boundaries. They cannot perform absent reconciliations, payments or tax filings. Use actual document/journal links as the posting lifecycle grows. |

## Concrete findings and proposed regression tests

### A1. Archived bank ledger accounts disappear from BookLoQ statements (P1)

`app/api/v1/bookloq/route.ts:136–144` aggregates only `a.active = 1`. `server/integrations/plaid.ts:985–997` intentionally archives financial accounts during consumer-data deletion while retaining accounting records. A posted cash debit against a retained archived bank account then disappears from the trial balance and balance sheet while its opposite entry remains. This is a concrete reachable accounting discrepancy, not just a hypothetical future archive feature.

Fix: keep posted balances for inactive accounts in financial statements; distinguish the selectable active account catalogue from the report set. Test a balanced posted journal, archive its bank account through the supported retention logic, and require unchanged balanced ledger totals. Keep inactive accounts unavailable for new manual posting.

### A2. Granular cost/profit restrictions are omitted from the complete-ledger gate (P1)

`route.ts:335–340` requires payroll totals, bank balances and AR/AP, in addition to the route-level statements permission, but does not require `finance.costs` or profit permission before exposing all ledger expense accounts and `summary.grossProfitCents/operatingProfitCents/totalExpensesCents` around lines 752–758. The permission DTO defines `costs`, but the complete-ledger gate does not consume it. Generic custom roles can deny these fields. Compare the stricter executive report permission gate.

Fix: define and reuse a complete-financial-data gate, or redact in a way that prevents reconstruction. Test a role with statements/bank/AR/AP/payroll access but denied costs/profit, plus an authorized accountant and owner. Do not loosen location boundaries.

### A3. Journal input accepts a contact belonging to another tenant (P2)

`journals/route.ts:71–99` validates accounts by organization, but passes `line.contactId` directly into the journal-line insert. `db/schema.ts:1801` has an ID-only contact FK. The input can therefore attach a known other-tenant contact ID to a local journal. Existing report joins also require tenant identity, which limits the observed result to an invalid cross-tenant relationship rather than demonstrated contact disclosure. Location, department and project values similarly have no tenant dimension validation.

Fix: validate contact existence/active state and tenant ownership; validate supported dimensions against the tenant model or explicitly reject unsupported dimensions. Test local/foreign/inactive/missing contacts and location aliases. Never read an unscoped contact to produce a more specific error.

### A4. Journal idempotency is not bound to its payload or operation (P2)

POST returns any journal found for the tenant/key before parsing the request (`journals/route.ts:57–60`). PATCH does the same after parsing basic reversal fields (`:129–131`). Reusing a key for a different amount, account, date, source journal, or POST versus PATCH returns success for unrelated work.

Fix: compare canonical persisted input, or store a canonical request hash with operation identity. Identical replay must work even after its period closes or the original is reversed. Changed input must return a conflict and must not mutate anything. Tests must cover POST/PATCH key collisions and changed reversal reason/date/source.

### A5. Match confirmation has a check-then-write race and can downgrade reconciliation (P1/P2)

`actions/route.ts:170–199` reads one confirmed match, then separately inserts/updates a match and sets the transaction to `matched`. Uniqueness in `db/schema.ts:2057–2060` is per target, not per confirmed transaction. Two overlapping requests for different targets can both pass the read and confirm both. Matching a transaction already marked `reconciled` also overwrites that state with `matched`. A failure between statements leaves inconsistent state.

Fix: enforce allowed transaction state and one-confirmed-match invariant inside an atomic write; preserve or reject reconciled rows; revalidate target currency/mode/state at write time. Return a conflict when the requested target lost the race. Test concurrent different targets, replay of same target, existing suggestion, reconciled/removed/pending transactions, and failure rollback. Add an explicit audited unmatch workflow later; current API tells the user to remove an existing match but has no such action.

### A6. Financial commit and audit insertion are not atomic (P1/P2)

`journals/route.ts:101–104`, `actions/route.ts` and invoice create commit financial mutations and then call `recordAudit` separately. If the audit write fails, the request fails after money records changed. A journal retry returns its existing ID before restoring the missing audit. `server/audit.ts` records actor/context correctly but is not part of the financial transaction.

Fix: prepare a common audit insert and include it in the same database batch/transaction as durable finance changes, or use a durable transactional outbox with an explicit recovery invariant. Never invent a successful audit when insertion failed. Inject audit failure in a real database test and require either full rollback or a durable recoverable outbox record.

### A7. Budget upsert returns and audits a nonexistent ID (P2)

`actions/route.ts:219–227` generates `budgetId`, but conflict updates the existing scoped row without changing its ID. Response and audit still use the new UUID. Fix with `RETURNING id` and record the persisted identity. Test create then update same scope, one row, stable returned/audited ID and updated amounts.

### A8. Locked month-end evidence can be edited; close lock can race (P2)

`actions/route.ts:237–241` updates a checklist item without checking its period. `:272–276` separately checks incomplete items then locks. A second reviewer can change the checklist between check and lock, or change it after lock. Fix checklist edits to require open/review period in the write predicate and lock with an atomic completeness predicate. Tests should prove edits fail after lock and a competing incomplete update cannot leave a locked incomplete checklist. Empty checklist policy must be explicit rather than assumed complete.

### A9. Limited lists silently shape count/export claims (P2)

GET caps transactions at 1,000, bills/invoices at 200, documents at 200, matches at 500 and periods at 24. `summary.upcomingBillsCount` uses the capped raw bills list, including records outside the final visible source-mode/currency projection. `TransactionsPanel` labels one filter “All imported history” and local CSV exports only the loaded rows. The separate collections aggregate and cash computation paths already demonstrate a better full-query/capacity boundary.

Fix count calculations independently of paginated rows; expose cursors/has-more and loaded-scope language; export through a complete, permission-checked server job or label a limited selection. Test >200 bills in mixed modes/currencies and >1,000 transactions.

### A10. Retained Plaid transactions can be treated as approved after replacement connection (P2, add regression)

`route.ts:154–162` approves transaction visibility when any connected approved Plaid record exists for the organization; it does not correlate transaction account to the current Item. `disconnectPlaid` clears old bank Item refs and keeps transaction history, then `claimPlaidConnection` permits replacing the Item. A new approved Item can make old retained transactions visible under the current approval condition. The bank balance query correctly correlates Item refs. Retained history may remain available, but must not be promoted as current connected source data merely because another Item was approved.

Test disconnect A, connect/approve B, and verify A transactions retain a historical/disconnected boundary and do not satisfy current live-source coverage. Do not delete valid accounting records to resolve this.

## Tax scope and official evidence

The existing helper `calculateCanadianTax(subtotalCents, rateBasisPoints)` correctly performs integer arithmetic for a supplied rate. It does not determine which tax applies. A country/province setting plus a rate is not enough for a jurisdiction engine.

- Federal GST/HST selection depends on type and place of supply. Zero-rated and exempt classifications must remain distinct. Store a tax classification and effective-dated jurisdiction decision, not simply a displayed percentage. [CRA: GST/HST rates and place-of-supply rules](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-place-supply.html).
- CRA explains that charged GST/HST is reported for the period covering the invoice date even when payment has not arrived. The existing invoice-email status change and missing issuance tax journal cannot serve as an integrated tax posting system. [CRA: Charge and collect the GST/HST](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html).
- Quebec's QST and GST/HST reporting needs separate tax records and eligible ITC/ITR support. Generic `gst_collected - gst_recoverable` is not a validated Quebec working paper. [Revenu Québec: Reporting GST/HST and QST](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/reporting-gsthst-and-qst/), [invoice support requirements](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/collecting-gst-and-qst/preparing-invoices/).
- Provincial PST is a separate system; British Columbia describes its taxable goods/software/services and exemptions independently. A future engine must not treat all provincial tax as federal recoverable input tax. [B.C. Ministry of Finance: PST](https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst).

These sources were checked for architectural requirements, not to certify a taxpayer's treatment. No US sales-tax engine, current state/local nexus determination, filing integration or jurisdiction certification was verified. Keep the current “tax filing not available” disclosure. Add tax-code and effective-date tests before expanding claims.

## Permission and accounting-control design decisions

1. Keep one effective permission system. `bookloq_role_assignments` currently duplicates a role vocabulary without enforcement. Do not make it appear active by rendering its names. Decide explicitly whether it is retired or migrated into the generic tenant access-role system.
2. Resolve the mismatch between granular finance grants and broad membership role checks. An employee-level membership can receive an accountant template yet fail `requireBookLoQPermission(role, 'post_journals')`. The finance templates also omit `payroll.totals`, which currently blocks a complete ledger. Prefer deliberate finance capability boundaries over granting broad administrator power.
3. Separate record visibility, preparation, approval, posting, reversal, period unlock, and initiating an external payment. Current manual journals self-approve for authorized owner/admin; maker/checker approval is not implemented.
4. Ledger reads must include all posted accounts, stable base currency and a defined date basis. Cash/accrual and multi-currency modes require explicit engines and versioned policy, not a setting-only label.
5. Do not extend phase scope by auto-posting bank imports, invoice sends, AI suggestions, or matching actions. Add durable source posting records and idempotent document transitions first.

## Existing tests to retain and extend

- `tests/bookloq.test.ts`: pure journal validation, reversal helper, tax arithmetic, financial statement balance, permissions and verified-bank functions.
- `tests/bookloq-cash-regressions.test.ts`: real D1/migrated worker accounting authorization/period tests, complete collections totals, cash/source and commitment boundaries. Requires a current built worker; do not run against stale output and call it source verification.
- `tests/intelligence-flow.test.mjs`: demonstration ledger balance, manual journal replay/reversal, scope/permission response boundaries. Its accounting setup uses the demo route and direct fixture updates, so it does not prove live onboarding works.
- `tests/bank-statement.test.ts` and `tests/bank-statement-flow.test.mjs`: reviewed import arithmetic, scoped atomic persistence and historical cash boundary.
- `tests/invoice.test.ts` and `tests/invoice-security-flow.test.mjs`: invoice integer arithmetic, PDF and security flows.
- `tests/bookloq-review-regressions.test.ts`, `tests/bookloq-guidance.test.ts`, `tests/advisor-bookloq.test.ts`: missing-data, comparison and explanation limits.
- `tests/bookloq-standalone-billing.test.ts` and `tests/paid-feature-routing.test.ts` where present: entitlement/action gates. Static source assertions are useful but are not authorization runtime proof.

## Proposed implementation sequence

1. Fix demonstrated integrity/security defects and add isolated regressions. Preserve the snapshot above and record resolved IDs separately.
2. Add guarded live settings/chart/period initialization with fiscal/calendar validation, explicit source mode, idempotency and audit. Test a completely new live tenant without demo seeding.
3. Establish a shared transactional posting service with immutable source linkage and request-content idempotency. Add invoice issuance, payment allocation and reversal as separate authorized transitions; then bills, expenses, credits and settlement records.
4. Build actual reconciliation sessions against posted ledger balances, with explicit statement completion, zero-difference rules, outstanding items and audited undo. Keep evidence matching separate.
5. Consolidate period-aware reporting, complete export, audit traceability, granular finance roles and tax working papers. Only then expand advanced migration, automation and jurisdiction claims.

The current implementation can be refined safely without discarding its useful foundations. Completion requires demonstrated document-to-journal-to-report-to-reconciliation paths, not a larger navigation tree.

## Subsequent bounded remediation, 2026-10-04

After this snapshot was saved, the coordinating task authorized focused integrity edits. This section records that separate work without rewriting the findings as if the gaps never existed.

- **A3, contact portion resolved:** manual journal creation now validates active tenant-owned contacts through `validateJournalContacts`. Department/project/location dimension validation remains a broader follow-up.
- **A4 resolved for current manual/reversal routes:** `findJournalReplay` compares persisted posting fields and every line dimension, or reversal source/date/reason. Different payloads or operations return `JOURNAL_REQUEST_CONFLICT`; exact replay remains valid after period closure or original reversal. Concurrent identical submissions recover the persisted entry after a batch conflict.
- **A5 current API confirmation path resolved:** `confirmSupportingMatch` uses an atomic guarded insert/upsert plus transaction update, revalidating transaction and target state/currency/mode. Competing different targets cannot both confirm through this path. Reconciled records are rejected rather than downgraded. An unmatch workflow and a global database uniqueness invariant remain future work.
- **A6 journal posting/reversal resolved:** `server/audit.ts` now exposes `prepareAudit`, sharing the same trusted fields/metadata checks as existing `recordAudit`. Journal financial writes and audit insert are in one D1 batch. Other legacy action/invoice audit calls are still separate; do not mark all audit atomicity complete.
- **A7 resolved:** budget upsert uses `RETURNING id`, so response and audit reference the actual persisted scoped budget row.
- **A8 lock/checklist portion resolved:** checklist mutation requires an open/review period and expected previous item status at write time. Lock requires a nonempty complete checklist in its write predicate. The error text explicitly says checklist completion records reviewer work and is not automatic verification of the books.

Exact changed source ownership: `server/bookloq.ts`, `server/audit.ts`, `app/api/v1/bookloq/journals/route.ts`, `app/api/v1/bookloq/actions/route.ts`. Added `tests/bookloq-integrity.test.ts`. The coordinating task separately owns live setup, GET statement/permission fixes, and UI improvements.

Validation completed: `node scripts/test.mjs tests/bookloq-integrity.test.ts tests/bookloq.test.ts` passed **21/21 tests**, including migrated D1 concurrency, failed-write rollback, payload conflicts, tenant contact checks, stable budget identity and close-lock races. These exercise current source helpers directly, without a built worker. No build, deployed API verification, or provider action was run by this subtask.

### Final review follow-up

- **A10 resolved for the reviewed BookLoQ GET paths:** the transaction list, trusted-transaction health query, and supporting matches share `server/bookloq-source.ts`. A Plaid transaction must map to a bank account belonging to the same organization and to that account's currently connected, approved Item, without an active sync lease. Replacing Item A with Item B cannot promote A's retained transactions or matched evidence. Records remain stored; the response states the retained/disconnected source boundary.
- **Additional permission leak found and resolved:** `customers.identity` previously hid the contacts list but left bank contact names/descriptions, invoice customer names/emails, supplier names and derived cash-planning labels visible. Match payloads also revealed invoice/bill IDs, references and notes when `finance.ap_ar` was denied. `server/bookloq-visibility.ts` now masks identity-bearing structured fields and unstructured review text, applies generic names before derived planning labels, and masks target details according to AP/AR and document permissions. A confirmed match remains as an anonymous marker, preventing the UI from offering conflicting evidence. Authorized financial amounts, dates, statuses and operational references are preserved. Fully permitted responses remain unchanged. Journal/alert prose, audit detail and saved source-rule text are also withheld when the required identity/detail permission is absent.

New validation: `node scripts/test.mjs tests/bookloq-permission-source.test.ts tests/bookloq-visibility.test.ts` passed **8/8 tests**. The permission/source test invokes the actual current GET handler with an isolated auth fixture and migrated D1, so it verifies the final serialized API response, not merely helper behavior. It covers denied identity, independently denied AP/AR/documents, approved replacement Items, active leases, staging, foreign account references and retained-row preservation. Typecheck passed after these changes. No production connection or deployment was touched.
