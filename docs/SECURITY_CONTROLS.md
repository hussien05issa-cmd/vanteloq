# Implemented security-control matrix

Baseline: OWASP ASVS 5.0.0 Level 2 target. “Implemented” means present in this source and exercised where test evidence exists; it is not a compliance claim.

| Control | Implementation | ASVS / OWASP relationship | Evidence |
|---|---|---|---|
| Trusted authentication boundary | Supabase token validation, immutable subject binding, verified email, mandatory AAL2; no fabricated fallback | ASVS authentication; OWASP A07 Identification and Authentication Failures | Auth integrity and anonymous API negative tests |
| Credential abuse resistance | Turnstile plus D1 account/source and source rate buckets; generic invalid-credential response | ASVS authentication/API resource controls | Sign-in route and hostile-path tests |
| Password policy | Shared client/server 12-character and character-class policy; Supabase bcrypt storage | ASVS password controls | Password-security module and interaction tests |
| Tenant authorization | Active membership resolves organization server-side | ASVS access control; OWASP A01 Broken Access Control; API1 BOLA | Organization ID absent from client task inputs |
| Function authorization | Explicit role allowlists per route | ASVS access control; API5 Broken Function Level Authorization | Route policy declarations |
| Parameterized data access | Drizzle ORM and D1 prepared statements | ASVS injection prevention; OWASP A03 Injection | Repository/source review |
| Strict request schemas | Unknown-field rejection, normalization, bounds, enum/date/email/URL/hour validation | ASVS validation/business logic; API3 Broken Object Property Level Authorization | Validation module and negative route behavior |
| CSRF layer | Same-origin and Fetch Metadata enforcement on writes | ASVS web frontend/session controls | Cross-site onboarding test |
| Abuse controls | D1-backed per-user/source rate buckets | ASVS API/resource controls; API4 Unrestricted Resource Consumption | Route limits and database schema |
| Idempotency | Organization-scoped unique task key | ASVS business logic; replay/duplicate protection | Schema unique index and POST logic |
| Safe errors | Structured code/message/request ID; server log excludes payload and credentials | ASVS error/logging; OWASP A09 Logging and Monitoring Failures | Security tests inspect response |
| Audit trail | Append-only application path for workspace/task events | ASVS logging; OWASP A09 | Audit schema and route writes |
| Browser hardening | HSTS on HTTPS, nosniff, referrer/permissions policy, frame denial, CSP enforcement subset and report-only policy | ASVS web frontend/configuration; clickjacking/XSS defense in depth | Worker headers and response tests |
| Sensitive caching | API `no-store`; same-origin resource policy | ASVS data protection | Response tests |
| Migration integrity | Foreign keys, checks, uniqueness, indexes, preserved legacy data | ASVS architecture/data protection | Reviewed migration 0002 |
| API inventory | `/api/v1` and OpenAPI 3.1 description | ASVS API/web services; API9 Improper Inventory Management | Runtime OpenAPI test |
| Secret hygiene | `.env*` ignored, `.env.example` sanitized, source secret scan | ASVS configuration; OWASP A02 Cryptographic Failures / A05 Misconfiguration | Secret scan result |

Not implemented or not yet evidenced: passkeys, user-facing session/device revocation, leaked-password protection in the Supabase provider, malware scanning/OCR, external SIEM/alerts, backup restoration evidence, DAST, and full ASVS verification. Provider token encryption, OAuth state/PKCE, signed webhook/replay controls, Supabase MFA and recovery paths are implemented for their current bounded surfaces.
