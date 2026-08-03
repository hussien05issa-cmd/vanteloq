# Vanteloq threat model

Method: asset/entry-point review with STRIDE-style categories and business-abuse analysis.  
Review date: 2026-08-02  
Owner: Vanteloq engineering; legal/privacy items require qualified counsel.

## Assets

- Authenticated identities, sessions, memberships, and privileged roles
- Organization profiles, tax identifiers, operating records, tasks, and audit history
- Future POS sales, customer, inventory, supplier, marketing, and settlement data
- Future OAuth tokens, API keys, webhook secrets, and encryption keys
- Application source, deployment identity, D1 data, backups, logs, and domains

## Threat actors

- Anonymous external attacker
- Malicious or compromised tenant user
- Compromised owner/administrator account
- Careless or malicious support/employee user
- Compromised dependency, CI identity, provider, or integration
- Automated abuse, scraping, denial-of-service, and credential attacks

## Entry points

- Public landing page and dispatcher-owned sign-in
- Onboarding and task APIs
- Future CSV upload, OAuth callbacks, incoming/outgoing webhooks, public APIs, exports, and admin tools
- Deployment pipeline, dependency registry, cloud control plane, logs, backups, and support processes

## Material threats

| Threat | Likelihood | Impact | Current mitigation | Residual risk / additional mitigation | Owner |
|---|---|---:|---|---|---|
| Cross-tenant record access | High | Critical | Parameterized ORM only | Add membership-derived scope, foreign keys, negative tenant tests, and repository policy | Engineering |
| Anonymous organization takeover | High | Critical | None | Trusted identity, one-time onboarding state, origin checks, throttling, audit events | Engineering |
| Privilege escalation | Medium | Critical | No roles exist | Central RBAC, deny-by-default, recent reauthentication for privileged changes | Engineering |
| Session theft/replay | Medium | High | Dispatcher manages session | Secure hosted cookies must be verified operationally; revoke sessions through identity provider; no tokens in browser storage | Platform/Engineering |
| CSRF on state changes | Medium | High | No explicit control | Same-origin enforcement plus dispatcher SameSite/session controls; negative tests | Engineering |
| Injection/mass assignment | Medium | High | Drizzle parameterization | Strict field allowlists, bounded JSON parser, DTOs, content-type controls | Engineering |
| OAuth token theft | Medium when enabled | Critical | Integrations not implemented | Encrypted secret storage, minimal scopes, state/PKCE, redacted logs, rotation | Integrations |
| Forged/replayed webhook | Medium when enabled | High | Webhooks not implemented | Raw-body signatures, timestamp window, event uniqueness, idempotent queue | Integrations |
| Malicious CSV/file | Medium when enabled | High | Upload not implemented | Private storage, type/signature/size checks, scanning, staging, tenant ownership, short retention | Data platform |
| Business metric corruption | Medium | High | Prototype calculations only | Immutable source facts, reconciliation, import quality gates, lineage, audit events | Data platform |
| Duplicate charge/refund/credit | Low now | Critical if billing added | Payments not implemented | Hosted processor, authoritative server totals, idempotency, signed webhooks, append-only state | Billing |
| Sensitive log leakage | Medium | High | No structured logging | Central redaction, allowlisted metadata, log tests, restricted retention | SRE |
| Dependency compromise | Medium | High | Lockfile and pinned versions | SCA, SBOM, secret scanning, reviewed updates, immutable CI actions | DevSecOps |
| D1/backup theft or deletion | Low/Medium | Critical | Provider controls not verified | Restricted identities, encryption, backup retention, restore drills, deletion protection where supported | SRE |
| Denial of service/cost abuse | Medium | High | Cloudflare edge only | Per-identity/IP/tenant throttles, bounded queries/uploads, WAF, queue limits, alerts | SRE |
| Insider export | Low/Medium | Critical | No export permission or audit | Elevated permission, recent reauth, export limits, immutable audit, alerts | Security |
| Misleading analytics | High in prototype | High | Empty-state routing hides some fixtures | Remove fixture paths, source status, completeness/confidence, reproducible metric definitions | Product/Data |

## Business-abuse cases

- A user changes an organization ID, task ID, role, provider ID, price, discount, or plan in a request.
- A manager tries to approve their own restricted adjustment or access another location/tenant.
- A caller retries a create/import/payment request to cause duplicates.
- An attacker triggers excessive invitations, password/recovery messages, imports, reports, or provider API costs.
- A user bypasses required reconciliation/import stages or edits an immutable completed period.
- An owner exports more customer data than needed or an operator views sensitive data without a business reason.

Server-side policy, explicit state transitions, idempotency, limits, and audit events are required controls for these cases.

## Acceptance rule

No live POS, customer, tax, payment, or provider-secret data may be admitted while a Critical tenant-isolation or identity finding remains open. High risks require a documented owner, mitigation, and deadline before launch.

