# Vanteloq v1.0 Origin

**Product and production handover · 1 October 2026**  
**Operator:** 2855706 ALBERTA INC, doing business as LexEdge Consulting and operating Vanteloq.  
**Audience:** the product owner, engineers, support operators and authorized accounting reviewers.

This is the canonical Origin release document. It records what Vanteloq implements, how customer information moves through the system, how access and payment work, what was tested, and what still needs independent production evidence. The appendices list the complete source inventory, feature entitlements, database tables and HTTP endpoints. They describe source contracts, not a claim that every listed capability is publicly available, populated or independently certified.

Vanteloq brings a business’s sales, inventory, documents and financial records into one inspectable picture. BookLoQ provides its accounting and cash workspace. LexEdge Consulting operates the product. Customers retain their own workspaces, provider grants, permitted locations and decisions. A sample preview is always separate from customer records.

## Release decision and unresolved items

Publication and production readiness are distinct. This release improves the interface, onboarding, AI, financial calculations, privacy handling, connector evidence and subscription controls. A seven-day first-subscription trial is now the approved commercial policy; prices and existing customers’ access remain unchanged.

The following must remain visible in the owner’s operational register:

1. **Actual production backup and restoration remain unverified.** Source archives and the earlier synthetic recovery drill do not prove recoverability of current customer records and uploaded files. Obtain a private production export and restore it into an isolated environment, with outbound actions disabled. Never overwrite the live workspace to run this drill.
2. **Provider approval and customer acceptance vary by connector.** A production key or successful developer-account callback does not establish public distribution approval, usable fields or correct reports for another customer. Keep unfinished connectors labelled Coming soon. The homepage observed in this review lists Lightspeed R-Series, Square, Slack and CSV as Available. Stripe subscription billing is separate from the Stripe customer-reporting preview.
3. **Dependency advisory coverage is not complete until the advisory request is authorized and run.** A lockfile inventory or pattern scan is not a zero-vulnerability result.
4. **Retention execution, operational ownership and provider obligations need ongoing evidence.** Technical review and published notices are not a legal certification. Record the responsible operator, actual subprocessors/regions, disposal runs, escalation procedures and provider contract changes.
5. **Performance measurements have bounded scope.** Local builds and focused provider timings are recorded below. No universal concurrency guarantee, fresh production load result or permanent Lighthouse score is claimed.

## Product surfaces and everyday workflows

### 1 October interaction and billing verification update

The homepage and executive overview now share an interactive SVG goal-ring component. Each ring responds to pointer selection, Enter and Space, with equivalent labelled buttons for touch and keyboard use. The selected metric shows its progress and target. Existing date, location and source-eligibility checks still determine progress. Unknown data remains unknown, and displayed percentages can exceed 100% while the arc is capped at a full circle.

Gross Profit and Gross Margin card labels use darker 14px type. Connector cards show blue Available! and lavender Coming Soon! stickers with readable handwritten-style lettering. Provider logos, readiness rules, account-health states, subscription requirements and third-party notices are preserved. The changes add no fonts, image downloads, packages, polling or provider requests. Motion is bounded and honours reduced-motion and the existing pause setting.

Verification: 48 focused dashboard, hydration, empty-state, goal-preference and connector tests passed; TypeScript checks passed. Browser checks covered the shared workspace component and homepage preview at 390px and 1440px widths, keyboard and pointer ring selection, changing a sample target, values over 100%, unknown-data states and unclipped connector badges. These are scoped checks, not a new production load or PageSpeed measurement.

The requested owner-email Stripe sandbox test also completed: the prepared Starter checkout began with CAD $0 due and an exact seven-day trial. Ending only that sandbox trial produced a successful CAD $49 test invoice and payment; the synthetic subscription was then cancelled. No live charge or production-workspace change occurred. The checkout was created through Stripe's test API, not production onboarding, so it does not independently establish delivery of production webhooks. The related 34 local billing, trial, access, concurrency, legal-acceptance and BookLoQ billing checks passed.

### Dashboard and business pulse

The executive overview presents six starting KPI cards, with configurable visibility, order and width. Cards show the current value, available comparison, trend, source and update time. Available measures include net revenue, gross profit, gross margin, operating profit, net margin, cash balance, cash flow, inventory value, transactions, average order value and units sold. Each measure still requires the necessary plan, permission, source fields and reporting coverage.

Users can select date presets or a custom range, compare with a previous period, previous year, budget or saved target, and drill into records. Budget and target comparisons require a compatible scope and dates. Percentage margins compare in percentage points; a previous zero does not produce an invented percentage change. Missing observations remain gaps in the chart.

The overview places its main trend beside invoice and bill aging, with attention items and configurable goal rings below. It supports line and bar charts, keyboard inspection and accessible data tables. The customizer provides metric explanations, industry starting points, saved views, section controls and dated goals. Recommendations are starting points, not universal industry standards.

An unconnected workspace keeps the same structure with empty grids, clear setup actions and dashes for unknown amounts. It never invents successful trading days, cash, invoices or zero costs. The homepage renders the same actual components with explicitly fictional records and an interactive before-connection mode. Preview changes never write into a customer’s workspace.

### Commerce and inventory

Sales analysis separates discounts, returns, taxes, units and product costs. It supports available product, category, location and channel detail, source attribution and transaction drill-down. POS revenue, payment settlements, bank movements and posted accounting earnings are different measures. A deposit is not automatically additional sales.

Inventory and purchasing include supported quantities, costs, lots, expiry, cover, velocity, reorder and supplier workflows where required inputs exist. Costs that were not supplied stay unknown. Historical cost evidence is not silently replaced with today’s catalogue cost. Purchase-order, receiving and invoice-matching actions retain their own permissions and review steps.

Vehicle inventory adds a dealership-specific starting mode, manual entry and preview/confirm CSV import. Records include a VIN or permitted legacy identifier, year, make, model, stock number, location, status and dates, plus optional acquisition and reconditioning costs. Costs use integer minor units and the location’s currency. Location and cost permissions apply to list, change, import and export paths. Version checks prevent silent overwrites; duplicate identifiers and stock numbers are rejected within the defined workspace scope. These records do not automatically post accounting entries, decode VINs, create financing applications or prove that a POS supplied vehicle fields. This first version uses the existing Growth/Pro inventory entitlement. See [vehicle inventory contract](vehicle-inventory.md).

### BookLoQ

BookLoQ is available as a separate subscription or an add-on. Its source implements a financial overview, chart of accounts, journal workflows, expenses, customer invoices, supplier bills, receivables/payables, payments and credits, bank review, reconciliation, period controls, financial statements, tax working papers, budgets and cash planning. These capabilities depend on permitted, reviewed and sufficiently complete records.

The P&L distinguishes revenue, COGS, gross profit, operating expenses, operating profit, other income and recorded net earnings. The balance sheet checks assets against liabilities and equity. Cash-flow presentation distinguishes operating, investing, financing and entries requiring classification review. Liquidity measures include working capital, current and quick ratios, recorded cash burn and runway when denominators and classifications are valid.

Invoice aging uses current outstanding document balances, due dates, payments and credits. The overview can switch between receivables and payables and open each aging bucket. These balances include document tax and cover the user’s permitted locations; they are distinct from the trend chart’s selected sales period and from posted ledger balances. Invalid balances withhold the headline total. Other currencies are reported separately rather than converted without an exchange-rate basis.

A balanced journal is a mechanical bookkeeping control, not an audit or a guarantee that all transactions, classifications or taxes are correct. Posting, reversal, approval, reconciliation and period locking remain deliberate authorized actions. File upload, extraction or an AI answer does not post a journal or pay a bill.

### Forecasting and recommendations

Forecasting separates recorded history, model estimates, user assumptions and commitments. Revenue/demand and inventory decisions require usable historical coverage, stable units and a supported horizon. Cash planning includes a 13-week view with opening cash and explicit commitments. Missing inputs are visible; projected balances are not bank balances.

Recommendations explain the observed change, plausible driver, financial implication and an action to investigate. Correlation does not establish a cause. Forecast quality is evaluated using held-out periods and baseline comparisons where the implementation has sufficient data, rather than presenting every fit as accurate. Record horizon, scope, missingness, assumptions and measured error before making stronger accuracy claims.

### Documents and linked files

Documents support reviewed uploads, quarantine/scan states, extraction, metadata and authorized download/deletion. Bank statements can provide cash and transaction evidence for review; they do not become recognized revenue automatically. Storage and processing involve authorized service providers, so the product must never promise that uploaded documents are never stored or can never be accessed by an authorized processor.

Document email uses a workspace forwarding address, sender/address authorization and an independent email receiver. Revoked addresses must reject delivery. The enabled/verified production flags are configuration evidence; delivery, malware scanning and extraction are separate outcomes. General support/inquiry forwarding is separate from BookLoQ document ingestion.

CSV and supported file snapshots are distinct from live account connections. Google and Microsoft file adapters require their own customer authorization, file selection, read scope and resource access. Microsoft files were disabled in the configuration inspected during this review. Selection limits what Vanteloq imports; it does not narrow the provider grant itself. Google uses `drive.readonly`; Microsoft uses delegated `offline_access Files.Read`. Refresh checks run while the panel is open and visible. Unlinking or disconnecting removes linked snapshots, but previously imported Documents remain subject to their separate deletion workflow. Do not advertise automatic live synchronization for arbitrary documents or presentations until the applicable connection is enabled and verified.

### Vanteloq AI

Vanteloq AI streams real provider output with readable formatting, visible working/stop/error states and ordinary conversational follow-ups. It uses only the tools and workspace information permitted by the user’s current role, locations, plan and consent. Tool results and uploaded content cannot grant additional authority. AI cannot approve accounting treatment or consequential actions.

Memory starts off. A bounded signed current-chat context supports follow-ups without implying permanent memory. Optional saved history supports search, rename, reopen and deletion; response preferences are stored separately and can be reset. Attachment-derived exchanges do not enter saved chat history or financial records through the chat path. Supported fictional PDF, image and CSV probes were tested separately from real financial imports.

Provider requests use `store:false`; that setting is not a promise of zero provider retention. The implementation applies a 45-second provider deadline, a 3,200-output-token cap, a 40,000-character streamed-answer bound and six forwarded history messages. Request leases and retry metadata limit duplicate overlapping work. Consent changes, revocation, membership and location restrictions are re-evaluated server-side.

### Team and operating work

Workspace features include team profiles and invitations, configurable roles and locations, an Action Centre, tasks, calendar/operations, communications, decision records, business briefs, reports and settings. Access depends on the permission and feature catalogue, not merely whether a navigation item is visible. Sensitive finance, identity, payroll and export privileges are separate.

Slack sends an explicitly confirmed test or a secure Vanteloq link to the authorized channel. The current connector does not read conversations or files and does not establish a general automated alert service.

## Subscription and signup contract

| Subscription | Monthly CAD before applicable tax | Active locations | Users |
| --- | ---: | ---: | ---: |
| Starter | $49 | 1 | 3 |
| Growth | $99 | 3 | 10 |
| Pro | $179 | 10 | 25 |
| BookLoQ standalone | $59 | 1 | 3 |
| BookLoQ add-on | $39 in addition to the base plan | Uses applicable workspace limits | Uses applicable workspace limits |

New purchases use monthly prices. Legacy annual identifiers remain available for reconciliation; their presence does not offer a new annual purchase. No new monthly AI/document quota or overage charge is introduced in this release.

The seven-day trial applies to a workspace’s first eligible base subscription and requires a payment method. Stripe Checkout states the selected price and first charge, and the public pricing/terms disclose renewal and cancellation. A returning or already subscribed workspace cannot repeatedly obtain another trial. This protection follows retained workspace history, not a payment card or person across recreated accounts. An operator should not manually extend a trial in Stripe without reconciling its customer-facing billing date and Vanteloq’s capped access deadline. Adding BookLoQ to an existing paid subscription does not start another free trial. Existing paid and explicitly authorized complimentary access is preserved.

Checkout access is established by server-side identity, MFA, workspace ownership, current legal acceptance and exact approved prices. A redirect or client-supplied success message cannot grant access. Stripe events are signature-verified and synchronized with current subscription state. The stored first-trial deadline prevents an old or extended event from making access indefinite. After trial expiry, access requires verified paid conversion. The opening zero-dollar invoice is not proof of payment.

The billing portal remains available for cancellation even when onboarding is unfinished or product access has expired. The live portal configuration inspected supports cancellation at period end, invoice history and payment-method updates. Live trial-ending notification activation is recorded in the completion record below. No customer charge or existing subscription was created or altered for verification in this pass.

Signup loads configuration and the Turnstile script concurrently, with bounded waits and a visible retry. It does not disable CAPTCHA, MFA, legal acceptance or billing gates to appear faster. Address entry does not depend on a Canada Post lookup completing.

## Data architecture and invariants

The application is a TypeScript/React site built through the Sites/Vinext/Cloudflare Worker toolchain. Application records use D1/SQLite with Drizzle schema and ordered SQL migrations. Supabase supplies authentication; Vanteloq applies its own workspace sessions, membership, roles, location scope and subscription/feature guards. Documents use private object storage and scan/extraction workflows. Provider secrets and hosting configuration belong in private secret storage, never in this handover.

The record path is: customer authorization, selected provider/resource, bounded import or upload, validation/staging, review/source selection, canonical records, metric or posted-ledger calculation, then dashboard/report/AI use. Each step has a distinct state. Source attribution follows the records rather than a marketing label.

Money uses integer minor units, explicit source currency and validated rounding. Dates distinguish business dates from timestamps and respect the applicable location or provider time zone. Missing values remain null/unknown. A known zero cost is different from a missing cost. Different currencies are not simply summed. Refunds, credits, tax and tips preserve their source semantics.

Connector readiness now checks field evidence for each individual connection. A record count alone does not establish a complete metric, and complementary fields on two unrelated accounts are not merged into a fictional complete source. Permission-filtered field counts describe observed stored rows. The Connections endpoint supplies no completed report-period, pagination or reconciliation proof. Consistent production and consumption of that proof across every report, export and AI use remain unfinished; individual financial/report guards are still required.

Posted accounting entries retain their balance and reversal controls. Mutations use server authorization and bound query parameters. Repeated provider deliveries, concurrent checkout attempts and imports require their designated idempotency or version controls. A webhook receipt is not proof that its work was fulfilled.

## Security privacy and third-party controls

Server checks cover workspace identity, membership, MFA, role, location and plan separately. Sensitive exports, private documents, bank records, AI tools, vehicle costs and administrative tasks must not rely on client-side hiding. Expired/revoked sessions and grants must fail closed. Public health responses must not expose credentials or customer records.

Consent and policy versions are stored and checked. October 1 changes describe AI preferences/current-chat context, trial terms and vehicle identifiers/costs. Provider notices link to the relevant third-party policy and do not imply endorsement or sponsorship. Logos and public availability need provider-specific rights and approval evidence; a general disclaimer cannot create those rights.

Shopify customer data requests now require a private owner/admin workflow. Their bounded request scope is encrypted, the Action Centre receives a generic task, and a separate authenticated privacy-request page remains reachable without a paid product entitlement. An authorized operator exports permitted matching records locally, verifies the requester and delivers them securely or records an appropriate no-data outcome. A routine POS sync cannot mark the privacy request fulfilled. Disconnect retains the minimum shop identity needed for terminal compliance events, deletes locally stored credentials and stops collection. Provider-side revocation is not established by this route. Completion clears the encrypted identifying scope while retaining the opaque request ID, request hash and limited fulfilment audit metadata. Access requires owner/admin status, `privacy.manage` and organization-wide location access; export and completion also require `customers.export`. The export covers matching imported customer, sale-line, payment and staged-order records. Separate documents and communications require operator review. Oversized exports remain pending. Completion records an operator attestation, not independently verified delivery. No automatic email or disclosure to a customer is implied.

Application retention mechanisms and written targets must be distinguished. Saved-chat inactivity and retry metadata cleanup occur on subsequent relevant use, not a guaranteed background deadline. Age-based document/provider disposal and the operator’s retention schedule need actual execution evidence. The Shopify queue’s 30-day due date is an operator response deadline, not automatic disposal. Pending identifiers remain encrypted until completion or applicable deletion. Backups must not silently reintroduce later deletions or revoked access.

## Performance and accessibility

Public and signed-in styles are separated so workspace panels are not shipped as an undifferentiated homepage stylesheet. Signup configuration and challenge loading overlap. Charts use responsive SVG/HTML rather than blurry screen images. Subtle transitions, focused hover states and Business Pulse illumination respect reduced-motion settings. Content remains readable with ordinary keyboard navigation and narrow layouts.

Focused real-provider AI probes observed first text at 1.517–2.190 seconds and completion at 2.013–2.787 seconds. Those fictional requests are not an end-to-end multi-user SLA. An earlier BookLoQ load test at 25 concurrent users recorded p95 5.70 seconds against a five-second target; no replacement production measurement is asserted here. Cloudflare cannot be declared the cause of a perceived delay without separating network, authentication, Worker, database and provider time.

Maintain route-level bundle budgets, image sizes, query bounds, cursor pagination, independent connection leases, cancellation/timeouts and retry limits. Measure cold and warm mobile signup, authenticated dashboard and invoice/AI paths under an agreed production-safe load before publishing a capacity claim.

## Backup and recovery procedure

1. Obtain the actual database export, schema/migration manifest, object inventory and recoverable encryption/configuration material through the hosting provider’s supported private process. Store them with restricted access and record time, scope and hashes.
2. Create a separate recovery environment with outbound email, payments, provider writes, webhooks and scheduled jobs disabled. Restore database and object copies there, never over production.
3. Check migration identity, row counts by workspace, critical totals, ownership/location boundaries and every object hash. Confirm encrypted provider fields can be recovered only by authorized operators.
4. Replay deletions, consent withdrawals and revoked access newer than the backup. Do not reconnect restored credentials or trigger duplicate notifications, subscriptions or imports.
5. Run sign-in/session, file download, representative financial reconciliation and tenant-isolation checks. Record the measured recovery point and elapsed recovery time, operator and exceptions.
6. Securely retire the recovery copy through the agreed retention process. Proposed 24-hour RPO and eight-hour RTO remain targets until demonstrated using production data.

## Maintenance and change control

For every future feature, connector, schema or billing change, assess the data fields, permissions, consent purpose, third-party terms, retention/deletion behavior, accounting semantics, API version, plan entitlements, accessibility and performance impact. Update the relevant policy version and obtain renewed consent when the actual change requires it. Do not silently widen existing scopes.

Keep a release record with commit/build identity, migrations, exact tests and results, provider configuration revision, deployment, rollback path and post-release observations. Credentials belong in the secret manager with expiry/rotation owners. Background jobs need last-success, failure and retry visibility. Review provider API deprecations and authorization expiries before they become customer failures.

Future names are roadmap labels only: Vanteloq 2.0 Nexus, Vanteloq 3.0 Cognition and Vanteloq 4.0 Autonomous. They do not advertise currently available autonomous capabilities.

## Verification and deployment record

<!-- RELEASE_RECORD_START -->
- Production build and artifact validation: passed. TypeScript: passed. ESLint: zero errors and ten existing unused-symbol warnings.
- Final focused regression batch: 175 tests, 167 initially passed. Eight failures came from stale legal-policy date/version fixtures. The corrected affected suites plus onboarding identity checks passed 19/19 on rerun. Deliberately obsolete policy acceptance remains rejected. These are selected regressions, not a claim that all 217 test files ran together.
- Vehicle API flows: 2/2 passed, including tenant/location/cost boundaries, concurrent updates, CSV confirmation and account deletion. Shopify privacy and migration/scheduler checks are recorded in their separate component evidence. Suite counts overlap.
- Browser review: desktop metric selection, customization, receivable/payable aging drill-down and empty-data mode checked. A 375 CSS-pixel iframe layout had no horizontal overflow and retained the social links; iframe interaction automation was unavailable, so this is visual/layout evidence rather than a complete mobile-device acceptance test.
- Live Stripe: the existing subscription webhook includes trial, pause/resume, invoice and payment-failure lifecycle events; the existing billing portal supports cancellation. Trial reminder email settings are prepared but not saved because authorization to enable customer emails remains pending. No live subscription or charge was created for this test.
- The post-publication browser review found a timezone-dependent source-timestamp hydration mismatch. A deterministic UTC timestamp formatter corrected it; a regression first failed on the prior code and now passes across UTC, Denver and Tokyo. All 10 focused rendering checks, type checking, focused lint and the rebuilt production artifact passed. The corrected live homepage expanded successfully. Pricing navigation and the Starter trial CTA opened the selected signup form. No rendering errors were reported in that fresh browser session.
- Published successfully as release **322** at `2026-10-01T09:51:23Z`, from source commit `0c092eea21ac3519e2c7bd447fc4fdbc47e1d7af`, with environment revision 64. The public site is https://vanteloq.com. See the [deployment receipt](evidence/origin-deployment-2026-10-01.json). This final documentation update follows deployment and changes no application code.
- Final signed-in owner acceptance could not run because the workspace was signed out. No new live account, subscription or charge was created. The focused isolated flows and public smoke checks are recorded separately.
- See [release verification and log hashes](evidence/origin-release-verification-2026-10-01.json), [changed-source pattern scan](evidence/changed-source-secret-scan-2026-10-01.json) and the component reports below. A clean pattern scan does not establish zero vulnerabilities.
<!-- RELEASE_RECORD_END -->

TLS evidence at `2026-10-01T08:03:05.964Z`: `vanteloq.com`, `www.vanteloq.com`, `connectors.vanteloq.com` and the native Sites hostname rejected TLS 1.0/1.1 and accepted certificate-authorized TLS 1.2/1.3. See [protocol evidence](evidence/public-tls-2026-10-01.json).

Test counts in component reports overlap and must not be added into a single invented total. Real-provider probes, mocked-provider flows, isolated D1 tests, source inspection and production verification are explicitly different kinds of evidence.

## Supporting records and primary references

- [AI conversation review](ai-conversation-review-2026-10-01.md), [pricing review](subscription-review-2026-10-01.md), [financial corrections](financial-final-review-2026-10-01.md), [operating and policy review](operations-policy-review-2026-10-01.md).
- [Connector capabilities and official provider research](connector-capabilities-review-2026-10-01.md), [complete machine-readable source inventory](origin-feature-inventory-2026-10-01.json), [retention schedule](DATA_RETENTION.md).
- [Stripe trial implementation guidance](https://docs.stripe.com/payments/checkout/free-trials), [Stripe subscription trial requirements](https://docs.stripe.com/billing/subscriptions/trials), [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).
- [Alberta organization privacy responsibilities](https://www.alberta.ca/organization-responsibilities-for-protecting-personal-information), [federal privacy jurisdiction](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/r_o_p/02_05_d_26/). Provincial and federal obligations have different scopes; the operator must assess the applicable activity.
- [Rolling-origin forecast evaluation](https://otexts.com/fpp3/tscv.html), [forecast accuracy measures](https://otexts.com/fpp3/accuracy.html), [Cloudflare D1 recovery facilities](https://developers.cloudflare.com/d1/reference/time-travel/). Method and platform documentation do not prove this application’s accuracy or actual recoverability.

<!-- GENERATED_INVENTORY_START -->

## Complete source inventory

This appendix was generated from the source and an isolated reconstruction of every SQL migration. It contains no production records or secret values. It is a contract inventory, not proof that every endpoint or provider is available to every plan. Exact SQL, indices, triggers, permission expressions, hashes and candidate test references are retained in the linked JSON inventory.

| Source item | Count |
| --- | --- |
| pages | 20 |
| routeFiles | 146 |
| methodEntries | 199 |
| Drizzle table declarations | 104 |
| migrationFiles | 68 |
| tests | 217 |
| features | 103 |
| roleTemplates | 12 |
| workspaceViews | 27 |
| physicalDatabaseTables | 106 |


### Complete plan feature catalogue

Included means the entitlement key is assigned. A connector approval, customer permission, populated field or implemented workflow may still be required. An entitlement label alone is not a product promise.

| Feature key | Starter | Growth | Pro | BookLoQ | BookLoQ add-on |
| --- | --- | --- | --- | --- | --- |
| dashboard.core | Included | Included | Included | Included | — |
| business.profile | Included | Included | Included | Included | — |
| business.settings | Included | Included | Included | Included | — |
| business.brief.basic | Included | Included | Included | — | — |
| operations.basic | Included | Included | Included | — | — |
| communications.basic | Included | Included | Included | — | — |
| pos.reporting.core | Included | Included | Included | Included | — |
| analytics.sales.basic | Included | Included | Included | — | — |
| analytics.sales.advanced | — | Included | Included | — | — |
| products.basic | Included | Included | Included | — | — |
| products.margin | Included | Included | Included | — | — |
| products.location_performance | — | — | Included | — | — |
| inventory.basic | Included | Included | Included | — | — |
| inventory.lots | — | Included | Included | — | — |
| inventory.expiry | — | Included | Included | — | — |
| inventory.shelf_life | — | Included | Included | — | — |
| inventory.fefo | — | Included | Included | — | — |
| inventory.turnover | — | Included | Included | — | — |
| inventory.sell_through | — | Included | Included | — | — |
| inventory.velocity | — | Included | Included | — | — |
| inventory.days_on_hand | — | Included | Included | — | — |
| inventory.dead_stock | — | Included | Included | — | — |
| inventory.stockout_risk | — | Included | Included | — | — |
| inventory.reorder_ai | — | Included | Included | — | — |
| inventory.bring_back | — | Included | Included | — | — |
| inventory.assortment | — | Included | Included | — | — |
| inventory.opportunity | — | Included | Included | — | — |
| inventory.transfers | — | — | Included | — | — |
| supplier.analytics | — | Included | Included | — | — |
| supplier.cost_trends | — | Included | Included | — | — |
| supplier.lead_time | — | Included | Included | — | — |
| supplier.fill_rate | — | Included | Included | — | — |
| supplier.reliability | — | Included | Included | — | — |
| invoice.basic | Included | Included | Included | Included | — |
| invoice.extraction | — | Included | Included | — | — |
| invoice.matching | — | Included | Included | — | — |
| invoice.discrepancy | — | Included | Included | — | — |
| invoice.credit_opportunities | — | Included | Included | — | — |
| calendar.basic | Included | Included | Included | — | — |
| calendar.automation | — | Included | Included | — | — |
| marketing.overview | Included | Included | Included | — | — |
| marketing.google_business | Included | Included | Included | — | — |
| marketing.google_ads | — | Included | Included | — | — |
| marketing.google_analytics | — | Included | Included | — | — |
| marketing.meta_ads | — | Included | Included | — | — |
| marketing.search_intelligence | — | Included | Included | — | — |
| marketing.profit_attribution | — | Included | Included | — | — |
| marketing.inventory_aware | — | Included | Included | — | — |
| marketing.optimization | — | — | Included | — | — |
| marketing.advanced_attribution | — | — | Included | — | — |
| marketing.channel_allocation | — | — | Included | — | — |
| growth.strategy | — | Included | Included | — | — |
| growth.strategy_graph | — | Included | Included | — | — |
| growth.goals | — | Included | Included | — | — |
| growth.opportunities | — | Included | Included | — | — |
| pulse | — | Included | Included | — | — |
| exceptions | — | Included | Included | — | — |
| forecasting.revenue | — | Included | Included | — | — |
| forecasting.demand | — | Included | Included | — | — |
| forecasting.inventory | — | Included | Included | — | — |
| forecasting.cash_basic | — | Included | Included | — | — |
| forecasting.advanced | — | — | Included | — | — |
| forecasting.scenarios | — | — | Included | — | — |
| forecasting.future_obligations | — | — | Included | — | — |
| ai.basic | Included | Included | Included | Included | — |
| ai.advanced | — | Included | Included | — | — |
| ai.pro | — | — | Included | — | — |
| ai.tools.sales | — | Included | Included | — | — |
| ai.tools.inventory | — | Included | Included | — | — |
| ai.tools.products | — | Included | Included | — | — |
| ai.tools.marketing | — | Included | Included | — | — |
| ai.tools.suppliers | — | Included | Included | — | — |
| ai.tools.invoices | — | Included | Included | — | — |
| ai.tools.customers | — | Included | Included | — | — |
| ai.tools.strategy | — | Included | Included | — | — |
| multi_location.basic | Included | Included | Included | Included | — |
| multi_location.advanced | — | — | Included | — | — |
| multi_location.benchmarking | — | — | Included | — | — |
| multi_location.forecasting | — | — | Included | — | — |
| multi_location.marketing | — | — | Included | — | — |
| reporting.basic | Included | Included | Included | Included | — |
| reporting.advanced | — | — | Included | — | — |
| reporting.exports | — | — | Included | — | — |
| reporting.custom_dashboards | — | — | Included | — | — |
| workflow.advanced | — | — | Included | — | — |
| workflow.rules | — | — | Included | — | — |
| permissions.standard | Included | Included | Included | Included | — |
| permissions.advanced | — | — | Included | — | — |
| support.priority | — | — | Included | — | — |
| bookloq | — | — | — | Included | Included |
| bookloq.dashboard | — | — | — | Included | Included |
| bookloq.chart_of_accounts | — | — | — | Included | Included |
| bookloq.transactions | — | — | — | Included | Included |
| bookloq.expenses | — | — | — | Included | Included |
| bookloq.documents | — | — | — | Included | Included |
| bookloq.ap | — | — | — | Included | Included |
| bookloq.ar | — | — | — | Included | Included |
| bookloq.reconciliation | — | — | — | Included | Included |
| bookloq.financial_statements | — | — | — | Included | Included |
| bookloq.cash_intelligence | — | — | — | Included | Included |
| bookloq.anomaly_detection | — | — | — | Included | Included |
| bookloq.accountant_access | — | — | — | Included | Included |
| bookloq.ai | — | — | — | Included | Included |


### Workspace views

| View | Required UI permission | Navigation entitlement |
| --- | --- | --- |
| Dashboard | dashboard.view | dashboard.core |
| Forecasting | sales.view | forecasting.revenue |
| Intelligence | insights.view | analytics.sales.advanced |
| Action Centre | operations.tasks | operations.basic |
| Business Brief | dashboard.view | business.brief.basic |
| Advisor | insights.view | ai.basic |
| BookLoQ | finance.statements | bookloq |
| Sales | sales.view | analytics.sales.basic |
| Profit | metrics.profit | bookloq |
| Cash | metrics.cash | bookloq |
| Bookkeeping | finance.statements | bookloq |
| Inventory | inventory.view | inventory.lots |
| Customers | customers.totals | ai.tools.customers |
| Marketing | marketing.view | growth.strategy |
| Communications | customers.identity | communications.basic |
| Team | team.directory | permissions.standard |
| Operations | operations.tasks | operations.basic |
| Suppliers | purchasing.view | supplier.analytics |
| Purchase Orders | purchasing.view | inventory.reorder_ai |
| Documents | documents.view | invoice.basic |
| Data Quality | integrations.view | reporting.basic |
| Locations | locations.manage | multi_location.basic |
| Decision Journal | insights.view | growth.strategy |
| Scenario Planner | metrics.cash | forecasting.scenarios |
| Reports | reports.operational | reporting.basic |
| Integrations | integrations.view | business.settings |
| Settings | organization.settings | business.settings |


### Permission register

These permissions are checked in the applicable routes and helpers. The full role expressions remain in the inventory and server/permissions.ts; this register does not imply every employee receives these powers.

#### Dashboard & intelligence

| Permission | Meaning | Sensitivity |
| --- | --- | --- |
| dashboard.view | View executive dashboard | standard |
| metrics.revenue | View revenue metrics | financial |
| metrics.profit | View profit and margin | sensitive |
| metrics.cash | View cash metrics | restricted |
| insights.view | View recommendations | standard |
| insights.create_task | Create tasks from insights | standard |


#### Sales

| Permission | Meaning | Sensitivity |
| --- | --- | --- |
| sales.view | View sales totals | standard |
| sales.transactions | View individual transactions | sensitive |
| sales.refunds | View refunds and discounts | standard |
| sales.refund_issue | Issue refunds | sensitive |
| sales.export | Export sales records | sensitive |


#### Finance & BookLoQ

| Permission | Meaning | Sensitivity |
| --- | --- | --- |
| finance.statements | View financial statements | restricted |
| finance.bank_balances | View bank balances and available cash | restricted |
| finance.bank_transactions | View bank transactions | restricted |
| finance.costs | View product and supplier costs | sensitive |
| finance.ap_ar | View accounts payable and receivable | restricted |
| finance.journal_post | Post journal entries | restricted |
| finance.reconcile | Reconcile accounts | restricted |
| finance.periods | Lock or unlock periods | restricted |
| finance.export | Export financial information | restricted |
| finance.connections | Manage banking connections | restricted |


#### Payroll & compensation

| Permission | Meaning | Sensitivity |
| --- | --- | --- |
| payroll.totals | View payroll totals | restricted |
| payroll.individual | View individual compensation | restricted |
| payroll.edit | Edit compensation | restricted |
| payroll.export | Export payroll | restricted |


#### Inventory & purchasing

| Permission | Meaning | Sensitivity |
| --- | --- | --- |
| inventory.view | View quantities | standard |
| inventory.value | View inventory value and costs | sensitive |
| inventory.adjust | Adjust or transfer inventory | sensitive |
| purchasing.view | View purchase orders | standard |
| purchasing.create | Create purchase orders | sensitive |
| purchasing.approve | Approve purchase orders | restricted |
| purchasing.send | Send purchase orders | restricted |
| purchasing.receive | Receive inventory | standard |
| purchasing.match | Match invoices | sensitive |


#### Documents

| Permission | Meaning | Sensitivity |
| --- | --- | --- |
| documents.upload | Upload invoices and receipts | standard |
| documents.view | View financial documents | sensitive |
| documents.review | Review extracted information | sensitive |
| documents.download | Download documents | sensitive |
| documents.retention | Manage document retention | restricted |


#### Customers & marketing

| Permission | Meaning | Sensitivity |
| --- | --- | --- |
| customers.totals | View customer totals | standard |
| customers.identity | View customer identity and contact details | sensitive |
| customers.export | Export customer data | restricted |
| marketing.view | View marketing performance | standard |
| marketing.spend | View marketing spending | sensitive |
| marketing.manage | Manage campaigns and integrations | restricted |


#### Team & operations

| Permission | Meaning | Sensitivity |
| --- | --- | --- |
| team.directory | View employee directory | standard |
| team.contacts | View employee contact information | sensitive |
| team.create | Create and invite employees | restricted |
| team.edit | Edit, suspend or archive employees | restricted |
| team.roles | Assign roles and permissions | restricted |
| team.pin_reset | Reset workplace PINs | restricted |
| operations.tasks | View and complete tasks | standard |
| operations.manage | Assign tasks and manage checklists | standard |
| locations.manage | Manage locations | restricted |


#### Reports, integrations & administration

| Permission | Meaning | Sensitivity |
| --- | --- | --- |
| reports.operational | View operational reports | standard |
| reports.financial | View financial reports | restricted |
| reports.export | Export or schedule reports | sensitive |
| integrations.view | View integrations and synchronization | standard |
| integrations.manage | Connect, disconnect and manage credentials | restricted |
| data.import | Upload and map data | sensitive |
| audit.view | View audit history | restricted |
| privacy.manage | Manage provider privacy requests | restricted |
| organization.settings | Manage organization settings and branding | restricted |
| organization.billing | Manage billing and subscription | restricted |
| organization.ownership | Manage ownership | restricted |


### Database register

All 106 physical application tables after applying every migration are listed below. This includes `advisor_preferences` and `advisor_requests`, which lack current Drizzle declarations. Internal SQLite tables and obsolete rebuild temporaries are excluded. Every column is listed; exact constraints, defaults, foreign keys, indices and triggers are included in the JSON companion. The empty in-memory reconstruction passed integrity and foreign-key checks; populated D1 migration and application tests are recorded separately.

#### access_roles

`id` (primary key), `organization_id`, `name`, `description`, `color`, `system_key`, `permissions_json`, `location_scope_json`, `archived`, `created_by_user_id`, `created_at`, `updated_at`.


#### account_deletion_jobs

`id` (primary key), `account_hash`, `organization_id`, `user_id`, `scope`, `token_hash`, `plan_encrypted`, `stage`, `result_json`, `lease_until`, `created_at`, `expires_at`.


#### account_deletion_receipts

`id` (primary key), `account_hash`, `organization_hash`, `scope`, `result`, `retained_categories_json`, `provider_outcomes_json`, `completed_at`, `expires_at`.


#### account_notifications

`id` (primary key), `user_id`, `organization_id`, `notification_type`, `title`, `message`, `delivery_status`, `read_at`, `created_at`.


#### account_preferences

`user_id` (primary key), `email_notifications`, `remembered_profile`, `created_at`, `updated_at`, `hidden_navigation_json`, `preferred_location_id`, `dashboard_preferences_json`.


#### accounting_periods

`id` (primary key), `organization_id`, `label`, `start_date`, `end_date`, `status`, `locked_at`, `locked_by_user_id`, `created_at`, `updated_at`.


#### advisor_preferences

`organization_id` (primary key), `user_id` (primary key), `preferences_json`, `updated_at`.


#### advisor_requests

`organization_id` (primary key), `user_id` (primary key), `turn_id` (primary key), `request_hash`, `state`, `conversation_id`, `created_at`, `updated_at`.


#### assistant_conversations

`id` (primary key), `organization_id`, `user_id`, `title`, `created_at`, `updated_at`.


#### assistant_messages

`id` (primary key), `conversation_id`, `organization_id`, `user_id`, `role`, `content`, `evidence_json`, `model`, `created_at`.


#### audit_events

`id` (primary key), `organization_id`, `actor_user_id`, `action`, `resource_type`, `resource_id`, `outcome`, `request_id`, `source_hash`, `details_json`, `created_at`.


#### bank_accounts

`id` (primary key), `organization_id`, `financial_account_id`, `name`, `account_type`, `institution_name`, `masked_number`, `live_balance_cents`, `available_balance_cents`, `book_balance_cents`, `available_credit_cents`, `connection_status`, `last_sync_at`, `last_reconciled_at`, `demo_record`, `created_at`, `updated_at`, `currency`, `provider`, `external_account_ref`, `external_item_ref`.


#### bank_statement_imports

`id` (primary key), `organization_id`, `document_id`, `bank_account_id`, `financial_account_id`, `start_date`, `end_date`, `currency`, `opening_balance_cents`, `closing_balance_cents`, `row_count`, `inflow_cents`, `outflow_cents`, `fingerprint`, `demo_record`, `status`, `approved_by_user_id`, `created_at`.


#### bank_statement_rows

`import_id` (primary key), `transaction_id`, `row_number` (primary key).


#### billing_checkout_attempts

`organization_id` (primary key), `attempt_id`, `selection_key`, `request_body`, `session_id`, `created_at`.


#### bookloq_alerts

`id` (primary key), `organization_id`, `severity`, `alert_type`, `title`, `explanation`, `dollar_impact_cents`, `confidence`, `supporting_records_json`, `recommended_action`, `assigned_user_id`, `due_date`, `status`, `resolution_history_json`, `demo_record`, `created_at`, `updated_at`.


#### bookloq_budgets

`id` (primary key), `organization_id`, `account_id`, `period_start`, `period_end`, `location_ref`, `department_ref`, `budget_cents`, `committed_cents`, `forecast_cents`, `created_at`, `updated_at`.


#### bookloq_category_rules

`id` (primary key), `organization_id`, `name`, `match_text`, `direction`, `account_id`, `active`, `created_by_user_id`, `created_at`, `updated_at`.


#### bookloq_contacts

`id` (primary key), `organization_id`, `contact_type`, `name`, `email`, `phone`, `billing_address`, `payment_terms_days`, `credit_limit_cents`, `tax_registration_number`, `notes`, `active`, `created_at`, `updated_at`.


#### bookloq_role_assignments

`id` (primary key), `organization_id`, `user_id`, `role`, `permissions_json`, `created_by_user_id`, `created_at`, `updated_at`.


#### bookloq_settings

`organization_id` (primary key), `base_currency`, `country_code`, `province_code`, `accounting_basis`, `fiscal_year_start_month`, `cash_safety_threshold_cents`, `status`, `data_mode`, `updated_by_user_id`, `created_at`, `updated_at`.


#### bookloq_transaction_matches

`id` (primary key), `organization_id`, `transaction_id`, `supplier_bill_id`, `customer_invoice_id`, `document_id`, `status`, `method`, `confidence_basis_points`, `matched_amount_cents`, `reasons_json`, `note`, `matched_by_user_id`, `created_at`, `updated_at`.


#### business_events

`id` (primary key), `organization_id`, `event_type`, `title`, `detail`, `event_date`, `expected_outcome`, `review_date`, `status`, `created_by_user_id`, `created_at`, `updated_at`.


#### cloud_file_connections

`id` (primary key), `organization_id`, `user_id`, `auth_subject`, `provider`, `state_hash`, `state_expires_at`, `consumed_at`, `verifier_ciphertext`, `token_ciphertext`, `status`, `created_at`, `updated_at`.


#### commerce_customers

`id` (primary key), `organization_id`, `provider`, `external_customer_id`, `display_name`, `first_name`, `last_name`, `email`, `phone`, `archived`, `source_updated_at`, `source_payload_hash`, `sync_run_id`, `updated_at`, `connection_id`.


#### commerce_payments

`id` (primary key), `organization_id`, `provider`, `external_payment_id`, `external_sale_id`, `payment_type_ref`, `payment_type_name`, `category`, `amount_cents`, `paid_at`, `outlet_ref`, `source_payload_hash`, `sync_run_id`, `updated_at`, `connection_id`.


#### commerce_products

`id` (primary key), `organization_id`, `provider`, `connection_id`, `external_product_id`, `sku`, `name`, `category_ref`, `supplier_ref`, `default_cost_cents`, `owner_cost_cents`, `owner_cost_source`, `owner_cost_updated_by_user_id`, `owner_cost_updated_at`, `default_price_cents`, `archived`, `source_updated_at`, `source_payload_hash`, `sync_run_id`, `updated_at`, `category_name`.


#### commerce_sale_lines

`id` (primary key), `organization_id`, `provider`, `external_sale_id`, `external_line_id`, `product_ref`, `customer_ref`, `outlet_ref`, `sold_at`, `sku`, `product_name`, `quantity_milli`, `net_sales_cents`, `cost_cents`, `discount_cents`, `source_payload_hash`, `sync_run_id`, `updated_at`, `connection_id`, `cost_known`.


#### commerce_suppliers

`id` (primary key), `organization_id`, `provider`, `external_supplier_id`, `name`, `account_number`, `contact_name`, `email`, `phone`, `archived`, `source_updated_at`, `source_payload_hash`, `sync_run_id`, `updated_at`, `connection_id`.


#### complimentary_access

`grant_id` (primary key), `user_id`, `organization_id`, `auth_subject_hash`, `active`, `created_at`.


#### customer_invoice_lines

`id` (primary key), `organization_id`, `invoice_id`, `line_number`, `description`, `quantity_milli`, `unit_price_cents`, `tax_rate_basis_points`, `subtotal_cents`, `tax_cents`, `total_cents`, `created_at`.


#### customer_invoices

`id` (primary key), `organization_id`, `customer_id`, `invoice_number`, `invoice_date`, `due_date`, `status`, `subtotal_cents`, `tax_cents`, `total_cents`, `paid_cents`, `currency`, `location_ref`, `journal_entry_id`, `demo_record`, `created_at`, `updated_at`, `purchase_order_ref`, `issuer_snapshot_json`, `customer_snapshot_json`, `notes`, `payment_instructions`, `document_id`, `sent_at`, `emailed_to`.


#### daily_business_metrics

`id` (primary key), `organization_id`, `business_date`, `location_ref`, `gross_sales_cents`, `net_sales_cents`, `cost_of_goods_cents`, `transaction_count`, `units_sold`, `refunds_cents`, `discounts_cents`, `labour_cost_cents`, `inventory_value_cents`, `cash_balance_cents`, `accounts_payable_cents`, `source_provider`, `source_connection_id`, `source_import_id`, `created_by_user_id`, `created_at`, `updated_at`, `labour_cost_reported`.


#### data_imports

`id` (primary key), `organization_id`, `import_type`, `status`, `file_name`, `row_count`, `idempotency_key`, `imported_by_user_id`, `created_at`.


#### document_email_aliases

`organization_id` (primary key), `alias`, `enabled`, `authorized_by_user_id`, `auth_subject`, `consent_version`, `consented_at`, `generation`, `created_at`, `updated_at`.


#### document_email_deliveries

`id` (primary key), `organization_id`, `alias_generation`, `body_sha256`, `status`, `lease_token`, `lease_until`, `created_at`, `updated_at`.


#### document_email_sources

`delivery_id` (primary key), `attachment_index` (primary key), `organization_id`, `document_id`, `sender_unverified`, `authorized_by_user_id`, `created_at`.


#### document_ingest_intents

`id` (primary key), `organization_id`, `object_key`, `sha256_hex`, `state`, `created_at`, `lease_token`, `lease_until`.


#### employee_pin_credentials

`member_id` (primary key), `organization_id`, `salt_hex`, `hash_hex`, `iterations`, `failed_attempts`, `locked_until`, `expires_at`, `force_change`, `revoked_at`, `created_at`, `updated_at`.


#### financial_accounts

`id` (primary key), `organization_id`, `code`, `name`, `account_type`, `account_subtype`, `normal_balance`, `system_key`, `parent_account_id`, `description`, `plain_language`, `tax_treatment`, `restricted`, `active`, `archived_at`, `created_at`, `updated_at`.


#### financial_transactions

`id` (primary key), `organization_id`, `transaction_date`, `posting_date`, `description`, `original_description`, `amount_cents`, `currency`, `exchange_rate_ppm`, `tax_amount_cents`, `account_id`, `contact_id`, `source_system`, `external_source_id`, `source_state`, `pending_external_source_id`, `location_ref`, `department_ref`, `project_ref`, `reconciliation_status`, `categorization_status`, `confidence_basis_points`, `approval_status`, `journal_entry_id`, `demo_record`, `created_at`, `updated_at`, `category_account_id`.


#### forecasting_runs

`id` (primary key), `organization_id`, `created_by`, `issued_at`, `horizon`, `model_version`, `input_hash`, `snapshot_json`, `report_json`.


#### forecasting_settings

`organization_id` (primary key), `location_id` (primary key), `settings_json`, `updated_by`, `updated_at`.


#### forecasting_views

`organization_id` (primary key), `user_id` (primary key), `preferences_json`, `updated_at`.


#### goods_receipts

`id` (primary key), `organization_id`, `purchase_order_id`, `received_date`, `received_by_user_id`, `lines_json`, `discrepancy_status`, `created_at`.


#### growth_touchpoints

`id` (primary key), `organization_id`, `occurred_at`, `source`, `stage`, `journey_ref`, `source_system`, `source_event_id`, `created_at`.


#### growth_transactions

`id` (primary key), `organization_id`, `occurred_at`, `journey_ref`, `revenue_cents`, `gross_profit_cents`, `source_system`, `source_event_id`, `created_at`.


#### integration_connections

`id` (primary key), `organization_id`, `provider`, `status`, `external_account_ref`, `domain_prefix`, `api_version`, `scopes_json`, `data_promotion_status`, `connected_at`, `last_successful_sync_at`, `last_sync_cursor`, `last_error_code`, `created_at`, `updated_at`, `external_account_name`, `privacy_data_deleted_at`, `source_namespace`, `sync_lease_owner`, `sync_lease_expires_at`, `sync_version`, `promotion_authorized_at`, `resource_selection_version`.


#### integration_consents

`id` (primary key), `organization_id`, `actor_user_id`, `provider`, `status`, `notice_version`, `privacy_policy_version`, `data_categories_json`, `purposes_json`, `consent_source`, `accepted_at`, `withdrawn_at`, `created_at`, `updated_at`.


#### integration_location_mappings

`id` (primary key), `organization_id`, `provider`, `external_location_ref`, `external_name`, `local_location_id`, `status`, `last_seen_at`, `created_at`, `updated_at`, `connection_id`.


#### integration_oauth_states

`state_hash` (primary key), `organization_id`, `actor_user_id`, `provider`, `expires_at`, `consumed_at`, `created_at`, `connection_id`, `initiator_auth_subject`, `initiator_auth_provider`, `initiator_assurance_level`.


#### integration_secrets

`id` (primary key), `organization_id`, `provider`, `access_token_ciphertext`, `refresh_token_ciphertext`, `token_expires_at`, `created_at`, `updated_at`, `connection_id`.


#### integration_source_authorities

`id` (primary key), `organization_id`, `local_location_id`, `channel`, `fact_family`, `provider`, `connection_id`, `created_by_user_id`, `updated_by_user_id`, `version`, `created_at`, `updated_at`.


#### integration_staged_financial_records

`id` (primary key), `organization_id`, `provider`, `external_record_id`, `record_type`, `category`, `source_ref`, `occurred_at`, `available_at`, `currency`, `gross_cents`, `fee_cents`, `net_cents`, `state`, `livemode`, `source_payload_hash`, `sync_run_id`, `staged_at`, `connection_id`.


#### integration_staged_sales

`id` (primary key), `organization_id`, `provider`, `external_sale_id`, `external_version`, `outlet_ref`, `sold_at`, `state`, `total_cents`, `tax_cents`, `cost_cents`, `discount_cents`, `line_count`, `source_payload_hash`, `sync_run_id`, `staged_at`, `connection_id`.


#### integration_sync_runs

`id` (primary key), `organization_id`, `provider`, `mode`, `status`, `cursor_before`, `cursor_after`, `records_read`, `records_staged`, `duplicates_skipped`, `warning_count`, `error_code`, `started_at`, `completed_at`, `created_by_user_id`, `connection_id`, `resource_selection_version`.


#### integration_sync_schedules

`connection_id` (primary key), `organization_id`, `provider`, `enabled`, `authorized_by_user_id`, `authorized_subject`, `authorization_version`, `authorized_at`, `generation`, `interval_seconds`, `next_run_at`, `last_started_at`, `last_finished_at`, `last_status`, `last_error_code`, `consecutive_failures`, `lease_owner`, `lease_expires_at`, `created_at`, `updated_at`, `cycle_started_at`.


#### integration_sync_ticks

`id` (primary key), `created_at`.


#### integration_webhook_events

`id` (primary key), `organization_id`, `provider`, `payload_hash`, `signature_hash`, `event_type`, `external_object_ref`, `status`, `received_at`, `processed_at`, `connection_id`.


#### internal_access

`id` (primary key), `user_id`, `organization_id`, `access_level`, `reason`, `active`, `mfa_required`, `created_by_user_id`, `created_at`, `updated_at`.


#### inventory_balances

`id` (primary key), `organization_id`, `location_ref`, `sku`, `name`, `on_hand_quantity`, `reorder_point`, `version`, `updated_at`, `source_provider`, `source_connection_id`.


#### inventory_lot_movements

`id` (primary key), `organization_id`, `lot_id`, `operational_event_id`, `quantity_delta`, `reason`, `notes`, `occurred_at`, `created_by_user_id`, `created_at`.


#### inventory_lots

`id` (primary key), `organization_id`, `location_ref`, `sku`, `product_name`, `supplier_name`, `lot_number`, `batch_number`, `manufacturing_date`, `received_date`, `expiration_date`, `best_before_date`, `shelf_life_days`, `unit_cost_cents`, `unit_retail_cents`, `quantity_received`, `quantity_remaining`, `storage_notes`, `status`, `source_system`, `source_ref`, `version`, `created_by_user_id`, `updated_by_user_id`, `created_at`, `updated_at`.


#### inventory_movements

`id` (primary key), `organization_id`, `operational_event_id`, `location_ref`, `sku`, `item_name`, `quantity_delta`, `reason`, `occurred_at`.


#### inventory_vehicles

`id` (primary key), `organization_id`, `location_id`, `identifier_kind`, `identifier`, `model_year`, `make`, `model`, `stock_number`, `status`, `acquired_date`, `currency`, `acquisition_cents`, `reconditioning_cents`, `source`, `version`, `created_by`, `updated_by`, `created_at`, `updated_at`.


#### invoice_matches

`id` (primary key), `organization_id`, `purchase_order_id`, `document_id`, `status`, `difference_cents`, `details_json`, `reviewed_by_user_id`, `created_at`, `updated_at`.


#### journal_entries

`id` (primary key), `organization_id`, `entry_number`, `entry_date`, `posting_date`, `period_id`, `status`, `source_type`, `source_ref`, `memo`, `currency`, `exchange_rate_ppm`, `total_debit_cents`, `total_credit_cents`, `reversal_of_entry_id`, `idempotency_key`, `prepared_by_user_id`, `approved_by_user_id`, `posted_at`, `created_at`, `updated_at`.


#### journal_lines

`id` (primary key), `organization_id`, `journal_entry_id`, `line_number`, `account_id`, `description`, `debit_cents`, `credit_cents`, `tax_code`, `tax_amount_cents`, `contact_id`, `location_ref`, `department_ref`, `project_ref`, `created_at`.


#### legal_acceptances

`id` (primary key), `organization_id`, `user_id`, `terms_version`, `privacy_policy_version`, `notice_version`, `acceptance_source`, `source_hash`, `user_agent_hash`, `request_id`, `accepted_at`, `created_at`.


#### linked_files

`id` (primary key), `organization_id`, `user_id`, `connection_id`, `remote_id`, `sheet_name`, `name`, `kind`, `enabled`, `revision`, `snapshot_ciphertext`, `document_id`, `last_checked_at`, `last_changed_at`, `error_code`, `lease`, `lease_expires_at`, `created_at`, `updated_at`.


#### marketing_calendar_entries

`id` (primary key), `organization_id`, `title`, `channel`, `event_type`, `start_date`, `due_date`, `status`, `objective`, `notes`, `created_by_user_id`, `created_at`, `updated_at`.


#### marketing_daily_metrics

`id` (primary key), `resource_selection_id`, `metric_date`, `metric_key`, `value_milli`, `source_event_id`, `created_at`, `updated_at`.


#### marketing_email_events

`id` (primary key), `email_hash`, `subject_hash`, `action`, `source`, `notice_json`, `occurred_at`, `intent_at`, `source_hash`, `user_agent_hash`.


#### marketing_email_intents

`token_hash` (primary key), `email_hash`, `selected`, `notice_json`, `created_at`, `expires_at`, `source_hash`, `user_agent_hash`.


#### marketing_email_preferences

`email_hash` (primary key), `subject_hash`, `email_encrypted`, `status`, `current_event_id`, `updated_at`.


#### marketing_email_unsubscribe_tokens

`token_hash` (primary key), `email_hash`, `created_at`, `expires_at`.


#### marketing_profiles

`organization_id` (primary key), `business_model`, `primary_offer`, `target_audience`, `service_area`, `primary_goal`, `website_url`, `google_profile_status`, `notes`, `updated_by_user_id`, `created_at`, `updated_at`.


#### marketing_resource_selections

`id` (primary key), `organization_id`, `connection_id`, `provider`, `dataset`, `external_resource_ref`, `external_resource_name`, `scope_kind`, `local_location_id`, `selected_by_user_id`, `selected_at`, `created_at`, `updated_at`.


#### memberships

`id` (primary key), `user_id`, `organization_id`, `role`, `status`, `created_at`, `updated_at`.


#### month_end_items

`id` (primary key), `organization_id`, `period_id`, `item_key`, `title`, `status`, `assigned_user_id`, `due_date`, `blocker`, `completed_at`, `updated_at`.


#### operational_events

`id` (primary key), `organization_id`, `event_type`, `aggregate_type`, `aggregate_id`, `source_system`, `source_event_id`, `payload_json`, `occurred_at`, `recorded_at`.


#### opportunity_review_events

`id` (primary key), `review_id`, `organization_id`, `version`, `status`, `note`, `actor_user_id`, `created_at`.


#### opportunity_reviews

`id` (primary key), `organization_id`, `scope_key`, `scope_label`, `rule_id`, `period_start`, `period_end`, `snapshot_json`, `required_permissions_json`, `status`, `snoozed_until`, `version`, `mutation_key`, `created_by_user_id`, `created_at`, `updated_at`.


#### organization_locations

`id` (primary key), `organization_id`, `name`, `status`, `country_code`, `address_line_1`, `address_line_2`, `address_line_3`, `locality`, `district`, `administrative_area`, `postal_code`, `timezone`, `currency`, `locale`, `tax_jurisdiction`, `validation_status`, `latitude_e6`, `longitude_e6`, `created_at`, `updated_at`.


#### organization_profiles

`organization_id` (primary key), `display_name`, `organization_type`, `business_structure`, `locale`, `language`, `brand_color`, `logo_object_key`, `logo_content_type`, `logo_alt_text`, `logo_version`, `created_at`, `updated_at`.


#### organizations

`id` (primary key), `owner_email`, `owner_name`, `business_name`, `legal_name`, `business_email`, `phone`, `website`, `industry`, `country`, `province`, `city`, `address`, `postal_code`, `timezone`, `currency`, `fiscal_year_start`, `tax_number`, `hours_json`, `source_mode`, `selected_pos`, `setup_complete`, `created_at`, `updated_at`.


#### outbound_messages

`id` (primary key), `organization_id`, `operational_event_id`, `channel`, `recipient`, `subject`, `body_text`, `status`, `attempt_count`, `next_attempt_at`, `provider_message_ref`, `last_error_code`, `created_at`, `updated_at`.


#### purchase_order_lines

`id` (primary key), `organization_id`, `purchase_order_id`, `line_number`, `sku`, `description`, `quantity`, `received_quantity`, `invoiced_quantity`, `unit_cost_cents`, `previous_cost_cents`, `landed_cost_cents`, `current_inventory`, `reorder_point`, `forecast_demand`, `created_at`, `updated_at`, `provider`, `external_product_ref`, `connection_id`.


#### purchase_orders

`id` (primary key), `organization_id`, `order_number`, `supplier_name`, `delivery_location_id`, `order_date`, `expected_delivery_date`, `currency`, `payment_terms`, `status`, `subtotal_cents`, `tax_cents`, `discount_cents`, `total_cents`, `committed_cash_date`, `notes`, `approved_by_user_id`, `created_by_user_id`, `created_at`, `updated_at`.


#### rate_limit_buckets

`bucket_key` (primary key), `scope`, `actor_hash`, `window_start`, `request_count`, `expires_at`.


#### reconciliations

`id` (primary key), `organization_id`, `account_id`, `reconciliation_type`, `start_date`, `end_date`, `opening_balance_cents`, `closing_balance_cents`, `book_balance_cents`, `difference_cents`, `status`, `prepared_by_user_id`, `reviewed_by_user_id`, `completed_at`, `created_at`, `updated_at`.


#### retail_measurements

`id` (primary key), `organization_id`, `connection_id`, `provider`, `outlet_ref`, `kind`, `reference`, `period_from`, `period_to`, `source_label`, `values_json`, `updated_by_user_id`, `version`, `updated_at`.


#### search_visibility_observations

`id` (primary key), `organization_id`, `query`, `observed_date`, `position_milli`, `discovery_actions`, `source_system`, `source_event_id`, `created_at`.


#### shopify_privacy_requests

`id` (primary key), `organization_id`, `connection_id`, `provider`, `request_hash`, `request_ciphertext`, `status`, `received_at`, `due_at`, `last_exported_at`, `last_export_complete`, `last_export_count`, `completed_at`, `completed_by_user_id`, `completion_method`, `completion_reference_hash`.


#### shopify_store_locks

`shop_domain` (primary key), `organization_id`, `created_at`, `updated_at`.


#### stripe_billing_events

`event_id` (primary key), `organization_id`, `event_type`, `stripe_created_at`, `payload_hash`, `status`, `error_code`, `received_at`, `processed_at`.


#### supplier_bills

`id` (primary key), `organization_id`, `supplier_id`, `bill_number`, `invoice_date`, `due_date`, `status`, `subtotal_cents`, `tax_cents`, `total_cents`, `paid_cents`, `currency`, `purchase_order_ref`, `location_ref`, `approval_status`, `journal_entry_id`, `demo_record`, `created_at`, `updated_at`.


#### tasks

`id` (primary key), `organization_id`, `title`, `detail`, `priority`, `status`, `assignee`, `due_date`, `created_by`, `created_at`, `updated_at`.


#### team_members

`id` (primary key), `organization_id`, `user_id`, `role_id`, `first_name`, `last_name`, `preferred_name`, `email`, `mobile`, `employee_code`, `job_title`, `department`, `employment_type`, `start_date`, `end_date`, `manager_member_id`, `primary_location_id`, `permitted_locations_json`, `status`, `remote_login`, `require_mfa`, `pin_enabled`, `invitation_sent_at`, `invitation_expires_at`, `last_login_at`, `notes`, `created_by_user_id`, `created_at`, `updated_at`.


#### tenant_addons

`id` (primary key), `organization_id`, `addon_key`, `status`, `stripe_subscription_item_id`, `stripe_price_id`, `current_period_ends_at`, `scheduled_removal_at`, `last_synced_at`, `created_at`, `updated_at`.


#### tenant_subscriptions

`organization_id` (primary key), `base_plan`, `billing_interval`, `status`, `stripe_customer_id`, `stripe_subscription_id`, `stripe_base_price_id`, `trial_ends_at`, `current_period_ends_at`, `cancel_at_period_end`, `scheduled_base_plan`, `scheduled_billing_interval`, `scheduled_effective_at`, `last_stripe_event_id`, `last_stripe_event_created_at`, `last_synced_at`, `version`, `created_at`, `updated_at`, `trial_access_ends_at`, `trial_converted_at`.


#### users

`id` (primary key), `email`, `display_name`, `status`, `created_at`, `updated_at`, `auth_subject`, `auth_provider`.


#### workspace_documents

`id` (primary key), `organization_id`, `document_type`, `file_name`, `object_key`, `content_type`, `size_bytes`, `sha256_hex`, `security_state`, `status`, `scan_status`, `scanned_at`, `scan_provider`, `extraction_status`, `extracted_json`, `uploaded_by_user_id`, `created_at`, `updated_at`.


#### workspace_sessions

`id` (primary key), `user_id`, `organization_id`, `started_at`, `last_seen_at`, `expires_at`, `revoked`.


#### workspace_tasks

`id` (primary key), `organization_id`, `title`, `detail`, `priority`, `status`, `assignee`, `due_date`, `source_type`, `source_ref`, `expected_impact`, `created_by_user_id`, `idempotency_key`, `created_at`, `updated_at`.


#### workspaces

`id` (primary key), `owner_name`, `business_name`, `legal_name`, `business_email`, `phone`, `website`, `industry`, `country`, `province`, `city`, `address`, `postal_code`, `timezone`, `currency`, `fiscal_year_start`, `tax_number`, `hours_json`, `source_mode`, `selected_pos`, `setup_complete`, `created_at`, `updated_at`.


### Migration register

| Migration | Creates |
| --- | --- |
| drizzle/0000_curved_cammi.sql | tasks |
| drizzle/0001_stale_gabe_jones.sql | organizations |
| drizzle/0002_absent_shard.sql | audit_events, integration_connections, memberships, rate_limit_buckets, users, workspace_tasks, workspaces, __new_organizations |
| drizzle/0003_mute_betty_ross.sql | business_events, daily_business_metrics, data_imports, __new_workspace_tasks |
| drizzle/0004_lyrical_black_bird.sql | accounting_periods, bank_accounts, bookloq_alerts, bookloq_budgets, bookloq_contacts, bookloq_role_assignments, bookloq_settings, customer_invoices, financial_accounts, financial_transactions, journal_entries, journal_lines, month_end_items, reconciliations, supplier_bills |
| drizzle/0005_medical_mantis.sql | account_notifications, account_preferences |
| drizzle/0006_colossal_the_fallen.sql | access_roles, employee_pin_credentials, goods_receipts, invoice_matches, organization_locations, organization_profiles, purchase_order_lines, purchase_orders, team_members, workspace_documents |
| drizzle/0007_wakeful_stardust.sql | integration_location_mappings, integration_oauth_states, integration_secrets, integration_staged_sales, integration_sync_runs, integration_webhook_events, __new_integration_connections |
| drizzle/0008_sturdy_deathbird.sql | Schema/data change without a new table |
| drizzle/0009_sweet_dexter_bennett.sql | inventory_balances, inventory_movements, operational_events, outbound_messages |
| drizzle/0010_short_ares.sql | growth_touchpoints, growth_transactions, search_visibility_observations |
| drizzle/0011_remove_production_demo_data.sql | Schema/data change without a new table |
| drizzle/0012_amazing_microbe.sql | inventory_lot_movements, inventory_lots |
| drizzle/0013_acoustic_genesis.sql | tenant_addons, tenant_subscriptions |
| drizzle/0014_watery_pixie.sql | internal_access |
| drizzle/0015_medical_apocalypse.sql | integration_staged_financial_records |
| drizzle/0016_smart_ken_ellis.sql | stripe_billing_events |
| drizzle/0017_founder_email_verification.sql | Schema/data change without a new table |
| drizzle/0018_overjoyed_ben_grimm.sql | commerce_customers, commerce_products, commerce_sale_lines, commerce_suppliers |
| drizzle/0019_eminent_gideon.sql | commerce_payments |
| drizzle/0020_special_speedball.sql | marketing_calendar_entries, marketing_profiles |
| drizzle/0021_abandoned_morlocks.sql | Schema/data change without a new table |
| drizzle/0022_cheerful_silhouette.sql | __new_financial_transactions |
| drizzle/0023_careless_shooting_star.sql | __new_workspace_documents |
| drizzle/0024_thick_mysterio.sql | integration_consents |
| drizzle/0025_talented_gateway.sql | __new_workspace_documents, __new_workspace_documents |
| drizzle/0026_lazy_gamma_corps.sql | marketing_daily_metrics, marketing_reviews |
| drizzle/0027_fuzzy_jean_grey.sql | integration_source_authorities |
| drizzle/0028_fair_wallflower.sql | marketing_resource_selections, __new_marketing_daily_metrics |
| drizzle/0029_shallow_calypso.sql | customer_invoice_lines |
| drizzle/0030_sudden_jackpot.sql | Schema/data change without a new table |
| drizzle/0031_sad_dreadnoughts.sql | bookloq_category_rules, bookloq_transaction_matches |
| drizzle/0032_loving_secret_warriors.sql | Schema/data change without a new table |
| drizzle/0033_perfect_iron_man.sql | __new_commerce_products |
| drizzle/0034_true_lightspeed.sql | __new_marketing_resource_selections |
| drizzle/0035_grounded_assistant.sql | assistant_conversations, assistant_messages |
| drizzle/0036_versioned_legal_acceptance.sql | legal_acceptances |
| drizzle/0037_shopify_store_ownership.sql | shopify_store_locks |
| drizzle/0038_nice_major_mapleleaf.sql | account_deletion_receipts |
| drizzle/0039_journal_period_guards.sql | Schema/data change without a new table |
| drizzle/0040_magenta_edwin_jarvis.sql | account_deletion_jobs |
| drizzle/0041_ambitious_exodus.sql | Schema/data change without a new table |
| drizzle/0042_normal_paibok.sql | retail_measurements |
| drizzle/0043_amazing_gambit.sql | Schema/data change without a new table |
| drizzle/0044_slim_dragon_man.sql | integration_sync_schedules, integration_sync_ticks |
| drizzle/0045_absent_shape.sql | Schema/data change without a new table |
| drizzle/0046_clean_blazing_skull.sql | Schema/data change without a new table |
| drizzle/0047_pale_vertigo.sql | __new_daily_business_metrics |
| drizzle/0048_nice_redwing.sql | opportunity_review_events, opportunity_reviews |
| drizzle/0049_even_toxin.sql | workspace_sessions |
| drizzle/0050_lucky_madelyne_pryor.sql | Schema/data change without a new table |
| drizzle/0051_reviewed_bank_statements.sql | bank_statement_imports, bank_statement_rows |
| drizzle/0052_document_deletion_guards.sql | Schema/data change without a new table |
| drizzle/0053_marketing_email_consent.sql | marketing_email_intents, marketing_email_preferences, marketing_email_events, marketing_email_unsubscribe_tokens |
| drizzle/0054_document_timestamp_units.sql | Schema/data change without a new table |
| drizzle/0055_document_cleanup_retry_indexes.sql | Schema/data change without a new table |
| drizzle/0056_document_email_inbox.sql | document_email_aliases, document_email_deliveries, document_email_sources, document_ingest_intents |
| drizzle/0057_checkout_coordination.sql | billing_checkout_attempts |
| drizzle/0058_complimentary_access.sql | complimentary_access |
| drizzle/0059_bookloq_standalone_plan.sql | __new_tenant_subscriptions |
| drizzle/0060_dashboard_preferences.sql | Schema/data change without a new table |
| drizzle/0061_linked_files.sql | cloud_file_connections, linked_files |
| drizzle/0062_dashboard_workspace_scope.sql | Schema/data change without a new table |
| drizzle/0063_forecasting.sql | forecasting_settings, forecasting_runs, forecasting_views |
| drizzle/0064_advisor_experience.sql | advisor_preferences, advisor_requests |
| drizzle/0065_subscription_trial_access.sql | Schema/data change without a new table |
| drizzle/0066_vehicle_inventory.sql | inventory_vehicles |
| drizzle/0067_shopify_privacy_requests.sql | shopify_privacy_requests |


### HTTP endpoint register

The routes below are source entry points. Client navigation, rate limits, authentication, MFA, owner/role/location checks, plan gates, signatures and provider permissions still apply. An unauthenticated route can be an intentional public health or signed webhook endpoint. The JSON companion records guard references and test mappings; those mappings do not establish universal coverage.

| Path | Methods | Source |
| --- | --- | --- |
| /api/health | GET | app/api/health/route.ts |
| /api/internal/pos-sync | POST | app/api/internal/pos-sync/route.ts |
| /api/readiness | GET | app/api/readiness/route.ts |
| /api/v1/account/deletion/plan | POST | app/api/v1/account/deletion/plan/route.ts |
| /api/v1/account/deletion/resume | POST | app/api/v1/account/deletion/resume/route.ts |
| /api/v1/account/deletion | GET, POST | app/api/v1/account/deletion/route.ts |
| /api/v1/address | GET, POST | app/api/v1/address/route.ts |
| /api/v1/advisor/chat | DELETE, GET, POST | app/api/v1/advisor/chat/route.ts |
| /api/v1/advisor/consent | DELETE, GET, POST | app/api/v1/advisor/consent/route.ts |
| /api/v1/advisor/conversations | DELETE, GET, PATCH | app/api/v1/advisor/conversations/route.ts |
| /api/v1/advisor/preferences | DELETE, GET, PUT | app/api/v1/advisor/preferences/route.ts |
| /api/v1/auth/signin | POST | app/api/v1/auth/signin/route.ts |
| /api/v1/auth/signup | GET | app/api/v1/auth/signup/route.ts |
| /api/v1/backend | GET | app/api/v1/backend/route.ts |
| /api/v1/billing/checkout | POST | app/api/v1/billing/checkout/route.ts |
| /api/v1/billing/portal | POST | app/api/v1/billing/portal/route.ts |
| /api/v1/billing | GET | app/api/v1/billing/route.ts |
| /api/v1/billing/stripe/webhook | POST | app/api/v1/billing/stripe/webhook/route.ts |
| /api/v1/bookloq/actions | POST | app/api/v1/bookloq/actions/route.ts |
| /api/v1/bookloq/collections | GET | app/api/v1/bookloq/collections/route.ts |
| /api/v1/bookloq/demo | POST | app/api/v1/bookloq/demo/route.ts |
| /api/v1/bookloq/invoices/email | POST | app/api/v1/bookloq/invoices/email/route.ts |
| /api/v1/bookloq/invoices | POST | app/api/v1/bookloq/invoices/route.ts |
| /api/v1/bookloq/journals | PATCH, POST | app/api/v1/bookloq/journals/route.ts |
| /api/v1/bookloq | GET | app/api/v1/bookloq/route.ts |
| /api/v1/bookloq/statements | GET, POST | app/api/v1/bookloq/statements/route.ts |
| /api/v1/command-centre | GET | app/api/v1/command-centre/route.ts |
| /api/v1/commerce-intelligence | GET | app/api/v1/commerce-intelligence/route.ts |
| /api/v1/commerce | GET | app/api/v1/commerce/route.ts |
| /api/v1/communications/config | GET | app/api/v1/communications/config/route.ts |
| /api/v1/communications/preferences | GET, POST | app/api/v1/communications/preferences/route.ts |
| /api/v1/communications/signup-intent | POST | app/api/v1/communications/signup-intent/route.ts |
| /api/v1/communications/unsubscribe | POST | app/api/v1/communications/unsubscribe/route.ts |
| /api/v1/custom-plan | GET, POST | app/api/v1/custom-plan/route.ts |
| /api/v1/daily-metrics | GET, POST | app/api/v1/daily-metrics/route.ts |
| /api/v1/data-quality | GET | app/api/v1/data-quality/route.ts |
| /api/v1/documents/email/deliver | POST | app/api/v1/documents/email/deliver/route.ts |
| /api/v1/documents/email | GET, POST | app/api/v1/documents/email/route.ts |
| /api/v1/documents | DELETE, GET, PATCH, POST | app/api/v1/documents/route.ts |
| /api/v1/entitlements | GET | app/api/v1/entitlements/route.ts |
| /api/v1/events | GET, POST | app/api/v1/events/route.ts |
| /api/v1/forecasting | GET, POST | app/api/v1/forecasting/route.ts |
| /api/v1/governance | GET, POST | app/api/v1/governance/route.ts |
| /api/v1/growth | GET, POST | app/api/v1/growth/route.ts |
| /api/v1/integrations/clover/authorize | POST | app/api/v1/integrations/clover/authorize/route.ts |
| /api/v1/integrations/clover/callback | GET | app/api/v1/integrations/clover/callback/route.ts |
| /api/v1/integrations/clover/disconnect | POST | app/api/v1/integrations/clover/disconnect/route.ts |
| /api/v1/integrations/clover/locations | GET, POST | app/api/v1/integrations/clover/locations/route.ts |
| /api/v1/integrations/clover/sync | POST | app/api/v1/integrations/clover/sync/route.ts |
| /api/v1/integrations/clover/webhook | POST | app/api/v1/integrations/clover/webhook/route.ts |
| /api/v1/integrations/deel/authorize | POST | app/api/v1/integrations/deel/authorize/route.ts |
| /api/v1/integrations/deel/callback | GET | app/api/v1/integrations/deel/callback/route.ts |
| /api/v1/integrations/deel/disconnect | POST | app/api/v1/integrations/deel/disconnect/route.ts |
| /api/v1/integrations/deel/status | GET | app/api/v1/integrations/deel/status/route.ts |
| /api/v1/integrations/deel/sync | POST | app/api/v1/integrations/deel/sync/route.ts |
| /api/v1/integrations/google/authorize | POST | app/api/v1/integrations/google/authorize/route.ts |
| /api/v1/integrations/google/business-profile/reviews | GET, POST | app/api/v1/integrations/google/business-profile/reviews/route.ts |
| /api/v1/integrations/google/callback | GET | app/api/v1/integrations/google/callback/route.ts |
| /api/v1/integrations/google/disconnect | POST | app/api/v1/integrations/google/disconnect/route.ts |
| /api/v1/integrations/google/resources | POST | app/api/v1/integrations/google/resources/route.ts |
| /api/v1/integrations/google/sync | POST | app/api/v1/integrations/google/sync/route.ts |
| /api/v1/integrations/lightspeed-r/authorize | POST | app/api/v1/integrations/lightspeed-r/authorize/route.ts |
| /api/v1/integrations/lightspeed-r/callback | GET | app/api/v1/integrations/lightspeed-r/callback/route.ts |
| /api/v1/integrations/lightspeed-r/disconnect | POST | app/api/v1/integrations/lightspeed-r/disconnect/route.ts |
| /api/v1/integrations/lightspeed-r/shops | GET, POST | app/api/v1/integrations/lightspeed-r/shops/route.ts |
| /api/v1/integrations/lightspeed-r/sync | POST | app/api/v1/integrations/lightspeed-r/sync/route.ts |
| /api/v1/integrations/lightspeed/authorize | POST | app/api/v1/integrations/lightspeed/authorize/route.ts |
| /api/v1/integrations/lightspeed/callback | GET | app/api/v1/integrations/lightspeed/callback/route.ts |
| /api/v1/integrations/lightspeed/disconnect | POST | app/api/v1/integrations/lightspeed/disconnect/route.ts |
| /api/v1/integrations/lightspeed/outlets | GET, POST | app/api/v1/integrations/lightspeed/outlets/route.ts |
| /api/v1/integrations/lightspeed/sync | POST | app/api/v1/integrations/lightspeed/sync/route.ts |
| /api/v1/integrations/lightspeed/webhook | POST | app/api/v1/integrations/lightspeed/webhook/route.ts |
| /api/v1/integrations/meta/authorize | POST | app/api/v1/integrations/meta/authorize/route.ts |
| /api/v1/integrations/meta/callback | GET | app/api/v1/integrations/meta/callback/route.ts |
| /api/v1/integrations/meta/campaigns | GET, POST | app/api/v1/integrations/meta/campaigns/route.ts |
| /api/v1/integrations/meta/disconnect | POST | app/api/v1/integrations/meta/disconnect/route.ts |
| /api/v1/integrations/meta/resources | POST | app/api/v1/integrations/meta/resources/route.ts |
| /api/v1/integrations/meta/sync | POST | app/api/v1/integrations/meta/sync/route.ts |
| /api/v1/integrations/moneris/connect | POST | app/api/v1/integrations/moneris/connect/route.ts |
| /api/v1/integrations/moneris/disconnect | POST | app/api/v1/integrations/moneris/disconnect/route.ts |
| /api/v1/integrations/moneris/sync | POST | app/api/v1/integrations/moneris/sync/route.ts |
| /api/v1/integrations/plaid/delete-data | POST | app/api/v1/integrations/plaid/delete-data/route.ts |
| /api/v1/integrations/plaid/disconnect | POST | app/api/v1/integrations/plaid/disconnect/route.ts |
| /api/v1/integrations/plaid/exchange | POST | app/api/v1/integrations/plaid/exchange/route.ts |
| /api/v1/integrations/plaid/link-token | POST | app/api/v1/integrations/plaid/link-token/route.ts |
| /api/v1/integrations/plaid/sync | POST | app/api/v1/integrations/plaid/sync/route.ts |
| /api/v1/integrations/plaid/webhook | POST | app/api/v1/integrations/plaid/webhook/route.ts |
| /api/v1/integrations/quickbooks/authorize | POST | app/api/v1/integrations/quickbooks/authorize/route.ts |
| /api/v1/integrations/quickbooks/callback | GET | app/api/v1/integrations/quickbooks/callback/route.ts |
| /api/v1/integrations/quickbooks/disconnect | POST | app/api/v1/integrations/quickbooks/disconnect/route.ts |
| /api/v1/integrations | GET, POST | app/api/v1/integrations/route.ts |
| /api/v1/integrations/schedule | POST | app/api/v1/integrations/schedule/route.ts |
| /api/v1/integrations/shopify-pos/authorize | POST | app/api/v1/integrations/shopify-pos/authorize/route.ts |
| /api/v1/integrations/shopify-pos/callback | GET | app/api/v1/integrations/shopify-pos/callback/route.ts |
| /api/v1/integrations/shopify-pos/disconnect | POST | app/api/v1/integrations/shopify-pos/disconnect/route.ts |
| /api/v1/integrations/shopify-pos/locations | GET, POST | app/api/v1/integrations/shopify-pos/locations/route.ts |
| /api/v1/integrations/shopify-pos/sync | POST | app/api/v1/integrations/shopify-pos/sync/route.ts |
| /api/v1/integrations/shopify-pos/webhook | POST | app/api/v1/integrations/shopify-pos/webhook/route.ts |
| /api/v1/integrations/shopify/authorize | POST | app/api/v1/integrations/shopify/authorize/route.ts |
| /api/v1/integrations/shopify/callback | GET | app/api/v1/integrations/shopify/callback/route.ts |
| /api/v1/integrations/shopify/disconnect | POST | app/api/v1/integrations/shopify/disconnect/route.ts |
| /api/v1/integrations/shopify/locations | GET, POST | app/api/v1/integrations/shopify/locations/route.ts |
| /api/v1/integrations/shopify/privacy | GET, POST | app/api/v1/integrations/shopify/privacy/route.ts |
| /api/v1/integrations/shopify/sync | POST | app/api/v1/integrations/shopify/sync/route.ts |
| /api/v1/integrations/shopify/webhook | POST | app/api/v1/integrations/shopify/webhook/route.ts |
| /api/v1/integrations/slack/authorize | POST | app/api/v1/integrations/slack/authorize/route.ts |
| /api/v1/integrations/slack/callback | GET | app/api/v1/integrations/slack/callback/route.ts |
| /api/v1/integrations/slack/disconnect | POST | app/api/v1/integrations/slack/disconnect/route.ts |
| /api/v1/integrations/slack/share-workspace | POST | app/api/v1/integrations/slack/share-workspace/route.ts |
| /api/v1/integrations/slack/status | GET | app/api/v1/integrations/slack/status/route.ts |
| /api/v1/integrations/slack/test-notification | POST | app/api/v1/integrations/slack/test-notification/route.ts |
| /api/v1/integrations/square/authorize | POST | app/api/v1/integrations/square/authorize/route.ts |
| /api/v1/integrations/square/callback | GET | app/api/v1/integrations/square/callback/route.ts |
| /api/v1/integrations/square/disconnect | POST | app/api/v1/integrations/square/disconnect/route.ts |
| /api/v1/integrations/square/locations | GET, POST | app/api/v1/integrations/square/locations/route.ts |
| /api/v1/integrations/square/sync | POST | app/api/v1/integrations/square/sync/route.ts |
| /api/v1/integrations/square/webhook | POST | app/api/v1/integrations/square/webhook/route.ts |
| /api/v1/integrations/stripe/authorize | POST | app/api/v1/integrations/stripe/authorize/route.ts |
| /api/v1/integrations/stripe/callback | GET | app/api/v1/integrations/stripe/callback/route.ts |
| /api/v1/integrations/stripe/disconnect | POST | app/api/v1/integrations/stripe/disconnect/route.ts |
| /api/v1/integrations/stripe/sync | POST | app/api/v1/integrations/stripe/sync/route.ts |
| /api/v1/integrations/stripe/webhook | POST | app/api/v1/integrations/stripe/webhook/route.ts |
| /api/v1/internal/team-access | POST | app/api/v1/internal/team-access/route.ts |
| /api/v1/internal/team-provisioning | GET | app/api/v1/internal/team-provisioning/route.ts |
| /api/v1/inventory-costs | POST | app/api/v1/inventory-costs/route.ts |
| /api/v1/inventory-lifecycle | GET, POST | app/api/v1/inventory-lifecycle/route.ts |
| /api/v1/legal/acceptance | GET, POST | app/api/v1/legal/acceptance/route.ts |
| /api/v1/linked-files/google-files/callback | GET | app/api/v1/linked-files/google-files/callback/route.ts |
| /api/v1/linked-files/microsoft-files/callback | GET | app/api/v1/linked-files/microsoft-files/callback/route.ts |
| /api/v1/linked-files | GET, POST | app/api/v1/linked-files/route.ts |
| /api/v1/locations | GET | app/api/v1/locations/route.ts |
| /api/v1/marketing/reports | GET | app/api/v1/marketing/reports/route.ts |
| /api/v1/onboarding | GET, POST | app/api/v1/onboarding/route.ts |
| /api/v1/openapi | GET | app/api/v1/openapi/route.ts |
| /api/v1/operations | GET, POST | app/api/v1/operations/route.ts |
| /api/v1/opportunities | GET, PATCH, POST | app/api/v1/opportunities/route.ts |
| /api/v1/organization-logo | DELETE, GET, POST | app/api/v1/organization-logo/route.ts |
| /api/v1/preferences | GET, POST | app/api/v1/preferences/route.ts |
| /api/v1/purchasing | GET, POST | app/api/v1/purchasing/route.ts |
| /api/v1/reports | GET, POST | app/api/v1/reports/route.ts |
| /api/v1/retail-intelligence | GET | app/api/v1/retail-intelligence/route.ts |
| /api/v1/retail-measurements | GET, POST | app/api/v1/retail-measurements/route.ts |
| /api/v1/session | DELETE, GET, POST | app/api/v1/session/route.ts |
| /api/v1/tasks | GET, PATCH, POST | app/api/v1/tasks/route.ts |
| /api/v1/team-invitations | GET, POST | app/api/v1/team-invitations/route.ts |
| /api/v1/vehicles | GET, PATCH, POST | app/api/v1/vehicles/route.ts |


### Page routes

| Route | Source |
| --- | --- |
| /account/deletion-status | app/account/deletion-status/page.tsx |
| /account/deletion | app/account/deletion/page.tsx |
| /contact | app/contact/page.tsx |
| /cookies | app/cookies/page.tsx |
| /custom-plan | app/custom-plan/page.tsx |
| /data-processing | app/data-processing/page.tsx |
| /demo | app/demo/page.tsx |
| /email/unsubscribe | app/email/unsubscribe/page.tsx |
| /features/[slug] | app/features/[slug]/page.tsx |
| /help | app/help/page.tsx |
| /legal | app/legal/page.tsx |
| / | app/page.tsx |
| /pricing | app/pricing/page.tsx |
| /privacy-requests | app/privacy-requests/page.tsx |
| /privacy | app/privacy/page.tsx |
| /resources/[segment] | app/resources/[segment]/page.tsx |
| /resources | app/resources/page.tsx |
| /social | app/social/page.tsx |
| /subprocessors | app/subprocessors/page.tsx |
| /terms | app/terms/page.tsx |


### Background and event processing

#### Signed POS synchronization

Trigger: POST /api/internal/pos-sync. Signed, timestamped and replay-protected external tick. At most three due POS jobs; per-connection authorization and leases. External trigger activation is not verified.


#### Authorized document cleanup

Trigger: Accepted signed POS tick. At most three existing authorized cleanup/failed-ingest jobs. Does not create general age-based disposal.


#### Expired rate-limit cleanup

Trigger: Accepted signed POS tick. Runs cleanupExpiredRateLimits; actual scheduled production execution is not verified.


#### Inbound document email

Trigger: Cloudflare Email Worker email event. Separate email worker forwards authorized routed mail for ingestion. Enabled/verified flags do not prove this release delivery, scan and extraction.


#### Provider notifications

Trigger: Provider-specific webhook routes. Receipts and processing vary by provider. A route does not prove subscription, delivery, historical coverage or completed privacy fulfilment.


### Inventory provenance

Generated: 2026-10-01T09:49:29.354Z. Source extraction records HEAD `d27c54b1bd48b8cae6da5961d9156810105fe0e4` plus the final working changes at extraction time. Use the deployment/source record above for the actual published commit. The full JSON contains source hashes and test-reference mappings. Do not infer current production row counts or customer contents from this document.

This source snapshot includes the deterministic timestamp correction in `app/executive-overview.tsx`, `app/invoice-overview.tsx`, `app/revenue-source-detail.tsx`, `domain/executive-presentation.ts` and the new candidate test `tests/dashboard-hydration.test.tsx`. The manual verification record reports execution and deployment separately.

<!-- GENERATED_INVENTORY_END -->
