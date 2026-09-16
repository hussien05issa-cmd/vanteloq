# Lightspeed X-Series read-only connector

## Status

The adapter supports OAuth authorization, outlet discovery, resumable sales, product, category, stock, customer and supplier imports, and reviewed reporting. Connected credentials alone do not enable dashboard metrics. Records remain excluded until the account's completed import satisfies the reporting gates and an authorized owner or administrator approves it.

The September 16, 2026 configuration review did not run merchant authorizations, sample imports, test transactions or acceptance tests, as requested by the owner. Configuration readiness is not a claim that a real merchant import has been verified.

## Hosted configuration

Configure these values privately in the hosted environment:

- `LIGHTSPEED_X_CLIENT_ID`: the X-Series developer application client ID.
- `LIGHTSPEED_X_CLIENT_SECRET`: its matching secret.
- `LIGHTSPEED_X_TOKEN_ENCRYPTION_KEY`: base64-encoded 32-byte encryption key.
- `LIGHTSPEED_X_REDIRECT_URI`: `https://vanteloq.com/api/v1/integrations/lightspeed/callback`.
- `LIGHTSPEED_X_API_VERSION`: `2026-07`.

The source also supports the older `LIGHTSPEED_CLIENT_ID`, `LIGHTSPEED_CLIENT_SECRET`, `LIGHTSPEED_REDIRECT_URI`, `LIGHTSPEED_API_VERSION` and `INTEGRATION_ENCRYPTION_KEY` names as fallbacks. Do not rotate a working credential or encryption key merely to rename it. This adapter has no separate sandbox/production environment switch; access follows the developer application and the retailer that authorizes it.

Register the callback exactly. Vanteloq requests `customers:read`, `inventory:read`, `outlets:read`, `products:read`, `retailer:read`, `sales:read` and `suppliers:read`. Older connections with only outlet and sales scopes must reconnect before the expanded importer can run. No sales, inventory or customer write scope is requested.

The September 16 hosted review confirmed the X-prefixed client ID, secret, encryption key, exact callback and `2026-07` version are present. Provider application approval remains a separate dashboard state that must be recorded directly.

## Provider access and reporting gates

Lightspeed's current documentation states that an unapproved application can connect up to 30 retailer accounts, and that production-ready public applications require approval. A public label, API health indicator or saved callback does not establish that approval. Inspect the existing application at [Lightspeed developer applications](https://developers.retail.lightspeed.app/applications).

Each customer must authorize their own X-Series retailer account. The OAuth callback reads outlets before marking the connection Connected. Reporting then requires a completed history import, a matching workspace currency, reviewed outlet mappings, at least one verified sale, no unresolved sync error and sufficient product-cost coverage. Owner/admin approval is followed by a successful final sync that publishes the reviewed metrics. These gates remain in place when tests are deferred.

## Security and lineage

- OAuth state is hashed, expires after 10 minutes, is bound to the initiating browser, user and organization, and is consumed before code exchange.
- Tokens use encrypted storage and rotation. API responses and audit details do not expose credentials.
- Retailer domains accept only a constrained provider prefix.
- Imports retain normalized records and source hashes. Customer names and source identifiers support repeat-customer analysis; the importer excludes birth dates, free-text notes, tax IDs and marketing permissions.
- Versioned imports and webhook receipt hashes preserve source lineage and replay protection. Signed webhook receipts are change signals; polling remains the source of truth. The current read-only OAuth scope set does not include webhook-management access.
- Disconnect removes local encrypted tokens and excludes the account from reporting while retaining its audit evidence.

## Official references

- [Authorization, exact callbacks, rotating refresh tokens and public-app approval](https://x-series-api.lightspeedhq.com/docs/authorization)
- [OAuth scopes](https://x-series-api.lightspeedhq.com/docs/scopes)
- [Mandatory scope parameter from June 1, 2026](https://x-series-api.lightspeedhq.com/changelog/2025-11-scope-parameter-required)
- [Current 2026-07 product endpoint](https://x-series-api.lightspeedhq.com/reference/listproducts)
- [Webhook delivery, signing and polling guidance](https://x-series-api.lightspeedhq.com/docs/webhooks)
