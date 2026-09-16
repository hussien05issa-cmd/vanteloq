# Launch verification, September 16, 2026

This note records the current hardening batch and its limits. It does not certify every integration, financial output, legal obligation or production launch. Earlier release results remain historical evidence, not acceptance of these latest edits.

## Implemented in the current source

| Area | Verified scope and remaining boundary |
| --- | --- |
| Optional email updates | Signup/onboarding consent is separate from account terms and operational notifications. Verified-email binding, Settings withdrawal, public POST unsubscribe and minimal suppression are implemented. Enrollment remains disabled and hidden during signup/onboarding because no valid public mailing address has been supplied. No newsletter, confirmation or campaign email is sent by this feature. |
| Document deletion | Authorized deletion first makes the document unavailable and records durable cleanup progress. Original storage and tracked Azure copies are removed independently; failures remain pending and retryable. Linked or approved accounting evidence and active processing claims are protected. A pending response is not a completed deletion. |
| Completed processing cleanup | Existing authorized extraction/scan copies can be removed without reading, uploading or extracting the original again. Saved consent, the original and reviewed figures remain. Provider cleanup failures keep their references and visible retry status. |
| Daily CSV/manual records | Provenance and mapped-location checks prevent manual/CSV replacement of POS-derived rows. Corrections compare a complete stored snapshot and use atomic writes. New timestamps use schema-compatible seconds. Manual inputs stay locked during review, and successful reviewed saves clear the form. Existing overwritten lineage and legacy timestamp values are not reconstructed. |
| Clover | Quantity, discount and payment-status evidence is handled conservatively, with unknown or refund cases requiring review. `dataPromotionEnabled` remains false, so staged Clover records cannot become approved business totals. Tax/refund/snapshot reconciliation and provider distribution approval remain separate gates. |
| Meta | Requests use actual provider expiry, app-secret proof, restricted destinations and redirect rejection. These changes do not configure credentials, grant permissions or complete Meta app/business review. |

Source pointers: `server/communications.ts`, `server/document-deletion.ts`, `server/document-processing.ts`, `server/daily-metric-import.ts`, `server/integrations/clover-reporting.ts`, `server/integrations/sync/clover.ts` and `server/integrations/meta-security.ts`.

The **24-hour purge of abandoned application originals remains a target**, not an enabled automatic control. Azure temporary-copy lifecycle and explicit cleanup are different controls. A state-aware scheduled purge must protect active processing and retained accounting evidence before that promise can be made. See `docs/compliance/DATA_RETENTION_AND_DISPOSAL_POLICY.md`.

## Recorded verification

- 27 account-deletion, newsletter-consent and migration checks passed.
- 36 document, Clover-reporting, Meta and application TLS-guard checks passed.
- 18 CSV/import checks passed, including a real Drizzle readback of import, metric and correction audit timestamps.
- Built bank-statement and document-deletion routes passed their access, retry, accounting and tenant checks. The built CSV route preserves connector ownership. Seven built newsletter checks passed, including an actual unverified HTTP identity response, which returns 401 without changing consent records.
- The production build, TypeScript and lint passed. Responsive component checks at desktop, 390px and 320px found and corrected overlapping table headers and cramped comparisons. These previews used fictional records, not an authenticated live workspace.
- The lockfile check found no published advisories affecting the locked versions of 613 public-registry packages, including development dependencies. This was a direct-advisory check, not a penetration test or complete security certification.
- `https://www.vanteloq.com/demo?launch_check=1` returned **301** to `https://vanteloq.com/demo?launch_check=1`. The HTTP www request followed **301 → HTTPS www, 301 → canonical, 200 → demo**, preserving the path and query.

These are separate, bounded results, not a single full-suite pass or a deployed-release certification. Financial/provider fixtures did not authorize production customer data promotion.

## TLS release blocker

At **09:49:19 UTC on September 16**, certificate-verified probes still negotiated TLS 1.1 with `vanteloq.com`, despite the customer zone's TLS 1.2 minimum. TLS 1.2 and 1.3 also succeeded. `connectors.vanteloq.com` rejected TLS 1.1 and accepted 1.2/1.3. Evidence: `output/public-tls-2026-09-16.json` in the local review artifacts; the durable summary is in `docs/PLAID_PRIVACY_SECURITY_EVIDENCE.md`.

`server/transport-security.ts` is a supplemental request guard using platform TLS metadata. It runs **after negotiation** and cannot fix or prove rejection of a TLS 1.1 handshake. Hosting must enforce the main custom hostname's minimum protocol, followed by independent TLS 1.1 rejection and TLS 1.2/1.3 success probes. Do not mark the Plaid TLS requirement complete or issue overall launch approval from the application tests.

## Final acceptance still required

Publish the tested source with the ordered migrations and verify the published release. The live workspace is signed out, so authenticated production acceptance remains outstanding. Keep newsletter sending, unreconciled provider reporting and unapproved provider access disabled. Resolve the main-host TLS exception and the existing legal/provider conditions before claiming those requirements are satisfied.
