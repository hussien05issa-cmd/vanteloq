# Security acceptance status

Date: 2026-08-02

## Passed in this phase

- Production artifact build and Sites validation
- Type checking
- Linting after dead prototype removal
- Five hostile-path security tests: anonymous onboarding isolation, anonymous task denial, cross-site write denial, removal of legacy endpoints, and safe operational/OpenAPI output
- Retry-safe onboarding identifiers and ordering so a partial D1 batch can converge without reactivating a suspended membership
- Source secret-pattern scan: zero matching files
- Public landing visual and interaction inspection
- Versioned route inventory
- Additive migration review with preservation of prior workspace/task data

## Open findings

| Severity | Risk | Affected component | Temporary mitigation | Permanent fix | Owner / deadline |
|---|---|---|---|---|---|
| High | `npm audit` reports Next.js/PostCSS/sharp advisories with no complete fixed dependency path | Framework dependency chain | No Server Actions, user-controlled rewrites, SVG uploads, or app image uploads are enabled; request/body controls remain active | Upgrade the Vinext/Next dependency set when a compatible patched release exists; re-run full regression/security suite | Engineering, before public customer launch |
| High | No end-to-end two-tenant D1 test has executed against staging | Tenant isolation assurance | Protected routes derive tenant only from membership and all task queries pair resource with organization | Add disposable staging fixtures for two organizations and automated BOLA/BFLA test matrix | Security, before POS/customer data |
| High | Account-level WAF, backup retention, restore drill, error tracking, uptime, and alert delivery are not evidenced | Cloudflare operations | Site remains limited during development; health/readiness endpoints exist | Configure account controls and complete a recorded restore/alert exercise | SRE, before public launch |
| High | Independent MFA/recovery/session revocation is not implemented | Public identity lifecycle | Use dispatcher-owned authentication; do not collect passwords | Select/configure supported production identity provider and test MFA, recovery, revocation, reauthentication | Product/Security, before non-workspace users |
| Medium | Full CSP still uses report-only mode for script/style policy | Browser security | Enforced frame/base/form restrictions plus other headers | Remove inline requirements and enforce full nonce/hash-based CSP after violation review | Frontend, before public launch |
| Medium | External provider adapters, token encryption, webhook security, queue retries, and sync reconciliation are absent | Integrations | All connection buttons remain disabled/planned; no secret is collected | Implement and test one provider at a time behind an adapter boundary | Integrations, phased |
| Medium | Full DAST, load, rollback, disaster recovery, and penetration testing are incomplete | Release assurance | Access remains restricted during development | Execute staging test plan and independent review | Security/SRE, before launch |

## Launch decision

**Fail — development milestone only.** No Critical source finding identified in the prior anonymous/shared-tenant paths remains open, but unresolved High assurance and operational findings block admitting real customers or live POS/customer data.
