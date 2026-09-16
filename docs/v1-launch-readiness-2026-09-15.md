# Vanteloq V1 launch review

Review date: September 15, 2026. Target: Monday, September 21, 2026.

## Release decision

Proceed toward a limited, assisted retail pilot. Do not describe every listed integration as production-ready or BookLoQ as a complete replacement for an accountant-approved accounting system. A broad, unattended paid launch still requires the acceptance gates below.

## Corrections in this release

- Invoice aging counts issued, unpaid invoices only, uses the workspace business date, respects live/demonstration scope and does not stop at the 200-row display limit.
- The invoice screen uses the server count instead of applying a different browser calculation.
- Removed the unverified payout bridge. Provider names alone could incorrectly classify sales, refunds and fees as a reconciled settlement. The replacement explains the evidence required and opens transaction review.
- Business Brief withholds gross profit and contribution when their metric provenance is unavailable. Missing labour is not displayed as a verified zero cost. A new nullable labour evidence flag distinguishes omitted wages from an explicitly recorded zero across manual entry, CSV persistence, reports, the Business Brief and AI. Legacy zeroes without evidence stay unavailable; POS feeds do not supply wages.
- QuickBooks explains its company-verification-only limitation. Sandbox connections do not instruct customers to import them into live books.
- Unavailable connectors no longer present an unnecessary subscription upsell.
- Document capture describes the actual scan/extraction review workflow.
- Restored the homepage link to inventory and cash features. Updated the Windows component test loader to support CSS imports and a case-sensitive assertion to match the existing cookie button label.

## Fresh live evidence

| Area | Evidence | Limit |
| --- | --- | --- |
| Public routes | All 31 sitemap routes returned HTTP 200 with titles and main content. Health and readiness returned success. | Availability does not prove every mutation. |
| Authentication | Signed-in workspace loaded after user verification. Anonymous protected APIs rejected requests with 401 and no-store headers. | A fresh customer signup/recovery cycle remains part of acceptance. |
| Data | Approved R-Series history and charts loaded. Square test data remained excluded from reports. | Backfill and source-specific coverage still require review. Closed days are not automatically import failures. |
| AI | OpenAI answered a real workspace question, identified its reporting window, missing coverage and unavailable profit, and provided an import-review path. | Responses still require review; incomplete source data limits conclusions. |
| AI privacy | Existing consent was recognized. Workspace-data sharing and memory controls were visible. Memory was off during the test. | No live stored conversations were deleted during this audit. |
| Documents | Six labelled test PDFs showed Clean and Complete. Azure scanning and extraction were configured. | Proposed figures still require review; email forwarding is not configured. |
| BookLoQ | Navigation and empty/limited states loaded across the accounting workspace. Cash forecasts were withheld when bank evidence was absent. | An accountant-reviewed pilot close is outstanding. |
| Stripe catalogue | Active monthly prices matched CAD 49 Starter, CAD 99 Growth, CAD 179 Pro and CAD 39 BookLoQ. Annual prices were archived. | No customer was charged by this audit. |
| Stripe webhook | Live billing endpoint active; checkout completion and 8 subscription events configured. No deliveries were recorded for the displayed week. | This is configuration evidence, not a completed hosted checkout lifecycle. |
| Customer portal | Invoice history, billing details, payment-method updates and cancellation at period end enabled; Vanteloq legal links present. | Self-service plan switching is disabled. Plan/add-on changes need the supported assisted route. |
| Security | Enforced CSP, HSTS, frame denial, no-sniff and restricted permissions headers; tenant and entitlement boundaries covered by regression tests. | CSP still permits inline scripts. This is not penetration-test certification. |
| Dependencies | Registry advisory check of 69 non-development lockfile packages returned no advisories. | Point-in-time registry result, not proof of zero vulnerabilities. |
| Responsive demo | No-signup BookLoQ demo worked; removing opening-bank evidence withheld the forecast. Narrow layout inspected at 320 px. | Not an exhaustive physical-device certification. |

## Integration boundaries for launch

| Provider or feature | Launch description | Remaining work |
| --- | --- | --- |
| Lightspeed R-Series | Connected and importing approved retail history in the pilot workspace. | Finish backfill; reconcile a complete source day and required reports. |
| Lightspeed X-Series, Square, Clover, Shopify, Shopify POS, Stripe merchant data | Built authorization/import paths with automated coverage. | Each merchant must authorize, map locations, review and approve records. Provider setup is not equivalent to a completed live merchant acceptance test. |
| Moneris | Sandbox/test connection. | Production onboarding and a reconciled settlement sample. |
| Plaid | Sandbox only in the current deployment. | Production access, live institution authorization and reconciliation. Do not sell the sandbox feed as live banking. |
| QuickBooks | Sandbox company verification only. | Ledger adapter implementation and acceptance, followed by production credentials/approval. Production credentials alone will not supply ledger imports. |
| Google | Account authorization present. | Select resources for the correct business and verify reporting. Never combine unrelated businesses. |
| Meta | Not configured. | App configuration, permissions/review, authorization and source verification. |
| Xero, DoorDash, Uber Eats | Unavailable or coming soon. | Implementation and provider approval; keep disabled and clearly labelled. |
| Payroll execution, tax filing | Working-paper and imported-cost support only. | No payroll execution or tax submission should be promised. |
| Email forwarding | Not configured. | Inbound provider setup and tenant-routing acceptance. Manual document upload remains available. |

## Acceptance gates before a broad paid launch

1. Complete a separate subscriber journey: signup, email verification, MFA, plan selection, hosted checkout, signed webhook, correct plan interface and BookLoQ add-on access. Verify payment failure, cancellation at period end and entitlement expiry in an isolated Stripe test environment before making a real charge.
2. Complete a restore drill into an isolated environment. Record backup age, restore duration, tenant counts and representative file integrity. Confirm alert ownership and escalation. The repository runbook alone does not prove that recovery works.
3. Resolve the Supabase security-advisor warning for disabled leaked-password protection, or record a conscious launch decision with the compensating application controls. Provider plan/setting changes require an owner action when paid.
4. Have an accountant review a pilot month-end close, bank reconciliation, tax working papers and opening balances before using BookLoQ as authoritative books.
5. Limit launch promises to the provider boundaries above. A customer needing production banking or QuickBooks ledger synchronization cannot be onboarded as though those are ready.

## Regression evidence

Build, TypeScript and lint passed after the application changes. The initial regression run was interrupted after intelligence-flow coverage when the desktop session restarted; completed output was retained. Two intelligence-flow checks that failed in that run passed against a stable build. The remaining batch completed 496 tests: 486 passed initially, and 10 outdated UI, consent-flow and OAuth-fixture tests required updates. The focused static/UI rerun passed all 60 tests. The final manual/CSV persistence and X-Series disconnect-race checks passed both cases. The final financial-engine, consent, retail and migration run passed all 26 tests. Every failure identified in the two broad batches was resolved and passed a focused rerun. The billing lifecycle also passed plan, BookLoQ entitlement, signed-event and cancellation tests in isolation. No single uninterrupted full-suite result is claimed.

No financial test records were imported into the live store's reporting tables. Financial fixtures used isolated local databases. This review did not buy subscriptions, send new marketing or invoice emails, delete customer records, or accept contracts on a customer's behalf.
