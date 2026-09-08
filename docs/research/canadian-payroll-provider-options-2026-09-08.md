# Canadian payroll integration options

Research date: September 8, 2026. Scope: Canadian payroll data for Vanteloq. This is an engineering shortlist, not a provider contract, compliance certification, or authorization to run payroll.

## Recommendation

Start with a read-only integration that imports approved payroll journals and labour summaries. Keep pay runs, bank details, remittances, and employee payments in the payroll provider. Vanteloq can then reconcile labour expenses and explain labour-to-sales ratios without becoming the system that moves wages.

Payworks is the first candidate to evaluate for this scope. This is an engineering judgment based on its explicitly advertised journal-entry and timesheet API, not a claim that Vanteloq has API access or that Payworks is universally the best provider.

## Verified public information

| Provider | Evidence | What is not established |
| --- | --- | --- |
| Payworks | Its official Canadian product material explicitly offers API access for journal entries and timesheets, alongside QuickBooks Online and Xero integrations. [Payworks integration information](https://www.payworks.ca/deluxe) | Vanteloq partner eligibility, authorization model, read-only scopes, endpoint contracts, sandbox, price, and production approval are not verified. |
| Wagepoint | Its official site describes Canadian payroll, payroll registers, tax breakdowns, and integrations with QuickBooks Online, Xero, and FreshBooks. [Wagepoint payroll](https://www.wagepoint.com/payroll/) | Existing accounting integrations do not establish a generally available API for Vanteloq. A supported third-party developer contract was not verified in this research. |
| PaymentEvolution | Its official developer page offers a payroll calculation API for custom applications. It requires an authorized API account arranged with the provider and describes paid calculation packages. [PaymentEvolution developer program](https://paymentevolution.com/fr/produits/developpeurs) | Calculation access does not establish access to completed payroll journals, employee payment execution, or every filing operation. Current contracts, pricing, and endpoints need direct confirmation. |

## Required before implementation

1. Confirm the owner wants reporting imports rather than payroll execution, and select a provider.
2. Obtain an authorized developer account, current API documentation, sandbox, and written confirmation that customer-authorized multi-tenant integration is supported.
3. Verify least-privilege authorization, token refresh and revocation, rate limits, incremental updates, corrections, and any webhook signature requirements.
4. Agree on the data contract: provider company, pay run, pay period, posting date, currency, gross wages, employer costs, liabilities, and reversal references. Distinguish net pay from total employment expense and prevent double counting with accounting imports.
5. Validate separate customer organizations, duplicate and amended pay runs, closed periods, failed imports, disconnect, deletion, retention, and reconciliation to provider reports.
6. Review provider terms, processing location, subprocessors, support access, and employee privacy requirements with appropriate advisers before production activation.

No provider was purchased, contacted, connected, or enabled during this research. The payroll connector remains unavailable until its actual contract and implementation are verified.
