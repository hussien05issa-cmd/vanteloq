# Vanteloq Control Evidence and Risk Register

Prepared: 2026-08-13  
Owner: Hussien Issa, Owner and Security Lead  
Review status: Initial technical evidence review completed; owner policy approval and operational reviews remain open.

## Current control status

| Control | Status | Evidence or required proof |
| --- | --- | --- |
| Server-side authentication and tenant binding | Verified in code and automated tests | `server/authorization.ts`, `server/api.ts`, 27 passing security boundary tests |
| Application RBAC and permission enforcement | Verified in code and automated tests | Membership, role, permission, location, and organization checks |
| Consumer AAL2 before protected Plaid actions | Verified in code and automated tests | Supabase TOTP/AAL2 enforcement and protected Plaid routes |
| Versioned Plaid consent | Verified in code and automated tests | Consent-bound link-token and exchange routes; 15 passing Plaid tests |
| Plaid credentials encrypted at rest | Verified in code and provider architecture | AES-256-GCM envelope plus Cloudflare D1 at-rest encryption |
| Plaid deletion workflow | Verified in code and automated tests | Owner/AAL2-protected, fail-closed deletion and de-identified audit evidence |
| Public privacy notice | Verified in source and legal-content tests | `https://vanteloq.com/privacy`; 3 passing legal and retention tests |
| Dependency vulnerability state | Verified on 2026-08-13 | Official npm production audit returned 0 vulnerabilities after upgrading transitive `nanoid` to 3.3.18 |
| TLS 1.2 minimum at production edge | Not verified; open blocker | TLS 1.2 succeeds, but TLS 1.1 also succeeded on 2026-08-13 |
| MFA on every critical administrative account | Owner verification required | Complete the administrator MFA inventory without recording secrets |
| Periodic access review | Not yet evidenced | Complete and sign first quarterly access review |
| Periodic retention enforcement review | Not yet evidenced | Complete and sign first quarterly retention review |
| Endpoint and external production vulnerability scanning | Not yet evidenced | Deploy managed scans and retain reports |

## Risk register

| ID | Risk | Likelihood | Impact | Treatment | Owner | Target | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | Production edge accepts TLS 1.1, preventing a truthful TLS 1.2-minimum declaration | High | High | Enforce TLS 1.2 minimum or migrate the custom-domain edge; retest TLS 1.1 rejection and TLS 1.2 success | Hussien Issa | Before Plaid production submission | Open blocker |
| SEC-002 | A critical administrator may lack MFA because the complete provider inventory has not been reviewed | Medium | High | Inventory Cloudflare, Supabase, Plaid, source control, email, and related administrators; enable MFA and retain dated verification | Hussien Issa | Before answering Plaid critical-system MFA | Open |
| SEC-003 | Comprehensive endpoint and external production scanning is not evidenced | Medium | High | Deploy managed endpoint and external scanning; assign remediation tickets and retain reports | Hussien Issa | Before selecting comprehensive scanning | Open |
| SEC-004 | Policies and periodic reviews have not yet produced signed operating evidence | High | Medium | Sign policies, schedule quarterly reviews, and retain access, retention, risk, and exception minutes | Hussien Issa | Before strongest governance answer | Open |
| SEC-005 | A transitive `nanoid` release below 3.3.18 was identified in the production dependency tree | Low | High | Lock transitive dependency to 3.3.18 and verify official npm audit | Hussien Issa | 2026-08-13 | Closed |

## Critical administrator MFA inventory

Do not record passwords, recovery codes, QR codes, TOTP seeds, session tokens, or API secrets.

| Provider | Administrator | Role | Factor type | MFA verified date | Reviewer | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Cloudflare | __________________ | __________________ | __________________ | __________________ | __________________ | Open |
| Supabase | __________________ | __________________ | __________________ | __________________ | __________________ | Open |
| Plaid | __________________ | __________________ | __________________ | __________________ | __________________ | Open |
| Source control | __________________ | __________________ | __________________ | __________________ | __________________ | Open |
| Production email | __________________ | __________________ | __________________ | __________________ | __________________ | Open |

## Quarterly review record

| Field | Entry |
| --- | --- |
| Review period | ______________________________ |
| Reviewer | ______________________________ |
| Access changes reviewed | Yes / No / Not applicable |
| Critical MFA inventory reviewed | Yes / No |
| Vulnerability findings reviewed against SLA | Yes / No |
| Retention jobs and deletion sample reviewed | Yes / No |
| Provider and privacy changes reviewed | Yes / No |
| Incidents and lessons reviewed | Yes / No / None |
| Exceptions accepted or closed | ______________________________ |
| New actions and owners | ______________________________ |
| Reviewer signature and date | ______________________________ |

## Initial technical verification log

| Date | Verification | Result |
| --- | --- | --- |
| 2026-08-13 | Security boundary test suite | 27 passed, 0 failed |
| 2026-08-13 | Plaid lifecycle, consent, encryption, and deletion test suite | 15 passed, 0 failed |
| 2026-08-13 | Privacy and retention content test suite | 3 passed, 0 failed |
| 2026-08-13 | TypeScript type-check | Passed |
| 2026-08-13 | ESLint | 0 errors; 2 pre-existing unused-component warnings |
| 2026-08-13 | Official production dependency audit | 0 vulnerabilities after patched lockfile resolution |
| 2026-08-13 | Production TLS protocol check | TLS 1.2 accepted; TLS 1.1 also accepted — remediation required |

