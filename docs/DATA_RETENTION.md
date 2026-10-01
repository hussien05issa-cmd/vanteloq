# Data retention and deletion policy

Policy version: 1.0

Effective implementation baseline: August 11, 2026

Technical inventory reviewed: October 1, 2026. This records a source review, not owner approval or completion of production disposal.

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
| Privacy deletion audit event | Operator target of 24 months unless a longer incident, complaint, or legal hold applies | Store action/result metadata only, without the deleted bank data; review expired events for authorized disposal | Event creation implemented; completion of age-based disposal requires dated operator evidence |
| Rate-limit records | No more than twice the enforcement window | Expire through the rate-limit store lifecycle | Implemented by platform control |

The Canada Revenue Agency generally requires relevant records and supporting documents to be kept for six years from the end of the last tax year to which they relate, subject to exceptions. See [Keeping records](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc188/keeping-records.html). A qualified professional must confirm the period that applies to each customer and record type.

## Other record categories

| Record | Baseline | Disposal rule |
|---|---|---|
| User identity and membership | Account life plus request-resolution and security period | Delete or anonymize after verified account closure unless a hold applies |
| Organization profile | Account life plus request-resolution period | Delete after verified workspace closure |
| Original invoices, receipts, and statements | Customer policy plus applicable accounting/tax duty | Private storage; authorized deletion only when no hold applies |
| Rejected uploads and quarantined files | Operator disposal target: within 30 days unless an active incident hold applies | A reviewed disposal decision must establish scope and authority. Age-based automatic purge and completed production review are not verified. The cleanup scheduler retries already-authorized deletion; it does not select old uploads for disposal. |
| Normalized POS records | Customer policy plus applicable recordkeeping duties | Export, correct, delete, or de-identify through a provider-specific workflow |
| Disconnected Shopify routing metadata | While needed to route privacy or uninstall events for retained records, subject to documented purpose review | Disconnect deletes local credentials and stops collection, while the store domain, prior authorization date and limited successful-connection audit evidence can remain. Local disconnection does not prove provider-side grant revocation. No age-based routing-metadata purge is established. |
| Pending Shopify privacy request scope | Until explicit fulfilment or applicable workspace deletion | Store only bounded shop/request/customer identifiers, customer email where supplied, and requested order identifiers in the encrypted scope. The generic task/notification contains no customer identifiers. The 30-day due date prompts operator follow-up; it does not automatically deliver a response or erase a pending request. |
| Shopify privacy fulfilment evidence | Only while needed for the documented privacy response or audit purpose, subject to retention review | Explicit completion clears the encrypted request scope. The opaque request ID, request hash, status, export counts/timestamps, completion actor/time/method and hashed fulfilment reference remain. This records an operator attestation, not proof of delivery. Whole-workspace deletion cascades to the queue; no automatic age-based purge is established. Downloaded export copies require separately authorized secure handling and disposal. |
| Cloud-file connection credentials and metadata | Credentials while active; limited connection/audit metadata for the documented service, security or privacy purpose | Google/Microsoft disconnect removes local credential ciphertext and linked sources; it does not prove remote provider grant revocation. Applicable account/workspace deletion removes cloud-file connections and cascades to linked sources. Provider-side revocation remains an account-owner action. |
| Linked-file source metadata and sheet snapshots | While linked, until unlink, disconnect or applicable account/workspace deletion | Store file and selected-tab identifiers/names, revisions, refresh state/timestamps and encrypted Google Sheet snapshots. Pause retains these records and stops refresh. Unlink deletes the source and snapshot; disconnect deletes all linked sources for that connection. No independent age-based purge is established. |
| PDF copies imported from linked files | Separate document policy and applicable accounting/tax duty | Changed selected documents enter the private quarantine, scan and review workflow. Unlinking or disconnecting does not delete earlier document copies or reviewed accounting records. Apply the normal authorized document deletion and workspace deletion controls. |
| Audit and security events | Operator review target: 24 months by default, longer only for a documented incident or legal hold | Review and authorize scoped deletion or anonymization. This period is an operating requirement, not evidence that automatic expiry or production disposal has completed. |
| Marketing consent evidence | While relied upon and for the period needed to answer a compliance question | Retain minimum proof only |
| Vanteloq AI consent evidence | While relied upon and for up to 24 months after withdrawal or account closure when needed to demonstrate authorization or answer a complaint | Retain the minimum versioned consent record; do not copy the question or model response into the consent record |
| Vanteloq AI conversations and messages | Until the user clears the conversation or 90 days after the conversation was last updated | Clear conversation deletes the scoped messages and conversation immediately; stale conversations are deleted when that user next uses the Advisor |
| Vanteloq AI open-chat context | Browser-held context for the open chat; server acceptance expires after 30 minutes for each signed turn | Up to six recent messages may inform a follow-up even with saving off. Starting a new chat clears context; expired or changed access/scope is rejected. Expiry does not erase visible text from an already-open browser. |
| Vanteloq AI response/display preferences | Until reset or applicable account/workspace deletion | Only allowlisted choices are persisted for the user/workspace. Reset deletes the row; account cleanup and workspace/user cascades cover deletion. Preferences are separate from chat saving. |
| Vanteloq AI retry metadata | Eligible for removal 24 hours after its last update | Request identifiers, hash, state, conversation reference and timestamps only, without question, answer, attachment or token contents. Expired rows are removed on that user's next request claim. No scheduled 24-hour purge is claimed. Account/workspace deletion removes the rows. |
| Vanteloq AI attachments and attachment-derived exchanges | Request-only files and an unsaved open-chat exchange | Files are not placed in Documents, object storage or saved history. Permitted follow-ups may use the recent exchange without reattaching the original file; those follow-ups remain unsaved. Provider retention remains separate. |
| Unsubscribe and suppression records | As long as needed to prevent prohibited contact | Keep only a minimal suppression value and never use it for marketing enrichment |
| Import staging files | Operator disposal target: 7 days after accepted or rejected import | Identify actual staging objects and authorize deletion from private storage. Automated expiry and completed production disposal are not verified by this policy. |

Operator targets require an assigned owner, dated inventory, documented holds, disposal results and tracked exceptions. The source review does not establish execution of these procedures. Do not delete customer records solely because a target date passed without checking the applicable authority and recordkeeping requirements.

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

The October 1, 2026 technical review added the AI preference, retry and open-chat categories, Shopify privacy queue/routing categories and linked-file categories, and checked their source-level reset/deletion paths. Isolated Shopify fixtures verify pending-request handling, fulfilment controls and workspace cascade; they do not establish live customer delivery or provider approval. This review did not approve the policy on the owner's behalf, conduct a production retention sweep, or verify actual production backup retention/restoration.

## Vanteloq newsletter choices

Newsletter enrollment is separate from required legal acceptance, the private contact form and operational account notifications. No existing user, customer import or subscriber plan is enrolled automatically. A valid public sender mailing address and an explicit enrollment switch are required before the optional signup or onboarding notice appears.

Signup drafts contain a keyed email hash, the displayed notice, selected choice, server timestamps and limited hashed request evidence. They cannot authorize a send. They expire after 7 days and expired rows are physically removed on the next signup-intent creation. A verified matching email and the originating HttpOnly browser cookie are required to claim a draft; changed notices or expired drafts require a fresh choice. Supabase user metadata is not consent evidence.

Current newsletter recipients are encrypted. Durable consent/withdrawal events contain the notice, server timestamps, manner and keyed identity/address references. Record only the minimum evidence needed while consent is relied upon and to answer a documented compliance matter afterward. The newsletter unsubscribe page does not require sign-in. GET displays the choice; POST suppresses immediately. Tokens last 400 days from issuance and are never rotated simply because another email is issued. Expired tokens cannot authorize changes and may be purged during maintenance.

When the acting account has no remaining Vanteloq membership after verified deletion, remove its email ciphertext, identity association and device/request hashes. Keep minimal keyed address suppression and unlinked consent/withdrawal evidence, never for targeting or enrichment. Do not withdraw another workspace member's independently granted consent when an owner deletes a workspace. The existing identity cleanup contract does not confirm which other shared identities were removed; a separate reviewed cleanup is needed if that contract expands to delete other subscribers.

This release stores preferences and prepares suppression/unsubscribe only. It does not dispatch campaigns, sync a provider audience or send confirmation messages. Before sending commercial emails, wire the current eligibility check, sender identification, valid unsubscribe links, signed provider bounce/complaint events, unsubscribe-request handling through support and confirmation of express consent. Account and invoice senders must not be reused as an unrestricted marketing broadcast.

Key rotation must migrate newsletter address/subject hashes and recipient ciphertext before removing the previous integration encryption key. The Lightspeed-specific key is not used for newsletter data.
