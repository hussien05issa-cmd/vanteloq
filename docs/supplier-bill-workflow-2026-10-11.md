# Supplier bill accounting and purchasing connection

## Implemented workflow

BookLoQ Bills now supports a reviewed supplier invoice, separate approval, accrual posting, partial or full recording of payments already made, corrections, and retained source history. No action initiates a bank transfer.

1. Choose an active supplier, enter its bill number, actual document date, due date, exact subtotal and reviewed recoverable tax, and retain a supplier document reference.
2. Optionally link a purchase order. This release supports one bill for one complete, undiscounted order. Supplier, currency, delivery location and subtotal/tax/total must agree. Every line must be fully accepted, not previously invoiced, and supported by retained goods or workflow receiving records. A received status alone cannot prove delivery.
3. Review and approve the bill. Approval alone changes no ledger balances. An authorized person separately chooses the appropriate expense or inventory asset account and input-tax asset before posting. Non-recoverable tax and multiple account allocation are not assumed.
4. Posting debits the reviewed cost/inventory and recoverable tax accounts, and credits accounts payable. Stock received but not yet sold ordinarily remains an inventory asset. This posting does not recognize COGS for sales or replace the inventory valuation workflow.
5. Record money already paid. The entry debits payable and credits cash. An optional bank outflow must have the exact account, posting date, negative amount and currency, with no competing document allocation or ledger posting. The movement remains available for statement reconciliation.
6. Correct a recorded payment with a retained reversing journal. Correct unpaid posted bills by retaining and reversing the liability journal, marking the bill void, and releasing reviewed PO invoiced quantities. Incorrect unposted bills may be archived with a reason while preserving their review history.

The original and reversal remain in dated ledger reporting. Actual supplier credits, refunds and payment initiation are separate business events.

## Integrity and privacy

- Tenant-scoped access requires BookLoQ, organization-wide location access, AP/AR, costs and supplier/contact identity permissions. Posting additionally requires journal authority; bank allocation additionally requires bank balance and transaction access. Bank source identifiers are omitted from history when the reader lacks bank transaction access.
- Exact integer cents, valid calendar dates through the business's current date, live accrual books and two-decimal base currencies are required.
- Existing generic atomic guard and mutation tables are reused with `supplier-bill:` identifiers. No old migration was modified and no new financial table was introduced.
- Every mutation saves its guarded state changes and audit in one D1 batch. Guards recheck settings, bill amounts/balances, period status, account types, retained receiving, PO authority and unused bank evidence at commit time.
- A repeated request retrieves its saved result. Reusing a key with changed details conflicts. Concurrent postings cannot create two liabilities; concurrent allocations cannot overpay a bill.
- The interface freezes uncertain write details and reuses the same key. Financially meaningful changes are never retried automatically with a new key.
- Payment references, approved bills and correcting reasons remain in retained history. No claim is made that an owner-entered reference independently establishes provider evidence.

## Verification

`tests/supplier-bill-accounting.test.ts` passed nine populated synthetic D1 tests. It checks approval versus posting, partial/full payment, retained reversals and void, exact replay, wrong tenant, unsupported fields, inexact amounts, future dates, mode/period gates, concurrent posting and overpayment, bank evidence reuse, reconciled source protection, whole-order receiving proof, duplicate order billing, failed audit rollback and commit-time period/account changes. Reversed receiving between validation and posting blocks the entire batch; an active posted bill also blocks receipt reversal.

`tests/supplier-bill-http-flow.test.mjs` passed a populated route lifecycle test using the source bill handlers. It verifies owner creation, approval and posting, unsigned and cross-origin rejection, tenant isolation, organization-wide location authority, retained history, and rejection of generic journal correction outside the bill workflow.

The tests use invented records in isolated local databases. They do not send payments, change production financial records, or establish production backup/restore or external provider approval. Authenticated live visual verification of the new Bills panel remains required after publication.

## Boundaries and next work

Partial PO bills, discounted orders, line-level supplier exceptions, supplier credit notes, multi-bill payment allocation, foreign-currency exchange, non-recoverable tax allocation, automated OCR conversion and actual payment initiation remain outside this bounded workflow. Existing posted imported bills without this workflow's retained posting event require reviewed migration. These boundaries appear in the Bills interface.

A populated production restoration drill remains unverified. Journal/source history protection in this increment is enforced by the supported writers and same-batch assertions; expanded financial schema and historical migrations should follow recovery evidence rather than a source deployment alone.

## Research basis

- [Xero: Add and approve bills](https://central.xero.com/0/article/Add-and-approve-bills), consulted 11 October 2026. Xero distinguishes draft/approval and uses supplier references to warn about duplicate bills. This informed the separate bill approval and liability-posting actions.
- [Zoho Procurement: Purchase order matching](https://www.zoho.com/us/procurement/help/bills/purchase-order-matching/), consulted 11 October 2026. Its documented matching checks order quantities and rates and associates the bill with the purchase order. This informed exact supplier/order/receiving comparison, with exceptions kept in explicit review.
- [IFRS: IAS 2 Inventories](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/), consulted 11 October 2026. Inventory cost and recognition when sold informed the distinction between receiving stock, recording supplier AP, and recognizing COGS. This is a product calculation boundary, not a determination of any customer's applicable accounting framework.

These are documented capability references, not claims of hands-on competitor testing or superior accounting accuracy.
