# Vanteloq connector experience verification

Date: 2026-09-25. Scope: the connector-experience brief and source-aware revenue example, based on release 308. This report does not certify every integration or the entire application as production-ready.

## Implemented in this update

- Shared connection-health model distinguishes authorization, importing, review, overdue updates, expired access, test data and approved records. Account-level warnings cannot be hidden by another account's successful import. Review staging is not labelled sandbox unless the environment is actually a test environment.
- A provider capability registry describes actual imported records, supported actions, update method and limitations. The integrations API and details accordion use it instead of broad category promises. Existing reporting contracts and authorization checks remain authoritative.
- Revenue source details show actual contributions for the selected dates and location, real import timestamps, the calculation and a scoped source-data link. Amounts reconcile in integer cents. Refunds are already included in net sales; deposits and payouts are not added as sales.
- Dashboard and reports share source selection. Overlapping manual and connected sales are excluded or withheld until the source conflict is resolved.
- Slack public distribution was activated and verified in its developer dashboard. Available means authorizing one outgoing channel, testing delivery and explicitly sharing a fixed Vanteloq sign-in link. No conversations, files, mentions or direct messages are read. No automated alerts are advertised. Existing workspace access is still required after opening the link.
- Public labels, customer controls and direct authorization guards now agree. X-Series remains in preview pending public-distribution evidence. Stripe merchant reporting remains separate from working Vanteloq subscription billing. Existing authorized records are preserved.
- Moneris native Worker requests reject redirects safely using the supported manual mode. Stripe import warnings no longer advance the successful-sync timestamp. Immutable Stripe evidence versions remain intact.

## Architecture preserved

The implementation extends existing provider adapters, normalized commerce and banking records, organization and location access, encrypted credentials, OAuth state, signed webhook handlers, replay controls, synchronization leases and source-authority selections. No migration, new dependency, private production record change or new financial posting is required. Fictional tests run against disposable local databases.

## Provider status and next requirements

| Provider | Customer availability and remaining requirement |
| --- | --- |
| Lightspeed R-Series | Existing public path. Confirm each retailer's authorization, complete period, outlet mapping and source reconciliation. |
| Lightspeed X-Series | Importer and isolated callbacks exist. Public distribution and unrelated-retailer acceptance still need verification; labels now match the preview gate. |
| Square | Existing public path. Keep the owner's test seller excluded from real Supplement World totals; merchant authorization and mapping are account-specific. |
| Clover | Importer exists. Current provider approval, Canadian distribution, review recording and billing arrangement still need console verification. Browser control failed after the owner reported signing in. |
| Moneris | Payment staging only. Production merchant credentials, refund/settlement reconciliation and reporting acceptance remain required. |
| Stripe merchant records | Staging only. Payment/payout-to-sale matching and approved BookLoQ reporting remain required. This does not disable subscription checkout. |
| Google | Resource-specific verification remains required for Analytics/Search Console, Ads and Business Profile. Select only the actual business's resources. |
| Meta | App credentials, live permissions/app review and a business ad-account sample remain required. Organic social feeds and messaging are not implemented. |
| Slack | Public direct installation enabled; outgoing channel features only. A second independent workspace installation has not been exercised in this run. |

## Boundaries of the full brief

This release does not implement inbound Slack events, a universal provider activity feed, global automatic notifications, universal real-time synchronization or complete cross-provider sale/payment/bank reconciliation. These require separate ingestion, consent, permission and data-matching work. Existing scheduled POS imports must not be described as instant updates for every provider.

Stripe review staging also has a documented lease-loss hardening item: a run losing its lease during provider requests can append immutable staging evidence before its final lease check rejects the run. It cannot promote that run into reports. Review-only records remain unavailable as revenue or accounting totals.

## Verification

Focused checks cover exact source reconciliation, source conflicts, missing/old timestamps, tenant boundaries, private source drill-downs, payment-feed exclusion, revoked and unconfirmed Slack sends, fixed destinations, redirect rejection, replay-safe financial evidence and preview authorization. TypeScript checks passed. Final built-application test and deployment results are recorded in the release response.

Browser UI verification is limited by a Codex Windows sandbox error (apply deny-read ACLs). This is not evidence that production records were damaged. Resume provider-console and visual checks after restoring browser controls.

### Final local release results

- Combined TypeScript check: passed.
- Production Worker/client build and artifact validation: passed. Existing large-chunk warnings remain; no fresh PageSpeed result is claimed.
- Final combined regression suite:74 passed, 0 assertion failures, 1 timed-out fixture. The same revenue source fixture passed alone in 12.4 seconds without source changes, accounting for all 75 checks.
- Additional focused suites:43 Moneris checks,11 Stripe checks,44 health/capability checks and the earlier 74 Slack/catalog/health checks passed. These sets overlap and must not be added into a unique total.
- Source integrity scan: 884 text-source/configuration/document files, zero NUL-containing files after recovering the isolated test fixture.
- Browser visual and provider-console acceptance remain unverified because the desktop browser controller failed before navigation.
