# Vanteloq Data Retention and Disposal Policy

| Document control | Value |
| --- | --- |
| Organization | 2855706 ALBERTA INC, doing business as LexEdge Consulting and operating Vanteloq |
| Policy owner | Hussien Issa, Owner and Security Lead |
| Version | 1.4 |
| Prepared | 2026-09-23 |
| Technical baseline reviewed | 2026-09-30 |
| Review cycle | Quarterly enforcement review and annual policy review |
| Proposed first quarterly review | 2026-12-22 |
| Proposed next annual review | 2027-09-23 |
| Approval status | Approved and adopted |

## 1. Purpose and scope

This policy defines how Vanteloq retains, reviews, deletes, de-identifies, and disposes of consumer, financial, business, authentication, integration, support, and security data. It applies to production databases, private object storage, logs, backups, exports, support systems, connected providers including Plaid, and temporary copies created for an authorized product or security purpose.

Vanteloq keeps identifiable data only while it is needed for a disclosed service purpose, a customer instruction, security, a legal obligation, a dispute, or a documented legal hold. Retention is not indefinite by default. A longer period must have a recorded legal, contractual, or operational basis.

This policy is designed for Vanteloq's current Canadian operations. It must be reassessed before offering the service in a jurisdiction with a different mandatory retention period. It does not replace customer-specific accounting, tax, employment, or legal advice.

## 2. Governing principles

1. Collect and retain only the minimum data needed for an identified and authorized purpose.
2. Apply a documented minimum and maximum retention period to each data category.
3. Stop new collection when consent or provider authorization is withdrawn.
4. Revoke provider access before deleting locally held provider credentials and data when a provider connection exists.
5. Delete, securely destroy, or irreversibly de-identify personal information when the purpose and any lawful retention requirement end.
6. Preserve only the minimum accounting fields required for an active customer's books or a documented legal duty; remove provider identifiers and unnecessary personal details.
7. Record the actor, time, scope, result, and limitation of material deletion and retention actions without copying the deleted content into the audit record.
8. Reapply deletion tombstones before a restored backup returns to service.

## 3. Retention schedule

The periods below are policy requirements, not proof that every hosted lifecycle is configured. Provider backup expiry, hosted application-log expiry and operational review completion require dated evidence in the retention register. No Canadian-only hosting commitment has been established.

| Data category | Minimum or active period | Maximum or review point | Disposal method |
| --- | --- | --- | --- |
| Plaid access tokens, item credentials, cursors, and provider connection secrets | Only while the connection is active and authorized | Remove promptly after verified disconnection, authorization withdrawal, workspace deletion, or loss of lawful purpose | Call Plaid `/item/remove` when credentials are available, stop synchronization, cryptographically delete encrypted credentials, and clear local connection state |
| Unreviewed Plaid balances and transactions | While needed for the active reconciliation or cash-analysis purpose | Delete on verified Plaid-data deletion or workspace deletion; review inactive connections quarterly | Delete source and derived financial rows after revocation, subject only to a documented hold |
| Approved, reconciled, or posted accounting entries derived from Plaid | While needed for the active customer's books and the customer's applicable accounting or tax period | Review at workspace closure and at the end of the customer's instructed retention period | Remove Plaid identifiers, account masks, descriptions, pending links, and provider metadata; retain only the minimum ledger fields the customer must preserve |
| Plaid consent, withdrawal, deletion, and authorization evidence | Connection life plus 24 months | Quarterly review after the connection closes | Delete or irreversibly de-identify after expiry unless a complaint, investigation, or documented hold requires it |
| POS, inventory, customer, supplier, and commerce records | While the workspace is active and the records support the customer-selected purpose | Review at least annually and at workspace closure | Export if requested, then delete or de-identify after the applicable customer instruction or legal period |
| Invoices, receipts, journals, tax support, and other customer accounting records | Customer-selected period; Canadian tax records commonly require at least 6 years from the end of the last tax year to which they relate | Vanteloq's standard supported maximum is 7 years unless the customer records a longer legal requirement | Securely delete after expiry and hold review; remove unnecessary personal details sooner when the accounting record can remain valid without them |
| User identity, membership, profile, preferences, and private Vanteloq AI history | Active account and membership | Delete after verified account deletion, subject to another active workspace membership or a documented hold | Delete the identity-owned records and de-identify authorship in customer records that must remain |
| Saved Vanteloq AI conversations | Memory is off by default. When enabled: until user deletion or 90 days after last update | Expired chats are pruned on the next AI request or saved-history listing | Delete scoped messages; retain only content-free deletion evidence |
| Files and photos attached directly to Vanteloq AI | Request processing only in Vanteloq; attachment exchanges disable saved chat memory | No original or attachment conversation is saved in the Vanteloq chat or Documents database | Release request data after processing; OpenAI safety retention is separate. Documents uploaded through Documents follow their own schedule |
| Authentication and integration consent evidence | While relied upon plus up to 24 months after withdrawal or closure | Quarterly review | Retain the minimum version, purpose, actor reference, decision, and timestamp; delete or de-identify the expired record |
| Nonidentifying account-deletion receipts | 24 months | Automatic or quarterly expiry review | Delete after expiry; never include name, email, workspace name, IP address, account mask, or raw provider identifier |
| Security and administrative audit events | 24 months | Quarterly expiry and legal-hold review | Securely delete or de-identify after expiry |
| Application and request logs | 90 days by default | Automated expiry or quarterly verification | Delete after expiry; restricted incident copies follow the incident record period |
| Support and privacy-request records | 24 months after closure | Quarterly review for open disputes or holds | Delete or de-identify after expiry and resolution |
| Temporary exports, email attachments, scan copies, and generated files | Only while processing or delivery is active | 30 days maximum unless a shorter provider lifecycle applies | Automatically expire where supported; otherwise remove during the scheduled review |
| Rejected, quarantined, or abandoned application uploads | Until classification, retry, or incident review is complete | 30 days maximum unless linked to an active incident or protected accounting record | State-aware deletion; never apply a blanket prefix deletion that could remove accepted accounting evidence |
| Marketing consent and suppression evidence | While consent is relied upon and long enough to answer a compliance question | Review annually | Keep minimum consent or suppression proof only; never reuse it for enrichment |

Where another law, customer instruction, contract, provider rule, complaint, or legal hold requires a different period, Vanteloq records the source, data category, period, owner, approval date, review date, and release condition in the retention register.

## 4. Roles and accountability

The Owner and Security Lead approves the schedule, exceptions, legal holds, and review evidence. System owners configure and test deletion, expiry, revocation, backup, and de-identification controls. Authorized workspace owners control their business records and may request export, disconnection, or deletion through the product or verified support process. Personnel and providers follow least privilege and use retained data only for its recorded purpose. Customers remain responsible for confirming the accounting and tax periods that apply to their records.

## 5. Plaid consent, disconnection, and deletion

Before Plaid Link is initiated, Vanteloq displays the requested data categories, purposes, policy versions, and deletion route, and records affirmative consent. Only the products and data needed for the selected use are requested. A new purpose or data category requires new or updated authorization.

Withdrawing authorization stops future collection. Disconnection is not permission to retain new Plaid data and is not the same as deleting accounting records that a customer must keep. Any retained record must be limited to its documented accounting or legal purpose and unavailable for unrelated product use.

Plaid deletion is a protected owner action requiring a current authenticated AAL2 session, tenant and finance authorization, exact confirmation, and a rate-limited server request. The process must:

1. identify the organization, connection, accounts, credentials, source records, derived records, reports, and audit scope;
2. call Plaid `/item/remove` when provider credentials are available;
3. stop scheduled synchronization and block further use of the connection;
4. delete encrypted credentials, bank-account data, transactions, balances, derived cash metrics, sync cursors, and unauthorized exports within the approved scope;
5. de-identify only the minimum ledger or audit evidence that must remain;
6. invalidate caches and generated views; and
7. record the request, authorization, scope, result, and timestamp without retaining the deleted secret or financial content.

If provider revocation cannot complete, Vanteloq fails closed, blocks further use, retains a restricted retry record, and tells the authorized requester what remains. A failed provider call is not recorded as completed deletion.

## 6. Account and workspace closure

Verified account deletion removes the login, memberships no longer needed by another workspace, profile, preferences, and private Vanteloq AI history after recent MFA and exact confirmation. Customer records that must remain use de-identified authorship.

A verified workspace-owner deletion checks authority, billing, disputes, exports, and legal holds before deleting the workspace, stored files, active records, credentials, memberships, and eligible authentication accounts. Connected providers are revoked, synchronization stops, and customer-required records should be exported before deletion. A person whose identity is still attached to another workspace is not deleted from that other workspace.

## 7. Backups, caches, and derived data

Deletion applies to primary records, caches, indexes, generated reports, exports, attachments, and derived analytics. If a provider-managed immutable backup cannot be selectively edited, the deleted record remains inaccessible to normal operations and expires through the provider's documented backup lifecycle. Any restoration must reapply deletion tombstones before the environment returns to service.

Backup capability is not represented as verified until a dated restoration exercise succeeds and evidence is retained. Backup retention must not silently extend normal production access to deleted data.

## 8. Legal holds and exceptions

Only the Owner and Security Lead may approve a legal hold or retention exception. The record must name the affected data, reason, authority, owner, start date, next review, and release condition. Held data is restricted to the hold purpose. The hold does not suspend deletion of unrelated records. Normal disposal resumes promptly when the hold ends.

An exception does not change the policy silently. It must include a compensating control, target remediation date, and approval. Expired exceptions are escalated at the quarterly review.

## 9. Secure disposal standards

- Database and object records are deleted through authenticated server-side operations.
- Encryption keys or wrapped credentials are destroyed when cryptographic deletion is used.
- Paper containing restricted information is cross-cut shredded.
- Physical media, if introduced, is sanitized or destroyed using a documented method appropriate to the media and data sensitivity.
- Provider deletion, revocation, or contract termination is recorded.
- Disposal logs record scope and outcome without reproducing personal, financial, or secret content.
- Reuse or disposal of a device requires verified removal of Vanteloq data and credentials.

## 10. Review, testing, and evidence

The Owner and Security Lead performs and records a quarterly enforcement review. The review must examine configured expiry controls, deletion queues, provider disconnection, stale exports, rejected uploads, backup treatment, legal holds, exceptions, and a sample deletion or de-identification result. The full policy is reviewed annually and after a material product, provider, legal, jurisdictional, or data-use change.

Evidence includes consent and withdrawal records, deletion audit events, provider revocation results, retention-job logs, exception and hold approvals, restore tests, and signed review minutes. A planned control is labeled as planned until dated evidence shows that it operates.

The first quarterly review is due by 2026-12-22 if this policy is approved on 2026-09-23. The next annual review is due by 2027-09-23. If approval occurs later, both dates move to 90 days and 12 months after approval.

## 11. Legal and provider references

- Office of the Privacy Commissioner of Canada, PIPEDA Principle 5, Limiting Use, Disclosure, and Retention: https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_use/
- Office of the Privacy Commissioner of Canada, Personal Information Retention and Disposal, Principles and Best Practices: https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/gd_rd_201406/
- Office of the Information and Privacy Commissioner of Alberta, PIPA guidance applying the requirement to keep personal information only as long as reasonably required for legal or business purposes: https://oipc.ab.ca/resource/guidance-for-landlords-and-tenants/
- Canada Revenue Agency, Electronic Record Keeping, including the general minimum six-year period and restoration expectations for electronic records: https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/ic05-1/electronic-record-keeping.html
- Plaid Launch Checklist, including Item removal when a connection is no longer used: https://plaid.com/docs/launch-checklist/
- Plaid Items API, `/item/remove`: https://plaid.com/docs/api/items/

[[PAGEBREAK]]

## 12. Approval

This policy becomes an operating requirement only after the owner approves the record below. Approval confirms responsibility for the quarterly review, annual review, exception register, and truthful disclosure of incomplete controls. It is not a legal opinion or a claim that every historical review has already occurred.

| Field | Entry |
| --- | --- |
| Approved by | Hussien Issa |
| Title | Owner and Security Lead |
| Approval date | 2026-09-23 |
| Approval method or signature | Electronic owner approval recorded in the Vanteloq project task |
| First quarterly review due | 2026-12-22 |
| Next annual review | 2027-09-23 |

After approval, the policy owner will store the adopted copy in the compliance register, schedule the first quarterly review, update the Plaid questionnaire to reflect the adopted policy, and preserve evidence of each review and exception.
