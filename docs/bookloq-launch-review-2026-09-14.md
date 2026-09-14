# BookLoQ launch review

The supplied BookLoQ research brief is a staged product specification, not evidence of completed functionality. This review preserves the existing application and records the remaining launch gates. It does not certify accounting accuracy or legal compliance.

## Implementation plan

1. Improve homepage demo-proof readability and preserve signup-free access.
2. Apply the supplied light, restrained glass dashboard reference to shared navigation, financial cards and charts. Keep tables opaque and text left aligned.
3. Use one server-calculated cash dataset for cards, charts and chart exports. Preserve currency, source-state, authorization and demonstration boundaries.
4. Test the accounting, cash and user-data paths supported today. Record unsupported workflows rather than presenting them as live features.
5. Publish verified changes, then inspect the real authenticated workspace when a user session is available.

## Findings and changes

- Hero proof labels were 10 to 11 px over photography. Increased them to 14 px with a pale, high-contrast backing.
- Cash activity was derived from a capped 1,000-row transaction page. The graph also used the browser date and 365 days, while one server summary used 366 days. Replaced that calculation with an uncapped server aggregate and exact shared reporting buckets.
- Live cash activity could mix pending, removed, demo or non-bank economic records. It now uses posted or modified cash-bank movements with matching approved Plaid item ownership, currency and data mode. Credit balances and POS sales are not treated as additional bank receipts. This is a cash movement report, not a formal statement of cash flows.
- The thirteen-week actual query netted opposite movements on the same day before measuring inflows and outflows. It now groups by date and direction, preserving gross movements.
- Forecast bars used absolute values. Replaced them with labelled forecast lines and a signed cash-movement chart. Missing opening evidence withholds the forecast. Chart tables and CSV use the plotted values.
- A category-rule validation error could occur after the transaction had already changed. Validation now precedes the atomic category/rule batch.
- The overview presented 12 equal-weight financial cards. It now prioritizes 4 and groups the remainder under More Financial Details.
- Privacy wording still described Gemini and repeated consent resets. Corrected it to the enabled OpenAI provider and the existing saved, versioned consent behaviour. No new consent is inferred from a browser setting.

- An open workspace could retain stale subscription controls. It now refreshes server entitlements when it becomes visible or focused and every 60 seconds while visible. Server authorization remains immediate on every request.
- Billing plan and add-on writes were separate. They now commit atomically, compare the observed subscription version, reject conflicting ownership and ignore older events. Interrupted processing can be retried after its lease expires.
- Customers with a delinquent existing subscription could initiate another checkout. They now use billing recovery. Members without billing authority receive owner guidance instead of a personal purchase path.
- Stripe's standard portal cannot update subscriptions with multiple products. Initial Vanteloq plus BookLoQ checkout is supported; later add-on changes are explicitly routed to the custom-plan inquiry pending a dedicated reviewed change flow.
- Mobile cash-plan rows escaped the page width. They now scroll inside their own labelled keyboard-accessible region. Zero outflows display as $0.00, never negative zero.

## Subscription access matrix

| Purchase | Locations | Users | Access |
|---|---:|---:|---|
| Starter | 1 | 3 | Core reporting and operating tools; no BookLoQ unless added. |
| Growth | 3 | 10 | Starter plus the catalogue's advanced sales, inventory and growth features. |
| Pro | 10 | 25 | Growth plus the catalogue's advanced forecasting, scenarios and reporting features. |
| BookLoQ add-on | Inherits base plan | Inherits base plan | BookLoQ is added independently to any active or trialing base plan. Financial permissions still apply. |

Past-due, unpaid, paused, incomplete and canceled subscriptions receive no paid workspace access under the current policy. A scheduled cancellation retains access while Stripe still reports an active subscription. Removing access does not delete the customer's ledger. Existing verified internal founder access is separately controlled and is not evidence that an ordinary subscriber has purchased a plan.

## Feature status matrix

Status describes source and available test evidence, not a production certification.

| Area | Status | Existing implementation and remaining gate |
|---|---|---|
| Public demo | Working | Fictional retail and BookLoQ scenarios use production calculation functions without an account. |
| Cash activity and 13-week planning | Working with source gates | Signed movements, exact reporting periods, current source rules and confirmed/expected separation. Live opening cash requires an approved, healthy bank source. |
| Journal validation and statement arithmetic | Implemented; native pilot required | Integer amounts, balanced-entry validation, reversals, period and role checks exist. Independent review, migration reconciliation and a pilot close are still required before replacing official books. |
| BookLoQ reports | Partial | Native posted-account P&L, balance sheet, trial balance and CSV exist. Complete external statements, formal cash-flow classification and all report drilldowns are not established. |
| QuickBooks Online | Sandbox / staging | OAuth, realm identity and scope checks exist. Production approval plus a complete read-only import, reconciled reports and recovery tests remain. A connected company is not proof that its books are imported. |
| Xero | Deferred | No complete production accounting adapter is established. |
| Plaid | Provider production gate | Sync, staging/promotion, pending state, item ownership and privacy deletion have implementation/tests. Approved production access and a customer-authorized live sync remain prerequisites for live banking. |
| POS and merchant payments | Per-provider authorization and review | Existing Lightspeed, Square, Shopify, Clover, Moneris and Stripe paths must be assessed by their edition and actual account. Supplement World uses R-Series. Square is a test source and must remain excluded from its live reporting. |
| Settlement reconciliation | Partial | Transaction-to-evidence matching exists. Complete group/split allocation, automatic versus manual payouts, disputes and clearing-account tie-outs remain separate acceptance work. Equal amounts do not establish a match. |
| CSV | Partial | Existing operational import is not a general-purpose reconciled bank-statement or official-book migration system. |
| Documents | Partial | Private originals and review/extraction states exist. Provider readiness, document duplicate detection, approved bill linkage and complete review-to-posting evidence remain gates. |
| Invoices and bills | Partial | Existing records, drafts, statuses and guarded operations remain. Partial-payment allocation, payment replay, credit/void handling and reminder lifecycle need a complete acceptance slice before broader claims. |
| Tasks and exceptions | Implemented in part | Existing review/action paths are retained. Every bill update/payment must be proven to update the same task before claiming fully automated accounting follow-up. |
| Inventory and retail intelligence | Implemented with coverage boundaries | Sales, basket, category, stock/expiry and purchasing functions use available source evidence. Cost coverage, historical valuation and customer identity constrain the metrics. Native inventory/GL tie-out and recipe costing are not established. |
| Vanteloq AI | Implemented with consent and permission gates | OpenAI receives bounded permitted summaries. Memory starts off; saved consent is checked by the server. It cannot post journals, pay, file or send business messages autonomously. Live provider availability requires current configuration/credits. |
| Tax and payroll | Review/import scope only | Tax calculations and working papers do not equal filing. Full GST/HST/provincial regimes, native payroll and remittance require separately validated scope and professional review. |
| Native migration / multi-entity / FX | Deferred | No official-book cutover, opening-balance plug, automatic consolidation or unreviewed currency conversion is authorized by the brief. |
| Subscription and custom plans | Server and interface lifecycle tested; hosted acceptance required | Verified catalogue selection, independent BookLoQ add-on, atomic synchronization, replay, cancellation, payment failure, recovery, role restrictions and record retention pass isolated tests. Open workspaces refresh entitlements on focus and every 60 seconds while visible. Stripe hosted checkout, webhook delivery, portal configuration and applicable tax setup still need a controlled provider test. Initial checkout supports the add-on. Later multi-product changes use the visible custom-plan inquiry path until a dedicated change flow is accepted. |
| Independent security scan | Blocked before start | Codex Security returned “Could not inspect local file” for `.sites-runtime/npm-cache/_cacache/content-v2/sha512/00/2f/fb2687c9bd91abae779635a12725e38b531f89946b7bb4d6b4c198913d3e0c635c267ca8eddbee8eda9daecf6fac92597c39966624c36a7a47bb90a6cd81`. No completed formal scan is claimed. Existing security regression tests are a separate check. |
| Backup restoration and legal review | Required evidence not established | A full isolated restoration, record-location assessment, retention/legal-hold process, accountant review and applicable legal review remain release gates. |

## Architecture decision record: connected review before native cutover

**Decision:** Preserve the current ledger and operational capabilities. Treat BookLoQ as a review and planning workspace while a customer's existing accounting system remains authoritative. A future native accounting mode needs explicit entity ownership, a cutover date, reconciled opening balances, preserved source history, independent review and a controlled close.

**Reasons:** OAuth authorization does not establish import completeness. POS economics, bank observations and posted journals describe different stages of an event. Summing them can count the same sale multiple times. Calculations and authorization remain deterministic server responsibilities; AI explains the permitted results.

**Boundaries:** No external posting, payment, tax filing, real email, production provider approval or official-book migration was performed by this UI/accuracy release. Charts use recorded periods; forecasts remain projections. Unsupported workflow states must stay explicit.

## Source checks

- [Plaid Transactions Sync](https://plaid.com/docs/transactions/sync-migration/) describes cursor-based added, modified and removed events. Authorization, staging and recovery remain necessary beyond a Connected badge.
- [Intuit webhook documentation](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks) was located, but the browser-readable page did not expose its implementation contract. Exact resource/recovery contracts still need confirmation before building the import slice.
- [CRA record location and retention](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/keeping-records/where-keep-your-records-long-request-permission-destroy-them-early.html), checked September 14, 2026: the general six-year retention rule has exceptions; electronically accessible foreign-hosted records are not automatically considered kept in Canada. This is federal CRA guidance, not a conclusion about every provincial or territorial obligation. Hosting and retention need review before treating BookLoQ as the sole official record store.

- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), checked September 14, 2026, describes asynchronous subscription status events and payment-related access updates.
- [Stripe customer portal limitations](https://docs.stripe.com/customer-management#limitations), checked September 14, 2026, states that subscriptions with multiple products cannot be updated in the standard portal. A request path is not an automatic prorated add-on-change implementation.

## Validation evidence

- Subscription catalogue, normalization, internal-access, navigation, selection and feature-routing checks: 36 passed.
- Full signed-webhook lifecycle in an isolated migrated database: passed. Covers base plan, add-on, duplicate/stale delivery, cancellation, payment failure/recovery, add-on failure rollback, concurrent delivery and financial-role denial. A deliberate database failure is expected test output, not a live incident.
- Concurrent location and employee creation tests confirmed that the base-plan capacity limits cannot be exceeded by simultaneous requests.
- The actual client subscription gate was exercised in a local fixture: Starter without BookLoQ, Starter plus BookLoQ, Pro without BookLoQ, past-due owner recovery, and an inactive employee workspace. Displayed access and user limits changed without reloading the page.
- Financial calculation, chart, AI consent/client, security and role tests were run separately. The full cash-report regression passed all 10 checks, including 1,004 source rows, source-state exclusions, exact period totals and atomic category-rule validation. The final focused finance/entitlement pass contained 38 passing checks. Type checking, lint and the production build passed. The build artifact validator confirmed the Worker entry, hosting manifest and asset paths.
- Visual QA covered the supplied 1536 x 1024 dashboard composition, 980px layout and 390 x 844 phone layout using fictional records. Homepage-to-demo navigation required no account; missing opening cash withheld the forecast. Onboarding required markers, single-column fields and inline validation were checked without submitting an account or accepting real legal terms.
- No real Stripe charge, customer subscription change, external email, production accounting cutover, tax filing or payment was performed in these tests.

## Launch decision

The public demo and an explicitly scoped, assisted analytics pilot can be evaluated independently of native accounting. Do not advertise BookLoQ as a completed QuickBooks replacement, complete bank reconciliation, automatic tax filing or an independently certified accounting product. Resolve the provider, workflow, restoration and review gates above before broadening the supported launch scope.
