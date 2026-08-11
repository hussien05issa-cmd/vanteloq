# BookLoQ, Plaid, document capture, and accountant-ready workflow research

Updated: 2026-08-11

## Research scope and conclusion

This note evaluates the safest useful scope for connecting BookLoQ to Plaid, accepting invoices and receipts, reconciling source records, and preparing an accountant-ready close. It uses first-party documentation from Plaid, Intuit, Xero, Wave, the Canada Revenue Agency, Canadian privacy regulators, Alberta, Cloudflare, and OWASP.

The recommended first production scope is deliberately narrow:

1. Connect supported Canadian business bank and credit-card accounts through Plaid Link.
2. Import transactions through `/transactions/sync` and show cached balance freshness.
3. Offer an on-demand real-time balance check through Plaid Balance only when a decision truly needs it.
4. Upload invoices and receipts to private object storage, extract draft fields, require review, and preserve the original document.
5. Match bank transactions, POS payouts, bills, invoices, purchase orders, and receiving records without silently posting uncertain entries.
6. Produce a close checklist, reconciliation evidence, an exception list, a trial balance, and exportable source documents for an accountant.
7. Keep payment initiation, payroll execution, tax filing, and autonomous journal posting outside the initial Plaid integration.

Plaid Sandbox can support a test implementation, but a live connection cannot be truthfully marketed or completed without Plaid Production credentials, approved products, an application and company profile, OAuth and redirect configuration where required, a production webhook endpoint, and live-institution testing. Plaid distinguishes Sandbox, which uses no real data, from Production, which uses live data, in its [official Quickstart](https://plaid.com/docs/quickstart/).

## Plaid product fit for BookLoQ

| Plaid product | BookLoQ value | Important limits | Recommendation |
| --- | --- | --- | --- |
| Transactions | Imports bank and credit-card activity for categorization, document matching, cash-flow history, and reconciliation. Plaid supports up to 730 requested days and sends added, modified, and removed updates through a cursor-based sync flow. | Updates are usually checked one or more times daily, not continuously. Pending records can disappear and be replaced by posted records. Categories and merchant names can be incomplete or incorrect. | Core product. Use `/transactions/sync`, store the cursor, process every page atomically, and preserve pending-to-posted lineage. See Plaid's [Transactions overview](https://plaid.com/docs/transactions/), [sync migration guide](https://plaid.com/docs/transactions/sync-migration/), and [transaction-state guidance](https://plaid.com/docs/transactions/transactions-data/). |
| Balance | Provides a live current or available balance for a specific decision. | Cached balances from general account endpoints are not real time. A live Balance request has higher latency, and `available` can be null at some institutions. Plaid reports approximate p50 latency of 3 seconds and p95 latency of 11 seconds. | Use on demand for treasury views and purchasing-capacity refreshes. Do not call every dashboard load. Label the timestamp and source. See Plaid's [Balance overview](https://plaid.com/docs/balance/) and [Balance integration guide](https://plaid.com/docs/balance/add-to-app/). |
| Identity | Can return account-holder names, email addresses, phone numbers, and addresses. | Only the name is guaranteed. A business account can report either an individual's name or the business name, and Plaid does not currently identify whether an account is a business account from this response. | Optional. Request only when account-ownership checking has a defined need. Do not collect it for basic bookkeeping. See Plaid's [Identity API](https://plaid.com/docs/api/products/identity/) and [Identity overview](https://plaid.com/docs/identity/). |
| Liabilities | Can enrich credit-card and loan schedules with balances, payment dates, amounts, rates, and loan terms. | Canadian coverage is limited. Data is refreshed approximately daily. The documented coverage is oriented mainly to credit cards, PayPal credit, student loans, and mortgages. | Optional and separately consented. Never make it a prerequisite for bookkeeping or promise coverage for a specific Canadian institution before checking it. See Plaid's [Liabilities overview](https://plaid.com/docs/liabilities/) and [Liabilities API](https://plaid.com/docs/api/products/liabilities/). |
| Investments | Can return holdings, securities, and investment transactions for connected brokerage accounts. | It is not a substitute for an investment subledger. Updates are normally checked overnight after market close. On-demand refresh is an add-on. Corporate actions can change security identifiers. | Exclude from the core bookkeeping connection. Add later only for business-owned brokerage accounts, with separate consent and reconciliation rules. See Plaid's [Investments overview](https://plaid.com/docs/investments/) and [Investments API](https://plaid.com/docs/api/products/investments/). |

### Minimum Plaid connection flow

1. Create each `link_token` on the server. Use an internal, non-personal user identifier and request only the products needed for the disclosed purpose. Plaid's [Link overview](https://plaid.com/docs/link/) describes the server-created token, user-facing Link session, temporary `public_token`, and server-side exchange for a persistent `access_token` and `item_id`.
2. Use `country_codes: ["CA"]` for a Canada-first connection experience. Add an OAuth redirect URI and mobile return flow where needed. Plaid's [OAuth guide](https://plaid.com/docs/link/oauth/) says a registered redirect URI is needed for supported redirect flows and recommends it for mobile web.
3. Exchange the `public_token` on the server. Store the resulting access token in an encrypted secret store, never browser state, logs, analytics, or client-accessible database fields. Plaid says an access token must be stored securely and never in client-side code in its [Transactions integration guide](https://plaid.com/docs/transactions/add-to-app/) and [API overview](https://plaid.com/docs/api/).
4. Associate each Item and account with one organization. Let the owner assign a human-readable account label, legal entity, and optional business location. Do not expose raw access tokens. Account and Item identifiers should also be masked in ordinary UI and logs even though Plaid classifies them as identifiers rather than tokens.
5. Call `/transactions/sync` once with no cursor to initialize updates. Save `next_cursor`. If `has_more` is true, keep fetching before committing the batch. If Plaid returns `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, restart from the first cursor for that batch, as required by the [Transactions sync guide](https://plaid.com/docs/transactions/sync-migration/).
6. Listen for `SYNC_UPDATES_AVAILABLE`, then apply `added`, `modified`, and `removed` records idempotently. A unique key should include organization, Plaid Item or account, and transaction ID. Preserve the relationship between a posted transaction and its `pending_transaction_id`.
7. Verify every Plaid webhook. Plaid signs webhooks with a JWT in the `Plaid-Verification` header. Its [webhook verification reference](https://plaid.com/docs/api/webhooks/webhook-verification/) requires checking ES256, the JWK, the issued-at time, and the request-body SHA-256 digest. The endpoint should also reject replays and process duplicate deliveries safely.
8. Surface connection health, last successful sync, initial-history status, and missing history. Plaid notes that institutions can be delayed or return limited history in its [Transactions troubleshooting guide](https://plaid.com/docs/transactions/troubleshooting/).
9. Use Link update mode for expired credentials, changed MFA, account permission changes, and consent renewal. Plaid documents `PENDING_DISCONNECT`, consent expiration, and renewal through [update mode](https://plaid.com/docs/link/update-mode/).
10. On disconnect or account closure, call `/item/remove`, invalidate and delete the local token, stop background work, and update the audit trail. Plaid describes `/item/remove` as a recommended offboarding practice and requires it to stop subscription billing for Transactions, Liabilities, and Investments unless the user has already revoked access. See the [Items API](https://plaid.com/docs/api/items/).

### Consent and product minimization

New US and Canada Link sessions use Plaid Data Transparency Messaging. Plaid states that consented products depend on the data scopes shown to the user and the products for which the customer has Production access. See the [Data Transparency Messaging guide](https://plaid.com/docs/link/data-transparency-messaging-migration-guide/) and [product initialization guidance](https://plaid.com/docs/link/initializing-products/).

BookLoQ should therefore use separate, understandable choices:

- Transactions and cached balances: needed for bookkeeping, reconciliation, and operating cash history.
- Real-time Balance: used only when the owner asks to refresh a cash-sensitive decision.
- Identity: optional account-ownership support.
- Liabilities: optional debt schedule support, with a warning that Canadian coverage varies.
- Investments: optional business-brokerage reporting, kept outside operating cash.

The user must be able to see connected accounts, scopes, status, last sync, and a disconnect control. Disconnecting Plaid access does not automatically erase accounting records that the business must legally retain. The product should explain that distinction before deletion.

## Transaction and reconciliation requirements

Plaid supplies bank-side records. It does not turn those records into verified accounting entries by itself. Plaid's own troubleshooting guidance says merchant names or category fields can be wrong, that delayed or missing transactions can occur, and that duplicate-looking records may be true duplicates, repeated Items, or pending and posted versions. BookLoQ must treat Plaid enrichment as evidence, not as an accounting conclusion.

### Required transaction states

- `pending`: visible but not eligible for final reconciliation or irreversible posting.
- `posted`: eligible for matching and review.
- `modified`: prior facts changed and every dependent match must be re-evaluated.
- `removed`: excluded from current reports while its audit history remains.
- `unreviewed`: imported but not assigned to a bookkeeping treatment.
- `suggested`: BookLoQ has a proposed account, tax treatment, document, or payout match.
- `approved`: an authorized user accepted the treatment.
- `reconciled`: included in a completed reconciliation period with a zero unexplained difference.
- `exception`: duplicate, missing evidence, split mismatch, foreign-currency issue, stale source, or policy conflict.

### Reconciliation model

The mature pattern across accounting products is not simply to import a feed. It is to compare a bank statement line with a record in the books, resolve exceptions, and close only when the difference is understood.

- Xero explains bank reconciliation as matching statement lines against transactions in Xero on its [bank reconciliation page](https://central.xero.com/s/article/Bank-reconciliation-in-Xero), and its [Bank Reconciliation report](https://central.xero.com/s/article/Bank-Reconciliation-Summary) checks whether the actual bank balance and the Xero bank account balance match.
- QuickBooks says the difference between the ending bank balance and the books should be zero, then gives a structured exception process for missing, duplicate, bundled, or slightly different records in its [reconciliation guidance](https://quickbooks.intuit.com/learn-support/en-ca/help-article/statement-reconciliation/fix-issues-end-reconciliation-quickbooks-online/L3mZimyAb_CA_en_CA).
- Wave creates a reconciliation period from a statement end date and closing balance, then displays unmatched transactions, matched balance, closing balance, and the difference in its [reconciliation workflow](https://support.waveapps.com/hc/en-us/articles/38599574877332-Reconcile-your-books).

BookLoQ should implement the same control with stronger cross-system evidence:

1. Select the account and statement period.
2. Record the statement closing date and balance.
3. Compare the statement balance, imported balance, and BookLoQ ledger balance.
4. Match one bank record to one or more ledger records, including split transactions.
5. Match net POS deposits to gross sales, refunds, processor fees, chargebacks, tips, and tax through a clearing-account packet.
6. Match supplier payments to one or more approved bills and their source invoices.
7. Show missing records, duplicate candidates, stale pending transactions, amount differences, and unsupported currency treatments.
8. Allow a reviewer to resolve or explain each exception.
9. Mark the period reconciled only when the unexplained difference is exactly zero in integer minor units.
10. Lock the period after approval. Corrections should create linked reversing or adjusting entries, not rewrite history.

## Cash-aware purchasing without an unsafe promise

Plaid Balance can support a cash-aware reorder recommendation, but a bank balance is not the same as cash available to spend. The safe deterministic calculation is:

```text
eligible cash base
- verified commitments not already reflected in the balance
- configured operating cash floor
- policy risk buffer
= preliminary purchasing capacity
```

Implementation requirements:

- Include only owner-selected business depository accounts. Exclude personal accounts, tax-only accounts, reserve accounts, credit limits, and investment market values unless the owner explicitly changes policy.
- Prefer a fresh `available` balance from `/accounts/balance/get` when the owner requests a real-time decision. If `available` is null, fall back to current balance only with a visible limitation. Plaid explains both nullability and cached-balance limitations in its [Balance documentation](https://plaid.com/docs/balance/).
- Subtract approved bills, payroll, tax, debt payments, approved purchase orders, and other scheduled outflows within the selected horizon.
- Do not subtract an obligation twice if its pending or posted bank transaction is already reflected in the balance. Match commitments to bank activity before calculation.
- Apply a configurable minimum cash floor and an explicit uncertainty buffer. Do not invent a universal percentage.
- Keep uncertain sales forecasts separate from confirmed cash. Projected inflows may appear in a scenario, but must not increase confirmed purchasing capacity.
- Show every included and excluded account, obligation, timestamp, data source, and formula component.
- If Plaid is stale, disconnected, or unavailable, say `Cash constraint unavailable` and return an inventory-only recommendation rather than a fabricated answer.

Safe language after this is live is `Uses connected balances and recorded obligations to estimate preliminary purchasing capacity.` Unsafe language is `Knows exactly how much you can spend` or `Prevents overdrafts.`

## Invoice and receipt capture

### What established products do well

- QuickBooks accepts receipt or bill uploads and email forwarding, extracts information, and asks the user to review, add, or match the document. When data is missing, the user must correct it. See Intuit's [receipt upload workflow](https://quickbooks.intuit.com/learn-support/en-ca/help-article/import-transactions/upload-receipts-bills-quickbooks-online/L862MmZHn_CA_en_CA).
- Xero's Hubdoc captures documents, extracts key data, and can publish a transaction to Xero with the document attached. See Xero's [Hubdoc overview](https://central.xero.com/s/article/Hubdoc-in-Xero), [data extraction guidance](https://central.xero.com/s/article/About-data-extraction-in-Hubdoc-US-SG-SA-ROW), and [publishing workflow](https://central.xero.com/s/article/Publish-Hubdoc-documents-to-Xero-US-GL).
- Wave can accept receipt images through mobile, browser, or email; create a corresponding expense; merge duplicate imported expenses; and let the user verify the date, amount, account, and category. The documented web limit is ten files per upload and 5 MB per file. See Wave's [receipt scan guide](https://support.waveapps.com/hc/en-us/articles/360059848112-Scan-and-upload-your-receipts).

The common strength is low-friction capture. The common documented constraint is that extraction and matching still require review. BookLoQ should not claim that OCR creates accurate books automatically.

### Secure capture pipeline

1. Accept only a documented allowlist such as PDF, JPEG, PNG, and HEIC after testing each parser. Apply per-file, per-batch, and per-organization limits.
2. Generate a random object key and a short-lived, single-object upload authorization. A private Cloudflare R2 bucket can use a presigned PUT without exposing storage credentials, as described in Cloudflare's [presigned URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) and [upload guide](https://developers.cloudflare.com/r2/objects/upload-objects/).
3. Keep the bucket private. Every later download must pass tenant and role authorization, then receive a short-lived URL.
4. Validate extension, declared MIME type, file signature, size, page count, and parser safety. Rename files on storage, scan for malware, and store them outside the public web root. OWASP recommends these controls in its [File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
5. Compute SHA-256 before extraction. Use it with organization, vendor, invoice number, date, currency, and amount to identify exact and probable duplicates.
6. Send extraction to a background queue with bounded retries and a dead-letter path. Cloudflare Queues supports retries, delays, batching, and dead-letter queues according to its [official documentation](https://developers.cloudflare.com/queues/).
7. Preserve the original object and create an extraction record that stores the engine, version, field value, field confidence, source page, and source bounding box.
8. Never let OCR directly post a bill, expense, tax credit, payment, or journal. Create a draft that an authorized user reviews.
9. Record who uploaded, viewed, changed, approved, rejected, posted, exported, or deleted the document.

### Fields worth extracting

- document type: supplier invoice, receipt, credit note, statement, or unsupported
- supplier legal and display name
- supplier address and tax registration number when present
- invoice or receipt number
- invoice date, service date, due date, and payment terms
- currency
- subtotal, discounts, freight, tips, provincial taxes, GST/HST, and total
- line-item descriptions, quantities, unit prices, item codes, and line totals
- purchase-order number
- payment method and masked card reference when present
- confidence and source coordinates for every extracted field

### Review and matching workflow

Use clear stages: `Uploaded`, `Scanning`, `Extracting`, `Needs review`, `Approved`, `Posted`, `Matched`, `Rejected`, and `Failed`.

The reviewer should be able to compare the original image with extracted fields, correct values, split lines, select the supplier, map expense or inventory accounts, confirm tax treatment, and explain unusual differences. BookLoQ should then attempt:

- exact duplicate detection
- probable duplicate detection
- invoice to purchase-order match
- invoice to purchase-order and receiving match
- receipt to bank or credit-card transaction match
- supplier bill to payment match
- invoice to customer payment match
- POS payout to clearing packet match

Every match needs a reason, confidence, amount difference, date difference, and user override. A suggestion is not a reconciliation.

## Accountant-ready close and competitor-derived gaps

### Evidence from current products

QuickBooks Accountant documents a year-end process that collects supporting documents, reviews the trial balance, makes adjusting entries, prepares financial statements, gets client approval, files the return, and locks the books. It also provides preparer, reviewer, and approver roles in Books Close. See Intuit's [year-end task guide](https://quickbooks.intuit.com/learn-support/en-ca/help-article/taxation/year-end-tasks-quickbooks-online-accountant/L1WwEf2rH_CA_en_CA), [Books Close workflow](https://quickbooks.intuit.com/learn-support/en-ca/help-article/custom-templates/onboard-client-books-close-template/L5TcpL5ZQ_CA_en_CA), and [Workpapers guide](https://quickbooks.intuit.com/learn-support/en-ca/help-article/map-forms-accounts/updated-view-workpapers/L8jLZWG1K_CA_en_CA).

Xero supports bank-reconciliation reports, user roles, history and notes, and lock dates. It explicitly recommends a lock date at year-end. See Xero's [year-end guidance](https://central.xero.com/s/article/Do-a-year-end-in-Xero-GL), [user role documentation](https://central.xero.com/s/article/User-roles-and-permissions-in-Xero-Business-edition-GL), and [history report](https://central.xero.com/s/article/View-a-history-and-notes-summary-for-transactions-and-user-activity).

Wave's year-end checklist requires every transaction to be entered, transactions to be categorized, and bank and credit-card accounts to be reconciled. Wave can invite accountants or other trusted collaborators with role-specific access. See Wave's [year-end checklist](https://support.waveapps.com/hc/en-us/articles/360036061991-Accounting-year-end-checklist) and [collaborator guide](https://support.waveapps.com/hc/en-us/articles/208621236-Invite-or-remove-collaborators-from-your-business).

These official documents establish a strong baseline. They do not establish that any one product combines live POS detail, purchase orders, receiving, bank records, invoice evidence, inventory decisions, and operational actions in one inspectable decision packet. That cross-system evidence packet is BookLoQ's credible opportunity.

### Recommended BookLoQ close workspace

Replace vague panels such as `What this workspace will answer` with a real close dashboard:

| Close control | Status evidence | Action |
| --- | --- | --- |
| Bank and credit-card reconciliation | Last statement date, ending balance, ledger balance, unexplained difference, open exceptions | Reconcile account |
| POS payout reconciliation | Gross sales, refunds, fees, chargebacks, tips, taxes, expected deposit, actual deposit | Review payout packet |
| Documents | Missing receipts, extraction failures, probable duplicates, bills without evidence | Review documents |
| Categorization | Uncategorized and low-confidence records by dollar impact | Review categories |
| Accounts payable | Open, overdue, disputed, and unapproved bills | Review bills |
| Accounts receivable | Open, overdue, credited, and unmatched invoices | Review invoices |
| Inventory | Received-not-billed, billed-not-received, shrinkage, and inventory-to-ledger difference | Review inventory controls |
| GST/HST working values | Collected tax, recoverable tax candidates, missing documentary evidence, jurisdiction exceptions | Review tax working paper |
| Journals | Draft, unbalanced, reversing, unsupported, and posted-after-close entries | Review journals |
| Trial balance | Debit total, credit total, imbalance, period comparison, and unexplained movement | Open trial balance |
| Reviewer approval | Preparer, reviewer, approver, due date, comments, and sign-off history | Submit or approve |
| Period lock | All blocking controls, lock date, and authorized unlock reason | Lock period |

An `accountant-ready` label should mean that the selected period has a completed checklist and downloadable evidence package. It must not mean that an accountant has reviewed it unless an identified accountant actually signed off.

The package should include:

- trial balance and general ledger in an open machine-readable format
- reconciliation summaries and unresolved exceptions
- bank, credit-card, and POS clearing support
- invoice, receipt, and credit-note index with secure document export
- AP and AR aging
- GST/HST working paper with evidence gaps clearly marked
- journal register with reversals and supporting references
- chart of accounts and mapping notes
- inventory valuation method, movements, and exceptions
- audit log of material changes and approvals

## Canadian privacy, record-keeping, and legal boundaries

This section is product research, not legal advice. Canadian privacy counsel and a Canadian CPA should review the production design, contracts, tax calculations, retention schedule, and user-facing claims.

### Applicable privacy principles

Alberta's Personal Information Protection Act is the provincial private-sector law for organizations operating in Alberta. PIPEDA continues to be relevant to federally regulated activity and interprovincial or international personal-information flows. See Alberta's [PIPA overview](https://www.alberta.ca/personal-information-protection-act) and the federal privacy commissioner's [PIPEDA overview](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/).

Financial data is sensitive. The Office of the Privacy Commissioner says safeguards must reflect sensitivity and specifically identifies financial information as generally sensitive in its [Safeguards guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_safeguards/).

BookLoQ therefore needs:

- a named privacy officer and documented privacy management program
- a clear purpose for each Plaid product, document field, and derived insight
- express, understandable consent before connecting financial data
- separate optional consent for Identity, Liabilities, and Investments
- collection limited to data that is necessary for the stated service
- tenant isolation, least-privilege roles, MFA for privileged access, encryption in transit and at rest, token rotation, and redacted logs
- a public list of relevant service providers and cross-border processing practices
- access, correction, export, disconnect, and deletion-request procedures
- vendor contracts that restrict use, require safeguards, allocate breach duties, and control subprocessors
- a retention schedule that distinguishes temporary uploads, accounting source records, audit logs, Plaid tokens, and backups

PIPEDA permits cross-border processing but keeps the Canadian organization accountable for the transferred information, according to the OPC's [cross-border processing guidelines](https://www.priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127/). Alberta also requires notice when an organization uses a service provider outside Canada to collect personal information. The notice must address how policies can be obtained and who can answer questions, as described in Alberta's [collection guidance](https://www.alberta.ca/collecting-personal-information).

The federal breach rules require records of every breach involving personal information under the organization's control and require those records to be kept for two years. Breaches presenting a real risk of significant harm trigger reporting and notification duties. See the OPC's [mandatory breach guidance](https://www.priv.gc.ca/en/privacy-topics/business-privacy/breaches-and-safeguards/privacy-breaches-at-your-business/gd_pb_201810/) and [business breach reporting page](https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-organization/report-a-privacy-breach-at-your-business/). Alberta requires reasonable safeguards and has its own breach reporting process under PIPA; see Alberta's [protection responsibilities](https://www.alberta.ca/organization-responsibilities-for-protecting-personal-information).

Canada is still implementing its consumer-driven banking framework. The Department of Finance described additional regulations as pre-published on June 26, 2026. BookLoQ must not call itself an approved participant, accredited open-banking provider, or government-certified service unless it has actually completed the applicable process. See the Department of Finance's [2026 framework update](https://www.canada.ca/en/department-finance/news/2026/06/government-pre-publishes-regulations-to-prevent-fraud-and-facilitate-the-next-phase-of-consumer-driven-banking.html).

### CRA record requirements

The CRA says businesses remain responsible for adequate records even when a bookkeeper, accountant, internet transaction manager, or application service provider keeps them. It generally requires records for six years after the end of the last tax year to which they relate. See CRA's [Keeping Records guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc188/keeping-records.html).

The same CRA guidance says records should be kept at the Canadian residence or place of business unless permission is obtained to keep them elsewhere. CRA has separate conditions for electronic records outside Canada in its [record-location guidance](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/keeping-records/where-keep-your-records-long-request-permission-destroy-them-early.html). Before using any global cloud service as the only copy of the accounting record, BookLoQ needs a documented storage-location decision, a reliable Canadian-accessible copy or the required permission, and professional review of the actual vendor architecture.

Electronic source records must remain electronically readable. Paper records may be imaged when the image is an intelligible reproduction and proper imaging practices are followed. See CRA's [electronic record-keeping guidance](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/ic05-1/electronic-record-keeping.html) and [acceptable imaging formats](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/keeping-records/acceptable-format-imaging-paper-documents-backing-electronic-files.html).

GST/HST input tax credits require sufficient documentary evidence before the claim is made. CRA warns that missing invoice information can cause a claim to be denied. See CRA's [input tax credit requirements](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/input-tax-credit.html), [documentary requirements](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/8-4/documentary-requirements-claiming-input-tax-credits.html), and [GST/HST records list](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/gst-hst-records-keep.html).

Consequences for the product:

- Do not delete an original source document after OCR.
- Do not keep only the extracted fields.
- Preserve the original electronic file when the supplier delivered it electronically.
- Keep an audit trail linking documents, transactions, tax working values, and corrections.
- Provide an export before account deletion and apply lawful accounting-retention rules.
- Do not call a GST/HST amount claimable when required evidence is missing.
- Keep tax results as reviewable working values until a qualified reviewer confirms them.

### Recommended user-facing fine print

> BookLoQ provides record-organization, reconciliation-support, and business decision tools. It is not a public accounting firm and does not provide accounting, assurance, tax, legal, investment, or financial advice. Imported data, document extraction, suggested categories, matches, balances, forecasts, and tax working values may be delayed, incomplete, or incorrect and require review. Connecting an account authorizes read access to the data disclosed during Plaid Link. BookLoQ does not move money or file returns unless a separate service is clearly identified and separately authorized. You remain responsible for your records, filings, payments, decisions, and professional advice.

The privacy notice shown before Plaid Link should also identify Plaid, the requested data categories, the exact purposes, whether data is processed outside Canada, how long BookLoQ retains imported records, how to disconnect, and how to contact the privacy officer.

## Product claims and evidence boundary

| Claim | When it is safe | Safer wording |
| --- | --- | --- |
| Plaid is connected | Production Link, token exchange, sync, webhook verification, update mode, disconnect, and live-account tests have passed. | Connect supported financial accounts through Plaid. |
| Balances are real time | The displayed value came from `/accounts/balance/get` in the current interaction and includes its timestamp. | Balance checked at 10:42 a.m. through Plaid. |
| Transactions are current | The UI shows last successful Plaid update and connection health. | Transactions last synchronized at 10:35 a.m. |
| BookLoQ reconciles accounts | The user completed a defined statement period and the unexplained difference is zero. | Reconcile imported records against your statement. |
| BookLoQ reads invoices | Secure upload, extraction, confidence, original-document retention, and human review are implemented. | Extract draft invoice details for review. |
| Accountant-ready | The close checklist and evidence package are complete. No accountant review is implied without sign-off. | Prepare an organized close package for your accountant. |
| Cash-aware reordering | A deterministic formula uses eligible connected balances, matched obligations, a cash floor, freshness, and explicit exclusions. | Factor connected cash and recorded obligations into reorder planning. |
| GST/HST support | Jurisdiction configuration, evidence requirements, rounding tests, and Canadian CPA review are complete. | Prepare GST/HST working values for review. |

Do not use these claims without additional proof:

- supports every Canadian bank or credit union
- always real time
- automatically accurate
- fully reconciles your books
- CRA compliant or CRA approved
- tax-ready without review
- replaces an accountant or bookkeeper
- guarantees cash-flow accuracy, profitability, savings, or overdraft prevention
- Plaid certified, bank certified, government approved, or accredited open banking
- bank-grade security unless a specific, independently verifiable control statement supports it

## Delivery gates and unresolved dependencies

### Can be implemented and tested now

- Plaid Sandbox Link flow and synthetic Items
- schema and tenant boundaries for Items, accounts, transactions, cursors, and connection health
- cursor-based sync with added, modified, and removed records
- webhook signature verification and replay protection using Sandbox events
- update-mode and disconnect UI states
- secure private document-upload pipeline with test files
- extraction state machine, duplicate detection, field confidence, and review UI
- deterministic reconciliation, close checklist, and evidence-package data model
- cash-capacity formula with mocked balance freshness and obligation matching
- clear legal and product limitation copy

### Blocked until credentials, vendor access, or commercial decisions exist

- Any live Plaid connection requires the Production client ID and secret, approved product access, completed application and company profiles, production Link customization, registered redirects, a public webhook URL, and institution testing. Plaid lists these launch tasks in its [Launch checklist](https://plaid.com/docs/launch-checklist/).
- Exact Plaid pricing and product availability depend on the approved plan. Transactions is subscription billed; refresh is an add-on; Balance is a separate product; Identity Match in Canada requires a Growth or Custom plan; Canadian Liabilities coverage is limited; Investments on-demand refresh is an add-on.
- OCR requires a selected extraction provider, data-processing terms, subprocessor review, regional-processing decision, and production credentials. No extraction-accuracy percentage should be claimed without a measured BookLoQ validation set.
- Production malware scanning requires a selected scanner or sandbox, operational monitoring, and a failure policy.
- Accountant invitation requires an identity, permission, notification, revocation, and audit design. A typed email field is not a secure invitation system.
- PDF, XLSX, GIFI, QuickBooks, Xero, or tax-software exports require actual format implementations and validation with the receiving product.

### Requires Canadian professional review before launch

- chart-of-accounts defaults and industry mappings
- GST/HST place-of-supply, recoverability, registration, quick-method, mixed-use, zero-rated, exempt, and adjustment logic
- inventory valuation, shrinkage, landed cost, returns, and year-end adjustments
- cash and accrual accounting treatments
- foreign-currency and exchange-rate policy
- payroll, owner draws, shareholder loans, debt principal, interest, and capital assets
- document and accounting-record retention, deletion, legal holds, and data residency
- privacy policy, Plaid disclosure, service-provider contracts, cross-border notice, breach process, and user rights
- all statements that could imply professional accounting, audit, tax filing, investment advice, or regulatory approval

## Recommended implementation priority

1. Secure Plaid Sandbox foundation: Link, token exchange, encrypted token storage, sync, webhook verification, health, update mode, and disconnect.
2. Source-document foundation: private storage, scanning, extraction states, original retention, duplicate detection, and review.
3. Reconciliation foundation: bank, credit card, POS clearing, bills, invoices, and zero-difference period close.
4. Accountant-ready close: checklist, evidence gaps, trial balance, audit history, roles, locks, and export package.
5. Cash-aware decisions: on-demand Balance, obligation deduplication, cash floor, scenario separation, and inventory-engine contract.
6. Optional products: Liabilities only after coverage testing; Identity only for a defined ownership need; Investments only for business-owned brokerage accounts.
7. Professional and live review: Canadian CPA validation, privacy and legal review, Plaid Production approval, live account testing, recovery exercises, and monitored rollout.

This sequence makes BookLoQ more useful than a decorative bookkeeping dashboard while keeping its most important promise credible: it organizes evidence, exposes what is missing, and helps an owner and accountant reach a supportable conclusion without pretending that a bank feed or language model is the books.
