# POS synchronization operations

Updated 2026-09-13. This supersedes the staging-only assumptions in the August readiness audit.

## Provider status

| Provider | Implemented | Acceptance still required |
| --- | --- | --- |
| Lightspeed R-Series | Sales, sale lines, tenders, catalogue, categories, inventory, customers, suppliers, reviewed reporting and resumable history | Complete historical correction and reconcile a finished date range |
| Square | Orders, lines, payments, catalogue, inventory, customers and reviewed reporting | Production merchant canary; supplied costs where Square does not expose them |
| Clover | Orders, lines, payments, catalogue, inventory, customers and reviewed reporting | Production merchant canary and source reconciliation |
| Shopify / Shopify POS | Separate online/POS order scopes, refunds, products, inventory, customers and reviewed reporting | Authorized store canary, required app distribution/scopes approval and reconciliation |
| Lightspeed X-Series | Read-only OAuth, outlets, resumable sales/line/payment/catalog/category/stock/customer/supplier imports and reviewed reports | Authorized retailer canary; reconnect older two-scope authorizations; resolve missing costs or unsupported receipt adjustments |
| Moneris | Read-only payment staging with resumable history; business-report approval is blocked | Each subscriber's production merchant credentials; currency, refunds, changed-payment history and settlement reconciliation; payments cannot supply SKU or labour facts |
| Stripe Connect | Balance transactions, fees and payouts in isolated staging | Merchant reconciliation; settlements must not be counted as additional POS revenue |

Configured OAuth credentials do not prove a customer's authorization or public app distribution approval. Test merchants must remain excluded from real business reports.

## Background jobs

Owners enable automatic sync separately for each connection. The setting includes a versioned data-use notice and records affirmative consent, including for older POS connections that lack a background-consent record. Normal refreshes run about every 15 minutes; incomplete history resumes after 60 seconds. Manual and scheduled execution share provider normalization and connection leases. Public routes retain verified MFA, integration permission and organization-wide access checks.

The service selects the oldest three due jobs, checks the exact owner/subject, membership, consent, connection, deletion state and service entitlement, then claims a durable lease. Failed jobs retry with exponential backoff up to one hour. A crashed job becomes eligible after its ten-minute lease expires. Authorization failures pause the grant. Automatic jobs never approve a data source.

The scheduler is a service principal. It does not fabricate a browser identity or MFA claim. Its HMAC-SHA256 request binds the timestamp, nonce and exact empty body. A 90-second freshness limit and durable replay receipts protect the endpoint. Callers cannot select a workspace or account.

Webhook receipts remain queued until a complete pull covers them. The cutoff is the beginning of the full import cycle, so events arriving during pagination remain pending for the next cycle.

Status, next check, delays, errors and pause controls are visible in Connections. Pausing stops new jobs; an already running batch can finish.

## Hosting

The signing secret is stored in hosted runtime settings and Supabase Vault, never source. The private, argument-free Supabase function in `pos-scheduler-function.sql` sends an empty signed request to the fixed Vanteloq endpoint using pg_net. pg_cron invokes it without an open browser.

The private Supabase dispatcher and minute scheduler were activated and returned HTTP 200 on 2026-09-13. Anonymous signed-endpoint access was rejected. Merchant enablement and an unattended provider cursor change still require acceptance in the signed-in workspace.

X-Series uses the official 2026-07 schemas. Tax-exclusive discounted line totals must exactly reconcile with the parent net total. Unsupported sale-level charges or incomplete expansions stop the cursor for review. Completed receipts replace their current lines and tenders, so later edits, deletions and voids do not leave stale facts. Explicit zero costs remain distinct from missing costs. Report publication requires completed history, mapped outlets, a matching workspace currency and reviewed cost coverage. Customer birthdays, notes, contact addresses and payment card attributes are not retained by this importer.

Refund-only daily net revenue and returned COGS may be negative. Migration 0047 preserves existing summaries and source-import lineage while removing only the invalid nonnegative constraints on these two net amounts.

Capacity is bounded to three connection jobs per minute. Monitor oldest-due lag and increase capacity or shard the queue before sustained onboarding volume exceeds that budget.

## Merchant acceptance

1. Authorize the correct merchant and environment; map locations.
2. Finish history and resolve invalid records; keep partial reports provisional.
3. Reconcile identical dates/timezones, net sales, taxes, discounts, returns, units and transaction counts.
4. Approve reviewed records explicitly; keep settlement amounts separate from POS revenue.
5. Enable sync, close the browser and verify unattended progress.
6. Test pause, reconnect, revocation, source exclusion and duplicate delivery.

Run provider contract/callback tests, scheduler security tests and incremental migrations before publication. Monitor heartbeat age, due-job lag, expired jobs, provider errors, unmapped locations, missing costs and reconciliation differences.

References: [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [Stripe pagination](https://docs.stripe.com/api/pagination), [X-Series sales](https://x-series-api.lightspeedhq.com/docs/sales_101).
