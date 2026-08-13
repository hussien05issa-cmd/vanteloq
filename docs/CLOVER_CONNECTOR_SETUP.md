# Clover connector production setup

Vanteloq's Clover connector is a merchant-authorized, read-only commerce integration. It imports operational records into an organization-scoped staging area, requires explicit merchant/location mapping, and publishes dashboard data only after an owner or authorized manager reviews the import.

## Clover developer application

Configure the Clover application with these production endpoints:

- OAuth redirect URI: `https://vanteloq.com/api/v1/integrations/clover/callback`
- Webhook URL: `https://vanteloq.com/api/v1/integrations/clover/webhook`

For sandbox testing, use the same paths on the approved Vanteloq preview or test origin and set the application environment to sandbox.

Request only the read permissions Vanteloq uses:

- Merchant identity and store configuration
- Orders and order line items
- Payments and tenders
- Inventory items and stock
- Customers

Do not request payment-processing, refund, employee-management, or other write permissions. Vanteloq does not ingest raw card numbers, magnetic-stripe data, CVVs, or authentication data.

## Production environment values

Store these as encrypted server-side secrets. Never expose them to browser code or commit them to source control.

- `CLOVER_CLIENT_ID`: Clover application ID
- `CLOVER_CLIENT_SECRET`: Clover application secret
- `CLOVER_REDIRECT_URI`: `https://vanteloq.com/api/v1/integrations/clover/callback`
- `CLOVER_ENV`: `production` (use `sandbox` only for developer testing)
- `CLOVER_WEBHOOK_AUTH`: the webhook authorization value configured in Clover
- `INTEGRATION_TOKEN_ENCRYPTION_KEY`: the existing 32-byte Vanteloq connector encryption key

After saving the webhook URL in Clover, enter the displayed one-time verification code if Clover requests it. The Vanteloq endpoint acknowledges only the restricted verification payload. Merchant events must carry the configured `X-Clover-Auth` header and the exact application ID.

## Merchant connection flow

1. A Vanteloq owner or authorized manager selects **Connect** on the Clover card.
2. Vanteloq creates a short-lived, single-use OAuth state bound to the initiating user and organization.
3. The merchant approves Clover access and Clover returns to the production callback.
4. Vanteloq verifies the state, retrieves the exact merchant, encrypts the grant, and creates a staging connection.
5. The owner maps the Clover merchant to a Vanteloq location.
6. Vanteloq imports paginated orders, line items, payments, tenders, customers, items, stock, discounts, taxes, and item cost where Clover provides it.
7. The owner reviews and approves the staged records. Only then can a subsequent sync publish verified metrics.

Missing product cost remains missing. Vanteloq will not invent gross profit or margin when Clover does not provide reliable cost evidence.

## Operations and incident checks

- OAuth refresh tokens are rotated under a per-connection synchronization lease.
- Webhooks schedule recovery work and never publish business metrics directly.
- Webhook replay protection is scoped to the organization, provider, connection, and payload.
- Disconnecting revokes the active connection without silently deleting retained accounting/audit records.
- A merchant can re-authorize if Clover revokes access; authorization errors must remain visible in Connections.
- Verify Connect, callback, mapping, sync, review, publish, re-sync, webhook, and disconnect in Clover sandbox before switching `CLOVER_ENV` to `production`.
