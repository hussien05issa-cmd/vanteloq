# Launch continuation: billing, document forwarding and capacity

This records bounded verification. It is not an unconditional launch certification, accounting opinion or guarantee of concurrent-user capacity.

## Changes

- Checkout now reserves one durable attempt per workspace before creating a Stripe session. Retries reuse the exact request and idempotency key. Changing a plan closes the previous payable session before creating a replacement. Completed payments waiting for a webhook cannot open another checkout. Ambiguous old attempts remain blocked for reconciliation.
- Account deletion refreshes authoritative billing identities, closes pending checkout and confirms paid subscription cancellation before removing the workspace. A payment completed after the deletion plan was prepared is reconciled rather than ignored.
- A bounded scheduled cleanup removes up to 500 expired rate-limit buckets per tick and preserves live buckets.
- Setup now has 6 steps. The prepayment logo upload was removed because its protected endpoint requires an active plan. Owners can add their logo in Settings after activation. Setup copy and labels use plain language.
- A candidate BookLoQ read-batching optimization was evaluated and removed after it did not improve the local capacity result. The shipped financial read path and calculations remain unchanged.

## Production forwarding acceptance

The earlier acceptance proved size-limit delivery, quarantine, authorized deletion, address revocation, replacement-address routing and attachment deduplication. On September 17 at 02:11 UTC the exact signed request replay also passed. A temporary wrapper matched only an approved fictional PDF and exact private destination. Both calls returned HTTP 200 and the second acknowledged an existing receipt with `replayed: true`. The original receiver was restored immediately after observation.

The live Documents view retained one original fictional test file and omitted both previously deleted test files. Enabled forwarding stays collapsed on ordinary visits. There is no recurring agreement checkbox outside Forwarding Settings.

The activation environment enables document forwarding for eligible subscribers rather than limiting it to the owner validation workspace. Deployment confirmation is recorded separately. This does not grant consent, scanning, AI processing or accounting-posting permission on a customer's behalf.

## Stripe observation

The live Vanteloq Stripe account contained 1 open legacy checkout for the owner's separate test signup, with no subscription. Its automatic expiration is September 17 at 05:52:03 UTC. This session predates the new durable-attempt table and must be confirmed expired or explicitly reconciled before a new payment attempt for that workspace. Its checkout URL and private identifiers are excluded here. The connected Stripe app still needs reconnection; browser sign-in alone does not restore connector access.

## Regression and interface evidence

- All 9 new checkout and maintenance checks passed, including 20 simultaneous requests sharing one payable session, plan replacement races, a lost provider response, provider conflict, organization isolation and bounded expiry cleanup.
- The deletion suite passed, including a payment that completed after the deletion plan was prepared. Migration continuity, document-email tenant/consent/revocation controls, scheduler signatures and replay protection, signup verification, Stripe price/signature checks and workspace chart assertions passed.
- The first 63-check run had 62 passes and one test setup failure caused by rebuilding the Worker while the test imported it. Its error was a missing build entry, not a failed application assertion. After freezing the build, all 21 targeted follow-up checks passed, including the complete subscription lifecycle, BookLoQ access, exact cash totals, commitment deduplication, statement import and restricted financial views.
- TypeScript and lint passed. The production build passed; final packaging is tracked separately.
- All 6 onboarding steps were traversed with a fictional local fixture. The final review was inspected at 390 x 844 with no page overflow. Consent and both navigation buttons remained reachable; submission stayed disabled without agreement. No real account or legal acceptance was created by the preview.
- The live owner Documents screen was inspected for readable controls, collapsed forwarding/settings, one original replayed fixture and the absence of the 2 previously deleted fixtures.

## Verification limits and open gates

- The local capacity baseline returned 4 errors in 25 simultaneous BookLoQ reads. A candidate batching build returned 6 errors at the same burst size, with similar p95 latency (54.26 seconds versus 53.83 seconds). At 1, 5 and 10 concurrent reads the candidate passed. All 40 successful candidate warmup/measured responses preserved exact financial and tenant assertions; foreign record access was denied and no external request occurred. The optimization was removed. Host-workload differences, small samples and Miniflare RPC overhead limit comparison; this is not evidence of a live outage. Hosted capacity remains unproven, and the local timeout is under investigation.
- Certificate-validated TLS 1.1 still returned HTTP 200 on the main hostname in the September 17 01:59 UTC transport check. TLS 1.2 and 1.3 also worked. Hosting support must close this previously reported minimum-protocol issue.
- An isolated restore of the hosted database and document objects is still unverified. Supabase authentication backup does not establish recovery of the Sites D1 and R2 business records.
- A fresh live subscriber journey through signup, MFA, payment and plan/add-on access remains distinct from isolated Stripe and database tests. No real payment was made by this verification.
- Accounting closing review and external provider approval gates remain open. Unavailable integrations must stay Coming Soon. Newsletters remain excluded.
