# Vanteloq v1.0 Origin: accuracy and workflow review
Date: September 18, 2026

This review covers a bounded correction release. It is not an accounting audit, penetration-test certification, production restoration certificate, or assurance that every advertised integration is ready.

## Changes
| Area | Correction | Evidence |
| --- | --- | --- |
| Invoice amounts | Editor and server share integer arithmetic, half-up rounding per line and safe aggregate bounds. Leading decimal fractions are accepted. | Fractional quantity regression, overflow rejection and saved-total comparisons. |
| Invoice content | Calendar dates are validated; addresses and payment instructions retain paragraphs. Long names, references and notes paginate without falling off the PDF. | Generated PDF parsing and page-coordinate assertions. |
| Invoice delivery | Users review the saved invoice's recipient and message before sending. Existing invoices have an email action and retries reuse the same invoice and provider idempotency key. Sending does not overwrite paid or partially paid status. | Isolated Worker, storage and mocked mail-provider tests, including a concurrent payment-state change. Inbox delivery was not retested in this pass. |
| Invoice UX | Portal dialog, focus containment, Escape close with focus return, readable fields and mobile line labels. Removed a logo upload control whose backend rejected every upload. | Actual component inspected at 390 by 844 and 1366 by 900. Fractional preview displayed $0.15 for 0.02 units at $7.25. |
| Sales profit | Ambiguous historical R-Series zero costs do not become verified profit. Current, comparison, daily and chart evidence is scoped to its own business dates. Verified revenue remains visible. | Isolated returned-sale fixture: missing refund costs withhold profit; complete reversal restores a zero result; missing prior-period costs do not hide current known profit. |
| Source freshness | Normalize seconds, milliseconds and previously double-decoded source dates. New R-Series daily writes use the timestamp units expected by the schema. | Numeric/date regression cases; live readback required after deployment. |
| Document protection | Invoice multipart uploads are bounded by actual bytes before parsing. Upload-only roles receive their own upload receipt without a document listing or existing duplicate filename. | Isolated authorization and oversized multipart tests. |
| Integration availability | Coming-soon authorization routes fail on the server for ordinary subscribers. Internal review remains restricted to an active subject-bound grant. | Direct Clover, Shopify and Moneris start attempts denied before connection state creation; existing internal preview tests pass. |
| BookLoQ guidance | Statement editing shows a running balance difference. Data windows are labelled as latest recorded dates. Receipt counts are informational, and unauthorized cross-links explain the restriction. | Component review and existing bank-statement import tests. |

## Verification
- Build and artifact validation passed.
- TypeScript checking and lint passed.
- Broad targeted batch: 112 passing tests; the new cost test initially failed because its synthetic setup omitted a required parent sync record.
- After correcting that fixture and the reviewed cost-window logic, all 11 invoice, cost-evidence and rollout tests passed.
- Earlier isolated workflow batch: all 6 passed, covering invoice/document boundaries, bank statements, retail and AI consent, subscriber integration availability, and complimentary access. These batches overlap; counts must not be added as unique coverage.
- AI checks include field minimization, permission boundaries, rejection of unsupported providers, cancellation and safe handling of provider errors.
- Financial checks include balanced journals, statement relationships, cash commitment deduplication, aging, ratios, currency boundaries and date comparisons.
- No synthetic financial transactions were inserted into the production workspace by these tests.

## Remaining product work
1. Invoice payment allocation and settlement posting need a complete reviewed workflow, including partial payments, bank evidence, journal linkage and reversals. Creating/emailing a PDF does not post a payment.
2. Custom invoice logos remain unavailable until there is a supported private, validated image path. Unsupported scripts receive a clear validation error; the current PDF font is not universal.
3. Historical POS cost provenance is not retroactively invented. Ambiguous zero costs are withheld until supported source evidence is available.
4. QuickBooks ledger import still needs mapping and acceptance checks for accounts, tax, reconciliation and closed periods. Connection authorization alone is not a completed ledger import.
5. Full product performance and every device/browser combination are not established by this correction pass. The build still reports a large client chunk; performance work remains measurable follow-up.

## External and integration acceptance work
Statuses here combine the current source review with the existing provider register. Provider dashboards were not re-approved in this pass.
- Hosting: enforce TLS 1.2 or newer at the public hosting edge. The latest recorded TLS 1.1 request was still accepted; support escalation remains open.
- Recovery: obtain an actual private production database and object export, restore into a separate environment and compare records and files. The prior isolated recovery test is not a production restore.
- Plaid: production approval, enabled products and a real institution acceptance check.
- Clover: listing/review evidence, Canadian billing/distribution confirmation and merchant reconciliation.
- Shopify: production app distribution/review and merchant acceptance.
- Meta: app permissions/review and resource-specific acceptance.
- Google: OAuth verification and Business Profile API approval; verify each business's selected resources.
- QuickBooks: production profile/access approval plus the application import work described above.
- Moneris: a subscriber's production merchant credentials and reporting/settlement acceptance. The platform owner need not fabricate a merchant account.
- Lightspeed X-Series: production merchant acceptance was deliberately deferred.
- Square: production merchant cost coverage and acceptance remain distinct from the excluded test account.
- Stripe subscription billing and Stripe merchant-data ingestion are different paths. Earlier isolated subscription tests do not establish a merchant settlement reconciliation.

Unavailable integrations remain Coming Soon for ordinary subscribers. Do not expand public availability solely because credentials or an OAuth callback exist.

## Release decision
This patch improves invoice correctness, access controls, cost evidence and customer workflows. The remaining product work and external acceptance items above prevent an unconditional whole-product launch certification.
