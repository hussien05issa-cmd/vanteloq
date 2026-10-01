# Vanteloq v1.0 Origin: forecasting implementation record

Prepared 1 October 2026. This record covers the forecasting changes, not certification of the entire product. Production publication is recorded separately in the release handoff.

## Delivered workflows

1. Open **Forecasting** from the workspace navigation. Existing plan entitlements and user permissions govern access. Review a location's hours, the effective date of a changed operating pattern, historical completeness, closures and unusual dates. This records an assumption review; it never creates sales.
2. Choose seven or 28 days and transactions, recorded units or net sales. Reviewed history uses solid lines, future predictions use dashed lines, and calibrated ranges use translucent marks. The calendar classifies workload relative to an ordinary open day. Exact chart values are available in a keyboard-accessible table.
3. Save a personal view or pin the seven-day outlook to Overview. Issue a forecast to preserve its original inputs, source cutoff, issue time, model version, hash and result. Later changes to source records do not rewrite that result. Exports require the existing export entitlement and permission.
4. **Promotion** compares a manually entered baseline with a proposed promotion, including contribution after costs, displaced contribution and demand shifted from later weeks. It does not assume that a discount causes a particular sales uplift.
5. **Stock** projects dated receipts, reserved units, expiry, demand, achievable sales and unmet demand. Reorder suggestions respect pack sizes, minimums, lead time, cash and free storage headroom. **Capacity** converts explicit workload assumptions into aggregate staff-hours to review.
6. **Cash** reuses the authorized BookLoQ dated planning schedule. Optional forecast sales, settlement lag, collection delays, fees, tax, additional outflows and a cash buffer produce base, downside and upside scenarios. A daily calculation identifies intraweek shortages that weekly closing balances can hide.

The planning tools never place orders, launch offers, change shifts, spend advertising money or post journals. Sample records remain visibly fictional and separate from business records. Manual scenario results stay in the current session.

## Calculation contract

| Result | Definition and boundary |
| --- | --- |
| Daily transactions, units and net sales | Separate series from approved authoritative daily sales sources. Current partial activity is excluded from training. Net sales preserves signed returns and the existing sales-tax treatment. |
| Prediction | Seasonal-naive most recent comparable weekday, or mean of up to eight comparable weekdays, selected using earlier rolling origins. Each forecast weekday needs four comparable observations under the reviewed operating pattern. |
| Company total | Sum only when every included location has complete compatible values, currency and local planning dates. No inferred currency conversion. Location uncertainty limits are not added together. |
| Workload label | More than 20% above or below the recent ordinary-open-day average of transactions. This is a planning classification, not measured foot traffic or a statistical confidence score. |
| Promotion net sales | Scenario units × current price × (1 − additional discount). Amounts use integer cents at monetary boundaries. |
| Gross profit | Net sales − product costs. Missing product costs withhold profit. |
| Contribution | Gross profit − variable costs − additional advertising, staffing and other costs − displaced/deferred contribution. Missing relevant costs withhold the affected result. |
| Break-even | For one eligible product, calculate units required both to recover promotion costs alone and to preserve baseline contribution. Mixed-product or nonpositive-margin cases do not receive a spurious single-unit break-even. |
| Stock | Reserve existing stock first; apply dated arrivals before that day's demand; consume dated lots by earliest expiry. Expired lots are unusable from the stated expiry date. Demand must cover every planning date explicitly. |
| Staffing | max(open hours × minimum coverage, transactions ÷ transactions per staff-hour + additional task hours), rounded upward to one tenth of a staff-hour. This is not a shift roster or peak headcount. |
| Cash | Existing schedule once, with delayed collections replacing their original timing. Additional cash-sales share × eligible net sales, adjusted for explicit collected tax, processor fees and settlement lag. Confirmed purchasing capacity remains distinct from expected scenario cash. |

## Readiness and evaluation

- The most recent four weeks and latest expected trading day must have reviewed comparable records. Four weeks is an engineering minimum, not a reliability guarantee.
- A 28-day outlook additionally needs at least four evaluable 28-day origins. Reopening or changed hours can reduce usable history. Recorded activity on closed days requires review.
- Missing or partial dates never become zero. Explicitly reviewed zero days and closures are distinct. Changed records invalidate the affected completeness review.
- Disconnected, unapproved, overlapping or still-importing sources block affected forecasts. Location summaries in a different time zone or currency from the workspace remain blocked until reconciled.
- Rolling origins use chronological training and the actual seven- or 28-day horizon, preserving the omitted current-day gap. Model selection, range calibration and later range evaluation have purged horizon boundaries. Longer-horizon weekly origins still overlap within their evaluation segment, so error observations are not independent.
- Report daily MAE, total MAE, signed bias, seasonal-naive benchmark MAE and MASE where a nonzero seasonal scale exists. No MAPE-based accuracy percentage is advertised.
- Empirical 80% ranges use residual quantiles only with at least 20 calibration origins and later evaluation. Coverage and width are reported. Their nominal level does not guarantee future coverage.
- Historical validation uses current reviewed records, not reconstructed records as they were known at each past issue time. This limitation is explicit. Newly issued immutable snapshots establish the basis for future prospective evaluation.

Synthetic fixture results, checked 1 October 2026, are implementation checks only:

| Horizon | Selected method | Held-out origins | Daily transaction MAE | Seasonal benchmark MAE | Later empirical range coverage |
| --- | --- | ---: | ---: | ---: | --- |
| 7 days | Seasonal naive | 35 | 1.91 | 1.91 | 79.59%, seven later origins |
| 28 days | Comparable-day mean | 29 | 2.79 | 3.67 | 80.71%, five later origins |

These results are not measured customer forecast accuracy. No customer records were pooled or used as training data.

## Security, persistence and verification

Migration `0063_forecasting.sql` adds workspace/location assumptions, per-user preferences and immutable issued forecasts. Tenant and user foreign keys preserve lifecycle deletion; deleting the reviewing user does not prevent removal because the reviewer reference becomes null. Existing source records and account balances are unchanged.

The API requires existing authentication, MFA, active paid access or an authorized exception, the forecasting entitlement, revenue permission and sales permission. Location restrictions are applied before input aggregation. Additional finance, promotion, inventory and export tools have separate existing permission and feature checks. Saved runs are private to their creator and organization; access to their sources and locations is rechecked when opened or exported. Requests use same-origin enforcement, rate limits and safe CSV escaping.

Validation evidence:

- 41 focused unit tests passed for forecasting mathematics, intelligence regressions, cash flow and navigation entitlements.
- The isolated API workflow passed review gating, two-tenant separation, original snapshot retention after corrected records, safe export, source revocation, foreign-origin rejection and cancelled-subscription denial. An expanded role and preference check is included in the final release run.
- TypeScript checks and scoped ESLint passed. Production build validates the Worker export, Site project manifest and production asset paths.
- Actual UI components were inspected at desktop and 390-pixel mobile widths. Mobile document width equalled viewport width. Keyboard activation calculated 16 staff-hours for the reference case; editing the input hid the obsolete result and requested recalculation.
- Desktop screenshot: `output/forecasting/forecast-desktop.png` in the parent project workspace. It contains only fictional data.

## Remaining limits

Hourly demand, learned product/category forecasts, promotion causal estimates and weather inputs are not enabled. They require reliable timestamped source completeness, product availability, comparable history and horizon-specific validation. Manual product, promotion and staffing scenarios are available instead. Known holidays and promotions need explicit unusual-date review; no automatic uplift is applied.

Stock's current form handles one product, one expected delivery and one dated expiring lot per scenario. A flat owner-entered daily demand is explicit. Supplier lead-time variability is represented through changed scenario assumptions, not an inferred probability distribution. Reorder proposals can create a later surplus when a delayed delivery already exists; the UI requires review of expediting or rescheduling.

Cash does not extend seven- or 28-day sales estimates across the entire 13-week plan. Additional sale/invoice/payout overlap is controlled by an explicit owner review, not guessed matching. Tax remittances and additional obligations need dated supported inputs. No live provider payment is initiated.

Requests are bounded to 20 locations and 20,000 daily rows and fail clearly instead of silently truncating history. Forecast panels load lazily. The production build still reports pre-existing large application chunks; no new PageSpeed score is claimed by this change. Live customer forecasts still need their actual data-readiness review.

## Research and method choices

Sources checked during the implementation, 30 September to 1 October 2026:

- [Forecasting: Principles and Practice, simple methods](https://otexts.com/fpp3/simple-methods.html): transparent seasonal benchmarks.
- [Forecast accuracy](https://otexts.com/fpp3/accuracy.html): MAE, scaled errors and weaknesses of percentage errors around zero.
- [Time-series cross-validation](https://otexts.com/fpp3/tscv.html): chronological rolling origins at relevant horizons.
- [Prediction intervals](https://otexts.com/fpp3/prediction-intervals.html) and [distributional accuracy](https://otexts.com/fpp3/distaccuracy.html): evaluate uncertainty rather than adding arbitrary percentages.
- [Count forecasting](https://otexts.com/fpp3/counts.html): respect count domains and sparse observations.
- [Exponential smoothing](https://otexts.com/fpp3/expsmooth.html), [regression](https://otexts.com/fpp3/forecasting-regression.html) and [hierarchical forecasting](https://otexts.com/fpp3/hierarchical.html): evaluated as future candidates; not enabled without covariate availability, leakage controls and comparative evidence.
- [Stripe payout documentation](https://docs.stripe.com/payouts): settlement timing is separate from sale recognition and depends on provider settings. Current scenarios require an explicit lag rather than asserting universal timing.

## Follow-on work requested 1 October 2026

Complete sequentially after this release:

1. AI conversation quality, controlled personalization, source presentation, streaming, attachments and history, using the full user brief `b663e904-907f-41e5-8060-fdb168ba0f9b`.
2. Three-plan inventory, pricing research, cost scenarios, complete feature matrix and purchase-to-access checks, using `7d647f85-8e96-43c1-a204-f799637de619`. Present proposed prices and any migration for owner review before changing live prices or existing subscribers.
3. Final mathematics, accounting, security, bug, performance and legal/provider consistency review, using `edf43e73-2ec8-4aa8-8da1-c42e8eefd153`. Keep findings and evidence separate from external approval or certification.
