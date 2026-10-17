# BookLoQ accounting research and implementation register

Reviewed 11 October 2026. This change continues the original invoice-to-cash work and adds the requested CSV bank workflow. It strengthens the existing BookLoQ product, whose ledger, dated reports, document review, bank feeds, cash forecasts, permission system and month-end controls were already present.

## Research access and interpretation

The requested [Internet Archive item](https://archive.org/details/isbn_9780070365971) was inaccessible through the available research tools. The [ISBN catalog](https://www.abebooks.co.uk/9780070365971/Solutions-Manual-Modern-Advanced-Accounting-0070365970/plp) identifies E. John Larsen's *Solutions Manual (Modern Advanced Accounting)*, sixth edition, McGraw-Hill, 1993. Its text was not read. A historical solutions manual cannot establish current accounting requirements.

Google Scholar pages were also inaccessible. Scholarly work was obtained from accessible author and university sources. David Ellerman's author manuscript and Wang and Strong's university-hosted paper were reviewed; Hongjiang Xu's university abstract was available, rather than the full paper. Implementation choices below are engineering interpretations of the research, not findings that these authors tested BookLoQ.

Primary standards and official competitor documentation were used to check accounting principles and current product behavior. Canada is the existing workspace context. The [IFRS Foundation's Canada profile](https://www.ifrs.org/use-around-the-world/use-of-ifrs-standards-by-jurisdiction/view-jurisdiction/canada/) distinguishes publicly accountable entities from private enterprises, which may use Canadian private-enterprise standards or IFRS. BookLoQ's accrual setting is not a declaration of either framework's compliance.

## Evidence translated into product behavior

| Source | Relevant principle | Implemented behavior or explicit boundary |
| --- | --- | --- |
| [Ellerman, *On Double-Entry Bookkeeping: The Mathematical Treatment*, 2014](https://arxiv.org/abs/1407.1898) | Double-entry provides a consistent mathematical representation of accounts and changes. | Monetary inputs use exact integer cents; every generated journal balances; retained reversals offset original entries; dated reports include the original and subsequent correction on their respective dates. Integer arithmetic, database atomicity and retry keys are engineering choices. |
| [Wang and Strong, *Beyond Accuracy: What Data Quality Means to Data Consumers*, 1996](https://web.mit.edu/tdqm/www/tdqmpub/beyondaccuracy_files/beyondaccuracy.html) | Useful data quality includes completeness, interpretability, accessibility and contextual relevance. | CSV date formats, decimal formats and money direction are explicit. Complete rows are reviewed, row errors identify their source, missing balances require input, and source evidence is retained with restricted access. Missing information does not become zero. |
| [Xu, *What Are the Most Important Factors for Accounting Information Quality and Their Impact on AIS Data Quality Outcomes?*, 2015](https://digitalcommons.butler.edu/cob_papers/208/) | The abstract associates input controls and system suitability with perceived accounting information quality. | Human review precedes import or posting; server validation and database constraints repeat critical checks at commit time; the UI explains the accounting effect before confirmation. The abstract does not establish causal benefits for this implementation. |
| [IFRS 15 overview](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/) | Revenue recognition depends on satisfying contractual performance obligations. | Posting requires explicit confirmation that the invoiced goods or services have been delivered. The invoice posts a receivable, earned revenue and entered tax; a received payment debits cash and credits the receivable. This workflow supports fully earned invoices, not a complete contract-recognition engine. |
| [CRA, *Electronic Records*, revised September 2026](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/15-2/electronic-records.html) | Records should support source-to-account tracing; conversion and correction controls should preserve reliable evidence. | Original CSV text, digest, mapping, source rows, journal links, actors, dates and correction reasons are retained. Posted financial effects and audit evidence are committed together. CSV archives retain originals. Retention periods, residency, backup restoration and organization-wide recordkeeping policies require separate operational validation. |
| [QuickBooks Canada CSV guidance](https://quickbooks.intuit.com/learn-support/en-ca/help-article/bank-transactions/format-csv-files-excel-bank-transactions-quickbooks/L4BjLWckq_CA_en_CA?uid=msyvkqqf) and [Xero CSV guidance](https://central.xero.com/0/article/Import-a-CSV-bank-statement) | Bank exports need clear field mapping and consistent amount/date interpretation. | Supports quoted fields, embedded newlines, comma/semicolon/tab delimiters, signed amounts and separate money-in/money-out columns. Ambiguous dates and credit/debit direction are never guessed. Mapping is retained with each import; reusable account-level mapping presets remain future work. |
| [QuickBooks reconciliation](https://quickbooks.intuit.com/learn-support/en-us/help-article/statement-reconciliation/reconcile-account-quickbooks-online/L3XzsllsK_US_en_US?uid=lyq1tp8w) and [Canada difference guidance](https://quickbooks.intuit.com/learn-support/en-ca/help-article/statement-reconciliation/fix-issues-end-reconciliation-quickbooks-online/L3mZimyAb_CA_en_CA?uid=m9bitr6i) | Reconciliation compares books against independently supplied statement balances and resolves differences. | Completion requires every source movement to have an exact unused cash-ledger link, a verified opening basis and zero difference. Outstanding ledger items remain visible and can clear on subsequent contiguous statements. No adjustment entry is manufactured to force agreement. |
| [Zoho Books banking documentation](https://www.zoho.com/ca/books/help/banking/dashboard.html) | Imported transactions need duplicate and matching controls. | Repeat reviewed requests replay safely; active duplicate files and overlapping statement periods are blocked. Source row identities preserve legitimate repeated equal-value movements. Exact ledger matches are used once. |
| [IAS 7 overview](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/) | Actual cash-flow reporting distinguishes operating, investing and financing activities and relates to cash balances. | Existing cash forecasts and imported movement analysis remain separate from ledger reports. This increment does not implement a fully classified statutory statement of cash flows. |
| [IAS 2 overview](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/) | Inventory measurement and expense recognition require a consistent costing policy. | Inventory costing was not replaced with a bank-expense shortcut. A complete quantity, cost-layer, return, write-down and COGS engine remains a separate development domain. |

Competitor features vary by country and plan. The initial QuickBooks description should not be treated as an authoritative specification: Canadian inventory is offered in Plus and Advanced; Canadian scorecard documentation and some US AI announcements use different plan or regional availability. The implementation follows accounting needs rather than copying a marketing claim.

## Connected workflows implemented

### Earned invoice to cash

1. Create the existing invoice and private PDF using exact quantity, price and tax arithmetic.
2. Review earned revenue, account choices and the posting date in an open period. Post accounts receivable against revenue and entered tax.
3. Record a partial or full received payment into a cash account. Optionally allocate one exact bank receipt to that invoice. The payment reduces receivables and never posts revenue again.
4. Review retained event history. Reverse a payment or void an unpaid posted invoice through a dated, reasoned reversal. Original entries and source links remain in history.
5. Reconcile a source-linked receipt through the statement workbench. Corrections to a cleared receipt require reopening its latest reconciliation first.

Canonical request keys, invoice allocation checks, source ownership and database commit checks protect repeat or concurrent requests. A changed request cannot reuse the same posting key. A failed audit write rolls back the financial posting. Generic journal reversal cannot bypass the invoice correction workflow.

### Bank CSV to reconciled books

1. Upload UTF-8 bank CSV text and choose or create a manual cash account. Current limits are 300 KB and 500 source movements per file. Credit accounts, foreign currency and mixed currencies require separate workflows.
2. Map columns; explicitly select date and decimal formats and amount direction; provide the actual statement opening and closing balances.
3. Preview every normalized row, correct source errors, and confirm the exact preview. The original private text and source mapping are retained. Importing creates reviewable movements without creating profit or journals.
4. Review a movement's purpose and entered tax. Post a balanced cash journal, or match an existing unused cash line with the exact account, amount and currency. Invoice and bill allocations are routed to their document workflow rather than arbitrary AR/AP postings. Connected feed cash movements use the same transaction review controls while preserving their existing source-approval rules.
5. Independently reconcile to the complete statement. The first statement needs an established opening ledger basis; later statements carry the prior baseline and outstanding items. A correction does not silently reset the opening balance.
6. Complete only when all source movements are linked and the independently calculated difference is zero. Retain the snapshot and clearing lines. Reopen only the latest run, in an open period, with a reason. Previous runs remain in history.
7. Archive an incorrect CSV only while its rows have no posting, allocation, matching or reconciliation history. Retain its original evidence and archived explanation; review a corrected replacement separately.

CSV/PDF statement periods cannot overlap for the same bank account. Database checks re-evaluate source eligibility, ledger sums, periods, allocations and reconciliation continuity when changes commit. Imported statement movements must be posted and reconciled before the accounting period can lock.

### Reports, permissions and UX

The existing dated P&L, balance sheet and trial balance consume posted ledger entries. Posting and source-link identifiers now return to the workspace. Work to Review distinguishes category/evidence review from ledger posting; a fully cleared invoice receipt does not require a redundant business category. Transaction rows explain whether they are unposted, ledger-linked or statement-reconciled.

The interface adds journal previews, deliberate review confirmations, complete source tables, visible reconciliation arithmetic, clear outstanding balances, correction reasons and retained histories. Forms use the existing theme variables, readable labels, focus handling and mobile layouts. Uncertain posting responses preserve a frozen retry request while the review stays open.

Server access checks combine membership, entitlement, organization scope, role and granular financial/document permissions. Managers can prepare work without receiving posting authority. Read-only members cannot post by granting themselves a granular journal permission. Identity and unstructured source text remain masked where grants are absent; original CSV download requires both document and identity access. Original text downloads use a plain-text attachment with nosniff and sandbox response headers.

## Verification record

Automated tests exercise migrated D1 databases, private object storage, built Worker routes and actual journal/report calculations. Coverage includes concurrent invoice issue/payment, partial settlement, overpayment rejection, strict request fields, exact retry replay, cross-tenant and granular permission boundaries, audit rollback, period-close races, source retention, duplicate/overlap rejection, tax posting, outstanding deposits clearing in a later statement, reconciliation reopen and workspace deletion cascades. Historical dated reports preserve earlier revenue when later corrections post.

TypeScript checking, production build and canonical migration artifact validation are required before publication. Existing setup, statement import, invoice PDF/email security, visibility, cash guidance and migration upgrade regressions are checked alongside the new workflows. Browser QA is unavailable in this environment; responsive CSS and source checks are not equivalent to observing interactions in a browser.

## Remaining advanced accounting domains

These are development requirements, not claims that this change already delivers them:

| Domain | Necessary connected behavior |
| --- | --- |
| Framework and migration policy | Explicit jurisdiction/framework policy, verified opening trial balance, fiscal calendar, retained earnings and conversion reconciliation. |
| Contracts, deposits and credits | Deferred revenue, advances, staged delivery, credit notes, refunds, multiple invoices per receipt and allocation of one invoice across settlement components. |
| Accounts payable | Supplier bill posting, approval separation, partial payments, bank allocation, credits and payable ageing tied to the general ledger. |
| Actual cash-flow statement | Reviewed activity classification, noncash exclusions, cash-equivalent policy and reconciliation to the dated balance sheet. |
| Inventory and job costing | Quantity movements, cost layers, COGS, returns, NRV write-downs, warehouse transfers and project dimensions. |
| Foreign currency | Transaction and functional currency amounts, rate provenance, realized/unrealized gains and period revaluation. |
| Advanced close and consolidation | Accruals, prepayments, fixed-asset schedules, intercompany eliminations, consolidations and framework-specific disclosures. |
| Operations and collaboration | Tested backup restoration, legally reviewed retention/residency settings, reviewer segregation, mapping presets and accountant migration tooling. |

Tax inputs remain reviewed amounts; this increment is not a tax-filing or eligibility determination service. AI suggestions must preserve evidence and require review before affecting accounts. Unavailable information should remain visibly unavailable, and incomplete workflows should retain their explicit gates.
