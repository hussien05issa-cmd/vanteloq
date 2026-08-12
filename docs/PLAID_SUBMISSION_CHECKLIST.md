# Vanteloq Plaid submission checklist

Updated: 2026-08-11

Plaid's Launch Center is personalized. Upload only the evidence requested by the question on screen; do not upload credentials, access tokens, QR enrollment screens, recovery codes, or customer financial data.

## Primary submission files

| Upload name | Source in this repository | Use for |
| --- | --- | --- |
| `01-Vanteloq-Privacy-Policy.pdf` | Public page: `https://vanteloq.com/privacy` | Consumer notice, purposes of processing, sharing, rights, retention and contact details. Export the live page to PDF if the questionnaire requires a file. |
| `02-Vanteloq-Data-Retention-and-Deletion-Policy.pdf` | `docs/DATA_RETENTION.md` | Retention schedule, account deletion, provider disconnection, legal holds and periodic review. |
| `03-Vanteloq-Plaid-Privacy-and-Security-Control-Evidence.pdf` | `output/pdf/Vanteloq-Plaid-Privacy-Security-Evidence.pdf` and `docs/PLAID_PRIVACY_SECURITY_EVIDENCE.md` | Consolidated control evidence for consent, encryption, tenant isolation, deletion, MFA, logging and incident handling. |
| `04-Vanteloq-Identity-and-Access-Control-Summary.pdf` | `docs/AUTH_SECURITY.md` and `docs/AUTHORIZATION_MATRIX.md` | Supabase identity, AAL2/TOTP, role permissions, session handling and production access boundaries. |
| `05-Vanteloq-Incident-Response-Plan.pdf` | `docs/INCIDENT_RESPONSE.md` | Detection, containment, escalation, recovery, notification and post-incident review. |
| `06-Vanteloq-Security-Controls-and-Vulnerability-Management.pdf` | `docs/SECURITY_CONTROLS.md`, `docs/SECURITY_RUNBOOKS.md`, `docs/SECURITY_AUDIT.md` | Secure development, dependency review, vulnerability response, monitoring and operational controls. |
| `07-Vanteloq-Architecture-and-Data-Flow.pdf` | `docs/ARCHITECTURE.md` and `docs/SUPABASE_BACKEND.md` | Trust boundaries and data flow among browser, Cloudflare, Supabase, D1/R2 and Plaid. |

## Screenshots Plaid may request

Capture a clean browser window without secrets or personal financial data.

| Screenshot name | What it must show |
| --- | --- |
| `08-Vanteloq-MFA-Enforcement-Screenshot.png` | The normal six-digit authenticator verification screen after password sign-in. Never capture the QR enrollment secret or recovery codes. |
| `09-Vanteloq-Plaid-Consent-Screenshot.png` | The Vanteloq pre-Link consent screen identifying data requested, purpose, storage, withdrawal/disconnect path and links to Privacy Policy. |
| `10-Vanteloq-TLS-1.2-Minimum-Screenshot.png` | Cloudflare Edge Certificates page showing Minimum TLS Version set to TLS 1.2. Do not submit this screenshot as completed evidence until an independent TLS 1.1 handshake is rejected; the Sites/custom-hostname edge still accepted TLS 1.1 on the latest live check. Do not include API tokens. |
| `11-Vanteloq-Role-Permissions-Screenshot.png` | Owner/manager/employee role controls or the protected settings screen that shows restricted financial access. |

## Questionnaire answer boundaries

- Select **role-based access control** only because organization roles and server-side permission checks are implemented.
- Select **OAuth tokens or TLS certificates for non-human authentication** because Plaid uses server-held API credentials and access tokens, and the browser never receives the Plaid secret or access token.
- Select **authenticator-app/TOTP MFA** for the current AAL2 control. Do not claim phishing-resistant MFA unless passkeys or hardware-backed WebAuthn are deployed and required for the systems named by Plaid.
- Select periodic access review, automated de-provisioning, centralized IAM, or zero-trust options only if the matching operational process is active and documented for Vanteloq staff access. Code-level capability alone is not evidence of a completed organizational process.

## Final review before submission

1. Confirm `https://vanteloq.com/privacy` is public and matches actual Plaid data use.
2. Confirm the production environment uses Plaid Production credentials stored only as encrypted server secrets.
3. Confirm Plaid Link displays a just-in-time consent step before account connection.
4. Confirm disconnect calls Plaid `/item/remove` and queues tenant-scoped deletion according to the retention policy.
5. Confirm webhooks, update mode, error handling and security logging are active for the products enabled in Plaid.
6. Redact user names, email addresses, account masks, bank balances, QR codes, keys and tokens from every screenshot.
7. Answer from implemented evidence. If a control is not active, leave it unselected and record the remediation owner and date.
8. Treat the TLS control as blocked until the hosting edge, not only the customer-zone dashboard, rejects TLS 1.1 and accepts TLS 1.2 or newer.

Official references: Plaid's current Launch Center/production checklist and Developer Policy. The exact attachments requested can change by product, country and questionnaire response, so the Plaid Dashboard remains the final source of truth.
