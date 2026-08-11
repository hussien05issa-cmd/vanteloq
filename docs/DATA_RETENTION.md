# Data inventory and retention matrix

These are proposed operational defaults and require Canadian privacy/legal review before public launch.

| Data | Purpose | Classification | Proposed active retention | Deletion behavior |
|---|---|---|---|---|
| Public site content | Explain product | Public | While published | Remove with release |
| User identity and membership | Authentication and access | Confidential | Account life + 30 days | Delete or anonymize unless a security or legal hold applies |
| Organization profile and hours | Reporting context | Confidential | Account life + 30 days | Delete after verified account deletion |
| Tax registration number | Tax and report context | Highly sensitive | Only while explicitly needed | Delete promptly when removed and never include in ordinary logs |
| Tasks and approvals | Operating workflow | Confidential | Account life or owner-defined period | Tenant-scoped export and deletion, subject to an applicable audit hold |
| Plaid and other provider access credentials | Authorized provider access | Highly sensitive | Active connection only | Revoke or delete encrypted credentials promptly on disconnection and stop scheduled syncs |
| Bank connection metadata | Connection support, scope, and audit | Highly sensitive | Connection life + proposed 90 days | Remove unneeded provider and account identifiers; retain only a minimal disconnection audit record where justified |
| Bank account metadata and balance snapshots | Reconciliation and supported cash context | Highly sensitive | Customer-defined period tied to the accounting purpose | Export, correct, or delete when no longer required; never treat an expired connection as permission for a new balance request |
| Imported bank transactions | Bookkeeping and reconciliation | Highly sensitive | Customer-defined period plus any applicable accounting or tax retention requirement | Disconnecting stops new collection but does not silently delete reviewed accounting evidence |
| Original invoices, receipts, and statements | Source evidence and recordkeeping | Highly sensitive | Organization policy plus applicable accounting or tax retention requirement | Keep the original private; delete only through an authorized retention workflow when no hold applies |
| Document extraction proposals and correction history | Review and audit of captured documents | Highly sensitive | No longer than the related source record and review purpose | Delete with the source record unless a minimal correction or audit record is still required |
| Rejected or unapproved uploaded files | Security review and upload recovery | Highly sensitive | Short documented quarantine period, proposed maximum 30 days | Delete automatically after the quarantine period unless an active incident hold applies |
| Normalized POS and commerce transactions | Analytics, reconciliation, and reporting | Highly sensitive | Customer-defined period plus applicable recordkeeping requirements | Export, correct, or delete subject to lawful accounting retention and provider terms |
| Marketing consent and CASL-exception evidence | Support the recorded express consent, implied consent, or applicable CASL exception | Highly sensitive | While relied on and for the period needed to answer a lawful compliance question | Delete unnecessary contact content while retaining the minimum evidence needed to support the recorded choice |
| Unsubscribe and suppression records | Honour a do-not-contact choice | Confidential | As long as needed to prevent prohibited contact | Retain a minimal suppression value; do not reuse it for marketing or enrichment |
| Integration sync and webhook records | Reliability, reconciliation, and security | Confidential | Short operational window plus a justified audit period | Remove raw payloads and personal fields early; retain status, identifiers, and error context only when necessary |
| Audit events | Security and accountability | Confidential | Proposed 24 months, subject to risk and legal review | Append-only during the active period; anonymize an actor where lawful after account deletion |
| Security and incident records | Detection, response, and legal evidence | Highly sensitive | Risk-based period documented for the incident type | Restrict access, preserve only required evidence, and delete after the hold and review period end |
| Rate-limit buckets | Abuse prevention | Internal | Maximum twice the enforcement window | Delete automatically |
| CSV import source files | Import staging and error review | Highly sensitive | Proposed 7 days after an accepted or rejected import | Delete automatically from private object storage after the staging period |
| Backups | Recovery | Same as source | Proposed rolling 35 days | Expire automatically with documented delayed-deletion semantics |

## Operating rules

- A consent screen must identify the provider, accounts, data categories, purpose, and whether access is read-only or includes a separately approved write action.
- Disconnection must revoke or delete stored credentials, stop scheduled syncs, and apply the provider-specific retention contract. Disconnection is not the same as deletion of lawfully retained accounting records.
- Original source documents must remain available for review when extracted fields are retained. A corrected extraction should preserve the reviewer, time, prior value, and reason according to the audit policy.
- Optional marketing and analytics consent must remain separate from transactional processing. A sale or customer record must not be converted into marketing permission.
- Cross-border provider and subprocessor locations, safeguards, and deletion semantics must be recorded in the vendor inventory and reflected in the Privacy Policy.
- The Canada Revenue Agency generally requires relevant records and supporting documents to be kept for six years from the end of the last tax year to which they relate, subject to exceptions. See [Keeping records](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc188/keeping-records.html). A qualified professional must confirm the period that applies to each customer and record type.
- Proposed periods must not be represented as active automated deletion until the deletion job, failure alert, audit event, backup expiry, and restoration behavior have been tested.

Vanteloq must maintain verified export, correction, revocation, and deletion workflows as new personal-information categories are introduced. Provider-specific rules can require a shorter period than this matrix and take priority where the service contract requires it.
