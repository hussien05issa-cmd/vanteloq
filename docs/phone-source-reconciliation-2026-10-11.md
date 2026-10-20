# Vanteloq v1.0 Origin source reconciliation, 11 October 2026

## Source and publication boundary

The phone-edited Site release 353 was opened from its existing source repository at commit `c431380b7e22255e6ed00e346cf582b4253e140c`. Its invoice, bank CSV, review and month-end changes are retained. The existing Vanteloq project, runtime bindings, public audience and homepage design are preserved.

At the start of reconciliation, GitHub's `codex/industry-expansion` branch had commit `5d0753b1ed1feab3ab48f140dbf4fd08bc43fbb7`, with source tree `97b0d70dfa3417296d2c79c853067c1305c397c6`. That tree matched the earlier Site source. GitHub was one Site release behind. The inspected phone thread did not contain a GitHub failure diagnostic, so this record does not infer its cause.

Sites publication and GitHub synchronization are separate operations. Updating a GitHub branch does not by itself demonstrate that production changed.

## Where the additions appear

In BookLoQ, invoice details support posted invoice accounting and partial payments, with payment history and reversals. Banking and Reconciliation support reviewed bank CSV import, matching, statement checks and an audited release of a ledger match. Month-end controls and the review queue preserve the accounting trail. The existing Vanteloq overview, sector workflows, integrations, customizable metrics and AI interface remain in the source.

A public **Book a free demo** navigation link opens `/book-demo`, including from the mobile menu. The form uses the existing protected contact delivery route. It requires name, email and explicit consent to respond and arrange the requested demo. Business name, phone, requirements and scheduling preferences are optional. It is not a marketing subscription or confirmed appointment.

## Repairs made during reconciliation

- Identical bank CSVs uploaded by different organizations now receive organization-specific import and generated-account IDs. Retrying the same import within one organization remains deduplicated.
- Forward migration `0080_bank_match_integrity` prevents reversal of an actively bank-matched journal at database commit time, including a race after the route's eligibility read.
- Supporting invoice and bill matches cannot claim an independently posted bank movement. A current source-linked payment belonging to the same invoice remains compatible.
- Invoice correction returns an actionable conflict when a bank match must first be released. The Banking/Reconciliation controls can reopen the latest statement and record an audited unmatch.
- Migration 0080 preserves existing records. It does not delete or rewrite financial evidence.

## Demo request protections and disclosure

The demo request pipeline verifies the hostname and challenge action, restricts request origins, bounds request fields and payload size, and applies rate limiting. It uses a fixed private server-configured recipient and does not accept a recipient from the visitor. Retry delivery keeps an identical provider idempotency key and email body.

The form identifies 2855706 ALBERTA INC, operating as LexEdge Consulting, states the narrow contact purpose, links the Privacy Policy and privacy contact, and discloses Resend's processing outside Canada. The Privacy Policy and service-provider page are updated consistently. The visitor-submitted consent timestamp is labelled as visitor supplied, not identity proof. No financial records are created.

## Verification and remaining limits

Validation results and final publication identifiers are recorded in the associated release receipt under the workspace output directory.

Advanced inventory cost layers, foreign-currency accounting and deferred revenue remain future accounting scope. Existing incompatible supporting matches, if any, are retained and require a separately reviewed audited correction path. This release prevents new incompatible matches; it does not claim to repair historical records without review.

Real recipient inbox delivery is not exercised by the fictional provider tests. These tests verify the request, receipt, retry, consent and security paths with mocked external providers. No customer records or credentials are included in the GitHub sync.

This update does not establish a completed production database/file restoration drill, a complete ordinary-subscriber billing lifecycle, or approval of a third-party connector. Those outcomes require their own evidence. It is not a legal compliance or accounting accuracy certification.
