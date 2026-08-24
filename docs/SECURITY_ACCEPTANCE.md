# Security acceptance status

Date: 2026-08-24

## Passed in this phase

- Production artifact build and Sites validation
- Type checking
- Linting after dead prototype removal
- Seven hostile-path security tests, including anonymous denial on intelligence and BookLoQ reads plus cross-site denial on every BookLoQ write surface
- Three deterministic calculation tests covering empty-workspace honesty, supported exceptions, evidence/action presence, and event impact thresholds
- Five deterministic BookLoQ tests covering integer-money journal equality, reversal mechanics, Canadian tax rounding, reconciliation, financial statements, trial balance, health score, and certainty-separated forecast calculations
- Disposable D1 forward-migration test through migration `0004`
- Complete end-to-end intelligence-to-action and accounting test: onboarding, empty state, 60-row import, idempotent replay, metric/insight generation, linked task, decision measurement, labelled BookLoQ seed/replay, balanced posting/replay/reversal, second tenant onboarding, and confirmed zero cross-tenant operating or financial rows
- Retry-safe onboarding identifiers and ordering so a partial D1 batch can converge without reactivating a suspended membership
- Source secret-pattern scan: zero matching files
- Production dependency audit: zero known vulnerabilities after the verified Next.js 16.3.0 toolchain update
- Public landing visual and interaction inspection
- Versioned route inventory
- Additive migration review with preservation of prior workspace/task data
- OpenAPI inventory and documented accounting invariants for each BookLoQ route and state change
- Protected, recent-MFA account and workspace deletion controls with exact typed confirmation, rate limiting, Stripe cancellation, object deletion, local connector-secret deletion, Supabase account deletion, shared-account preservation, and de-identified time-limited receipts
- Material legal-policy updates require new affirmative acceptance before billing status or workspace access is displayed
- Public Terms of Service, Privacy Policy, Cookie Notice, Data Processing Addendum, and subprocessor notice reflect the current core and optional provider boundaries
- Shopify privacy-compliance webhook topics and signed handlers are configured for data access and redaction requests

## Open findings

| Severity | Risk | Affected component | Temporary mitigation | Permanent fix | Owner / deadline |
|---|---|---|---|---|---|
| High | Account-level WAF, backup retention, restore drill, error tracking, uptime, and alert delivery are not evidenced | Cloudflare operations | Site remains limited during development; health/readiness endpoints exist | Configure account controls and complete a recorded restore/alert exercise | SRE, before public launch |
| High | Supabase leaked-password protection is disabled on the Free plan and session/device revocation UI is not exposed | Public identity lifecycle | Live 12-character/character-class policy, secure password change, Turnstile, rate limits, PKCE, token rotation and mandatory AAL2 are enforced | Upgrade Supabase, enable leaked-password protection, configure session timeouts, and add session/device management | Product/Security, before public launch |
| Medium | Full CSP still uses report-only mode for script/style policy | Browser security | Enforced frame/base/form restrictions plus other headers | Remove inline requirements and enforce full nonce/hash-based CSP after violation review | Frontend, before public launch |
| High | Independent Alberta legal review, vendor-contract review, and commercial-insurance confirmation are not evidenced | Legal and commercial operations | Public terms, privacy notices, DPA, deletion controls, subprocessor register, and internal compliance pack are prepared | Obtain written counsel review, approve the policies, register any required trade name, and confirm suitable coverage before broad paid launch | Owner, before broad paid launch |
| High | Production account deletion has not yet been exercised through a disposable paid test workspace and independently verified across Stripe, D1, R2, and Supabase | Identity, billing, and privacy lifecycle | Source-level controls and tests fail closed; exact confirmation and recent MFA are required | Deploy the migration and code, run one documented end-to-end deletion drill, and retain the nonidentifying receipt | Product/Security, before broad paid launch |
| Medium | Connector controls exist, but production provider contracts, app-review requirements, regional processing terms, and remote-revocation behaviour require recurring evidence | Integrations and BookLoQ | Read-only scopes, encrypted local credentials, signed webhooks, explicit selection, and fail-closed readiness checks are implemented | Complete the vendor register, accept current DPAs, test revocation and privacy webhooks, and review quarterly | Integrations/Privacy, before enabling each provider for customers |
| Medium | Canadian jurisdiction content, foreign-currency remeasurement, full inventory subledger, depreciation schedules, and production financial-report rendering have not received professional accounting review | BookLoQ accounting content | The module is an evaluation core; demo data is labelled; unsupported functions are gated; tax disclaimer is displayed | Complete accountant/tax review, reference datasets, independent ledger validation, and report certification | Finance product, before live ledger use |
| Medium | Full DAST, load, rollback, disaster recovery, and penetration testing are incomplete | Release assurance | Access remains restricted during development | Execute staging test plan and independent review | Security/SRE, before launch |

## Launch decision

**Fail pending launch evidence.** The source-level authentication, MFA, tenant, policy-acceptance, account-deletion, connector, migration, calculation, and application controls can pass automated verification, but broad paid onboarding remains blocked until the current build and migration are deployed, a disposable live deletion drill passes, the open Cloudflare and Supabase controls are evidenced, independent legal and accounting reviews are completed, provider contracts are accepted, and the required operational exercises are recorded.
