# Lightspeed Retail R-Series connector

Vanteloq treats R-Series as a separate provider from Lightspeed X-Series. The connector is read-only and staging-only until a sample reconciliation is approved.

## Multi-tenant model

- Register one server-side OAuth client for the Vanteloq application.
- Every Vanteloq organization starts its own OAuth authorization flow.
- OAuth state is single-use, expires after ten minutes, and is bound to the initiating organization and user.
- Each organization's access and refresh credentials are encrypted separately and stored under the `lightspeed-r` provider key.
- Account, shop mappings, sync runs, staged sales and audit events are tenant-scoped.
- Disconnecting one organization cannot revoke or delete another organization's credentials or history.

## Lightspeed client registration

Register the Vanteloq client in the Lightspeed R-Series developer portal as a confidential, server-side application.

- Registration page: `https://cloud.lightspeedapp.com/oauth/register.php`
- Application name: `Vanteloq` (do not include “Lightspeed” in the client name)
- Redirect URI: `https://vanteloq.com/api/v1/integrations/lightspeed-r/callback`
- Website: `https://vanteloq.com`

Configure these hosted values without committing them to source:

- `LIGHTSPEED_R_CLIENT_ID`
- `LIGHTSPEED_R_CLIENT_SECRET`
- `LIGHTSPEED_R_REDIRECT_URI`
- `INTEGRATION_ENCRYPTION_KEY`

The requested scopes are `employee:register_read` and `employee:inventory_read`. The authorizing R-Series employee must also have the corresponding rights.

The production Sites environment contains all four required values and the callback is set to the exact `vanteloq.com` route. This proves configuration readiness only; the provider connection is not considered live until an owner completes OAuth and the staged sample reconciles.

## Owner workflow

1. Open Integrations & data → Connections.
2. Choose Lightspeed R-Series → Connect.
3. Approve the read-only permissions in R-Series.
4. Map every R-Series shop to the correct Vanteloq location or explicitly ignore it.
5. Stage a bounded sample.
6. Review record counts, duplicates, unmapped shops, totals and warnings.

The reconciliation panel shows completed-sale count, the R-Series register total, recorded tax and recorded cost. These are source facts, not generated estimates. The owner must compare them to the matching R-Series report before Vanteloq enables a live import approval.

Staged records do not affect dashboards, BookLoQ or the reorder engine. Promotion remains blocked until reconciliation and a separate approval gate pass.

## Data safety

- The connector calls only R-Series `GET` endpoints.
- Customer records and contact details are not persisted by sale normalization.
- Monetary values are converted to integer minor units.
- Pagination is restricted to `api.lightspeedapp.com` and the connected account path.
- Failed normalization preserves the previous cursor so records are retried.
- Duplicate sale versions are ignored through a tenant/provider/source uniqueness constraint.
- Secrets never appear in the integration status API, audit details or browser responses.
