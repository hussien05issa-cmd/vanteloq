# Provider configuration and live-status register

## Current status

Last reviewed September 15, 2026. Use [the V1 launch review](v1-launch-readiness-2026-09-15.md) for acceptance evidence and [the provider dashboard review](provider-activation-review-2026-09-15.md) for current account and approval blockers.

- Supabase email authentication with the application's tenant and session controls is in use.
- Sites-managed Cloudflare D1 stores tenant business records; private R2 stores document originals and organization assets.
- Lightspeed R-Series history is importing in the authorized pilot workspace. A complete merchant reconciliation is still an acceptance step.
- OpenAI workspace analysis, Resend sending, Azure document extraction and the clean-file scanning path have live evidence recorded in the launch review.
- Stripe live prices, billing webhook configuration and the customer portal are present. The separate subscriber hosted-checkout lifecycle is still outstanding.
- Manual entry, validated imports, the internal BookLoQ ledger and deterministic calculations are implemented. An accountant-reviewed pilot close remains outstanding.

The checklist below describes activation requirements, not proof that every provider is active. Credentials and an open provider dashboard do not establish production approval or successful data reconciliation.

## Gated providers

| Provider group | Required before activation |
|---|---|
| Lightspeed X-Series | The read-only staging adapter and hosted OAuth configuration are present with the exact production callback and `2026-07` API version. Authorize an owner account, map outlets, reconcile a bounded sales sample, fault-test refresh/rate-limit/replay paths, and complete a read-only canary before data promotion can be approved. See `LIGHTSPEED_X_SERIES.md`. |
| Lightspeed R-Series | The multi-tenant read-only adapter and hosted OAuth configuration are present with the exact production callback and least-privilege `employee:register_read employee:inventory_read` scopes. Each retailer must authorize its own account, map shops, reconcile a bounded sample, pass recovery tests and complete a read-only canary before promotion. See `LIGHTSPEED_R_SERIES.md`. |
| Shopify, Square, Clover, Stripe, Moneris, WooCommerce | Production application approval; client credentials in server secrets; exact least-privilege scopes; hosted OAuth redirect; encrypted token storage; refresh handling; signed webhooks; idempotent backfill/incremental sync; rate-limit/retry/dead-letter behavior; provider-specific normalization; payout and reconciliation tests; disconnect/deletion workflow; verified production account |
| Plaid | Commercial production agreement; verified institution/country/account-type coverage; provider-hosted consent flow; server-held client credentials; encrypted access tokens; consent-expiry handling; signed webhooks; pending/posted transaction reconciliation; account deletion/disconnection; Canadian coverage validation where claimed; production certification |
| QuickBooks | The state-bound OAuth, affirmative in-app notice, encrypted refresh-token storage, company selection verification, revocation, and staging-only boundary are implemented. Sandbox client credentials and the exact hosted callback must be configured. Ledger import, account and tax mapping, incremental sync, conflict and closed-period policy, recovery, reconciliation tests, and Intuit production review remain required before accounting records or calculations can be enabled. |
| Xero | Production OAuth application; accounting scopes; tenant selection; chart/account/tax mapping; incremental sync; conflict and closed-period policy; webhook or polling recovery; reconciliation tests |
| DoorDash and Uber Eats | Coming soon only. The cards do not initiate authorization or receive provider data. Partner access, provider contracts, order and settlement mapping, retry and reconciliation tests, and production approval are required before activation. |
| Payroll | Selected provider and agreement; payroll-total versus individual-compensation scopes; consent; encryption; pay-period mapping; retry/reconciliation; strict payroll permissions; retention policy |
| OCR/document extraction | Selected extraction provider; private service credentials; tested field and line schema; confidence calibration; provider-run audit IDs; uncertain-field review workflow; arithmetic/tax/duplicate/PO discrepancy tests |
| Malware scanning | Private object scanning provider; quarantine callback; signature verification; timeout/retry policy; clean/malicious/unknown verdict handling; incident response and retention policy |
| Address validation | Region-specific provider; API credentials; session-token/debounced autocomplete; privacy/logging configuration; returned validation status; manual confirmation; deliverability tests; provider attribution rules |
| Transactional email | Verified sending domain; provider credentials; invitation templates; signed/expiring invitation tokens; bounce/complaint handling; resend/revoke state; audit records |
| Billing | Production billing account; products/prices; hosted payment collection; signed webhooks; subscription entitlement mapping; invoice/tax handling; cancellation and data-retention policy |
| XLSX/PDF/scheduled reports | Workbook and PDF generation service or tested internal renderer; private object storage; expiring download links; export authorization; delivery provider; queue/retry/failure handling |

## Activation rule

A provider may move from `configuration_required` or `planned` to `connected` only after its adapter returns a verified successful connection and the authorization, signature, idempotency, reconciliation, tenant-isolation, deletion and failure-recovery tests pass. A configured logo or connection card is never proof of a live integration.
