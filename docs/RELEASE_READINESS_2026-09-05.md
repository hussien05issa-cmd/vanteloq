# Vanteloq first-version release review

Date: September 5, 2026

Operator: LexEdge Consulting

Status: Conditional release. Not a certification of legal compliance, bug freedom, or payroll execution readiness.

## Release scope

This change is limited to Vanteloq. The separate private console, existing account grants, subscription records, provider credentials and customer financial records are not being edited.

The release strengthens OAuth browser binding, sensitive financial projections, location restrictions, streamed request-size limits, spreadsheet-safe exports and accounting-period enforcement. Terms and privacy notices describe the actual manual payroll accounting boundary.

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
| Automated payroll | No chosen provider or verified execution integration | Complete the provider steps above before advertising payroll processing |
| Self-service deletion | Live server configuration does not include the administrative deletion credential | Provision the correct scoped server credential and test deletion on a disposable, isolated account; retain the privacy-officer request route meanwhile |
| External identity controls | Application guards reviewed; hosted RLS, external activation functions and all authentication settings not independently certified | Verify external controls and recovery with dedicated test accounts |
| Provider availability | Code paths exist, but not every provider has production approval or validated credentials | Keep each connector's readiness label truthful; complete a customer-authorized test for each provider advertised as available |
| Uploaded documents | Quarantine protections exist; no production malware-scanning service verified | Keep unscanned uploads quarantined; configure and validate a scanner before permitting downloads |
| Legal approval | Public terms and privacy text updated to match the manual payroll boundary | Obtain qualified legal review of operator details, markets, contracts, retention and actual practices |
| Performance and visual QA | Production build succeeds with a large-chunk warning | Measure production performance and complete a dedicated device/browser acceptance review; do not call the build a Core Web Vitals pass |

## Security evidence

The completed source scan concerns the previous revision, f60f3b7a73a0213d9b1247609c63959cb7c8857e. It reports eight medium-severity findings and two low-severity findings. It does not certify the new patch or external services. Source coverage is partial for documentation, generated files and dependencies. No production exploit was performed.

Candidate fixes were reviewed independently. Focused regressions exercise denied access and legitimate accounting, OAuth missing-browser rejection and valid callbacks, bounded body streams, invalid dates, unsafe CSV text, idempotent journal posting and locked-period rejection. Run the release checks against the exact source state before publication.

## Deployment and rollback

Use the existing Vanteloq Sites deployment and its current public audience. Save the previous live version for rollback. Publish only the exact tested source and generated migration. The new accounting-period triggers add enforcement without rewriting existing migrations or deleting records.

If health checks fail, stop promotion and restore the previous application version. Do not remove database protections or delete customer records as an improvised rollback. Review any schema incompatibility explicitly.

Do not publish this release's full source to a public GitHub repository based on an older, commit-specific authorization.

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
