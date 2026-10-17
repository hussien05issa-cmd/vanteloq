# Customer controls review, October 4, 2026

## Subscription cancellation

Settings now includes a visible “Manage or cancel subscription” shortcut and a “Billing & subscription” section. Existing subscriptions show their management and cancellation controls above plan cards. The billing recovery screen also exposes these controls to authorized users when paid access is unavailable.

Settings search filters section labels and relevant task keywords. “Cancel” and “unsubscribe” find billing; “delete workspace” finds Account & login. No matches produce an explicit result message. Escape clears the query, Arrow Down focuses the first matching section and Enter opens a single match. Section buttons remain keyboard accessible.

“Cancel subscription” requests a short-lived Stripe portal confirmation session. It does not cancel billing, delete records or claim success when the session opens. Stripe presents the effective date and obtains confirmation. Returning from Stripe opens `#billing`; status comes from synchronized provider facts. Failed status refreshes label the last verified result, initial read failures offer “Try again,” reads time out after 15 seconds and portal opening after 30 seconds. Duplicate portal opens are blocked while a request is pending.

The API requires same-origin requests, verified workspace membership, owner/admin authority and `organization.billing`. It obtains customer and subscription references from the authorized workspace, verifies their relationship with Stripe, and checks that the existing default portal configuration permits cancellation at period end. The session is pinned to that verified configuration. No portal configuration is modified by this route. General billing remains accessible for ended subscriptions. Cancellation does not require a paid entitlement or a configured checkout webhook secret.

Stripe's flexible billing mode can represent scheduled portal cancellation with `cancel_at` while `cancel_at_period_end` is false. Normalization now retains that confirmed date through the existing status interface. Pricing, trial duration, renewal terms, tax settings and entitlement rules were not changed. Workspace deletion is a separate permanent process with separate confirmation and immediate billing termination.

### Verification

- Focused local tests cover Stripe request fields, safe redirects, configuration checks, ownership mismatch, scheduled cancellation normalization, active/trial/unpaid UI states and stale/timeout messages.
- A migrated D1 route test covers active, trialing, past-due, unpaid and paused subscriptions; employee and unauthorized admin denial; tenant-ID spoof rejection; cross-origin rejection; ended-subscription billing access; and absence of subscription mutation when opening confirmation.
- Live default configuration `bpc_1U2TWABmKMLpjFJQh0KgSNPx` was read back: active, default and live; subscription cancellation enabled with `at_period_end`, proration `none`; invoice history and payment method updates enabled. Its public privacy and terms links and `https://vanteloq.com/?billing=returned#billing` return URL were updated and read back, retaining the existing financial settings.
- No production subscription was canceled and no payment was made during this subtask. Provider requests in local tests are mocked. A production end-to-end cancellation was not performed.
- Isolated visual preview: `node scripts/billing-controls-preview.mjs`, loopback port 5202. It uses the actual controls and CSS with fictional states. It has no authentication, API traffic or billing mutation.

## Account controls, loading and recovery

Settings search filters actual sections, including cancellation, unsubscribe and deletion aliases. Escape clears the search, ArrowDown focuses a result, Enter opens a single match, and an explicit empty result offers correction. Account deletion remains separately reviewed in [the deletion report](account-deletion-review-2026-10-04.md).

The homepage keeps the exact rumour sentence above its main heading. Dashboard skeletons reserve the metric, trend, goal and attention shapes. BookLoQ skeletons follow the selected section and saved collections layout instead of always showing an overview. They show no fabricated values or loaded-data claims and respect reduced motion.

The application error boundary and missing-page screen provide plain-language recovery and working navigation. Failed API responses retain their HTTP status, application code and request reference while avoiding raw proxy HTML, database diagnostics or stack traces in the visible message. Successful and binary responses are unchanged. An uncertain write tells the user to inspect saved records before retrying, and the client does not automatically repeat it.

Final integrated checks passed 72/72 customer-control, deletion, document-processing, loading and recovery tests, plus 13/13 built-worker setup, invoice-security and public-rendering tests. TypeScript, production build and artifact validation passed. Full lint has zero errors and 17 existing warnings. These counts are distinct test runs, not a complete certification of the codebase.

Browser checks used fictional loopback previews: the headline and BookLoQ/dashboard skeletons fit a 390px viewport without horizontal overflow, motion-off kept controls usable, Enter activated cancellation's preview callback, trial and scheduled-cancellation notices remained distinct, and error retry callbacks responded. The actual page-error reset recovered through keyboard and pointer input on desktop and mobile. No live customer subscription or records were altered. Publication and authenticated production acceptance remain separate evidence.

### Primary sources

- [Stripe portal deep links](https://docs.stripe.com/customer-management/portal-deep-links): dedicated cancellation confirmation flows and return navigation.
- [Stripe portal configuration](https://docs.stripe.com/customer-management/configure-portal): cancellation settings.
- [Stripe configuration listing API](https://docs.stripe.com/api/customer_portal/configurations/list): read the active default configuration.
- [Stripe billing-mode comparison](https://docs.stripe.com/billing/subscriptions/billing-mode/compare#cancellations-in-the-customer-portal): flexible-mode cancellation uses `cancel_at`.
- [Stripe portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal): authentication and subscription lifecycle webhooks.
