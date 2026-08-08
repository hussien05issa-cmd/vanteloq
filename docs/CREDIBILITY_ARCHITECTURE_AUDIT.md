# Vanteloq credibility architecture audit

Date: 2026-08-08  
Scope: repository state after the data-trust upgrade

## Executive finding

Vanteloq is an existing modular monolith, not a decorative dashboard prototype. It already contains a substantial Phase 1 foundation: hosted authentication, server-resolved tenant membership, resource/action permissions, D1 persistence, R2 document storage, deterministic accounting and inventory calculations, append-only audit events, integration staging, rate limiting, source-gated empty states, and automated security checks.

The most important credibility gap found in this pass was between the metric registry and the dashboard presentation. Canonical formulas existed, but the API did not expose a standardized `MetricResult` contract and the user could not inspect source, period, record count, calculation version, freshness, or confidence from the KPI itself. This pass closes that gap for the command-centre metrics.

## Runtime and deployment architecture

- Application shape: Next/Vinext application compiled to a Cloudflare Worker.
- Persistence: Cloudflare D1 through Drizzle and parameterized D1 statements.
- Object storage: Cloudflare R2 for tenant-owned documents and branding assets.
- Authentication: dispatcher-owned ChatGPT sign-in headers; no application password store.
- Authorization: server resolves active user membership and organization; client organization identifiers are not authoritative.
- Hosting: OpenAI Sites with logical `DB` and `BUCKET` bindings.
- Client: one public landing/onboarding entry and one authenticated multi-workspace application shell.

## Route map

Public and operational health:

- `/`
- `/api/health`
- `/api/readiness`
- `/api/v1/openapi`

Identity, governance, and tenant configuration:

- `/api/v1/onboarding`
- `/api/v1/governance`
- `/api/v1/organization-logo`

Operating data and intelligence:

- `/api/v1/command-centre`
- `/api/v1/daily-metrics`
- `/api/v1/data-quality`
- `/api/v1/events`
- `/api/v1/reports`
- `/api/v1/tasks`
- `/api/v1/operations`
- `/api/v1/purchasing`
- `/api/v1/documents`

BookLoQ accounting:

- `/api/v1/bookloq`
- `/api/v1/bookloq/actions`
- `/api/v1/bookloq/journals`
- `/api/v1/bookloq/demo`

Integration control plane:

- `/api/v1/integrations`
- Lightspeed X-Series authorize, callback, outlets, sync, webhook, and disconnect routes
- Lightspeed R-Series authorize, callback, shops, sync, and disconnect routes

## Data model and relationships

Core identity and tenancy:

- `users` → `memberships` → `workspaces`
- `account_preferences`, `account_notifications`
- `organization_profiles`, `organization_locations`
- `access_roles`, `team_members`, `employee_pin_credentials`

Operating records:

- `data_imports` → `daily_business_metrics`
- `business_events`
- `workspace_tasks`
- `operational_events` → `inventory_movements` / `outbound_messages`
- `inventory_balances`
- `workspace_documents`
- `purchase_orders` → `purchase_order_lines` → `goods_receipts` / `invoice_matches`

Integration records:

- `integration_connections`
- `integration_secrets`
- `integration_oauth_states`
- `integration_location_mappings`
- `integration_sync_runs`
- `integration_staged_sales`
- `integration_webhook_events`

Accounting records:

- `bookloq_settings`, `bookloq_role_assignments`
- `financial_accounts`
- `accounting_periods`
- `journal_entries` → `journal_lines`
- `financial_transactions`
- `bank_accounts` → `reconciliations`
- `bookloq_contacts` → `supplier_bills` / `customer_invoices`
- `bookloq_alerts`, `bookloq_budgets`, `month_end_items`

Control records:

- `audit_events`
- `rate_limit_buckets`

The original prototype `tasks` and `organizations` tables remain intentionally retained for backward-compatible migration safety; application routes no longer use them.

## Dependency map

```text
POS / CSV / user-approved operational records
  → provider adapters and validated API imports
  → encrypted credentials, replay controls, bounded staging and mapping
  → normalized D1 records scoped by organization
  → canonical metric registry and deterministic calculation services
  → data-trust metadata, quality checks and evidence-bound intelligence
  → permission-filtered API DTOs
  → dashboard, reports, data quality, accounting and action workflows
```

Generative AI is not currently an authoritative dependency. The visible advisor and BookLoQ assistant use deterministic internal results and return missing-source boundaries for unsupported questions. Core reporting, accounting, inventory, purchasing, authentication, and integration staging do not depend on model availability.

## Existing credibility and security controls

- Money is stored as integer minor units; rates use basis points or parts per million where applicable.
- Journal entries are balanced and corrections use linked reversals.
- Accounting periods, reconciliation, AP/AR, cash forecasting certainty, and tax working values are deterministic.
- Every protected API authenticates and resolves tenant scope server-side.
- Permission checks are resource/action based and enforced on the server.
- Writes use same-origin checks, bounded bodies, allowlisted schemas, rate limits, and idempotency where replay is plausible.
- Integration secrets use authenticated encryption and never enter browser DTOs.
- Lightspeed adapters use least-privilege scopes, OAuth state, pagination bounds, provider-domain allowlists, retry handling, token rotation, staging, webhook signature verification, and replay protection.
- Provider data promotion remains disabled until reconciliation acceptance.
- The shared pre-sync gate distinguishes verified Lightspeed authorization, change-signal, and staging controls from the remaining reconciliation acceptance gate.
- Documents are tenant scoped, content/magic checked, duplicate hashed, and held for review; malware/OCR claims remain disabled.
- Audit metadata is size bounded and excludes raw source addresses through hashing.
- Worker responses apply HSTS, frame denial, MIME protection, same-origin API resource policy, and a report-only CSP.
- Empty and disconnected states do not fabricate revenue, inventory, customer, forecast, or insight values.

## Calculation and intelligence architecture

Existing deterministic services:

- Metric registry
- Command-centre period aggregation and comparison
- Volume-versus-basket sales decomposition
- Margin and labour exception detection
- Operating-system decision ranking
- Reorder Brain with explainable scenarios and constraints
- Double-entry financial statement engine
- Cash forecast with confirmed/probable/estimated separation
- Bookkeeping health and reconciliation helpers
- Purchase-order, receiving, invoice-match, and operational event services

Added in this pass:

- Formal `MetricResult` contract with actual/unavailable classification
- Source system, source account scope, source record count, source timestamp
- Calculation method and historical calculation version
- Period and comparison-period boundaries
- Freshness state and evidence-based confidence classification
- Limitations carried from the canonical registry
- Inspectable KPI evidence UI

## Observability and background execution

Present:

- Per-request correlation identifiers
- Structured safe API failure logs
- Integration sync-run state and error codes
- Audit events for material actions
- Health and readiness endpoints

Not present or not verified:

- No production OpenTelemetry exporter
- No external error/trace vendor
- No configured cron trigger or durable queue consumer
- Webhook records can be queued, but production dead-letter operations are not implemented
- Cloud account WAF, backup schedules, restore exercises, and alert routing are outside this repository and were not verified

## Honest feature gaps

- Live Lightspeed credentials and a provider sandbox acceptance run were not available; the adapters remain read-only staging.
- Square, Moneris, Stripe, Google Business, Google Ads, Meta, banking, payroll, and accounting connectors do not have verified live adapters.
- Line-item product, normalized customer, marketing attribution, SEO, supplier history, hourly demand, and employee schedule models remain incomplete.
- The current command centre consolidates locations and does not yet provide a complete location-comparison engine.
- There is no production anomaly model with seasonal baselines or forecast model with confidence intervals for revenue/cash.
- There is no generative model integration, prompt registry, token accounting, or AI trace store; therefore no claim of production generative AI is made.
- CSP enforcement remains report-only for scripts/styles while framework compatibility is evaluated.
- Multi-workspace membership is not supported by the current unique user-membership constraint.
- Several large client components should eventually be decomposed, but doing so was not required to close the trust gap and would add regression risk now.

## No-fake-functionality audit

- BookLoQ demonstration records are created only through an explicit demonstration endpoint and carry demonstration flags.
- Empty-workspace charts are explicitly labelled as layout previews with no business data.
- Provider cards without adapters remain planned/disabled and state their activation gates.
- Significant operational or financial actions remain permissioned and require explicit approval.
- Unsupported assistant questions return missing-source explanations rather than invented answers.

## Recommended next engineering phase

1. Build provider reconciliation acceptance for Lightspeed staged totals, taxes, discounts, refunds, duplicates, and payout timing.
2. Promote only reconciled normalized facts into a versioned source-of-truth ledger.
3. Add normalized products, SKUs, transaction lines, supplier price history, and inventory snapshots.
4. Connect the existing Reorder Brain to verified SKU demand and supplier lead-time history.
5. Add an explicit seasonal anomaly service only after sufficient history exists.
6. Introduce durable queue/dead-letter operations and OpenTelemetry-compatible export before background automation expands.
7. Add end-to-end authenticated browser coverage when a supported test identity environment is available.
