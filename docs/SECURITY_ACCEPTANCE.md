# Security acceptance status

Date: 2026-08-09

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

## Open findings

| Severity | Risk | Affected component | Temporary mitigation | Permanent fix | Owner / deadline |
|---|---|---|---|---|---|
| High | Account-level WAF, backup retention, restore drill, error tracking, uptime, and alert delivery are not evidenced | Cloudflare operations | Site remains limited during development; health/readiness endpoints exist | Configure account controls and complete a recorded restore/alert exercise | SRE, before public launch |
| High | Supabase leaked-password protection is disabled on the Free plan and session/device revocation UI is not exposed | Public identity lifecycle | Live 12-character/character-class policy, secure password change, Turnstile, rate limits, PKCE, token rotation and mandatory AAL2 are enforced | Upgrade Supabase, enable leaked-password protection, configure session timeouts, and add session/device management | Product/Security, before public launch |
| Medium | Full CSP still uses report-only mode for script/style policy | Browser security | Enforced frame/base/form restrictions plus other headers | Remove inline requirements and enforce full nonce/hash-based CSP after violation review | Frontend, before public launch |
| Medium | External bank/POS/payroll/OCR/payment/filing adapters, credential encryption, webhook security, queue retries, and sync reconciliation are absent | Integrations and BookLoQ | All provider-dependent controls remain explicitly disabled; no credential is collected | Implement and test one provider at a time behind an adapter boundary | Integrations, phased |
| Medium | Canadian jurisdiction content, foreign-currency remeasurement, full inventory subledger, depreciation schedules, and production financial-report rendering have not received professional accounting review | BookLoQ accounting content | The module is an evaluation core; demo data is labelled; unsupported functions are gated; tax disclaimer is displayed | Complete accountant/tax review, reference datasets, independent ledger validation, and report certification | Finance product, before live ledger use |
| Medium | Full DAST, load, rollback, disaster recovery, and penetration testing are incomplete | Release assurance | Access remains restricted during development | Execute staging test plan and independent review | Security/SRE, before launch |

## Launch decision

**Fail: restricted development milestone only.** The production dependency audit and the source-level authentication, MFA, tenant, migration, import, accounting, calculation, and execution tests pass. The provider leaked-password switch, session-management UI, account-level operations, restore, DAST, accounting-content review, and live-adapter findings still block admitting real customers or connecting live bank, payroll, tax, or customer data.
