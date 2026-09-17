# Friday release verification

Target: September 18, 2026. This is an evidence record, not a certification of every integration, legal obligation or concurrent-user capacity.

## Email delivery verified in production

- The 4 public addresses (support, security, billing and invoices) have active exact forwarding rules to the verified private business inbox. Cloudflare reports Forwarded. Individual Gmail inbox placement is not independently established by the provider status.
- The owner explicitly approved automatic document routing. Cloudflare's zone-wide catch-all now sends unmatched mail to the document receiver. The 4 exact public routes remain active. The receiver rejects non-document and malformed envelope recipients before accessing the raw message or making an outbound request.
- A fictional 10,485,760-byte PDF arrived in the correct workspace. Cloudflare reported Handled, the application returned HTTP 200, and Documents showed 10,240 KB, Quarantined, a separate Scan and Read action and no download access. It did not post to accounting or sales.
- The 2 specifically approved fictional intake files were permanently deleted through Documents. A fresh document list confirms both are absent.
- Disabling the forwarding address caused a real delivery to fail with HTTP 403. No new document appeared. Re-enabling generated a different private address.
- Sending a duplicate fictional original to the new address was Handled through automatic routing without a new exact provider rule. The application returned HTTP 200. Documents retained one original and recorded the new receipt.
- Private forwarding addresses, recipient identifiers, credentials and customer records are excluded from this source document.

The final exact authenticated production replay passed on September 17 at 02:11 UTC. A temporary, time-limited receiver wrapper matched only the approved fictional attachment and exact private recipient, delivered the same signed request twice, and required HTTP 200 with `received: true` followed by HTTP 200 with `received: true, replayed: true`. The live Documents view retained one original. The unmodified receiver was restored immediately afterward. No customer payload or address is included in this evidence.

The subscriber activation environment is prepared with both public flags enabled and the owner-only validation restriction removed. It takes effect with the next successful application deployment. Per-workspace consent, membership, BookLoQ access, location scope and revocation checks remain mandatory. See the continuation record for deployment verification.

## Interface corrections

- Enabled forwarding shows its address, receipt history and refresh action. Consent and address replacement controls are grouped under Forwarding Settings, so users do not see an agreement checkbox on each ordinary visit. Initial enablement and replacement still require explicit consent.
- File deletion uses a named-file dialog with focus trapping, a safe initial Keep File action and explicit permanent-deletion wording. It replaces the native browser confirmation that interrupted verification.
- Documents uses plain instructions and no longer labels extraction Not Configured when the reader is configured but that file has not been processed.
- When there are historical records but no current-day sales, the dashboard leads with a clearly dated 30-day summary and the period chart. Current-day coverage and payment details remain accessible in an expandable section. Unverified product costs do not become a profit amount.
- Existing Geist typography and restrained navy, blue and off-white surfaces are preserved.

## Visual and functional acceptance

The actual modified components were inspected in an isolated browser preview at desktop width and 390 x 844. Documents, the sales dashboard and BookLoQ had no page-level horizontal overflow. Charts retain an intentional internal scroll area on narrow screens. Upload controls remain readable and reachable. The file dialog was checked for initial focus, cancellation, focus restoration and fictional deletion.

Forwarding settings are hidden on the ordinary enabled view. Opening settings exposes consent; replacing the address remains disabled without consent. Closing settings clears the unsaved checkbox.

The fictional sales chart period inspection returned $1,000.00 net sales, $400.00 gross profit and 50 transactions. BookLoQ's selected fictional period returned $4,357.05 inflows, $1,728.00 outflows and $2,629.05 net movement. These are acceptance fixtures, not customer results. No preview console errors were observed.

TypeScript and full lint passed. The 27 focused email/client/workspace tests passed. The complete regression run executed 934 tests: 929 passed and 5 exposed outdated assertions for title case, the simplified public availability wording, the renamed banking button, connection-scoped action state and the added document-email settings exception. The actual payment, BookLoQ, permission and consent guards were inspected. Those 3 test files were corrected without relaxing the guards; all 60 tests in the affected files then passed. This is a full run followed by focused corrections, not a claim of a second full run. The final production build is tracked separately until completion.

The final production build and artifact validation passed. After that build, all 87 checks in the 6 affected test files passed together. The generic build helper could not find npm on this Windows host, so the established Node runtime build command was used successfully. The existing large-chunk advisory remains a performance improvement item.

The current production dependency audit reported 0 known vulnerabilities. That result concerns the dependency advisory database; it does not certify the application or hosting configuration.

## Outstanding release gates

1. The main hostname still accepts certificate-verified TLS 1.1 with HTTP 200. TLS 1.2 and 1.3 also work. Hosting support has been contacted, but the minimum protocol requirement is unresolved. Recheck after the hosting provider confirms its fix.
2. Confirm the prepared subscriber-forwarding environment is applied in the next successful deployment. The production email acceptance checks, including exact signed replay, have passed.
3. Finish a fresh subscriber's signup, email verification, MFA, checkout and entitlement acceptance. Isolated Stripe results do not replace the complete live subscriber journey.
4. Validate backup restoration, agreed concurrent-user capacity and an accountant-reviewed closing workflow before making corresponding reliability or accounting claims.
5. Keep provider capabilities unavailable until their actual approval and financial acceptance gates pass. The prior integration checklist remains applicable: Clover review and reconciliation, Moneris refunds and settlements, Intuit production and ledger import, Shopify public installation, Plaid production approval, and restricted Meta/Google access. Saved credentials and logos do not establish completion.

Newsletters are excluded at the owner's request. This release does not claim tax filing, autonomous financial action or guaranteed financial outcomes.
