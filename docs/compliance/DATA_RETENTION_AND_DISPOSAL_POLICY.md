# Vanteloq Data Retention and Disposal Policy

| Document control | Value |
| --- | --- |
| Organization | LexEdge Consulting, operating Vanteloq |
| Policy owner | Hussien Issa, Owner and Security Lead |
| Version | 1.1 |
| Prepared | 2026-08-24 |
| Review cycle | Quarterly enforcement review; full annual review |
| Approval status | Awaiting owner approval |

## 1. Purpose and scope

This policy defines how Vanteloq retains, reviews, deletes, de-identifies, and disposes of consumer, financial, business, authentication, integration, and security data. It applies to production databases, object storage, logs, backups, exports, support systems, connected providers including Plaid, and local copies created for an authorized business purpose.

Vanteloq retains data only while it is needed for a disclosed product purpose, security, legal obligation, dispute, or documented business requirement. Retention is not indefinite by default.

## 2. Roles

- The Owner and Security Lead approves the schedule, exceptions, legal holds, and deletion evidence.
- System owners implement retention controls in each service and verify their operation.
- Authorized users may request disconnection or deletion through the product or support channel.
- Service providers must be configured or instructed to delete data consistently with this policy and applicable contracts.

## 3. Retention schedule

| Data category | Default active retention | Disposal trigger and method |
| --- | --- | --- |
| Plaid access tokens and item identifiers | While the connection is active and authorized | Revoke provider access and cryptographically delete the encrypted credential when disconnected, authorization is withdrawn, or deletion is approved |
| Plaid account balances and transaction records | While the connected feature is active; reviewed after 24 months without authorized use | Delete source and derived financial records on verified deletion, subject to a documented legal hold |
| Plaid Link consent and authorization evidence | Connection life plus 6 years | Delete or de-identify after expiry unless law or dispute requires continued retention |
| POS, inventory, customer, supplier, and commerce records | Active service plus up to 7 years where required for accounting, tax, or audit support | Delete or de-identify after account closure and the applicable legal period |
| Invoices, receipts, journal support, and tax records | 7 years unless a longer legal requirement applies | Securely delete after expiry and hold review |
| Authentication and membership records | Active account | Delete the authentication account, membership, personal profile, preferences, and private Advisor history after verified account deletion. Preserve only anonymous authorship where a customer business record must remain |
| Nonidentifying account-deletion receipts | 24 months | Automatically remove after expiry. The receipt must not contain a name, email, workspace name, network address, or raw provider identifier |
| Security and administrative audit events | 2 years | Securely delete after expiry and incident/hold review |
| Application and request logs | 90 days by default | Automated expiry; restricted incident copies follow the incident record period |
| Support records | 2 years after closure | Delete or de-identify after expiry and dispute review |
| Temporary exports and generated files | 30 days or shorter when no longer needed | Automated expiry or immediate secure deletion after delivery |
| Failed or abandoned uploads | 24 hours | Automatic purge from quarantine and temporary storage |

Where another law, contract, or provider rule requires a different period, Vanteloq records the applicable source, category, period, and owner in the retention register.

## 4. Consumer consent and purpose limitation

Before Plaid Link is initiated, Vanteloq displays the data categories, purposes, policy versions, and deletion route, and records affirmative consent. Only the products and data needed for the selected use are requested. Expanding the purpose or data category requires new or updated authorization.

Withdrawing consent stops future collection that relies on consent. It does not override a documented legal obligation, but any retained record must be limited to that obligation and unavailable for unrelated product use.

## 5. Deletion and disconnection procedure

Plaid deletion is a protected owner action requiring a current authenticated AAL2 session, tenant and finance authorization, a fresh deletion confirmation, and a rate-limited server request. The deletion process must:

1. identify the organization, connection, source accounts, raw financial records, derived records, reports, and audit scope;
2. revoke or remove the Plaid item when provider credentials are available;
3. delete encrypted Plaid credentials and account data;
4. delete transactions, balances, derived cash metrics, sync cursors, and unauthorized exports tied to the connection;
5. de-identify only the minimal audit evidence required to prove the deletion occurred;
6. invalidate cached or generated views; and
7. record the request, authorization, scope, result, and timestamp without retaining the deleted secret.

If provider revocation cannot complete, Vanteloq must fail closed, retain the request for controlled retry, block further use of the connection, and notify the authorized requester without exposing a credential.

## 6. Account closure and inactivity

Account closure starts a documented deletion workflow after billing, dispute, legal-hold, and export obligations are checked. Every authenticated user can initiate their own account deletion after recent multifactor authentication and exact confirmation. A nonowner deletion removes the login, membership, personal profile, preferences, and private Advisor history while de-identifying authorship in customer records that must remain.

A verified workspace-owner deletion cancels the Vanteloq Stripe subscription and customer before deleting the workspace, stored files, active records, local integration credentials, memberships, and authentication accounts that are not still used by another workspace. The owner must confirm authority to delete the workspace and should export records that the customer is required to retain. Connected providers are disconnected and recurring synchronization stops. Inactive connections are reviewed at least quarterly; a connection that no longer has a valid purpose or authorization is disabled and scheduled for deletion.

## 7. Backups, caches, and derived data

Deletion applies to primary records, caches, search indexes, generated reports, exports, and derived analytics. Where a provider-managed immutable backup cannot be selectively edited, the deleted record must remain inaccessible to normal operations and expire through the provider's documented backup lifecycle. A restored backup must reapply all deletion tombstones before returning to service.

## 8. Legal holds and exceptions

Only the Owner and Security Lead may approve a legal hold or retention exception. The record must name the data, reason, authority, owner, start date, review date, and release condition. Held data is restricted to the hold purpose. When the hold ends, normal disposal resumes promptly.

## 9. Disposal standards

- Database and object records are deleted through authenticated server-side operations.
- Encryption keys or wrapped credentials are destroyed when cryptographic deletion is used.
- Physical media, if ever used, is destroyed through a documented secure-media process.
- Paper records containing restricted data are cross-cut shredded.
- Service-provider deletion or contract termination is recorded.
- Disposal logs identify scope and outcome without reproducing sensitive content.

## 10. Review, testing, and evidence

The retention schedule and enforcement status are reviewed quarterly and after a material product, provider, legal, or data-use change. The full policy is reviewed annually. Reviews must verify configured TTLs, deletion queues, provider disconnection, backup treatment, stale exports, legal holds, and a sample end-to-end deletion.

Evidence includes consent records, deletion audit events, provider revocation results, retention-job logs, exception approvals, legal-hold records, and signed review minutes. A control is not reported as operational until dated evidence exists.

This policy takes effect only when the owner completes the approval record. The first quarterly enforcement review is due within 90 days of approval.

## Approval

| Field | Entry |
| --- | --- |
| Approved by | ______________________________ |
| Title | Owner and Security Lead |
| Approval date | ______________________________ |
| Signature | ______________________________ |
| Next annual review | ______________________________ |
