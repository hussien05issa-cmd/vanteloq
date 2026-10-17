# Vanteloq v1.0 Origin: decision workflow refinement

This increment follows release 356's historical-cost, statement-cash, supplier-bill, purchasing-obligation, outcome and SQL/query corrections. It changes no prices, entitlements, provider availability or database schema. The canonical handover remains `docs/Vanteloq-v1.0-Origin.md` and its existing Google Doc.

## Implemented experience

- Owner briefings present three compact priorities, all eligible critical findings, recorded values, source dates including year and explicit coverage. Critical findings open the dashboard briefing automatically. Other detail stays expandable. Updates, stale records and connection failures do not become an all-clear. Permissions control task, AI and outcome actions. Reporting dates follow supported drilldowns and prepared tasks.
- Onboarding step 5 offers an optional own-data insight from the existing daily-summary CSV format. It preserves exact cents and physical source rows, checks a selected location and requires currency/timezone confirmation. A comparison needs all 14 completed business dates; absent discounts remain unknown. The 256 KiB preview stays in browser memory and is excluded from saved drafts. It never posts accounts or sends records to AI. Authentication, billing, legal acceptance and reviewed import gates remain in place.
- BookLoQ Collections has sourced overdue-invoice and seven-day bill cards. They use the complete authorised current document selection independently of search and pagination. Verified empty selections support zero. Missing dates, invalid/duplicate balances and currency mismatches withhold decisions. Bill review opens the matching seven-day filter; missing inputs open all relevant documents. Amounts are document balances, not bank cash or payment approval.
- Reviewed Food Operations periods expose actual depletion versus theoretical use and logged waste beside the saved period. The calculation retains its historical cutoff, source and version. Unexplained variance does not prove theft or a cause.
- Reviewed settlement workflows expose the difference between the recorded deposit and explicitly mapped signed components, retaining the payout date and version. This does not recognise another sale or post a journal.
- Shared decision cards separate recorded calculations, estimates and missing inputs. Formula, period, limitations and full source counts are expandable. Reference previews are bounded without dropping rows from calculations. Pending actions prevent duplicates; failures retain evidence and allow retry. Controls use 44 px targets, keyboard disclosures, restrained motion and readable light/dark surfaces.
- Reorder proposals cannot recommend an order below supplier minimum spend after cash/storage constraints. All critical briefing signals survive the normal priority cap.
- Inventory lifecycle reads apply authorised locations before the 1,001-record sentinel check. A dataset exceeding the 1,000-record display limit is explicitly partial. Its totals become Not determined; incomplete lots cannot produce depletion forecasts or FEFO ranking. Complete POS and lot datasets retain their values independently. Recorded lot dates/quantities and expired-lot review advice remain inspectable.
- The new CSV preview supports recognised currencies with two fractional digits, matching its existing cents contract. Unsupported currencies, including JPY and KWD, show a clear preview limitation while setup can continue. No conversion or change to financial storage is inferred.

## Calculation framework and honest scope

Ten adapters cover expiry exposure, immediate order affordability, product margin movement, reorder quantity, overdue invoices, upcoming bills, payout differences, food variance, vehicle holding and campaign-budget evidence. Four new cards are placed in customer screens: invoices, bills, food variance and payout differences.

Unused adapters are not additional published features. Existing reorder and dealership scenarios retain their own assumptions and permissions. An expiry card needs complete dated lots and in-stock demand coverage; a margin card needs comparable provider periods and historical costs. Marketing conversion events are not deduplicated qualified leads or contribution return. Campaign-budget recommendations remain unavailable without those links. Do not advertise unused adapters as available.

## Research applied

[W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) informed readable evidence surfaces. [W3C disclosure patterns](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) informed keyboard access and progressive disclosure. [Square reporting documentation](https://squareup.com/help/ca/en/article/5072-summaries-and-reports-from-the-online-dashboard) informed explicit scope and dates. [Stripe reconciliation documentation](https://docs.stripe.com/reports/payout-reconciliation) informed the distinction between sales, settlements and bank deposits. This is focused verification, not whole-site accessibility certification.

## Competitive position

The product direction is the owner decision loop: source records → recorded change → reviewed next step → assigned work → outcome review. Historical costs, inventory constraints, dated commitments and sector-specific evidence make that loop useful across sales and money. These are implemented engineering strengths, not proof that Vanteloq is faster, more accurate or categorically better than competitors. Measure time to first supported insight, completed evidence-to-action reviews, repeat usage and validated discrepancies before making comparative outcome claims.

## Acceptance limits

Deployment and isolated tests do not verify source completeness, public provider distribution, unattended pulls, populated database/private-file restoration or hosted capacity. Customer accounting acceptance and signed-in production verification remain separate. AI permissions, provider consent and consequential financial approvals are preserved. No production reset, live financial mutation or new provider grant is introduced.

The final receipt records tested source, version, build, live readback and GitHub branch separately.
