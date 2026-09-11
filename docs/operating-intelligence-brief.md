# Vanteloq: Operating Intelligence Engineering Brief

Prepared September 7, 2026. Product owner: LexEdge Consulting.

This is a working product and engineering specification, not a claim that every item below is already implemented. It covers the public Vanteloq application and BookLoQ. The private company console, customer authentication, subscriptions and access grants are outside the change scope.

## Working implementation prompt

Act as the product engineer, financial-systems engineer and product designer for Vanteloq. Make the existing product more useful for a business owner without replacing its design system or weakening its permissions. Preserve working features and customer data. Inspect the current source, provider documentation and actual visible states before changing them.

Prioritize an accurate daily operating picture: net sales, gross profit when cost is verified, transaction value, transaction count and a comparison with the same weekday through the same business-local time. Make the hourly chart readable, keyboard-accessible and inspectable down to exact cents. Give current net sales a blue line, comparable net sales a distinct secondary line, and gross profit a dotted teal line. Offer hourly and running-total views. Never draw future hours as if no sales happened in them.

Use the newest approved source version of each record. Keep tenants, source accounts, locations, currencies and reporting periods separate. Replayed imports must not double count. Missing records are not zero, gross profit is not net profit, and bank cash is not automatically available to spend. State source freshness and calculation limits next to the result. Never advertise a connector as operational merely because its button exists.

Build in small, reversible releases. Add tests for normal, empty, partial, refund, loss, timezone, permission and recovery cases. Verify the actual UI at phone, tablet and desktop widths. Use functional business diagrams and real product interfaces, not ornamental generated objects. Preserve consistent type, number alignment, spacing, accessible controls and existing branding. Do not use leading zeroes for decorative sequence numbers.

Keep human approval for accounting entries, orders, payroll, payments and consequential changes. Separate local test fixtures from customer records. Publish only the verified release after approval, then perform production smoke checks. Report evidence, limitations and remaining blockers honestly. Do not promise zero bugs or superiority to every competitor.

## First release: implemented scope

- Read-only R-Series intraday calculation with a common source synchronization cutoff, organization timezone and latest-version selection.
- Same-weekday, same-time comparison when every contributing selected account has observed history. No comparative percentage when the denominator is zero or unknown. Comparisons are withheld near daylight-saving changes rather than presenting unequal periods as equivalent.
- Actual losses and signed refund reversals. Missing staged product costs withhold gross profit. The legacy staging format cannot distinguish a legitimate zero cost from an absent cost; the read path conservatively withholds profit for nonzero sales with zero staged cost.
- Hourly and running-total charts, separate comparison line, dotted gross profit, exact-value selector and expandable accessible data table.
- Approved-source timestamp and a daily-summary fallback when timestamped history is stale, unsupported or exceeds the bounded review size. A daily CSV is not turned into invented hourly sales.
- Latest-request-only dashboard refresh, cancellation when the location or filter changes, one-minute refresh while visible, and refresh on return to the tab. Successful daily CSV imports already trigger refresh. These are dashboard refreshes, not a guarantee that every provider has delivered new records.
- Cash-minus-payables visual with explicit negative shortfalls and a warning that other obligations and timing are excluded.
- Homepage resource diagrams with reserved label space, replacing the floating SKU, percent and VIEW labels.

No database schema, provider credential, authentication, entitlement or billing changes are required by this release.

## Metric contract

| Measure | Definition and authoritative input | Decision and limitation |
| --- | --- | --- |
| Net sales | Completed source totals less sales tax, including signed returns, in integer minor currency units | Compare sales pace. Provider adapters must resolve shipping, gratuities, gift-card liabilities and discounts consistently before records are approved. |
| Gross profit | Net sales less verified signed cost of goods sold | Prioritize profitable sales, not revenue alone. Unknown cost produces unavailable profit, not an assumed 100% margin. This excludes operating expenses. |
| Gross margin | Gross profit divided by positive net sales | Monitor product economics. A zero or negative denominator is not a useful margin rate. |
| Average transaction value | Net sales divided by the count of completed non-refund sales | Diagnose basket value. Refunds affect net sales; refund-only events do not inflate the sale count. A refund-heavy day can produce a negative net average. |
| Transactions | Completed non-refund source sales | Diagnose traffic/conversion within the available sales data. This does not measure store footfall or website conversion. |
| Cash less payables | Recorded operating cash minus recorded accounts payable | A balance check only. Payroll, tax, purchases, reserves and payment dates must be included separately before a purchasing-capacity decision. |
| Source freshness | Time of approved synchronization, distinct from the latest sale timestamp | Decide whether the result is current enough to use. A recent page refresh does not make stale source data current. |

The primary daily outcomes are net sales and gross profit. Transaction count and transaction value explain sales movement; verified cost coverage guards against misleading profit. The primary cash decision is sustainable purchasing capacity, guarded by complete obligations and a verified opening balance. Do not invent universal sales, margin or growth targets. Establish each customer's baseline and review it with the owner.

## Next releases: not represented as complete

### Connector reliability

Move additional providers onto the same tested timestamped-sales contract only after their source definitions are reconciled. For each provider, prove authorization, exact scopes, source selection, initial import, signed webhook verification, replay handling, out-of-order recovery, pagination, rate-limit recovery, token expiry, disconnection and reauthorization. Test at least one approved production account with the owner's permission. Show separate states for unavailable, sandbox, configured, authorized, syncing, review required, active and stale.

Webhooks alone are not an assurance of complete data. Square documents duplicate and unordered notifications, retry limits and a recovery API. The application should deduplicate and reconcile missed events rather than promise instantaneous delivery. [Square webhook documentation](https://developer.squareup.com/docs/webhooks/overview).

Shopify requires verification against the raw delivery body and provides identifiers for duplicate handling. Preserve those checks before queueing or promoting facts. [Shopify delivery verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).

Lightspeed X-Series documents webhook limitations and the need to recover through the API. X-Series guidance must not be assumed to apply identically to R-Series. [Lightspeed X-Series webhooks](https://x-series-api.lightspeedhq.com/v2026.04/docs/webhooks).

The current R-Series staging review is bounded to 20,000 rows before falling back to daily summaries. For larger accounts, introduce indexed, incrementally maintained approved daily/hourly facts with an explicit coverage watermark. Benchmark actual query plans, record volume and Worker CPU before widening the limit. Merely increasing the limit is not a scaling strategy.

### Better diagnosis, with evidence

Prioritize price, volume and product-mix explanations; margin leakage by product; repeat-customer contribution; stockout-adjusted sales velocity; inventory turnover; and gross-margin return on average inventory. These require consistent item quantities, historical costs and coverage. Do not substitute transaction count for units or estimate demand from stockout periods without showing the assumption.

Each opportunity should include the source period, comparison, expected mechanism, confidence, missing inputs, a bounded estimate, an owner and a reversible next action. Do not sum overlapping opportunities. Compare forecasts with a simple seasonal baseline using out-of-sample errors before describing them as an improvement.

### BookLoQ and reports

Keep posted accounting records distinct from POS analytics. Strengthen the path from document to review, balanced journal, reconciliation and reporting. Preserve immutable posted entries, controlled reversals, period locks, document lineage and exact permission boundaries. Tie the trial balance, profit and loss, balance sheet and cash-flow statements together with reconciliation tests.

Gross profit and operating profit must stay distinct. Direct product costs belong in COGS; operating overhead is not silently deducted from the gross-profit line. [Intuit's COGS explanation](https://quickbooks.intuit.com/r/bookkeeping/cost-of-goods-sold/).

A useful cash forecast distinguishes actual bank movements, confirmed obligations and expected receipts, with scenarios and assumptions. Preserve the existing 13-week cash-flow rules, including currency and commitment blocks. Do not imply that the new cash-minus-payables visual is a full forecast. [Xero cash-flow product reference](https://www.xero.com/us/accounting-software/analytics/cash-flow/).

QuickBooks authorization is not the same as a complete accounting synchronization. Xero, payroll-provider execution and provider approvals require their own acceptance evidence before launch claims change. DoorDash and Uber Eats should remain marked coming soon until their approved integration paths exist.

### Design and conversion

Continue using the existing navy, blue and restrained teal system. Put the key value, primary action and source limitation first. Use tabular numbers, plain labels, consistent control sizes and visible focus states. Avoid animated status decoration. Test long business names, large currency amounts, empty accounts, role-limited views, keyboard inspection, narrow screens and zoomed text.

For the landing page, measure the path from visit to account creation, verified email, business setup and first useful approved report. Do not optimize clicks by concealing required steps, payment terms or integration limitations. The KPI target is successful activation and continued use, not decorative engagement alone.

## Release evidence and remaining acceptance gates

The verification record for this working release must distinguish pure-math tests, isolated API tests, browser tests using synthetic fixtures, and live production evidence. Synthetic charts prove rendering and interaction; they do not prove that a customer's POS has synchronized correctly.

Required before broad claims: a reconciled authorized production sale and refund; provider-specific freshness measurements; multi-location/source reconciliation at representative volume; failure and retry recovery; an accountant-reviewed accounting close; and a documented rollback. Benchmark against professional products on concrete tasks and error rates. No defensible process can honestly guarantee zero bugs.

The local machine has very limited remaining storage. Keep build and API test runs sequential, and do not delete additional personal files or unrelated projects to conceal that infrastructure limit.

## Verification record: September 7, 2026

This release is implemented locally and has not been published. The existing live deployment and private console remain unchanged.

153 targeted tests passed across the following groups. This is not a claim that the complete repository test suite or every production integration was exercised.

| Verification group | Passing tests |
| --- | ---: |
| Intraday mathematics and shared workspace presentation | 27 |
| Homepage presentation | 4 |
| Product experience | 11 |
| Lightspeed adapter and live-sales calculations | 20 |
| BookLoQ, reordering, purchasing and 13-week cash rules | 33 |
| Release security checks | 7 |
| Isolated API flows, source authority and access boundaries | 8 |
| Rendered homepage quality and SEO | 18 |
| Authentication, recovery, entitlements and internal access | 25 |

The final production build, lint, TypeScript checks, artifact validation and whitespace checks passed. The build still reports JavaScript chunks above 500 kB. Bundle reduction and representative-volume query profiling remain follow-up work, not completed performance claims.

Browser verification covered the shared financial components at 320, 390, 768 and 1440 CSS pixels, and the homepage at 320, 390, 1024 and 1280 CSS pixels. The tested pages did not overflow horizontally; financial tables and plots retain their own scroll regions. Verified hourly/running-total switching, exact record selection, keyboard activation, the chart data table, missing-cost and empty states, signed cash shortfalls, article navigation and reserved graphic-label space. No errors were recorded in the updated local homepage browser log.

The financial browser preview uses clearly labelled synthetic records and does not read or modify live customer accounts. API tests use isolated local databases. An initial restricted test run could not bind a loopback port; the same eight API tests passed after the local-port permission was granted. No production security control was bypassed.

The owner must complete authentication privately before an authenticated production smoke test. Public deployment is now authorized; a real POS reconciliation remains outstanding. Do not mark the wider roadmap complete on the strength of this first release.

## Branding and product-preview follow-up

The September 7 follow-up replaces the approximate Google and Meta marks with local brand assets, makes Gemini's provider label and submit states readable, and adds an explicit question label and consent guard for both click and Enter submission. The public platform section now reuses the actual sales and cash chart components with clearly labelled fictional records. It never reads a customer session or API. The chart data table also overrides an inherited sticky-header offset that caused overlapping rows on narrow screens.

Five new focused tests passed for the brand assets, consent and question guards, public-preview isolation and colour contrast. The existing 12 intraday calculation tests and seven release-security checks passed again. Browser checks covered desktop, tablet and phone layouts, consent enforcement, chart selection, hourly and running totals, unavailable costs and negative cash shortfalls.

The final local packaging attempt was blocked by insufficient disk space. A subsequent attempt found that the shared dependency directory no longer contained the declared maplibre-gl and pdf-lib packages. Lint passed; the subsequent TypeScript errors were missing declarations for those two packages. The earlier successful build record above predates this environment failure and must not be presented as a successful final follow-up build. The hosting service's remote-build fallback will be used if it can rebuild the exact locked source. Deployment must be confirmed separately, and authenticated integration acceptance remains outside these synthetic UI checks.
