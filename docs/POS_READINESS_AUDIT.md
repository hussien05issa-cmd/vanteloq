# POS integration readiness audit

Historical audit. Current connector and background-sync status is documented in [POS sync operations](POS_SYNC_OPERATIONS.md). The staging-only statements below describe the August snapshot, not the current release.

Date: 2026-08-09
Decision: **The Lightspeed X-Series and R-Series read-only staging connectors are built and hosted; do not promote live POS data yet.**

The Vanteloq core and both Lightspeed adapters have their production OAuth values configured and are ready for an owner-run pilot. No provider is represented as live. The Connections workspace keeps provider data in isolated staging and the integration-status API returns data promotion as disabled.

## Verified platform controls

| Control | Result | Evidence |
|---|---|---|
| Build and runtime artifact | Pass | Production Worker build and artifact validation complete |
| Authentication boundary | Pass | Anonymous access to every business API, including integrations, is rejected |
| Tenant isolation | Pass | Multi-organization flow test confirms records, metrics and BookLoQ data remain isolated |
| Server authorization | Pass | Permission registry and restricted employee defaults are tested; restricted navigation is also blocked in the client |
| Cross-site request protection | Pass | State-changing APIs reject unverified and cross-site origins |
| Financial precision | Pass | BookLoQ, tax, reconciliation and normalized provider values use integer minor units |
| Idempotency and replay safety primitives | Pass | Import/journal replay tests pass; Lightspeed sale versions and webhook payload hashes have tenant-scoped uniqueness |
| Auditability | Pass | Authorization, mapping, sample sync and disconnect actions create append-only events without token or payload disclosure |
| Data integrity and intelligence | Pass | Metric definitions, lineage, confidence, empty-state honesty and deterministic calculations are tested |
| Interaction integrity | Pass | Known no-op controls are absent and literal disabled buttons explain why they are unavailable |
| Dependency security | Pass | Production dependency audit reports zero known vulnerabilities at the configured threshold |
| Visual integration identity | Pass | Lightspeed uses its standalone flame asset; brand marks use one optical frame with no cropped wordmark |

## Lightspeed controls now implemented

- Owner/admin authorization with one-time, hashed, ten-minute OAuth state.
- Exact HTTPS callback, least-privilege `outlets:read sales:read` scopes and pinned date-based API version.
- AES-GCM server-side access/refresh token encryption and refresh-token rotation.
- Provider-domain allowlisting, outlet discovery and tenant-validated location mapping.
- Bounded pagination, retry/rate-limit handling, resumable cursor and idempotent normalized sale staging.
- HMAC webhook validation and replay rejection without raw payload retention; polling remains source of truth.
- Explicit disconnect that deletes encrypted tokens and preserves audit/staging history.
- Hard `dataPromotionEnabled: false` boundary until sample reconciliation and canary approval.
- Separate R-Series OAuth client, `employee:register_read employee:inventory_read` scopes, V3 account/shop discovery, tenant-bound shop mapping and bounded sale staging.

## Provider controls that remain blocked

| Gate | Required implementation before activation |
|---|---|
| Retailer authorization | Complete OAuth for the owner's real X-Series or R-Series account; a saved client credential alone is not a connected retailer |
| Webhook recovery | Queue consumer, dead-letter/retry operations and provider delivery fault tests; verified polling remains authoritative meanwhile |
| Backfill acceptance | Bounded sandbox sample plus source-total, refund, tax, discount, cost and duplicate reconciliation |
| Normalization | Provider-specific mapping for organizations, locations, transactions, line items, refunds, taxes, discounts, products, employees and payouts where supported |
| Reconciliation | Source totals versus normalized totals, payout versus bank settlement, refund and dispute handling, duplicate detection and discrepancy queues |
| Data quality | Missing periods, late arrivals, partial pages, invalid timestamps, currency mismatches, unmapped locations and stale connections |
| Recovery | Safe disconnect, credential revocation, replay, rollback or compensating correction, incident runbook and restore test |
| Operations | Sync health, last success, lag, failures, affected metrics, alerts and an owner-visible correction path |
| Provider testing | Contract fixtures, sandbox tests, fault injection, tenant-isolation tests, reconciliation acceptance and a read-only canary period |

## Readiness rule

A provider may be marked live only when all of the following are true:

1. The connection is verified by the provider, not inferred from saved credentials.
2. The least-privilege scope set is documented and approved.
3. Backfill and incremental sync complete idempotently.
4. Webhooks pass signature, replay and duplicate-event tests.
5. Normalized totals reconcile to the provider for the acceptance window.
6. Payouts reconcile where the provider exposes settlement records.
7. Failures produce a visible error, an affected-metric list and a recovery action.
8. Disconnect and token revocation are proven.
9. Tenant-isolation and export-permission tests pass with provider records.
10. The Data Quality centre remains authoritative when the provider is delayed or incomplete.

## Recommended first-provider sequence

Continue Lightspeed as a read-only pilot after the required partner approval and credentials exist:

1. Authorize an owner sandbox or production account using the already-configured hosted OAuth client.
2. Discover and map sandbox outlets to Vanteloq locations.
3. Stage a bounded sample and reconcile source totals before exposing metrics.
4. Run duplicate, refund, outage, partial-page, rate-limit and stale-token acceptance tests.
5. Complete a read-only canary period with manual reconciliation.
6. Activate production display only after the readiness API can return every provider gate as verified.

## Verification completed in this audit

- 100 automated checks passed, including dedicated reorder, Lightspeed, security, migration, tenant-isolation, calculation and interaction cases.
- TypeScript passed.
- Lint passed with two expected image-optimization advisories for tenant-uploaded logos.
- Production build and Sites artifact validation passed.
- Production dependency audit found zero known vulnerabilities at the configured threshold.
- Landing and integration-logo visual checks passed in the agent preview.

## Evidence limits

- Hosted Lightspeed OAuth values were verified by name, secrecy classification and exact callback without exposing their contents. No retailer OAuth grant or production POS data was available, so no external data connection was claimed.
- The authenticated workspace could not be visually traversed in the cloud audit browser because the hosted sign-in route is outside the local preview boundary. Its behavior was checked through source inspection, API integration tests and the supplied authenticated screenshots.
- Cloudflare account-level WAF, backup schedules, external alerting and provider-side security settings are outside this source audit.
- This is an engineering readiness audit, not a penetration test, SOC report, legal opinion or compliance certification.
