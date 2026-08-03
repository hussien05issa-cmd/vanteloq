# BookLoQ implementation and safety boundary

BookLoQ is Vanteloq's integrated accounting and financial-management workspace. Its promise is: “BookLoQ keeps your books organized, explains your financial position and shows you what requires attention.” It uses the same navigation shell, hosted identity, organization membership, location vocabulary, task system, audit service, D1 database, and visual language as the rest of Vanteloq.

## Working product surface

- Primary Vanteloq sidebar item and responsive, collapsible, searchable, permission-filtered 24-section finance navigation
- Owner overview with drill-down cards, ledger integrity, bookkeeping-health, month-end completion, cash forecast, AP/AR, tax working value, and prioritized Financial Attention Centre
- Unified financial transaction search, filters, record detail, categorization state, reconciliation state, confidence, attachments metadata, and CSV export
- Bank and POS payout evidence, reconciliation differences, bills, invoices, customers, suppliers, chart of accounts, budgets, cash flow, reports, month-end work, audit history, and assistant explanations
- Balanced manual journal posting with organization-owned active accounts, open-period validation, UUID idempotency, and immutable linked reversals
- Financial alerts with severity, explanation, dollar impact, supporting record references, confidence, recommended action, assignment, due date, status, resolution history, and conversion into the shared Vanteloq Action Centre
- Explicitly labelled Canadian retail demonstration data covering POS sales, fees, refund, chargeback, bank mismatch, card payment, loan principal/interest, owner funding/withdrawal, inventory, GST/HST, payroll, overdue AP/AR, foreign currency, accrual, and reversing journal evidence

## Accounting invariants

1. Money enters the server only as safe integer minor units; stored financial amounts are integer cents.
2. Every posted journal has at least two lines and equal debit and credit totals.
3. Every account reference is active and belongs to the authenticated organization.
4. Posting and reversal require an accounting period that covers the entry date and is not locked.
5. Posted lines are not edited or deleted. Corrections create a linked counter-entry; both records remain visible.
6. Idempotency keys and unique constraints make posting and reversal retries convergent.
7. Statement, tax, reconciliation, trial-balance, and forecast calculations are deterministic services, not language-model outputs.
8. Every sensitive state change is tenant scoped and audited.

## Canadian tax boundary

The current centre supports configurable GST/HST working calculations, collected tax, recoverable tax, net payable/refundable position, review exceptions, and transaction support. It is preparation assistance, not a filing service and not professional tax advice. BookLoQ never says a return was filed; the filing control is disabled because no verified government/provider confirmation adapter exists. Provincial rules remain configuration data requiring jurisdiction review before production use.

## Intentionally gated capabilities

These controls are visible only when useful for explaining the boundary, and are disabled with a reason: live bank/POS connections, background synchronization, OCR/email document capture, payment initiation, payroll execution, tax filing, accountant invitations, PDF/XLSX generation, and provider exports. They require their respective OAuth or service identity, encrypted credentials, callback verification, webhook replay protection, queues, recovery testing, and operational monitoring.

The assistant is currently deterministic and evidence-bound. It answers supported questions from returned records and calculations, shows confidence and missing information, and can create a proposed operational task. It cannot post, pay, file, delete, unlock, or claim professional status.

## Verification

Automated gates cover debit/credit equality, journal validation, linked reversal mechanics, Canadian tax rounding, reconciliation differences, trial-balance equality, statement totals, health scoring, certainty-separated forecast logic, idempotent demo seeding, journal posting replay, reversal, tenant isolation, anonymous denial, cross-site write denial, migrations, rendered output, lint, strict typing, and production build.

This is an evaluation-ready accounting core, not authorization to connect live financial data. Production launch still depends on the identity-lifecycle and Cloudflare operational controls listed in `SECURITY_ACCEPTANCE.md`, plus provider-adapter and accounting-content review.
