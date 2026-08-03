# Product capability audit

This matrix prevents a visible Vanteloq surface from being mistaken for an implemented data capability.

| Product area | Current implementation | Honest boundary / next wiring |
|---|---|---|
| Executive dashboard | Working with verified daily summaries; source freshness, period metrics, trend, stress list, prioritized insights | YTD, targets, budget, fixed operating expenses, taxes, full cash forecast, and location filters require additional facts |
| POS and commerce | Provider catalog and adapter security contract; buttons disabled | No provider authorization, token, webhook, sync, payout, or reconciliation exists yet |
| Financial command centre | Gross profit, margin, contribution after labour, latest imported balances, scenario planner, plus BookLoQ ledger-derived P&L, balance sheet, trial balance, cash, AP/AR, tax working value, and certainty-separated cash forecast | Daily operating summaries and BookLoQ are separate evidence layers until live POS/bank adapters map source records into the ledger |
| BookLoQ accounting | Working tenant ledger, chart, periods, balanced journals, linked reversals, unified transaction feed, bank/reconciliation records, bills/invoices, contacts, Canadian tax working values, budgets, month-end, attention workflow, report CSV, audit, and deterministic assistant | Demo data is labelled; live bank/POS/payroll/OCR/payment/filing/accountant-invite adapters, PDF/XLSX generation, multi-currency remeasurement, full inventory subledger, asset schedules, and production jurisdiction content remain disabled or visibly limited |
| Inventory | Latest imported aggregate inventory value and complete SKU capability contract | On-hand, stockout, expiry, shrinkage, turnover, reorder, PO, supplier lead time, and cash-aware quantities require SKU facts |
| Marketing | Metric/source/action contract | No ad, code, campaign, attribution, CAC, ROAS, cohort, or repeat-purchase feed exists |
| Customer retention | Metric/source/action contract | No customer identity, consent, loyalty, cohort, churn, replenishment, referral, or messaging automation exists |
| Labour and team | Imported daily labour rate, period pressure insight, contextual action guidance | No schedules, time clock, hourly traffic, employee roles, attendance, training, or individual performance records exist |
| Daily operations | Persistent tenant-owned Action Centre with priority, assignee, deadline, status, source, and expected impact | Checklists, cash counts, receiving, incidents, maintenance, photos, calendar, and escalation rules require their own records |
| Suppliers and purchasing | Metric/source/action contract | No supplier, invoice, PO, receiving, fill-rate, lead-time, credit, or price-history facts exist |
| Multi-location | Date/location uniqueness exists in the daily model | Current command centre consolidates rows; location comparison, transfers, rankings, and regional benchmarking are not implemented |
| Forecasting | Working formula-transparent scenario planner | It is a user-controlled scenario, not a statistical forecast; seasonality and uncertainty models require more history and dimensions |
| Alerts | Working ranking of supported aggregate exceptions and action conversion | Scheduled/background delivery, custom thresholds, notification channels, and richer alert types require queues and their source facts |
| Advisor | Working evidence-bound answers for supported sales, margin, and labour questions | It is deterministic, not a general AI agent; unsupported product/customer/campaign questions return missing sources |
| Reports | Working owner brief from verified aggregate facts | Downloadable daily/weekly/monthly packs, P&L, cash flow, tax, supplier, inventory, and accountant packages require deeper records |
| Industry modules | Visible module catalog and isolation principle | Specialized formulas remain disabled until each industry data model and source adapter is tested |
| Owner/manager/employee/accountant modes | Server roles and route authorization vocabulary exist | Invitation, role-management UI, field-level views, MFA, recent reauthentication, and privileged admin controls remain gated |
| Business memory | Working event/decision records with pre/post measurement when history is sufficient | Broader metric attribution and causal analysis require additional dimensions and controls |
| Action-first intelligence | Working insight evidence, confidence, missing-information list, task linkage, owner/deadline/status/expected impact | Automatic result-after-action comparison is only implemented for recorded business events, not every task type |

## Rule for future modules

A module is not “implemented” when it has a card, route, table, mock values, or a disabled control. It becomes implemented only when its source contract, validation, tenant isolation, calculation, uncertainty/limitations, action path, failure state, migration, and tests are complete.
