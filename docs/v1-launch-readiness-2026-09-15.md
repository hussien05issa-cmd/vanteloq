# Vanteloq V1 launch review

Review date: September 15, 2026. Target: Monday, September 21, 2026.

## Release decision

Proceed toward a limited, assisted retail pilot. Do not describe every listed integration as production-ready or BookLoQ as a complete replacement for an accountant-approved accounting system. A broad, unattended paid launch still requires the acceptance gates below.

## Corrections in this release

- Verification screens no longer guarantee email delivery when signup may refer to an already verified account. They offer a direct sign-in path, and resend requests recover from network failures.
- Billing plan descriptions now derive location and user counts from the enforced entitlement catalogue. This corrects an outdated Growth description that promised 5 locations and 15 users instead of 3 locations and 10 users.
- A real Stripe test checkout exposed simultaneous checkout/subscription events competing for the same subscription version. The webhook now retries one version conflict after re-reading both the stored version and the current Stripe subscription. Signature, ownership, atomic-write and stale-event protections remain enforced.
- Workspace source labels show a loading or error state before declaring records missing. The privacy notice now accurately describes remembered, account/workspace-scoped AI consent; opening a new chat or changing memory does not require accepting it again.
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
| Returning-customer acceptance | A separate, already verified account signed in with its existing MFA and accepted the current legal notice. The billing gate withheld paid access. Hosted production Checkout showed Starter CAD 49 plus BookLoQ CAD 39, totaling CAD 88 monthly. Returning without payment preserved the selections and withheld subscription access. | No payment was completed. This is not a fresh signup or a production subscription webhook acceptance test. A new-address signup message was independently shown as Delivered in Resend, but that address was not used for the completed sign-in. |
| Data | Approved R-Series history and charts loaded. Square test data remained excluded from reports. | Backfill and source-specific coverage still require review. Closed days are not automatically import failures. |
| AI | OpenAI answered a real workspace question, identified its reporting window, missing coverage and unavailable profit, and provided an import-review path. | Responses still require review; incomplete source data limits conclusions. |
| AI privacy | Existing consent was recognized. Workspace-data sharing and memory controls were visible. Memory was off during the test. | No live stored conversations were deleted during this audit. |
| Documents | Six labelled test PDFs showed Clean and Complete. Azure scanning and extraction were configured. | Proposed figures still require review; email forwarding is not configured. |
| BookLoQ | Navigation and empty/limited states loaded across the accounting workspace. Cash forecasts were withheld when bank evidence was absent. | An accountant-reviewed pilot close is outstanding. |
| Stripe catalogue | Active monthly prices matched CAD 49 Starter, CAD 99 Growth, CAD 179 Pro and CAD 39 BookLoQ. Annual prices were archived. | No customer was charged by this audit. |
| Stripe webhook | Live billing endpoint active; checkout completion and 8 subscription events configured. No deliveries were recorded for the displayed week. | This is configuration evidence, not a completed hosted checkout lifecycle. |
| Stripe hosted test acceptance | Real hosted Checkout with fictional billing details and an isolated D1 database: insufficient-funds decline left BookLoQ locked (402); successful Starter plus BookLoQ checkout enabled access (200). The final checkout and subscription-created events both returned 200 through the official Stripe CLI and the actual application signature-verification handler. Scheduled cancellation retained access; cancellation revoked it. | Uses test credentials, an isolated authentication fixture and the built application worker. This does not prove fresh Supabase signup/MFA, delivery to the production webhook URL or a real charge. Test subscriptions were canceled. |
| Customer portal | Invoice history, billing details, payment-method updates and cancellation at period end enabled; Vanteloq legal links present. | Self-service plan switching is disabled. Plan/add-on changes need the supported assisted route. |
| Security | Enforced CSP, HSTS, frame denial, no-sniff and restricted permissions headers; tenant and entitlement boundaries covered by regression tests. | CSP still permits inline scripts. This is not penetration-test certification. |
| Supabase security and backups | Pro confirmed active. Leaked-password protection saved and verified after reload. A fresh security-advisor response returned zero lints. Seven physical daily backups were visible, most recently September 15, 2026 at 11:36:16 UTC. | This closes the disabled-password-protection finding. It does not prove a restore or cover Sites-managed D1 and R2. |
| Dependencies | Registry advisory check of 69 non-development lockfile packages returned no advisories. | Point-in-time registry result, not proof of zero vulnerabilities. |
| Responsive demo | No-signup BookLoQ demo worked; removing opening-bank evidence withheld the forecast. Narrow layout inspected at 320 px. | Not an exhaustive physical-device certification. |

## Integration boundaries for launch

| Provider or feature | Launch description | Remaining work |
| --- | --- | --- |
| Lightspeed R-Series | Connected and importing approved retail history in the pilot workspace. | Finish backfill; reconcile a complete source day and required reports. |
| Lightspeed X-Series, Square, Clover, Shopify, Shopify POS, Stripe merchant data | Built authorization/import paths with automated coverage. | Each merchant must authorize, map locations, review and approve records. Provider setup is not equivalent to a completed live merchant acceptance test. |
| Moneris | Sandbox/test connection. | Production onboarding and a reconciled settlement sample. |
| Plaid | Sandbox only in the current deployment. Owner submitted business verification and the production request; the dashboard estimates review within 2–3 business days. | A separate required security questionnaire remains incomplete. Production access, matching credentials, live Canadian institution authorization and reconciliation remain. Do not sell the sandbox feed as live banking. |
| QuickBooks | Sandbox company verification only. | Ledger adapter implementation and acceptance, followed by production credentials/approval. Production credentials alone will not supply ledger imports. |
| Google | Account authorization present. | Select resources for the correct business and verify reporting. Never combine unrelated businesses. |
| Meta | Not configured. | App configuration, permissions/review, authorization and source verification. |
| Xero, DoorDash, Uber Eats | Unavailable or coming soon. | Implementation and provider approval; keep disabled and clearly labelled. |
| Payroll execution, tax filing | Working-paper and imported-cost support only. | No payroll execution or tax submission should be promised. |
| Email forwarding | Not configured. | Inbound provider setup and tenant-routing acceptance. Manual document upload remains available. |

## Acceptance gates before a broad paid launch

1. Complete the remaining hosted subscriber journey: fresh signup, email verification, MFA and production endpoint delivery acceptance. Hosted Stripe test checkout, initial payment decline, signed provider events, purchased plan/BookLoQ access and cancellation have now been verified with the actual built worker and an isolated database. Regression coverage also exercises upgrades, add-on removal, past-due lockout, duplicates, stale events and rollback. Do not treat the test authentication fixture as a real Supabase signup test.
2. Complete a restore drill into an isolated environment. Record backup age, restore duration, tenant counts and representative file integrity. Confirm alert ownership and escalation. The repository runbook alone does not prove that recovery works.
3. **Completed:** Supabase Pro is active, leaked-password protection is enabled and a fresh security-advisor check reports no lints. The approved change was verified after reloading the settings. The separate restore requirement in gate 2 remains open.
4. Have an accountant review a pilot month-end close, bank reconciliation, tax working papers and opening balances before using BookLoQ as authoritative books.
5. Limit launch promises to the provider boundaries above. A customer needing production banking or QuickBooks ledger synchronization cannot be onboarded as though those are ready.

## Regression evidence

Build, TypeScript and lint passed after the application changes. The initial regression run was interrupted after intelligence-flow coverage when the desktop session restarted; completed output was retained. Two intelligence-flow checks that failed in that run passed against a stable build. The remaining batch completed 496 tests: 486 passed initially, and 10 outdated UI, consent-flow and OAuth-fixture tests required updates. The focused static/UI rerun passed all 60 tests. The final manual/CSV persistence and X-Series disconnect-race checks passed both cases. The final financial-engine, consent, retail and migration run passed all 26 tests. Every failure identified in the two broad batches was resolved and passed a focused rerun. The billing lifecycle also passed plan, BookLoQ entitlement, signed-event and cancellation tests in isolation. No single uninterrupted full-suite result is claimed.

No financial test records were imported into the live store's reporting tables. Financial fixtures used isolated local databases. This review did not buy subscriptions, send new marketing or invoice emails, delete customer records, or accept contracts on a customer's behalf.

### Follow-up verification

The targeted Plaid, legal-consent and Stripe billing run passed 27 checks. The security-boundary follow-up passed 7 checks. The updated subscription lifecycle regression passed with a deliberately synchronized, same-second checkout/subscription event race, and both event receipts were processed. The final hosted Stripe test repeated the same scenario successfully with real provider-signed events. Build and TypeScript passed. Lint excludes the existing git-ignored `work/` directory used for private fixtures and downloaded test tools. The AI policy edit clarifies existing consent behavior; it does not expand the data-use purpose or change accepted notice versions.
