# Security acceptance status

Date: 2026-08-03

## Passed in this phase

- Production artifact build and Sites validation
- Type checking
- Linting after dead prototype removal
- Seven hostile-path security tests, including anonymous denial on every new intelligence route and cross-site denial on imports and business-memory writes
- Three deterministic calculation tests covering empty-workspace honesty, supported exceptions, evidence/action presence, and event impact thresholds
- Disposable D1 forward-migration test through migration `0003`
- Complete end-to-end intelligence-to-action test: onboarding, empty state, 60-row import, idempotent replay, metric/insight generation, linked task, decision measurement, second tenant onboarding, and confirmed zero cross-tenant rows
- Retry-safe onboarding identifiers and ordering so a partial D1 batch can converge without reactivating a suspended membership
- Source secret-pattern scan: zero matching files
- Production dependency audit: zero known vulnerabilities after the verified Next.js 16.3.0 toolchain update
- Public landing visual and interaction inspection
- Versioned route inventory
- Additive migration review with preservation of prior workspace/task data

## Open findings

| Severity | Risk | Affected component | Temporary mitigation | Permanent fix | Owner / deadline |
|---|---|---|---|---|---|
| High | Account-level WAF, backup retention, restore drill, error tracking, uptime, and alert delivery are not evidenced | Cloudflare operations | Site remains limited during development; health/readiness endpoints exist | Configure account controls and complete a recorded restore/alert exercise | SRE, before public launch |
| High | Independent MFA/recovery/session revocation is not implemented | Public identity lifecycle | Use dispatcher-owned authentication; do not collect passwords | Select/configure supported production identity provider and test MFA, recovery, revocation, reauthentication | Product/Security, before non-workspace users |
| Medium | Full CSP still uses report-only mode for script/style policy | Browser security | Enforced frame/base/form restrictions plus other headers | Remove inline requirements and enforce full nonce/hash-based CSP after violation review | Frontend, before public launch |
| Medium | External provider adapters, token encryption, webhook security, queue retries, and sync reconciliation are absent | Integrations | All connection buttons remain disabled/planned; no secret is collected | Implement and test one provider at a time behind an adapter boundary | Integrations, phased |
| Medium | Full DAST, load, rollback, disaster recovery, and penetration testing are incomplete | Release assurance | Access remains restricted during development | Execute staging test plan and independent review | Security/SRE, before launch |

## Launch decision

**Fail — restricted development milestone only.** The production dependency audit and the new source-level tenant, migration, import, calculation, and execution tests pass. Unresolved identity-lifecycle, account-level operations, restore, DAST, and live-adapter findings still block admitting real customers or connecting live POS/customer data.
