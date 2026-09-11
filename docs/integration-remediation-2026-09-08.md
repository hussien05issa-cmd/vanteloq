# Integration remediation and remaining activation work

Date: September 8, 2026.

This is a targeted reliability release for Google setup and Square imports, not a claim that every Vanteloq integration is finalized. The original findings remain in [the connector audit](connector-readiness-audit-2026-09-08.md). Meta registration stays paused. The private console, customer entitlements, Stripe billing configuration, and live provider credentials are outside these changes.

## Implemented

### Google authorization and discovery

- Accept Google's canonical email permission as well as its short alias.
- Require account identification and at least one approved measurement service instead of requiring every optional service permission.
- Report discovery status separately for Search Console, Analytics, Business Profile, and configured Google Ads.
- Allow healthy services to be selected when another service is unavailable.
- Block replacement if discovery cannot verify a previously selected service. Preserve its approved selections and stored measurements.
- Bound provider requests and return safe error messages without provider tokens or raw request details.

These changes do not bypass Google verification, API quotas, customer consent, resource ownership, or Vanteloq permissions.

### Square financial and import integrity

- Exclude tax from line-item net revenue. Preserve legitimate zero amounts and reject malformed totals instead of inventing fallback revenue.
- Search orders and payments by update time, using a fixed import window and a five-minute overlap.
- Resume pagination without restarting streams that already completed.
- Advance the durable watermark only when the entire window completes.
- Keep partial windows out of data approval and avoid reporting them as the latest successful complete sync.
- Preserve the existing daily revenue and cost snapshot while an approved refresh is incomplete.
- Publish owner-managed costs and revenue together in one transactional daily snapshot.
- Verify tenant, connection status, and synchronization ownership inside the publication transaction. A stale worker cannot remove the previous snapshot through this transaction.
- Preserve a newer worker's connection status when an older worker fails.

The revised cursor format intentionally starts a fresh two-year lookback on the next owner-initiated sync for an old-format checkpoint. It does not automatically rewrite existing live records. Existing connections still need a deliberate refresh and source reconciliation.

## Verification

Isolated Google flow tests cover authorization, resource selection, sample approval, tenant and origin restrictions, partial discovery, and preservation of approved data during provider failure.

The Square flow test covers callback, mapping, pagination, tax-exclusive line amounts, approval gating, update overlap, replay, owner cost preservation, transactional rollback, and stale-worker publication. It uses a disposable database and mocked provider responses, not a real merchant account. The test is included in the standard check command.

The production dependency audit reported zero known vulnerabilities. Fifteen sequential live probes across the homepage, Privacy, Terms, Health, and Readiness returned HTTP 200 on September 8 at approximately 18:56 UTC. Earlier intermittent hosting failures were not reproduced in that run, but their root cause remains unconfirmed.

The final standard check completed successfully on September 8 at approximately 19:15 UTC: 520 tests passed across 42 reported test groups, with zero failures. It included linting, TypeScript checks, production builds, security regressions, customer/account flows, marketing selection flows, BookLoQ accounting and cash-flow flows, and the new Square import flow. The earlier interrupted run is not counted as a completed check.

Independent standards and specification reviews were completed. Their cost-publication, archived-product cost, and stale-worker transaction findings were corrected and covered by the final tests. Existing large-bundle and build-tool warnings remain; no claim of warning-free output is made.

Public deployment is approved and follows the passing checks. The deployment result is recorded separately so this source record describes the exact prepublication verification. Successful automated checks do not establish zero bugs, universal provider approval, or real-account reconciliation.

## Still required

| Area | Remaining work | Dependency |
| --- | --- | --- |
| Google customer activation | Complete applicable public-app verification, authorized domains, consent evidence, and a fresh real-account callback/import. Business Profile quota and Ads production access require separate verification. | Google review and authorized account access |
| Business Profile storage | Resolve the legacy persistent metric path against provider content-storage restrictions before activation. Keep Gemini's current exclusion of Business Profile content. | Policy-aware engineering and provider review |
| Plaid | Verify the approved credential environment, set the missing environment securely, and test Link, refresh, reconnect, and disconnect. | Approved Plaid access and environment confirmation |
| Meta | Finish developer registration when the owner is ready; securely configure the app and complete required permissions/review. Organic Facebook and Instagram insights still require implementation. | Owner action, Meta review, and engineering |
| POS recurring updates | Implement durable authorized scheduling/queue processing, event replay, retries, backoff, and connection revocation checks. Browser refresh is not a substitute. | Engineering and supported worker hosting configuration |
| Square completeness | Reconcile refunds/returns, business-day time zones, larger location sets, full inventory pagination, and removed line items. Validate against real seller totals. | Engineering and merchant acceptance |
| Lightspeed R, Clover, Shopify/POS | Fresh merchant authorization and reconciliation of historical/new sales, refunds, costs, locations, token expiry, and ongoing updates. | Merchant acceptance plus synchronization work |
| Lightspeed X and Stripe Connect | Complete mapping, reconciliation, and approved promotion from staging into reporting. Stripe billing is a separate existing integration. | Engineering and real-account acceptance |
| QuickBooks | Production approval/configuration and a real ledger import/reconciliation adapter. Current company verification is not accounting synchronization. | Intuit approval and engineering |
| Xero | Implement and validate the connector if included in the release scope. | Provider setup and engineering |
| Canadian payroll | Choose the provider and define whether Vanteloq imports payroll summaries or initiates payroll. The [provider research](research/canadian-payroll-provider-options-2026-09-08.md) recommends evaluating Payworks for read-only journal imports first. Do not activate payments or payroll execution by assumption. | Owner choice, provider contract/API, and engineering |
| Invoice email and customer invitations | Configure a verified transactional sender; complete delivery, bounce/retry, and invitation acceptance tests. Ordinary customer invitations are distinct from internal console invitations. | Email provider configuration and engineering |
| Documents and invoice logos | Implement trusted malware scanning and controlled quarantine release. OCR is separate. Do not bypass the current quarantine protection. | Scanning provider choice and engineering |
| Report exports and delivery | Implement PDF/XLSX reports and scheduled delivery if promised. CSV and generated invoice PDFs are separate existing paths. | Engineering and email setup |
| Local opportunity data | Select a licensed provider and implement supported queries, quotas, attribution, and failure states. | Provider choice and engineering |
| DoorDash and Uber | Retain Coming soon until an approved, tested integration exists. | Future release, as requested |
| Full customer acceptance | Run an isolated live journey through signup, MFA, entitlement, provider consent, import, reporting, invitation, recovery, cancellation, and deletion. | Disposable test accounts and approved provider access |
| Production reliability | Correlate earlier hosting failures with provider logs and test from an independent network. | Hosting diagnostics |

No live bank connection, payroll run, payment, campaign change, customer deletion, credential rotation, or historical financial rewrite was performed for this release.
