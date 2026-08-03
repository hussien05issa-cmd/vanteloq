# Vanteloq pre-implementation security audit

Date: 2026-08-02  
Scope: the complete source checkout at the start of the backend-hardening phase  
Target: OWASP ASVS 5.0.0 Level 2 baseline; OWASP Top 10; OWASP API Security Top 10; NIST SSDF

## Executive finding

The current deployment is a strong interface prototype on Cloudflare Workers with a small D1 database. It is not yet a safe multi-user SaaS backend. The most urgent issue is not cryptography or dependency selection; it is the missing identity-to-tenant boundary. Any request can currently read the first organization, create or overwrite onboarding data, and read or mutate tasks stored under one shared workspace identifier.

Production readiness is therefore **blocked**. The first implementation phase must establish authenticated identity, membership-derived organization scope, deny-by-default authorization, validated requests, audit events, and tenant-isolation tests before POS, customer, inventory, or payment data is accepted.

## Existing architecture

| Area | Current implementation | Assessment |
|---|---|---|
| Frontend | Next.js 16 / React 19 single client page, built through Vinext | Visually substantial, but most product views are one client module and several data views are hardcoded or unreachable |
| Runtime | Cloudflare Worker-compatible Vinext artifact hosted through Sites | Suitable for a modular monolith |
| Database | Cloudflare D1 through Drizzle ORM | Persistent, parameterized access exists; schema lacks tenant membership and relational constraints |
| Authentication | Dispatch-owned Sign in with ChatGPT helper exists | Helper is not enforced by the API routes |
| Authorization | None | Critical blocker |
| Persistence | `organizations` and `tasks` | Tasks use a shared hardcoded workspace key |
| Integrations | UI descriptions only | No OAuth, tokens, callbacks, sync jobs, or webhooks exist |
| File storage | None | No upload surface exists |
| Payments | None | No payment code exists |
| Background jobs/cache/email | None | Not yet implemented |
| Logging/monitoring | Generic caught errors only | No structured audit trail, health/readiness surface, alerting, or correlation IDs |
| Deployment | Sites-owned Cloudflare deployment and D1 binding | Environment separation, backup/restore verification, and external alerting are not evidenced |

## Surface inventory

### Browser surface

- Public landing route: `/`
- Client-side workspace views: Overview, Intelligence, Action Centre, Business Brief, Advisor, Sales & margin, Inventory, Customers, Marketing, SEO, Calendar, Reports, Goals, Integrations, Settings
- Forms: onboarding, task creation, task status update, date/report controls
- Authentication links: `/signin-with-chatgpt` and dispatch-owned sign-out paths
- File uploads: none implemented; CSV import buttons are descriptive only
- Administrative surface: none

### API surface

| Method | Route | Current behavior | Finding |
|---|---|---|---|
| GET | `/api/onboarding` | Returns the first organization row | Critical unauthenticated data exposure |
| POST | `/api/onboarding` | Inserts or updates by client-supplied owner email | Critical account/organization takeover path |
| GET | `/api/tasks` | Lists tasks for `default-workspace` | Critical shared-tenant exposure |
| POST | `/api/tasks` | Creates a shared task; falls back to a fabricated identity | Critical missing authentication and tenant scope |
| PATCH | `/api/tasks` | Changes a task status within the shared workspace | High broken object/function authorization |

### Data model

- `organizations`: business identity, address, hours, tax number, source preference
- `tasks`: task details and a text organization identifier without a foreign key
- No users, memberships, roles, invitations, integrations, audit events, idempotency records, rate-limit state, sync jobs, sales, products, inventory, customers, or normalized transactions

## Prioritized findings

| Severity | Finding | Evidence | Required correction |
|---|---|---|---|
| Critical | Organization disclosure | Onboarding GET selects the first organization and does not require identity | Require trusted identity; resolve organization only through membership |
| Critical | Organization overwrite/hijack | Onboarding POST trusts `ownerEmail` from JSON and upserts by that value | Derive email from trusted identity; create membership and organization with retry-safe server identifiers |
| Critical | Tenant escape in tasks | Every task uses `default-workspace`; GET is unauthenticated | Replace the shared key with a foreign-keyed organization ID derived server-side |
| Critical | Identity spoofing | Missing auth header becomes `owner@vanteloq.local` | Fail with 401; never invent an identity |
| High | No authorization model | No roles, memberships, ownership rules, or denied operations | Add membership-based RBAC and central policy helpers |
| High | Misleading account security | Password fields are evaluated in the browser, then discarded; no account is created | Use the actual hosted identity flow now; do not collect a password until a real identity provider is configured |
| High | CSRF/request abuse exposure | State-changing endpoints have no origin check, content-type guard, body limit, or throttling | Add same-origin enforcement, bounded JSON parsing, rate limits, and security tests |
| High | No audit trail | Security-sensitive changes are not recorded | Add append-only audit events with redacted metadata |
| High | Prototype figures remain in source | Synthetic reports, customers, products, alerts, and forecasts remain hardcoded | Keep disconnected workspaces empty; isolate or remove unreachable prototype models before real ingestion |
| Medium | Weak schema integrity | Tasks have no organization FK or check constraints; business hours are opaque JSON | Add relational keys, uniqueness, checks where supported, and strict server validation |
| Medium | Missing browser controls | No evidenced CSP, clickjacking, referrer, permissions, or sensitive-cache policy | Add Worker-level headers and no-store API responses |
| Medium | Insufficient error observability | Errors are caught and flattened without request IDs or safe server context | Add correlation IDs and structured, redacted events |
| Medium | No operational endpoints | No health, readiness, or liveness checks | Add non-sensitive endpoints and document monitoring |
| Medium | Minimal tests | Only rendered metadata is tested | Add negative security and tenant-boundary tests |
| Medium | Documentation gap | Starter README does not describe Vanteloq architecture or operations | Replace it with product-specific setup and security documentation |

No plaintext secret or committed credential was found in the inspected source. The repository ignores `.env*`, certificates, build output, Wrangler state, and local runtime state. That is a useful baseline, but it does not compensate for the missing authorization boundary.

## Data-classification concerns

| Data | Classification | Current state |
|---|---|---|
| Public landing content | Public | Acceptable |
| Task and operating data | Confidential | Persisted without safe tenant separation |
| Business identity, address, tax registration | Confidential | Returned without authenticated tenant scope |
| Customer/POS data | Highly sensitive when introduced | Must not be ingested until tenant isolation, retention, audit, and integration controls pass |
| Provider tokens and webhook secrets | Highly sensitive | Not implemented; must use encrypted hosted secrets and never D1 plaintext |
| Payment card data | Prohibited in Vanteloq storage | No payment system implemented |

## Recommended implementation sequence

1. Enforce trusted hosted identity and remove all fabricated identity fallbacks.
2. Add users/memberships, roles, organization foreign keys, rate-limit state, idempotency, and append-only audit events.
3. Refactor onboarding and tasks through centralized validation, authorization, and repository services.
4. Add request limits, same-origin protection, security headers, safe errors, health/readiness routes, and negative security tests.
5. Replace misleading password collection with the actual identity flow; document the decision required for independent email/password and MFA.
6. Build a normalized POS ingestion model and CSV staging/validation flow only after the acceptance checks above pass.
7. Add OAuth adapters, token encryption, webhook replay protection, queues, monitoring, backups, and restore testing before live integrations.

## Audit limitations

- Cloudflare account settings, D1 backup configuration, WAF rules, DNS, domain controls, and external alert delivery were not visible in source and are not claimed as configured.
- Git history was inspected for the current source progression, but a dedicated secret-history scanner has not yet passed.
- No dynamic security testing against a public staging environment or third-party penetration test has been completed.
- Privacy, tax, and legal obligations require qualified Canadian counsel; this audit does not claim PIPEDA, Alberta PIPA, PCI DSS, or tax compliance.
