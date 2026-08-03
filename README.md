# Vanteloq

Vanteloq is a retail operating-intelligence platform for sales, margin, inventory, customers, marketing, SEO, reporting, and daily operating work. This repository is the Cloudflare Worker-compatible modular monolith hosted through Sites.

## Current release boundary

Implemented now:

- Public branded landing page
- Dispatcher-owned authenticated sign-in
- Secure, empty-workspace onboarding
- Organization membership and owner role
- Tenant-owned persistent tasks
- Versioned API, strict request validation, same-origin write protection, rate limits, idempotency, audit events, and security headers
- D1 migrations that preserve and migrate the earlier prototype workspace and tasks
- Health, readiness, OpenAPI, and hostile-path security tests

Not implemented yet:

- Independent email/password, passkeys, MFA, recovery, or session-management UI
- Live POS/Google/accounting OAuth, provider tokens, webhooks, or synchronization
- CSV file ingestion and normalized sales/inventory/customer facts
- Payments, billing, email delivery, background queues, or customer-data exports
- Account-level Cloudflare WAF/backup/alert configuration evidence

The application must not be described as production-ready while the open High findings in `docs/SECURITY_ACCEPTANCE.md` remain.

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
- `tests/`: render and negative-security tests
- `docs/`: architecture, threat model, operations, retention, deployment, and acceptance evidence

## API

The supported application API is under `/api/v1`. The runtime description is available at `/api/v1/openapi`; detailed rules are in `docs/API.md`. Old unversioned prototype endpoints have been removed.

## Security reporting

Do not include credentials, tokens, customer records, tax identifiers, or provider payloads in an issue. Record the affected route, request ID, observed behavior, and safe reproduction context. Rotate any exposed credential before sharing evidence.

