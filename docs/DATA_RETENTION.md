# Data retention and deletion policy

Policy version: 1.0

Effective implementation baseline: August 11, 2026

Policy owner: Vanteloq Privacy Officer

Review cycle: quarterly operational review and at least annual policy renewal

This policy defines Vanteloq's technical and operational retention baseline. It does not replace advice from qualified Canadian or Alberta privacy and accounting counsel. Alberta PIPA and PIPEDA apply according to their respective scope, and another jurisdiction or contract may impose a shorter or longer period.

## Principles

1. Collect only data connected to a disclosed and authorized purpose.
2. Keep identifiable data only while the purpose, contract, legal duty, security need, or documented legal hold remains.
3. Revoke access before deleting locally held provider data.
4. Delete data that is not required; de-identify the provider-specific fields of accounting records that must remain.
5. Record the actor, time, scope, result, and limitation of each deletion.
6. Do not treat disconnection as permission to retain new data or start another sync.

## Plaid control schedule

| Record | Retention rule | Enforced disposal behavior | Control state |
|---|---|---|---|
| Plaid access token and provider item credential | Active connection only | `/item/remove` is called, scheduled access stops, and application-encrypted credentials are deleted on disconnect | Implemented |
| Versioned Plaid consent record | While the connection is active and up to 24 months after withdrawal when needed to demonstrate the authorization or answer a complaint | Status changes to withdrawn on disconnect/deletion; quarterly review removes expired evidence unless a documented hold applies | Implemented record and withdrawal; quarterly review is an owner procedure |
| Bank and institution identifiers, account names, masks, balances, and provider references | Active service purpose, then until a verified deletion request or applicable hold is resolved | Protected owner-only deletion clears connection metadata and deletes linked bank-account records | Implemented |
| Unreviewed Plaid transactions | Until reviewed or a verified deletion request is completed | Protected owner-only deletion permanently deletes imports that are not approved, reconciled, or posted | Implemented |
| Approved, reconciled, or posted transaction fields | Customer accounting policy plus applicable tax and recordkeeping duties | Plaid identifiers, pending links, and descriptions are removed; only minimum accounting fields remain | Implemented |
| Privacy deletion audit event | 24 months unless a longer incident, complaint, or legal hold applies | Store action/result metadata only, without the deleted bank data | Implemented |
| Rate-limit records | No more than twice the enforcement window | Expire through the rate-limit store lifecycle | Implemented by platform control |

The Canada Revenue Agency generally requires relevant records and supporting documents to be kept for six years from the end of the last tax year to which they relate, subject to exceptions. See [Keeping records](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc188/keeping-records.html). A qualified professional must confirm the period that applies to each customer and record type.

## Other record categories

| Record | Baseline | Disposal rule |
|---|---|---|
| User identity and membership | Account life plus request-resolution and security period | Delete or anonymize after verified account closure unless a hold applies |
| Organization profile | Account life plus request-resolution period | Delete after verified workspace closure |
| Original invoices, receipts, and statements | Customer policy plus applicable accounting/tax duty | Private storage; authorized deletion only when no hold applies |
| Rejected uploads and quarantined files | Maximum 30 days unless an active incident hold applies | Automatic or reviewed secure deletion |
| Normalized POS records | Customer policy plus applicable recordkeeping duties | Export, correct, delete, or de-identify through a provider-specific workflow |
| Audit and security events | 24 months by default, longer only for a documented incident or legal hold | Delete or anonymize after review period |
| Marketing consent evidence | While relied upon and for the period needed to answer a compliance question | Retain minimum proof only |
| Unsubscribe and suppression records | As long as needed to prevent prohibited contact | Keep only a minimal suppression value and never use it for marketing enrichment |
| Import staging files | 7 days after accepted or rejected import | Delete from private staging storage |

## Enforced Plaid deletion workflow

1. Only an authenticated workspace owner with the restricted `finance.connections` permission and a confirmed AAL2 session may start deletion.
2. Plaid must already be disconnected. If it is active or needs repair, the API fails closed.
3. The owner must enter the exact confirmation phrase `DELETE PLAID DATA`.
4. The server applies same-origin checks and a maximum of three attempts per day.
5. One atomic database batch deletes unreviewed imports, de-identifies retained accounting transactions and accounts, deletes bank-account records and encrypted provider credentials, and clears connection identifiers.
6. Consent is marked withdrawn and an audit event records counts and limitations without copying the deleted data.

Disconnection is not the same as deletion of lawfully retained accounting records. The UI and API return the specific retained-record rule so an owner is not told that every accounting record disappeared when it did not.

## Review and exceptions

- The Privacy Officer reviews this policy quarterly for operational exceptions and at least annually for renewal.
- A review is also required after a new data category, provider, jurisdiction, subprocesser, security incident, or material legal change.
- Each exception must state the affected records, legal or operational basis, approver, start date, review date, and end condition.
- A legal hold must be scoped; it must not stop deletion of unrelated records.
- Failed deletion jobs must be investigated, retried, and recorded. The requester receives a clear limitation rather than a false completion message.

Vanteloq must update this inventory and add a verified disposal workflow before introducing a new personal-information category.
