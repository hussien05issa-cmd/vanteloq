# Launch follow-up, September 16, 2026

This follow-up records the application corrections and external actions after the earlier launch verification. It is not a certification that every provider or production workflow is ready.

## Application corrections

- Documents now write relational dates in seconds, matching the schema. Authorization, processing-lease and deletion-request evidence in JSON remains in milliseconds. Migration 0054 narrowly repairs plausible recent millisecond values, preserves valid seconds and out-of-range values, and is safe to rerun.
- Document uploads enforce the actual request size before parsing multipart data, including requests without Content-Length. Existing authentication, permissions, rate limits, file signatures, quarantine and review requirements remain.
- A confirmed Clover void removes the corresponding staged payment within its own workspace and connection. Ambiguous void evidence requires review. Missing records on partial pages do not imply deletion. Reporting promotion remains disabled.
- Moneris requires explicit supported currency matching the workspace and a valid payment date. Changed records need reconciliation, declined payments have a separate count, and storage failures fail the synchronization rather than being reported as skipped source rows. Payment history remains staged because refunds and settlements are not reconciled.
- Paginated Moneris windows keep their original end time. If a partial-day window finishes after midnight, that entire day is read again before advancing. Identical legacy rows can be revalidated using fresh matching currency evidence and a guarded hash-only update; amounts and other facts are not overwritten.

## Verification completed

77 targeted checks passed across this batch: 28 Clover adapter/reporting checks, 18 Moneris checks, 19 document processing/deletion/timestamp/streaming-reader checks, 5 migration checks, and 7 built upload/deletion/bank-statement/purchasing checks. This is the union of the affected checks, not a full-suite or live-provider certification.

The first upload-boundary test expected too little upstream prefetch from the framework wrappers. A diagnostic measured three queued chunks beyond the bounded reader. The corrected endpoint test passes at 16 KB and 64 KB chunk sizes, allows only four extra chunks, and separately proves the reader stops at its first oversized chunk. Both reject with 413, cancel the stream and write no document or object. Malformed multipart returns 400; a valid upload returns 201 with correct document dates.

The final production build and artifact validation, full TypeScript check, full lint plus targeted lint after follow-up edits passed. SQL artifacts use LF consistently. Build output retains an existing large-chunk advisory; it is not evidence of a broken route.

## Hosting and sandbox follow-up

The owner-approved hosting report was sent through OpenAI Help Center, including public protocol, certificate and DNS diagnostics. Support confirmed escalation to a specialist and said replies will also arrive by email. No case number was displayed. At 17:01 UTC, certificate-verified TLS 1.1, 1.2 and 1.3 still returned HTTP 200 from the main hostname. Escalation does not resolve the TLS requirement.

The obsolete Clover Sandbox Review callback and CORS origin were removed from the sandbox app. Its Site URL is now the reserved, non-resolving address https://vanteloq-sandbox-disabled.invalid/, and CORS is blank. The settings page showed the saved value. This does not alter the production Clover app or establish a successful merchant walkthrough.

## Conditions that remain

| Area | Required before claiming completion |
| --- | --- |
| Hosting | Enforce TLS 1.2 minimum on the effective main hostname, then verify TLS 1.1 rejection and modern protocol success. |
| Clover | Complete isolated merchant walkthrough and review video, financial reconciliation, and provider distribution/billing approval. |
| Moneris | Refund and settlement reconciliation, historical payment-change discovery, and each subscriber's production merchant acceptance. |
| QuickBooks | Intuit production access and a real ledger importer with reconciliation. Company identity verification alone is insufficient. |
| Shopify and Shopify POS | Public installation and required provider review, followed by authorized store/location acceptance. |
| Plaid | Production approval/configuration, security evidence and Canadian institution acceptance. |
| Meta and Google restricted services | Required provider access/reviews and correct subscriber resource authorization. |
| Documents | Automatic retries of already requested provider cleanup are not yet scheduled. A 24-hour abandoned-original purge is still a target, not an active promise. |
| Newsletter | Enrollment and sending remain disabled until valid sender identification is supplied. No personal or placeholder address is published. |
| Live workspace | Complete authenticated acceptance of the released workflows; fictional local fixtures do not replace this. |

See the original provider and launch verification notes for their historical test scope. Provider logos, saved credentials and a successful build do not establish complete financial coverage.
