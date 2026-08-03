# Secure backend implementation plan

## Phase 1 — identity and tenant boundary

- Require trusted hosted identity on protected APIs
- Add users, memberships, roles, tenant-owned tasks, audit events, and rate-limit buckets
- Derive organization scope server-side
- Remove mock identity and fake password-registration behavior
- Add strict validation, origin checks, body limits, safe errors, correlation IDs, security headers, and health/readiness endpoints
- Add authorization and hostile-path tests

Exit gate: no unauthenticated organization/task access; no shared workspace key; tenant tests pass.

## Phase 2A — daily-summary intelligence (implemented)

- Store tenant-owned import batches and daily date/location facts
- Validate and import up to 366 CSV/manual daily summaries with idempotent convergent writes
- Calculate reproducible period metrics and volume-versus-basket explanations
- Return evidence, confidence, missing dimensions, financial effect, and suggested action
- Link recommendations to persistent actions
- Record business events and measure 14-day before/after sales impact when supported
- Add formula-transparent scenario planning
- Test forward migrations, import replay, intelligence output, business memory, action linkage, and two-tenant isolation

Exit gate: passed in the automated disposable-D1 flow.

## Phase 2B — normalized commerce data

- Define locations, sources, import batches, products, inventory, customers, transactions, lines, tenders, discounts, and returns
- Implement CSV template detection, mapping, validation, reconciliation, duplicate detection, and dry-run preview
- Keep uploads private with short retention and scan/isolation controls
- Produce metrics only from accepted source facts

Exit gate: totals reconcile, duplicate import is idempotent, malformed data cannot cross tenants, and deletion/retention behavior is tested.

## Phase 2C — BookLoQ accounting core (implemented)

- Add BookLoQ as a primary Vanteloq workspace with a responsive, collapsible, searchable, permission-filtered 24-section navigator
- Add tenant-owned chart of accounts, periods, contacts, journal entries and lines, transaction feed, bank/reconciliation records, AP/AR, alerts, budgets, and close work
- Enforce integer-minor-unit money, balanced journals, active organization-owned accounts, open-period posting, idempotency, immutable linked reversals, and audit events
- Calculate trial balance, P&L, balance sheet, GST/HST working position, reconciliation difference, health score, and certainty-separated cash forecast deterministically
- Connect financial alerts to the shared Vanteloq Action Centre
- Include only explicitly labelled demo records and block demo seeding into any populated live ledger
- Disable provider-dependent actions until their adapters and operational controls pass

Exit gate: lint, strict types, production build, rendering, accounting-unit, migration, hostile-request, idempotency, journal-reversal, and two-tenant flow tests pass. Live financial data remains gated by Phase 3 and Phase 5.

## Phase 3 — live integrations

- Add provider adapter interface for Lightspeed, Square, Moneris, Shopify POS, Google, and accounting providers
- Implement OAuth state/PKCE, encrypted tokens, revocation, scope review, callback validation, and tenant-bound sync state
- Add signed/replay-protected webhooks and idempotent queued sync jobs
- Surface last successful sync, freshness, gaps, and provider outages honestly

Exit gate: token redaction and rotation pass; webhook replay and tenant isolation tests pass; provider failure cannot corrupt core state.

## Phase 4 — deeper analytics and operational workflows

- Rebuild inventory, customers, reports, loyalty, marketing, SEO, calendars, and recommendations on normalized facts
- Add metric definitions, data-quality status, drill-down lineage, confidence, and anomaly explanations
- Add scheduled reports, bounded exports, operational approvals, and immutable period controls

Exit gate: every metric is reproducible, filters share tenant/location/date context, and no fixture data reaches a real workspace.

## Phase 5 — production operations

- Configure WAF, bot controls, external uptime, error tracking, dashboards, alert routing, backup retention, and restore drills
- Add dependency/SAST/secret/SBOM/container or artifact checks as applicable
- Run staging DAST, recovery, rollback, MFA/recovery, session revocation, and incident exercises
- Complete privacy/legal review and subprocessor/retention documentation

Exit gate: final launch checklist passes, no Critical findings remain, and every High finding has an approved owner and deadline.
