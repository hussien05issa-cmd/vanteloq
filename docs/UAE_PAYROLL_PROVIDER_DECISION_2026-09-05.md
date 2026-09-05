# Dubai payroll provider recommendation

Prepared for LexEdge Consulting and Vanteloq on September 5, 2026.

Status: Research and integration proposal. No provider contract, production connection, employee-data transfer or payment has been authorized or completed by this document.

## Recommendation

Start with **Bayzat** for a Dubai-focused payroll partnership. Bayzat says it was founded in Dubai and serves more than 4,000 companies and 250,000 employees. These are vendor-reported adoption figures, not independently verified market share. Its UAE payroll product supports payroll processing and WPS-related workflows. This makes it a credible regional candidate, not proof that it is the most popular or error-free provider. Sources: [Bayzat company information](https://www.bayzat.com/) and [payroll product](https://www.bayzat.com/payroll-processing).

Bayzat advertises integrations with accounting products including QuickBooks and Xero. That does **not** establish that Vanteloq can use a public payroll API. This research did not verify a public, third-party developer contract for importing approved UAE pay runs. Ask its integrations team for partner access, API documentation and a sandbox before implementing a live adapter. Source: [Bayzat integrations](https://www.bayzat.com/integrations).

Use **Zoho Payroll UAE** as the alternative for a smaller employer wanting a published-price product. The UAE edition advertises WPS, pension and gratuity features, and integration with Zoho Books and Zoho People. Its Standard monthly price is advertised as AED 45 for five employees, plus AED 9 per additional employee; confirm current pricing, taxes and the features needed before buying. Do not assume API documentation for another country's edition applies to the UAE edition. Sources: [UAE product](https://www.zoho.com/blog/payroll/payroll-software-for-uae.html), [pricing](https://www.zoho.com/en-ae/payroll/pricing-comparison/) and [UAE integrations](https://www.zoho.com/en-ae/payroll/integrations/).

## What Vanteloq should do first

Keep payroll calculation, employee bank details, salary disbursement and statutory processing in the approved payroll provider. Initially, Vanteloq should import only employer-approved pay-run totals into a reviewable BookLoQ journal. This is an integration design recommendation, not a claim that either provider has granted these API capabilities.

Suggested minimal fields: employer identifier, pay-run identifier, revision, pay period, payment date, AED currency, total gross wages, employer costs, withholding/liability totals and net wages. Do not import passports, Emirates IDs, bank instructions or individual salary details for an aggregate accounting workflow.

Every import should require an authorized workspace connection, explicit payroll-data consent, least-privilege server credentials and a recorded source. Deduplicate by employer, pay-run ID and revision. Quarantine incomplete, unbalanced or conflicting totals. Corrections should create a reviewed reversal or adjustment, not silently overwrite a posted journal. The payroll provider remains responsible for its payment workflow; an AI explanation must not submit wages or filings.

Until provider approval exists, the current manual journal workflow can record an approved external payroll report. Do not label Bayzat or Zoho as connected, imply a partnership, or advertise automatic payroll execution.

## Questions to send Bayzat

1. Does your commercial agreement allow a multi-tenant SaaS application to connect customer employers separately, rather than using one shared customer credential?
2. Can Vanteloq read approved and corrected UAE pay runs, employer totals and posting references? Please provide the endpoint and field documentation, scopes, pagination, rate limits and versioning policy.
3. Is there a sandbox with synthetic employees and no ability to make real payments? Are signed webhooks available for approvals, revisions and cancellations?
4. How do customers grant and revoke authorization? Are short-lived OAuth tokens available? What are the restrictions on storing or deriving accounting results?
5. Which UAE employer jurisdictions and current WPS rules are supported, including relevant mainland and free-zone distinctions? Which approved payment institutions execute wages?
6. Provide the payroll-service agreement, data processing addendum, subprocessors, hosting/transfer locations, deletion terms, breach-notification commitments, security evidence and partner pricing.

Bayzat's website privacy notice permits some international processing. Do not promise UAE-only storage without an appropriate contractual commitment. A website privacy policy and marketing certification statement are not substitutes for reviewing the actual payroll service agreement or its security evidence. Source: [Bayzat Privacy Policy](https://www.bayzat.com/privacy-policy).

## Legal and operating checks

The UAE government describes WPS obligations for MoHRE-registered employers, with applicable exceptions and approved payment channels. Confirm the employer's legal entity, registration jurisdiction, employee categories, current payment deadlines and applicable pension/end-of-service treatment with the provider and a qualified UAE payroll professional. Do not configure a Canadian employer as UAE-based merely because Vanteloq plans to serve Dubai customers. Source: [UAE government salary-payment guidance](https://u.ae/en/information-and-services/jobs/employment-in-the-private-sector/payment-of-wages).

This is product and procurement guidance, not a legal opinion. Legal review, provider approval and a reconciled sandbox test are release gates for the payroll connector. No software supplier can honestly promise that software will never contain a bug.
