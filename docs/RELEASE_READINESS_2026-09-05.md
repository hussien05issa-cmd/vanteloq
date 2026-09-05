# Vanteloq first-version release review

Date: September 5, 2026

Operator: LexEdge Consulting

Status: Conditional release. Not a certification of legal compliance, bug freedom, or payroll execution readiness.

## Release scope

This change is limited to Vanteloq. The separate private console, existing account grants, subscription records, provider credentials and customer financial records are not being edited.

The earlier release strengthened OAuth browser binding, sensitive financial projections, location restrictions, streamed request-size limits, spreadsheet-safe exports and accounting-period enforcement. The follow-up adds resumable, explicitly confirmed self-service deletion. Terms and privacy notices describe the actual manual payroll accounting and deletion boundaries.

## Payroll capability

BookLoQ can record an approved payroll report as a balanced manual journal when the workspace has the required entitlement, permissions, chart of accounts and an open or reopened review period. Aggregate wage and liability balances remain subject to financial and payroll permissions.

This is not a payroll processing integration. It does not calculate statutory deductions, send wages, remit taxes, prepare employment forms, or submit returns. Do not collect Social Insurance Numbers, bank account details, passwords or individual employee pay details in journal memos.

Before enabling automated payroll:

1. Select the payroll provider and confirm supported employer countries and provinces.
2. Approve the provider agreement, data processing terms, employee notices, retention rules and authorization scopes.
3. Configure credentials through the server secret store, never source control or browser code.
4. Test isolated payroll imports, reversals, duplicate deliveries, consent withdrawal, denied permissions and employee data deletion.
5. Reconcile results against a qualified payroll professional's calculations.
6. Separately approve any real payments, remittances or filings. This release does not authorize them.

## Outstanding launch decisions

| Item | Current evidence | Required completion |
| --- | --- | --- |
| Automated payroll | Bayzat is the recommended Dubai provider; third-party API access and an execution integration are not verified | Obtain provider partner documentation and employer-specific approval. See UAE_PAYROLL_PROVIDER_DECISION_2026-09-05.md. Do not advertise payroll processing as connected |
| Self-service deletion | Ten isolated flow tests cover scoped cleanup, shared identities, retries, leases, provider failures and denied requests | Publish the tested worker, generated migration and dedicated identity function, then enable the feature flag. Verify live denial paths. An actual disposable production-account lifecycle remains an acceptance test, not a claimed result |
| External identity controls | Application guards reviewed; hosted RLS, external activation functions and all authentication settings not independently certified | Verify external controls and recovery with dedicated test accounts |
| Provider availability | Code paths exist, but not every provider has production approval or validated credentials | Keep each connector's readiness label truthful; complete a customer-authorized test for each provider advertised as available |
| Uploaded documents | Quarantine protections exist; no production malware-scanning service verified | Keep unscanned uploads quarantined; configure and validate a scanner before permitting downloads |
| Legal approval | Public terms and privacy text updated to match the manual payroll boundary | Obtain qualified legal review of operator details, markets, contracts, retention and actual practices |
| Performance and visual QA | Production build succeeds with a large-chunk warning | Measure production performance and complete a dedicated device/browser acceptance review; do not call the build a Core Web Vitals pass |

## Security evidence

The completed source scan concerns the previous revision, f60f3b7a73a0213d9b1247609c63959cb7c8857e. It reports eight medium-severity findings and two low-severity findings. It does not certify the new patch or external services. Source coverage is partial for documentation, generated files and dependencies. No production exploit was performed.

Candidate fixes were reviewed independently. Focused regressions exercise denied access and legitimate accounting, OAuth missing-browser rejection and valid callbacks, bounded body streams, invalid dates, unsafe CSV text, idempotent journal posting and locked-period rejection. Run the release checks against the exact source state before publication.

## Deployment and rollback

Use the existing Vanteloq Sites deployment and its current public audience. Save the previous live version for rollback. Publish only tested source and its generated migrations. Migration 0040 adds the deletion job table without altering existing records or migrations.

If health checks fail, stop promotion and restore the previous application version. Do not remove database protections or delete customer records as an improvised rollback. Review any schema incompatibility explicitly.

Do not publish this release's full source to a public GitHub repository based on an older, commit-specific authorization.

## Self-service deletion operating boundary

The entry point is /account/deletion and the account Settings deletion control. A paid subscription is not required. The caller must sign in, complete fresh multifactor verification, type the exact scope-specific confirmation and explicitly acknowledge permanent deletion. Owners must also acknowledge immediate cancellation and disconnect external providers first. Suspended, ambiguous or multiple-workspace relationships require verified privacy support; the system must not guess which business to erase.

The server captures an encrypted plan and hashes a randomly generated, 256-bit retry capability. The browser saves the capability only in that tab's session storage. No capability is placed in URLs or analytics. Keep that tab open until the receipt confirms completion. A pending result is not proof of deletion.

The dedicated Supabase function verifies the capability against the canonical application's persisted plan before using its internal service credential. No global Supabase administrator key is copied into the Vanteloq website environment. Existing private-console functions and access grants remain unchanged. Shared sign-in identities are retained when another service or workspace needs them. Deleting an owner's workspace never deletes other members' independent sign-in identities.

Processing checks billing cancellation before erasing workspace records, verifies provider removals, uses a renewable processing lease and preserves an encrypted retry plan after an interruption. Completed jobs immediately discard direct target identifiers and the encrypted plan. A pseudonymous receipt is retained for 24 months. A 30-day capability expiry sends unresolved requests to verified privacy support rather than silently marking them complete.

If an incident requires pausing new processing, set VANTELOQ_DELETION_ENABLED to false and deploy that environment revision. Preserve job records and review pending receipts. Do not delete retry records, revoke shared accounts or bypass scope checks to clear an error. Financial, provider and backup retention exceptions still apply as described in the public notice.

## What can honestly be guaranteed

No finite test suite, warranty or security scan can establish that software has zero bugs. This release can report the exact tests performed, their results, the limitations of those tests and a rollback plan. It cannot promise flawless behaviour for every device, provider outage, future dependency change or customer dataset. A contractual bug-fix commitment is a separate business decision, not proof of bug freedom.

## Legal reference points

These references support review, not a blanket conclusion that every law applies in the same way to every customer:

- [Office of the Privacy Commissioner of Canada: business privacy guide](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda-compliance-help/guide_org/)
- [Alberta: personal employee information](https://www.alberta.ca/personal-employee-information.aspx)
- [Alberta: organizational responsibilities for personal information](https://www.alberta.ca/organization-responsibilities-for-protecting-personal-information)
- [CRA: keeping records](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc188/keeping-records.html)
- [CRA: employers' guide to payroll deductions and remittances](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4001/employers-guide-payroll-deductions-remittances.html)

## Acceptance record

The combined release preserves the newer employee invitation and internal-entitlement changes. The full application suite, 29 connector and account-flow tests, 10 BookLoQ accounting and cash-flow tests, invitation lifecycle tests, focused security tests, linting and type checking passed locally. Thirteen authentication and security email templates passed dry-run validation. The production dependency advisory check reported no known vulnerabilities at the time of review.

Connector tests use isolated mock services and disposable databases. They do not prove provider production approval, actual email delivery, payroll processing or deletion of a real account. No real wages, filings, remittances or customer record deletion were performed.

The release handoff records the deployment and live health results separately. A working homepage alone does not establish a complete production workflow.
