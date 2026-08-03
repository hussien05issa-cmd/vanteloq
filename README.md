# Vanteloq

Vanteloq is a retail operating-intelligence platform for sales, margin, inventory, customers, marketing, reporting, daily operating work, and BookLoQ accounting. This repository is the Cloudflare Worker-compatible modular monolith hosted through Sites.

## Current release boundary

Implemented now:

- Public branded landing page
- Dispatcher-owned authenticated sign-in
- Secure, empty-workspace onboarding
- Organization membership and owner role
- Tenant-owned persistent actions linked to manual work, insights, alerts, or decisions
- Validated daily-summary CSV import and manual daily entry
- Evidence-bound owner command centre with period comparisons, source freshness, data-quality limits, deterministic insight evidence, and recommended actions
- Business memory and decision journal with measured before/after sales impact when sufficient history exists
- Formula-transparent scenario planner, owner brief, evidence-bound advisor, owner stress list, and industry/module data contracts
- Integrated BookLoQ workspace with a permission-aware 24-section finance navigator, integer-minor-unit double-entry ledger, balanced journals and linked reversals, Canadian GST/HST working calculations, banking and reconciliation records, receivables/payables, alerts-to-actions, cash forecast, budgets, month-end controls, reports, audit history, and a deterministic accounting assistant
- An optional, explicitly labelled Canadian retail demonstration ledger that cannot be loaded over an existing live ledger
- Versioned API, strict request validation, same-origin write protection, rate limits, idempotency, audit events, and security headers
- D1 migrations that preserve and migrate the earlier prototype workspace and tasks
- Health, readiness, OpenAPI, hostile-path tests, deterministic calculation tests, forward-migration tests, idempotent import tests, and a two-tenant end-to-end intelligence-to-action test

Not implemented yet:

- Independent email/password, passkeys, MFA, recovery, or session-management UI
- Live POS/Google/accounting OAuth, provider tokens, webhooks, or synchronization
- Live line-item POS, SKU inventory, customer, campaign, employee, supplier, payout, bank, and accounting feeds
- Provider-backed bank/POS synchronization, document OCR, payment initiation, tax filing, payroll execution, accountant invitations, and production PDF/XLSX report generation
- Payments, billing, email delivery, background queues, or customer-data exports
- Account-level Cloudflare WAF/backup/alert configuration evidence

The production dependency audit is currently clean. The application must still not be described as production-ready while the remaining identity-lifecycle and account-level operational High findings in `docs/SECURITY_ACCEPTANCE.md` remain.

## Local setup

Prerequisites: Node.js 22.13 or later, Linux tooling used by the Sites starter, and access to the Sites lifecycle.

1. Open the existing Site checkout through the Sites lifecycle.
2. Install exactly from the lockfile with `npm run install:ci` when dependencies are not already present.
3. Start the agent-compatible local application with `sites-preview start "$PWD"`.
4. Use `npm run lint`, `npm run typecheck`, and `npm test` for checks.
5. Generate a migration after schema changes with `npm run db:generate`, then inspect the SQL before deployment.

Local development uses a Sites-managed simulated D1 binding. No production data or secret is required. `.env.example` lists variable names only; hosted values belong in encrypted runtime configuration.

## Project structure

- `app/`: public UI, secure onboarding, and API routes
- `server/`: request security, authorization, validation, and audit helpers
- `db/`: Drizzle D1 access and schema
- `drizzle/`: reviewed, version-controlled migrations
- `worker/`: Cloudflare Worker entry and browser security headers
- `tests/`: render, hostile-path, intelligence-calculation, migration, tenant-isolation, and end-to-end workflow tests
- `docs/`: architecture, threat model, operations, retention, deployment, and acceptance evidence

## API

The supported application API is under `/api/v1`. The runtime description is available at `/api/v1/openapi`; detailed rules are in `docs/API.md`. Old unversioned prototype endpoints have been removed.

Calculation definitions and evidence rules are in `docs/INTELLIGENCE_CONTRACT.md`. BookLoQ's accounting boundary is documented in `docs/BOOKLOQ.md`. The honest implementation boundary for every requested product area is in `docs/PRODUCT_CAPABILITY_AUDIT.md`.

## Security reporting

Do not include credentials, tokens, customer records, tax identifiers, or provider payloads in an issue. Record the affected route, request ID, observed behavior, and safe reproduction context. Rotate any exposed credential before sharing evidence.
