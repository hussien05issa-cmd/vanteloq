# Retail intelligence

The authenticated retail workspace and public fictional demo use `domain/retail-intelligence.ts`. Calculations are deterministic. OpenAI interprets an allowlisted summary after consent; it does not calculate the underlying report or change provider records.

## Evidence contract

- Money enters as signed integer cents; quantities enter as thousandths of a unit. Unsafe integer sums fail explicitly.
- Receipt and product identities include provider and connection. Stock velocity also includes the exact source outlet and SKU. Conflicting duplicates are rejected.
- R-Series detail uses the latest parent sale status, completion timestamp and outlet. Open, voided and unmatched parent records are excluded, including a sale whose earlier version was completed. Line creation time cannot substitute for completion time.
- The server applies organization, membership, location, entitlement, permission and source-authority checks before returning data. Staged records and nonproduction Moneris records do not contribute. A selected source that is syncing cannot silently fall back to another account.
- Dates and hours use the workspace time zone. Offset timestamps are converted as instants; provider timestamps without an offset are local business times.
- A purchase basket contains positive-quantity lines. Returns and zero-quantity adjustments remain in net revenue but are separate in the revenue bridge. Fully returned items on the same receipt leave co-purchase sets.
- An absent record is not a verified zero or a closed trading day. Comparisons describe recorded activity and require matching source outlets, equal calendar periods and purchase records on both sides. They do not prove complete sync coverage or causes.
- Legacy zero line costs have no proof of being verified free products and are treated as unknown. Profit is withheld when any included line lacks cost evidence. Gross profit excludes overhead and is not net business profit.

## Measures and interpretation

| Measure | Definition / requirement |
|---|---|
| Net revenue | Sum of signed line net revenue, including returns and adjustments. |
| Items per basket | Positive purchased units / distinct purchase baskets. |
| Average purchase basket | Revenue on positive-quantity lines / purchase baskets. |
| Discount dependency | Share of purchase baskets containing a positive discount. |
| Discount rate | Purchase discounts / purchase revenue before discounts. |
| Revenue growth | Current minus prior net revenue, divided by a positive prior net revenue. Unsupported baselines remain unavailable. |
| Why bridge | Symmetric count × basket-value decomposition, plus the change in returns/adjustments. BigInt rational arithmetic rounds the count effect; the basket-value residual reconciles the total exactly to cents. |
| Category contribution | Current minus prior category net revenue. Product classification is the current provider or reviewed classification, not a reconstructed historical taxonomy. |
| Product sales score | 40% revenue percentile + 30% purchased-unit percentile + 30% full-price share. Ties share a rank. Requires at least ten baskets and three selling products. A relative merchandising heuristic, not a forecast or industry benchmark. |
| Observed repeat rate | Identified buyers with at least two purchase baskets in the selected period / identified buyers. Product repeat uses distinct baskets containing that product. Guests remain unknown. This is not cohort retention. |
| Basket support | Paired baskets / baskets in the same source account. |
| Basket confidence | Paired baskets / baskets containing the first item. Direction matters. |
| Basket lift | Confidence / the second item's source basket frequency. At least three paired baskets are required. Association does not prove incremental demand. |
| Loyalty activity | Basket activity before or after a verified enrollment date. Unknown membership is separate. Cohort differences do not prove a program effect. Rewards and redemption integration is separate. |
| Inventory turnover | Period recorded COGS / mean of reviewed opening and closing inventory cost. |
| Days on hand | Period days / positive inventory turnover. Distinct from forward stock cover. |
| Sell-through | Net units sold / reviewed opening units plus receipts. If sales exceed these units, reconcile movements before using the result. Other systems may use a different sell-through definition. |
| Forward stock cover | Current on-hand units / positive net daily sales velocity in the selected period. Requires a period ending today and stock no older than 36 hours. |
| Reorder review | Target 21 days of velocity or the recorded reorder point, whichever is higher, less on-hand stock; minimum zero. This is an explicit planning assumption without lead times, lost demand or seasonality. |
| Overstock review | Current stock exceeds 90 days of positive velocity or the reorder point, whichever is higher. A review signal, not a disposal instruction. |
| Expiry watch | Recorded remaining lots expiring within 30 days, including overdue lots. Recorded cost at risk is not a waste forecast. Undated stock cannot be assessed. |
| Hourly demand | Recorded net revenue grouped into local hours. Negative values display below zero. Unobserved hours remain unknown. |
| Sales per paid labour hour | Recorded sales / reviewed paid hours, requiring complete evidence for every observed outlet. Multiple feeds at one physical location share one hours dataset. |
| Average paid rate | Recorded wages / paid hours. Not an employee performance ranking. |
| Staff-attributed basket value | Reviewed attributed sales / attributed transactions. Both inputs must be provided together. |
| Recorded-day anomaly | Difference from the median of the previous four to eight same-weekday observations exceeds 3.5 × 1.4826 × median absolute deviation. A zero spread, changed scope or insufficient baseline produces no flag. Context and coverage still require review. |

## Reviewed inputs

Evidence settings support stock period totals, labour, verified loyalty enrollment and product classifications. CSV files use explicit headers, at most 200 rows and 100 KB. References must resolve inside the selected approved account. Catalogue entries can use an exact product reference or a unique SKU; ambiguous or duplicate aliases fail.

Each source/outlet/kind/period is a single versioned dataset. Saving replaces that dataset atomically after review. `expectedVersion` prevents stale or simultaneous edits from silently overwriting another person's work. Deletion checks the same version. Provider data is unchanged; content-free audit events record the action. Source-wide classification and loyalty editing require organization-wide access plus the appropriate permissions.

## Scale and boundaries

Each detailed request permits at most 366 days, 30 source outlets, 50,000 current/prior line records and 5,000 stock/lot records. Oversized selections fail with a request to narrow scope rather than return sampled totals. Pair analysis is separately withheld for receipts above 100 distinct items or more than 100,000 distinct candidate pairs. Displayed product, pair and inventory summaries may be bounded excerpts; the full selection supplies the aggregate math.

The AI projection excludes customer references, employee identities, SKUs, raw receipt IDs and connection IDs. Cost, payroll and customer aggregates follow permissions. Explicit retail questions retain their selected period and location. Saved history remains per user and workspace, and is reused only when its evidence/permission fingerprint matches. Turning memory off prevents chat persistence; deletion removes owned conversations and messages. App help attaches no workspace evidence.

See `/api/v1/openapi` for the retail report and reviewed-input API contracts. Deterministic tests cover arithmetic, duplicate handling, source/outlet separation, returns, fractional quantities, missing costs, DST, stock formulas, paid-hour completeness, loyalty, anomalies and a 10,000-receipt selection. Worker/database tests cover source approval, authorization, concurrent edits, consent, provider projection and chat deletion. These checks do not replace production load, restore, independent penetration or cross-browser acceptance testing.

## Reference definitions

- [IBM association-rule support and confidence](https://www.ibm.com/docs/en/ias?topic=rules-usage)
- [IBM association-rule lift](https://www.ibm.com/docs/en/db2/11.1.0?topic=SSEPGG_11.1.0%2Fcom.ibm.im.model.doc%2Fc_lift_in_an_association_rule.htm)
- [Shopify inventory formulas](https://www.shopify.com/blog/inventory-formulas)
- [Shopify inventory report definitions](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/inventory-reports)

The implemented definitions above govern Vanteloq. Similar names across providers do not guarantee identical denominators or data coverage.
