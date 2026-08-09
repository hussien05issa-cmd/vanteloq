# Provider configuration and live-status register

## Genuinely live now

- Hosted ChatGPT/Sites authentication: verified identity and application session forwarding.
- Cloudflare D1: tenant relational records and migrations.
- Cloudflare R2 binding: tenant organization logos and quarantined document originals.
- Manual entry and validated daily-summary CSV ingestion.
- Internal BookLoQ ledger and deterministic calculation services.

No external POS, bank, accounting, payroll, OCR, malware-scanning, email, billing or address-validation provider is represented as live.

## Gated providers

| Provider group | Required before activation |
|---|---|
| Lightspeed X-Series | The read-only staging adapter and hosted OAuth configuration are present with the exact production callback and `2026-07` API version. Authorize an owner account, map outlets, reconcile a bounded sales sample, fault-test refresh/rate-limit/replay paths, and complete a read-only canary before data promotion can be approved. See `LIGHTSPEED_X_SERIES.md`. |
| Lightspeed R-Series | The multi-tenant read-only adapter and hosted OAuth configuration are present with the exact production callback and least-privilege `employee:register_read employee:inventory_read` scopes. Each retailer must authorize its own account, map shops, reconcile a bounded sample, pass recovery tests and complete a read-only canary before promotion. See `LIGHTSPEED_R_SERIES.md`. |
| Shopify, Square, Clover, Stripe, Moneris, WooCommerce | Production application approval; client credentials in server secrets; exact least-privilege scopes; hosted OAuth redirect; encrypted token storage; refresh handling; signed webhooks; idempotent backfill/incremental sync; rate-limit/retry/dead-letter behavior; provider-specific normalization; payout and reconciliation tests; disconnect/deletion workflow; verified production account |
| Plaid | Commercial production agreement; verified institution/country/account-type coverage; provider-hosted consent flow; server-held client credentials; encrypted access tokens; consent-expiry handling; signed webhooks; pending/posted transaction reconciliation; account deletion/disconnection; Canadian coverage validation where claimed; production certification |
| QuickBooks, Xero | Production OAuth application; accounting scopes; company/tenant selection; chart/account/tax mapping; incremental sync; conflict and closed-period policy; webhook or polling recovery; reconciliation tests |
| Payroll | Selected provider and agreement; payroll-total versus individual-compensation scopes; consent; encryption; pay-period mapping; retry/reconciliation; strict payroll permissions; retention policy |
| OCR/document extraction | Selected extraction provider; private service credentials; tested field and line schema; confidence calibration; provider-run audit IDs; uncertain-field review workflow; arithmetic/tax/duplicate/PO discrepancy tests |
| Malware scanning | Private object scanning provider; quarantine callback; signature verification; timeout/retry policy; clean/malicious/unknown verdict handling; incident response and retention policy |
| Address validation | Region-specific provider; API credentials; session-token/debounced autocomplete; privacy/logging configuration; returned validation status; manual confirmation; deliverability tests; provider attribution rules |
| Transactional email | Verified sending domain; provider credentials; invitation templates; signed/expiring invitation tokens; bounce/complaint handling; resend/revoke state; audit records |
| Billing | Production billing account; products/prices; hosted payment collection; signed webhooks; subscription entitlement mapping; invoice/tax handling; cancellation and data-retention policy |
| XLSX/PDF/scheduled reports | Workbook and PDF generation service or tested internal renderer; private object storage; expiring download links; export authorization; delivery provider; queue/retry/failure handling |

## Activation rule

A provider may move from `configuration_required` or `planned` to `connected` only after its adapter returns a verified successful connection and the authorization, signature, idempotency, reconciliation, tenant-isolation, deletion and failure-recovery tests pass. A configured logo or connection card is never proof of a live integration.
