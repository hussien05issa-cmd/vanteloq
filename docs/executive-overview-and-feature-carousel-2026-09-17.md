# Vanteloq v1.0 Origin: executive overview and feature discovery

## Implemented

- A responsive feature carousel on the existing homepage: swipe on touch devices, previous/next arrows and named pagination buttons. Sales, inventory, BookLoQ and AI examples stay labelled as fictional. No autoplay or provider availability changes.
- Mobile header navigation preserves Instagram, YouTube, TikTok and Facebook as individual 44-pixel touch targets.
- An 8-metric Executive Overview in the dashboard and live BookLoQ overview: net revenue, gross profit, gross margin, operating profit, net profit margin, cash balance, cash flow and inventory value.
- Today, 7D, 30D, MTD, QTD, YTD and custom periods. Previous-period and previous-year comparisons, exact-period ledger budgets and explicitly temporary view targets. Custom periods are limited to 366 days and cannot end in the future.
- Metric selection opens dated charts, keyboard inspection, exact-value tables, source details, coverage and calculation definitions. Sales drill-through carries the chosen dates into the sales workspace. Existing location, category, product and transaction exploration remains available.
- Financial disclosure includes period P&L, closing balance sheet, cash activity classifications, current AR/AP aging, working capital, current/quick ratios, recorded GST, net cash burn, runway and expense breakdowns. The existing 13-week forecast, budgets, tax review and reconciliation workflows remain in BookLoQ.
- Retail customer analytics add observed cross-period cohort retention and top-customer/top-5 revenue concentration. Guests and unknown identities are excluded and their coverage limits are explicit.
- Shared accounting calculations distinguish operating revenue, COGS, operating expenses, finance costs, income tax and other income. BookLoQ checks, profit visualisation and permitted AI aggregate projections use the same definitions.

## Data and access contracts

Money is summed in integer cents with safe-precision checks in the new ledger calculations. Ratio denominators must be positive; comparison against zero is unavailable. Product costs are not invented. Inventory is a dated balance, never a sum across days, and a missing selected-date snapshot is not carried forward as current stock.

POS and ledger figures have different source bases. Sales metrics use approved records and complete comparable-date coverage before claiming growth. Ledger metrics require the BookLoQ add-on, organization-wide scope, finance, cash, payroll, profit, revenue and inventory-value permissions. Named supplier totals additionally require customer-identity permission. Every SQL join is scoped to the organization and ledger currency. Demonstration settings are excluded from the live endpoint. Queries do not post, delete or alter financial records.

Opening and closing ledger amounts include posted and reversed journals, including their corresponding reversal entries, rather than draft journals. A balanced ledger is not evidence of complete records, reconciliation or an audit. Reported profit reflects the entries actually posted; unposted costs and tax adjustments are not estimated.

Cash activity is classified only when the non-cash side of a journal has one unambiguous activity type. Mixed journals, uncertain classifications and policy-sensitive interest/tax movements remain in a review bucket. Internal cash transfers net to zero. Net cash burn is historical net movement normalized to an average month, not an operating-only forecast or a promise about future cash.

## Explicit limits

- All 8 cards are available as interface slots, but figures appear only when corresponding permitted source evidence exists. No sample numbers are inserted into live reports.
- Targets entered in the overview apply to that view only. Saved organization budgets continue to use BookLoQ budget controls. Exact-period budget coverage is required; POS totals are not compared against ledger budgets.
- Historical AR/AP aging is withheld because current paid balances cannot establish what was unpaid on a past date without payment-allocation history.
- The new comparison modes apply to the Executive Overview. Detailed retail screens retain their existing matched prior-period comparison; this release does not claim a universal YoY/budget comparison for every product or a new channel hierarchy where providers do not supply one.
- Broad drill-through leads to the authorized sales/BookLoQ source screens. It is not a new transaction-linkage relationship between POS sales and accounting journals.
- Large record sets fail closed or withhold the capped detail: 20,000 daily rows, 2,000 ledger accounts, 20,000 journal lines for daily classification/trends, and 5,000 grouped aging rows. Supplier expense detail shows up to 100 suppliers.
- Customer retention is observed cohort retention within source-scoped identities, not proof of full customer lifetime retention. Concentration uses identified purchase-basket revenue and excludes unidentified guests and standalone returns.
- AI receives existing consent- and permission-filtered aggregates, never raw uploaded documents or identities from these new projections. Explanations of likely drivers remain distinct from established causes.

## Verification

The focused 12-suite regression run passed 94 tests covering arithmetic, contra accounts, reversals, source coverage, missing data, inventory snapshots, customer identity, retail calculations, financial chart semantics, AI projection boundaries and interface rendering. TypeScript, lint and the production build are checked separately before publishing.

An isolated built-worker test passed the new executive endpoint with a fictional database: demonstration data stays excluded; live-path totals reconcile; a selected location cannot expose organization-wide financial totals; deactivating BookLoQ withholds ledger metrics; invalid dates return HTTP 400. No customer financial records were altered.

Browser inspection covered desktop feature arrows, mobile header visibility at 320 and 390 pixels, the working fictional order-size calculation, financial disclosure, keyboard chart values, reporting-period changes and per-view target variance. Browser reference: Syft Analytics, used for interaction inspiration, with no copied assets or copy.

## Release boundaries

This is a product and calculation update. It does not certify production backup restoration, TLS enforcement, pending third-party approvals, or all future provider integrations. Those retain their separately recorded status. Pricing, consent requirements, plan gates, public integration availability and the current brand remain in place.

## Method references

- IAS 7 cash flow categories: https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/
- BDC financial-ratio explanations: https://www.bdc.ca/en/articles-tools/money-finance/manage-finances/financial-ratios-what-are-how-use

These references informed terminology and conservative classification. They are not an accounting certification or a claim that these working reports constitute statutory statements.
