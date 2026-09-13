# POS synchronization operations

Updated 2026-09-13. This supersedes the staging-only assumptions in the August readiness audit.

## Provider status

| Provider | Implemented | Acceptance still required |
| --- | --- | --- |
| Lightspeed R-Series | Sales, sale lines, tenders, catalogue, categories, inventory, customers, suppliers, reviewed reporting and resumable history | Complete historical correction and reconcile a finished date range |
| Square | Orders, lines, payments, catalogue, inventory, customers and reviewed reporting | Production merchant canary; supplied costs where Square does not expose them |
| Clover | Orders, lines, payments, catalogue, inventory, customers and reviewed reporting | Production merchant canary and source reconciliation |
| Shopify / Shopify POS | Separate online/POS order scopes, refunds, products, inventory, customers and reviewed reporting | Authorized store canary, required app distribution/scopes approval and reconciliation |
| Lightspeed X-Series | OAuth, outlets, versioned sales staging and signed notifications | Canonical reporting expansion and authorized retailer canary |
| Moneris | Read-only payments, resumable history and production-only reconciliation eligibility | Production merchant credentials and reconciliation; payments cannot supply SKU or labour facts |
| Stripe Connect | Balance transactions, fees and payouts in isolated staging | Merchant reconciliation; settlements must not be counted as additional POS revenue |

Configured OAuth credentials do not prove a customer's authorization or public app distribution approval. Test merchants must remain excluded from real business reports.

## Background jobs

Owners enable automatic sync separately for each connection. Normal refreshes run about every 15 minutes; incomplete history resumes after 60 seconds. Manual and scheduled execution share provider normalization and connection leases. Public routes retain verified MFA, integration permission and organization-wide access checks.

The service selects the oldest three due jobs, checks the exact owner/subject, membership, consent, connection, deletion state and service entitlement, then claims a durable lease. Failed jobs retry with exponential backoff up to one hour. A crashed job becomes eligible after its ten-minute lease expires. Authorization failures pause the grant. Automatic jobs never approve a data source.

The scheduler is a service principal. It does not fabricate a browser identity or MFA claim. Its HMAC-SHA256 request binds the timestamp, nonce and exact empty body. A 90-second freshness limit and durable replay receipts protect the endpoint. Callers cannot select a workspace or account.

Webhook receipts remain queued until a complete pull covers them. The cutoff is the beginning of the full import cycle, so events arriving during pagination remain pending for the next cycle.

Status, next check, delays, errors and pause controls are visible in Connections. Pausing stops new jobs; an already running batch can finish.

## Hosting

The signing secret is stored in hosted runtime settings and Supabase Vault, never source. The private, argument-free Supabase function in `pos-scheduler-function.sql` sends an empty signed request to the fixed Vanteloq endpoint using pg_net. pg_cron invokes it without an open browser.

Activate only after deploying the migrations and verifying a signed request. Verify a real unattended job and provider cursor change before claiming background sync is live.

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

