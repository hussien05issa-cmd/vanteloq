# Lightspeed X-Series read-only staging pilot

## Status

The adapter is implemented but not represented as live. It can authorize, discover outlets and stage a bounded normalized sales sample. Staged records never change Dashboard, BookLoQ or report metrics. Promotion requires a separate acceptance decision after reconciliation and a read-only canary.

## Hosted configuration

Set these names in the hosted secret/environment manager; never add values to source control:

- `LIGHTSPEED_CLIENT_ID`: approved X-Series developer application client ID.
- `LIGHTSPEED_CLIENT_SECRET`: approved developer application secret.
- `INTEGRATION_ENCRYPTION_KEY`: base64-encoded 32-byte key managed as a hosted secret.
- `LIGHTSPEED_REDIRECT_URI`: `https://vanteloq.com/api/v1/integrations/lightspeed/callback`.
- `LIGHTSPEED_API_VERSION`: `2026-07`.

Register the callback exactly. Vanteloq asks only for `outlets:read` and `sales:read`.

The production Sites environment contains the required X-Series values and pins API version `2026-07`. This proves configuration readiness only; OAuth and sample reconciliation still determine whether a retailer connection is usable.

## Owner pilot

1. Open Data → Connections as an owner or authorized administrator.
2. Select Connect on Lightspeed and approve the read-only scopes.
3. Discover outlets and map each relevant provider outlet to a tenant-owned Vanteloq location.
4. Run Stage sample. Verify records read, newly staged, duplicates skipped and unmapped outlets.
5. Reconcile source totals, taxes, refunds, discounts, costs, timestamps and outlet mapping for the acceptance window.
6. Exercise revoked token, token refresh, rate limit, partial page, provider outage, duplicate delivery and disconnect recovery.
7. Complete a read-only canary. Only then may a separately reviewed migration/service promote normalized facts.

## Security and lineage boundary

- OAuth state is random, stored only as a hash, bound to the organization and initiating user, expires in ten minutes and is consumed before token exchange.
- Access and refresh tokens are encrypted with AES-GCM and never returned from APIs or written to audit details.
- Retailer domains accept one constrained provider prefix, preventing arbitrary outbound hosts.
- Sample staging retains only normalized accounting fields and source hashes, not customer identity or raw provider payloads.
- Sale versions and webhook payload hashes have tenant/provider uniqueness for replay safety.
- Webhooks are change signals only. Signed polling remains the recovery and completeness source of truth.
- Disconnect deletes local encrypted tokens and blocks data promotion while retaining audit evidence.
