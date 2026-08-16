# BookLoQ production readiness record

Assessment date: August 16, 2026

This record maps the BookLoQ master specification to the implemented Vanteloq system. It is an engineering readiness record, not a legal opinion, accounting assurance engagement, tax opinion, or promise that the service cannot be breached. Canadian and Alberta counsel, a qualified accountant, and the applicable provider review teams must approve the production policies and regulated workflows before they are represented as independently certified or universally compliant.

## Implemented and verified in the application

| Control area | Current implementation |
|---|---|
| Tenant and identity boundaries | Supabase identity, verified email, AAL2 controls for sensitive actions, organization-scoped authorization, role permissions, location scope, rate limits, same-origin protection, and auditable protected actions |
| Legal acceptance | Account creation and onboarding require affirmative acceptance of the current Terms of Service and Privacy Policy. The server rejects stale or missing versions and stores a versioned acceptance record with hashed request context. |
| General ledger | Organization-scoped chart of accounts, balanced journal entries, accounting periods, corrections, source lineage, and immutable posting history |
| Accounts receivable | Customer invoices, line items, tax, due dates, status, document output, email delivery through the protected server route, and transaction matching |
| Accounts payable | Supplier bills, line items, due dates, approval state, document matching, and payable context |
| Bank data | Plaid Link consent, read-only account and transaction sync, encrypted credentials, cursor-based updates, reconciliation support, disconnection, and protected deletion |
| Point of sale data | Provider-specific normalized sales, product, inventory, customer, supplier, payment, and location paths where the provider returns those records |
| Inventory accounting | Owner-entered and CSV-imported unit cost, source priority, product matching, cost lineage, inventory valuation, margin inputs, and reorder context |
| Reporting | Trial balance, profit and loss, balance sheet, cash flow, receivables, payables, budgets, forecasts, comparisons, source labels, data freshness, and CSV or document outputs where implemented |
| AI explanations | Google Gemini receives a bounded aggregate evidence snapshot only after explicit data-use acceptance. It cannot post accounting entries or execute actions. Conversation data is scoped by organization and user, can be deleted by the user, and expires after the documented inactivity period. |
| Data integrity | Decimal currency storage, database constraints, tenant-qualified joins, idempotent provider writes, source authority selection, duplicate handling, and fail-closed unavailable states |
| Privacy controls | Provider-specific consent, published Privacy Policy and Terms of Service, retention schedule, deletion controls, security and audit records, and explicit limitations for professional decisions |

## Intentionally bounded or dependent on external approval

These items must not be advertised as live unless their specific provider, data, or professional review exists:

1. Automated tax filing, payroll remittance, legal compliance certification, and professional accounting advice.
2. Money movement, supplier payment, card issuing, lending, or autonomous financial actions.
3. A connector whose production credentials, provider approval, webhook verification, data sample, and reconciliation checks have not all passed.
4. Metrics that require missing product cost, customer, supplier, inventory, banking, payroll, or tax records.
5. Full feature equivalence with QuickBooks, Xero, or another third-party product. BookLoQ supports a substantial operating accounting system, but parity claims require independently tested feature-by-feature evidence.
6. A guarantee against lawsuits, breaches, downtime, inaccurate source data, or professional decision error.

## Required operational approvals before broad release

1. Canadian and Alberta privacy counsel must review the Privacy Policy, Terms of Service, consent notices, subprocessors, cross-border disclosures, retention schedule, breach process, and customer contracts.
2. A qualified Canadian accountant must review accounting definitions, default chart of accounts, sales tax treatment, statement presentation, close controls, and customer-facing accounting claims.
3. Each production connector must pass the provider's approval process and an owned test-account reconciliation against the provider's source totals.
4. The operator must maintain monitored security contacts, incident response ownership, access reviews, dependency updates, backup tests, deletion reviews, and legal-hold records.
5. Production observability must alert on authentication failures, webhook verification failures, sync lag, repeated import errors, reconciliation differences, and elevated server errors.

## Release evidence

The engineering release must pass type checking, linting, production build, migration validation, authentication and tenant-boundary tests, connector regression tests, accounting regression tests, interaction tests, and a live browser check. A passing automated scan reduces known risk but does not prove that no vulnerability exists.
