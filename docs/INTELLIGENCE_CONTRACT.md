# Vanteloq intelligence contract

Vanteloq must answer four questions: what happened, why, what needs attention, and what to do next. It must do so without treating inference as fact.

## Output contract

Every prioritized insight includes:

- severity: critical, attention, opportunity, or informational;
- what happened: a reproducible calculation from tenant-owned records;
- probable cause: a supported decomposition or a clear statement that the cause is not identifiable;
- financial impact: a direct difference or explicitly labeled estimate;
- recommended action: a bounded next step that respects missing context;
- confidence: high, medium, or low;
- evidence: the calculations and comparisons used;
- missing information: dimensions that could materially change the answer;
- suggested task: title, detail, priority, expected impact, and source reference.

## Current metric definitions

| Metric | Definition |
|---|---|
| Net sales | Sum of imported `net_sales_cents` |
| Gross profit | Net sales minus imported cost of goods |
| Gross margin | Gross profit divided by net sales |
| Contribution after labour | Gross profit minus imported labour cost |
| Average transaction | Net sales divided by transaction count |
| Units per transaction | Units sold divided by transaction count |
| Labour rate | Labour cost divided by net sales |
| Discount rate | Discounts divided by gross sales |
| Current period | Up to 30 calendar days ending on the latest verified business date |
| Previous period | The preceding 30 calendar days |

Contribution after labour is not labeled net operating profit because rent, tax, debt, overhead, depreciation, spoilage, shipping, and other operating expenses may be missing.

## Exception thresholds

- Sales trend: absolute period change of at least 5% with at least seven current and seven previous daily records.
- Margin trend: absolute change of at least one percentage point with sufficient history.
- Labour pressure: labour rate increases by at least two percentage points with sufficient history.
- Stable output: no configured threshold is crossed; this does not prove that no lower-level product, customer, supplier, or campaign issue exists.

## Cause model

The first sales cause model decomposes change into transaction-volume effect and average-transaction effect. The larger absolute modeled effect is described as the leading supported factor. Product mix, traffic, promotion, customer, employee, channel, weather, competition, or supplier explanations are not asserted without their source dimensions.

Margin explanations may name rising discounts as a supported contributor. Otherwise the output explicitly requests SKU cost, supplier, and promotion data before recommending pricing or assortment changes.

## Business-memory measurement

An event is measurable only when at least seven verified daily records exist in both the 14-day pre-event and 14-day post-event windows. The result compares average daily net sales and is labeled as an association, not proof that the event caused the change.

## Data freshness and quality

- current: latest business date is no more than one day old;
- aging: two to seven days old;
- stale: more than seven days old;
- missing: no daily source exists.

Data-quality status is blocked with no records, limited without a usable comparison window, and usable once the current aggregate engine has enough history. “Usable” does not imply that missing line-item dimensions are available.
