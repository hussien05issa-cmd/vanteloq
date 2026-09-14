# Product brief: implementation and gap audit

Reviewed against the user-supplied senior product design and engineering brief, September 13, 2026. Baseline: live release 211. This is a source and workflow audit, not certification of every live provider, financial result, device or legal obligation.

## Preserve and extend

The application already contains the main platform. Keep the existing framework, authentication, subscription catalogue, data authorization, accounting ledger, integrations, retail calculations, unified AI and recent homepage journey. Add missing capabilities to those modules rather than building a second application or duplicating data stores.

The homepage already demonstrates Data → Insight → Diagnosis → Action with fictional, labeled records and production calculation functions. Its visible provider directory, navigation, plan selection, BookLoQ logo, AI identity and consent-gated analytics were completed in the previous release. No extra provider carousel, second chatbot, new pricing or unsupported free trial is introduced by this brief.

## Changes in this implementation

1. Bring the existing operating decision queue into an **Opportunities** view under Intelligence, beside Retail analysis. Replace the repeated queue and expanded cards with one searchable, filterable list and evidence panel. Preserve the existing decision engine and authorization boundary.
2. Include dates, evidence, limitations and the next step when creating an action. AI questions and the linked report carry the same reporting period and location. Actions and AI affordances follow the existing permission and feature checks.
3. Withhold daily-summary period comparisons unless every observed location has records throughout both equal periods. Reuse a shared period-coverage check in the decision engine and AI KPI calculation. Keep recorded totals available. Explicitly identify missing imports or closures as unresolved; do not invent zero-sales days.
4. Prevent recent gaps from entering a sales outlook and prevent older gaps from silently entering its weekday baseline. Preserve negative modeled gross profit.
5. Correct percentage-point labels and remove causal or recoverable-revenue claims from aggregate findings. Fix the missing-inventory-balance readiness check.
6. Improve the existing Action Centre with search, status filters, priority/due-date ordering, refresh, current-opportunity links and explicit failed-update feedback. Preserve the original task source and evidence. Retry an unchanged action form with the same idempotency key after a lost response. Reuse the existing modal focus manager for keyboard navigation, background isolation and focus restoration.

## Requirement map

Update: the follow-up implementation now adds saved opportunity review states, immutable evidence, notes/activity, snoozing, reopening, task deduplication and permission-safe task links. See `opportunity-review-release-2026-09-13.md` for the implemented boundary, tests and remaining limits. The map below includes that follow-up for the operating decision queue and organization-wide operations access.

| Area | Existing implementation | Status and remaining work |
| --- | --- | --- |
| Product positioning | `app/page.tsx`, feature guides, source-linked interactive demo | Present. Preserve the independent retail audience and demonstrable claims. Real customer evidence still needs permission and measured outcomes. |
| Design system | `workspace-design.css`, typography, chart and BookLoQ components, new decision workspace styles | Partial. Shared colors, focus states, tabular numerals, spacing and controls exist. Legacy style layers still need gradual consolidation as modules are touched. Avoid a global rewrite that changes working screens. |
| Navigation | Permission and entitlement-aware sidebar, location selector, saved visibility preferences, public navigation | Present with improvements needed. Intelligence now separates Opportunities and Retail analysis clearly. A universal contextual breadcrumb/date/comparison framework is not complete. |
| Command Centre | Current sales, profit where permitted, transactions, basket value, payments, intraday and period charts, provenance, setup guidance | Present. This release fixes incomplete period comparisons. Universal custom/prior-year comparisons and a reviewed historical trading calendar remain. |
| Opportunities | Operating decision rules, saved evidence, review notes/history, dismiss/snooze/reopen and one linked action per review | Implemented for the existing operating queue with organization-wide operations access. Cross-module aggregation, full archive pagination and location-limited collaborative notes remain. |
| Business health | Source freshness/readiness and individual metric checks | Partial. No defensible cross-domain health model exists. Define business-owned thresholds, required evidence and scope before labeling a whole business healthy or strong. Do not reuse readiness as business health or invent a score. |
| Sales and profitability | `domain/retail-intelligence.ts`, commerce API, net/gross sales, returns, discounts, product/category mix, exact-cent revenue bridge | Present for supported source data. Attribution remains an investigation. Costs and full source coverage govern profit availability. |
| Basket intelligence | Product/category pairs, support, directional confidence, lift, basket-size bands, items/basket, discount dependency | Present. Median basket value, richer attach-rate journeys and margin distributions are incremental gaps. Associations require minimum supporting receipts and are not causal recommendations. |
| Inventory | Stock cover, turnover, sell-through, reorder review, overstock, expiry lots, supplier and purchase commitment workspaces | Substantial but partial. GMROI, consistent aged-stock/dead-stock views, transfer/receiving workflow unification, saved SKU filter views and comprehensive supplier lead-time coverage need further work or source inputs. Opening/closing stock and receipts are not inferred. |
| Customers | Identified-buyer repeat activity, loyalty comparisons and customer views | Partial. Observed repeat rate is not longitudinal retention. Cohort retention, defined RFM/VIP/at-risk segments and reliable lifetime value need explicit history, definitions and permission-scoped identities. |
| Marketing | Source selection, Google/Meta workbenches, attribution coverage, metrics, campaign planning and owner-reviewed controls | Present where configured. Cross-source revenue attribution requires matched records. Meta setup/review and some provider data remain pending. No foot-traffic or causal marketing lift is inferred from transaction counts. |
| Operations | Tasks, assignee text, due dates, status, source reference, expected impact, saved review activity and Decision Journal before/after review | Partial, improved here. Opportunity reviews now link task status and outcome notes. Structured member assignment, external reminders and automatic outcome measurement remain. Before/after observations do not establish intervention causality. |
| Vanteloq AI | OpenAI-only unified app help/business chat, consent, memory controls, deletion, filtered financial/retail context, evidence-first guidance | Present. Opportunity prompts now retain period/location. Fully structured report/entity/metric context links and cross-module action cards need gradual extension. Live billing and authorized generation require separate verification. |
| Data quality | Approved source promotion, freshness, provenance, invalid-data handling, cost gates and dimension coverage | Present, with new period checks. Reconciliation and record presence are distinct. Historical closures and a shared status vocabulary across all legacy modules remain. |
| Integrations | One public directory and authenticated connection management with honest provider status | Present as a catalogue, not blanket production certification. See provider dependencies below. No fake API or dummy production success added. |
| BookLoQ | Separate financial ledger, journals, balances, reconciliation, cash planning, accounting checks, permissions, exports and period controls | Present. Keep financial records separate from sales analytics. Automated checks are not an audit. Provider ledger import/account mapping and further accountant workflow validation remain. |
| Reports | Report directory, dates/location/provider selection, export entitlements, stock/sales/accounting reports | Partial. Some directory entries explicitly require more data or implementation. Saved report views, fully consistent comparison/print/share patterns and scheduled delivery remain. Disabled controls are not counted as working features. |
| Multiple locations | Scoped APIs, mapped outlets, source authority, selected location, role filters and location comparison | Present. This release prevents a missing location-day from being masked by another store. Historical store openings/closures and like-for-like benchmark definitions remain. |
| Homepage and conversions | Guided demo, clear CTA, plan continuity, consolidated providers, BookLoQ proof, contact/custom inquiry, public analytics consent | Present. Preserve recent layout improvements. Customer testimonials/case studies cannot be invented. Search Console/field performance and verified signup-to-first-insight measurement remain. |
| Interactive demo | Shared retail records/calculations, different shops, source lines, data gaps, cash scenarios, hideable questions | Present. Fictional and labeled. It does not send live AI requests or expose customer data. Opportunity preview is local QA only, not a fabricated public customer result. |
| Tables/charts | Semantic tables in key modules, filtering, pagination, exact-value inspection, signed charts, keyboard controls | Partial consistency. Sorting, column choices, saved views and bulk operations are not universal. Preserve exports and permissions when expanding them. |
| Accessibility/devices | Semantic controls, visible focus, reduced motion, responsive shell and visual regression checks | Present with scoped verification. This release checks the opportunity board at phone, tablet and requested desktop widths. It does not certify every device, assistive technology or legacy form. |
| Performance | Worker runtime, existing bundles/assets, bounded server queries, calculation modules | Partial. Profile authenticated route bundles and field data before optimizing. No new component package, global animation library or client-side sensitive datastore is added. |
| Security and privacy | Supabase identity/MFA, server permissions, organization/location isolation, Stripe entitlements, approved sources, same-origin writes, rate limits, audit records, AI consent | Preserved. Run relevant security/tenant/source/task regression flows. This pass is not a new penetration test or legal review of every workflow. |

## Provider dependencies

These are configuration/source-backed statuses, not fresh provider-account approval checks in this pass.

- **Lightspeed R/X, Shopify/Shopify POS, Square, Clover, Stripe, Moneris, Google:** customer authorization, correct business/location mapping, completed imports and reviewed totals are required. Each customer's production POS must remain separate from test accounts and unrelated marketing resources.
- **QuickBooks:** sandbox only; production review, full ledger import and account/tax mapping remain.
- **Plaid:** approved production access/credentials remain. Current confirmed credentials were sandbox.
- **Meta:** provider configuration, permissions and applicable review remain.
- **Xero:** implementation pending.
- **DoorDash/Uber Eats:** coming soon.
- **Payroll:** provider selection and approved source integration pending.
- **CSV:** available with validation and source review.

## Recommended next implementation sequence

1. Add an owner-reviewed historical trading calendar and source coverage records. Model scope/date/source explicitly and extend like-for-like comparisons before making broader health claims.
2. Completed for the operating queue: persistent review lifecycle, evidence snapshots, dismissal/snooze, versioned activity and deduplicated action links. Next: full archive pagination, cross-module aggregation and a permission model for location-limited collaborative notes.
3. Extend customer/basket/inventory analysis from the existing normalized facts, with tests for sparse identities, returns, missing costs and changing assortment. Prioritize median basket/GMROI/cohorts only where input quality allows.
4. Standardize report context, saved views and AI deep links, followed by actual action-outcome tracking.
5. Complete external provider approvals and live source checks, then measure onboarding/activation and obtain a permissioned customer case study.

The brief is intentionally larger than one safe release. This implementation completes the evidence and decision-to-action foundation while keeping the remaining requirements explicit.
