# Vanteloq subscription review and pricing proposal

**Decision status:** Approved by the owner on October 1, 2026: retain existing monthly prices and customer access. No subscriber migration or new monthly usage/storage quotas. The quota examples below remain unapproved proposals, not customer limits. Pricing presentation and validation have been updated in source; the final release report records publication and tests.

**Research date:** October 1, 2026. All external sources below were accessed on that date. Pricing may change. Competitor prices are regular prices unless explicitly identified otherwise.

**Recommendation:** Retain Starter at CAD49/month, Growth at CAD99/month, Pro at CAD179/month, BookLoQ at CAD39/month as an add-on, and BookLoQ at CAD59/month standalone. Preserve existing entitlements and annual subscriptions. Introduce a reviewed versioned policy for future allowances only after metering, cost evidence, public disclosure, and migration tests are ready.

## 1. Scope and evidence

This review covers the current source catalogue, entitlement resolver, billing price validation, public pricing copy, integration readiness definitions, forecast access, AI provider configuration, and document processing. It compares official competitor prices and supplier rates, then models usage costs with explicit assumptions.

Source checkout: [work/vanteloq](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq). This is a local source inspection, not a certification of the deployed Site or live Stripe state. The parent task reports stage 1 forecasting verified locally. That statement is not a production deployment receipt or independent repetition of those tests by this research task.

Source matrix generated at 2026-10-01T07:53:58.874Z. Catalogue SHA-256: `cbac6c2752e31530f307e8933e710e4c4d81a13fd1a00a0de5de98a4d0b08957`. Counts: 103 stable feature keys; Starter 19, Growth 69, Pro 89, BookLoQ standalone 23, add-on 14. Repository work may continue after this snapshot; recheck before commercial approval.

Evidence classes used throughout:

- **Verified source:** Directly read from this checkout.
- **Verified public source:** Read from an official provider or competitor page on the access date.
- **Assumption/proposal:** A commercial or modeling choice for review, not an existing promise.
- **Unverified:** Actual account configuration, provider invoice, production capability or customer lifecycle not established by this review.

The feature appendix maps every stable catalogue key. An entitlement answers whether a plan permits a capability. Implementation, provider activation, input completeness, authorization and operating readiness are separate questions.

## 2. Current catalogue and billing behaviour

| Product | New monthly price, CAD | Legacy annual total, CAD | Active locations | Users | Current AI quota |
|---|---:|---:|---:|---:|---|
| Starter | 49 | 490 | 1 | 3 | Numerical quota not launched |
| Growth | 99 | 990 | 3 | 10 | Numerical quota not launched |
| Pro | 179 | 1,790 | 10 | 25 | Numerical quota not launched |
| BookLoQ standalone | 59 | None defined | 1 | 3 | Numerical quota not launched |
| BookLoQ add-on | 39 | 390 | Uses base capacity | Uses base capacity | No separate numerical quota |

[Catalogue](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/entitlements/catalog.ts) defines four base plan keys and one add-on key. The three Vanteloq plans remain Starter, Growth and Pro. BookLoQ is a separate product that can be purchased alone or added to a Vanteloq workspace. PURCHASE_INTERVALS permits month only; annual definitions remain for legacy webhook reconciliation. Do not advertise an annual purchase option merely because an annual reconciliation entry exists.

Source prices are pre-tax plan amounts. The current copy says taxes and the final total appear before payment. Do not imply tax is included, or quote the Stripe Tax fee as a government tax.

Current combinations are Starter + BookLoQ CAD88/month, Growth + BookLoQ CAD138/month, and Pro + BookLoQ CAD218/month. Standalone BookLoQ is CAD59/month. Never attach a second paid BookLoQ add-on to the standalone base plan.

### Entitlement resolver and access exceptions

[engine.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/entitlements/engine.ts) establishes the following:

- Only an active paid subscription grants ordinary subscription access. Trialing, past_due, unpaid, paused, canceled and incomplete states do not. A scheduled cancellation retains access while the subscription remains active.
- A scheduled future plan does not change current entitlements before the effective Stripe event.
- Active add-ons and add-ons scheduled for removal remain in the current effective add-on set.
- Standalone BookLoQ synthesizes its effective BookLoQ entitlement in memory. It does not need a false paid add-on row.
- Internal access is resolved before complimentary access, then ordinary subscription access. Internal access is bound to the verified user and workspace and requires the configured MFA condition. It grants all normal paid features and Pro capacity in the current implementation.
- Complimentary access resolves the explicitly configured Vanteloq plan and optional BookLoQ. [complimentary-access.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/complimentary-access.ts) binds the grant to an eligible verified owner and requires MFA. Do not assume complimentary owner access automatically grants every employee the same billing bypass.
- The snapshot version is a subscription synchronization version. This review did not establish a persisted commercial catalogue version or explicit grandfathered feature snapshot. Legacy annual price recognition is not the same as complete grandfathering support.

[authorization.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/authorization.ts) separately checks workspace membership, role, MFA, service access, setup completion and the requested feature. Fine-grained permission and location/source checks remain necessary inside each operation. A higher plan must not increase an employee's authority.

Capacity currently counts active locations and remote-login members in draft, invited, pending_verification or active status. Marketing copy saying “team members” should explain this operational seat definition near billing or capacity controls. Record whether the owner's account consumes a seat by testing the actual membership model before making a contrary public promise.

[Stripe price validation](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/billing/stripe.ts) rejects absent or duplicate lookup matches and verifies active status, CAD currency, exact unit amount and recurring interval. Actual live Stripe products, lookup mappings, subscriptions, discounts, complimentary grants, invoice taxes and account-specific fee agreements were not inspected.

## 3. Official market comparison

Temporary discounts are excluded from the regular-price comparison. A different product scope, billing term, currency or licence basis is not a like-for-like saving.

| Benchmark | Regular price verified October 1, 2026 | Billing basis and relevant distinction |
|---|---|---|
| [Shopify Canada](https://www.shopify.com/ca/pricing) | Basic CAD49, Grow CAD132, Advanced CAD517 monthly. Annual equivalents CAD37, 99 and 389/month, totals CAD444, 1,188 and 4,668/year. | Broader commerce platform. Grow advertises 5 staff accounts and Advanced 15; Basic is positioned for solo operation. Basic already includes an AI assistant. Introductory offers are separate. |
| [Microsoft Power BI Canada](https://www.microsoft.com/en-ca/power-platform/products/power-bi/pricing) | Pro CAD19/user/month, Premium per user CAD32.60/user/month. | Paid yearly, plus applicable tax. Three Pro licences equal CAD57/month equivalent. A BI licence does not include a maintained retail data integration or the effort of building reports. |
| [Xero Canada](https://www.xero.com/ca/pricing-plans/) | Starter CAD25, Standard CAD60, Premium CAD80/month. | Monthly renewal, taxes extra, no per-user licence fees. The page separates its initial 80% discount from regular prices. Listed forecast horizons are 30, 60 and 180 days. |
| [Wave](https://www.waveapps.com/pricing) | Starter CAD0; Pro CAD25/month or CAD250/year, equivalent to CAD20.83/month. | Accounting/bookkeeping benchmark. Pro includes bank imports and receipt capture. Payment processing is separate. Apply taxes where applicable. |
| [Float](https://www.floatapp.com/pricing) | Essentials USD130, Growth USD265, Scale USD389/month. Annual equivalents USD105, 215 and 315/month, totals USD1,260, 2,580 and 3,780/year. | Dedicated cash forecasting connected to existing accounting software. Essentials includes unlimited users, eight scenarios, and 13-week plus 12-month planning. Scale includes up to five entities. Prices remain USD in this comparison. |
| [Inventory Planner](https://www.inventory-planner.com/pricing/) | Quote only. | Official page bases pricing on inventory volume and includes unlimited users. Do not invent a dollar amount from an old review or third-party comparison. |

Implications are judgments, not competitor facts:

1. Starter CAD49 competes for a budget that can also buy an entry commerce product. Its value must come from concrete retail visibility, trustworthy imports and useful decisions, not the mere presence of AI.
2. Growth CAD99 can be defensible for reviewed stock, supplier and operating intelligence if those workflows work with a buyer's sources.
3. Pro CAD179 requires demonstrated multi-location and scenario value. Features without an implemented path cannot justify the premium.
4. BookLoQ standalone CAD59 sits close to Xero Standard CAD60 and above Wave Pro CAD25. The sale should explain delivered retail-linked financial review, cash planning and evidence handling. Do not claim a superior full accounting replacement on this pricing comparison alone.
5. CAD39 as a BookLoQ add-on is a coherent lower price for a shared workspace and infrastructure. That rationale is operationally plausible, but the CAD20 difference is not a measured cost saving.

QuickBooks, Fathom and Syft were considered. Their dynamic pages did not yield sufficiently reliable regular price amounts during this review, so no numeric price is attributed to them. This is a research limitation, not a claim about their prices.

## 4. Proposed customer-facing plan structure

The price recommendation retains existing names and amounts. Existing feature access is preserved. The initial brief's “entry core, middle AI, high forecasts” is a hypothesis, not authority to remove Starter AI or Growth forecasting.

| Commercial item | Starter | Growth | Pro |
|---|---|---|---|
| Monthly subscription, CAD | 49 | 99 | 179 |
| Included locations / users | 1 / 3 | 3 / 10 | 10 / 25 |
| Primary outcome | Understand sales and recorded margins | Review inventory, suppliers and operating plans | Compare locations and test advanced decisions |
| Core reporting, basic AI and eligible sources | Included | Included | Included |
| Stock lots, expiry, supplier analytics | Preserve current core scope | Entitled, subject to implementation and inputs | Entitled, subject to implementation and inputs |
| Forecasts | Preserve current scope | Preserve existing revenue, demand and inventory forecast entitlements | Preserve advanced and scenario entitlements |
| Proposed completed AI requests / billing month | 50 | 250 | 750 |
| Proposed extraction pages / billing month | 0 in core proposal; see current-behaviour exception below | 200 | 750 |
| Proposed document storage allowance | 1 GB | 5 GB | 20 GB |
| Source/history policy | Published retention policy and source limits; no new “unlimited” promise | Same | Same |
| Refresh policy | Supported provider scheduling with visible last-success time; no new SLA | Same | Same |
| Support | Email or published support channel | Same | Priority queue only when staffed; no unverified response-time SLA |
| BookLoQ add-on | +CAD39/month | +CAD39/month | +CAD39/month |

All numerical usage and storage allowances in this section are **proposed**, not presently launched limits. A completed request needs a precise definition: one user-authorized AI operation that returns a usable response, with idempotent retry handling. Abuse controls and internal cost telemetry also record unsuccessful provider work.

**Starter document exception:** [documents PATCH](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/documents/route.ts:185) currently requires invoice.basic and document permissions, then invokes provider processing. It does not require invoice.extraction. Therefore a Starter workspace with the correct role and configured providers can currently Scan and Read. Zero included extraction pages would change behaviour. It must not be imposed silently or characterized as current policy. Preserve existing customers. An alternative is 50 pages/month for new Starter customers, with modeled extra cost of CAD0.15/0.45/1.50 at 5/15/50 pages. That alternative is commercially simpler if maintaining this workflow is preferred.

Other policy details to approve before enforcement:

- AI: both request and token/input-page limits are needed. A request count alone does not control large PDFs or long context. Show limits before a file is sent.
- Storage: meter retained originals and defined retained derivatives consistently. Keep temporary security/recovery costs in internal telemetry. Do not delete existing records automatically when a plan changes or a limit is reached.
- Imports: validate size and source-specific limits. Do not invent one untested row limit or sell an unsupported integration.
- Refresh: a scheduler default is not a delivery SLA. Provider outages, backlog, missing permissions and source review can delay data.
- History: make retention and exports clear. Do not promise infinite history, nor truncate needed records as an upgrade tactic.
- Overages: notify at 80% and 100%, then pause the expensive operation. No automatic charge without an explicit approved purchase flow. Viewing, correcting and exporting already entitled records should remain available subject to ordinary billing, permission and retention policy.
- No new annual checkout is recommended until allowance resets, cancellation, cost exposure and subscriber migration have been verified. Preserve existing annual subscriptions.

### BookLoQ policy

Retain CAD59 standalone and CAD39 add-on. A proposed standalone allowance for review is 100 AI requests, 200 extraction pages and 5 GB, with one location and three users.

The add-on shares workspace capacity rather than creating another login, ledger or duplicate document store. Proposed pooled allowances are the maximum of the base allowance and the BookLoQ allowance, not their sum. For example, Growth + BookLoQ would retain 250 AI requests, 200 pages and 5 GB under that proposal; Pro + BookLoQ would retain 750, 750 and 20 GB. Starter + BookLoQ would have 100, 200 and 5 GB.

Do not charge twice or count one document/request twice because it appears in both retail and financial views. Entitlements are a union; the cost event and source record are single instances. Standalone-to-bundle changes need an explicit subscription-item transition with proration review and preserved workspace data.

BookLoQ's 13-week cash review remains BookLoQ scope; retail revenue forecasting is not a substitute for a cash receipt forecast. Cash scenarios should reuse BookLoQ source obligations and adjustments without posting a new financial ledger.

## 5. Verified supplier rates and unverified own costs

All rates below were accessed October 1, 2026. They are public list rates, not proof of Vanteloq's actual contracted or billed rate.

| Cost component | Official rate / evidence | Modeling treatment |
|---|---|---|
| [OpenAI GPT-5 Mini](https://developers.openai.com/api/docs/models/gpt-5-mini) | USD0.25 per million input tokens, USD0.025 per million cached input tokens, USD2 per million output tokens. | No cache discount assumed. Confirm the deployed model override. Reasoning/provider output usage must be measured. |
| [Stripe Canada](https://stripe.com/en-ca/pricing) | Domestic online card processing 2.9% + CAD0.30 per successful transaction; Billing pay-as-you-go 0.7% of billing volume. | Base model uses 3.6% of pre-tax monthly revenue plus CAD0.30 for one successful monthly payment. Actual fee on collected tax, international cards, currency conversion and account terms can differ. |
| [Stripe Tax](https://stripe.com/en-ca/pricing) | Public page separately prices Tax Basic at 0.5% for the relevant no-code transaction service. | Not included in base model. Confirm actual use and registration configuration. This is a supplier fee, not sales tax. |
| [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/) | Standard USD0.015/GB-month; Class A USD4.50/million, Class B USD0.36/million. Egress is free. | Storage modeled at list rate. Operations are within an assumed platform reserve. Shared account free allowances are not allocated in full to every tenant. |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/) | Paid subscription starts at USD5/month, including 10 million requests and 30 million CPU milliseconds. Overage USD0.30/million requests and USD0.02/million CPU milliseconds. | Shared hosting allocation is unverified. Sites hosting or bundled service charges may differ from direct list rates. |
| [Cloudflare D1](https://developers.cloudflare.com/d1/platform/pricing/) | Paid-plan allowances include 25 billion rows read, 50 million rows written and 5 GB storage monthly. Overage USD0.001/million rows read, USD1/million rows written, USD0.75/GB-month. | Index writes and query design affect usage. Do not treat every tenant as having a separate free allowance. |
| [Azure Document Intelligence](https://azure.microsoft.com/en-ca/pricing/details/document-intelligence/) | Official page confirms page-based processing, but numeric region/SKU prices did not render reliably in this review. | CAD0.03/page is an assumption for extraction and a processing/retry reserve. It is not a verified Azure quote. |
| Azure security scanning and temporary blobs | Source uses Azure Blob/Defender scanning before Document Intelligence. | Actual Defender plan, scan volume, storage/recovery and repeat processing costs unverified. |
| Authentication, email, providers, support | Source uses Supabase auth and multiple optional providers. | Actual plan, contracts, minimums, paid pilots, alerting/logging, support tooling and labour unverified. Included only through stated scenario reserves where indicated. |

[advisor-providers.ts](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/advisor-providers.ts) defaults to gpt-5-mini and caps output at 3,200 tokens. The current local reread returns provider/model and input/output/cached usage metadata, including nullable values. This is useful instrumentation but does not, by itself, establish a deployed atomic monthly quota, complete failed-request cost capture, or reconciled invoices.

[Attachment limits](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/shared/advisor-attachments.ts) are four files per message, 5 MB per file, 8 MB combined, and 64 KB for TXT/CSV. Byte limits do not reliably cap PDF/image token cost. Document provider work is rate-limited at 60 calls/hour per organization in the inspected route; that is not a monthly page allowance.

Unknown usage must remain unknown. Do not write zero tokens or zero provider cost when telemetry is missing.

## 6. Illustrative monthly cost-to-serve

These are scenario estimates, not measured customer cohorts. The model is reproducible from the assumptions below.

### Common assumptions

- Currency conversion: USD1 = CAD1.35, an explicit modeling assumption, not a current FX quote.
- Revenue: pre-tax monthly subscription amount.
- Stripe: 0.036 × price + CAD0.30, one successful domestic monthly subscription payment.
- AI low/typical/high: 3,000/6,000/40,000 input tokens; 800/1,500/3,200 output tokens; cost multipliers 1.10/1.15/1.30 for retries and unsuccessful provider work. Cached savings excluded.
- Resulting AI cost per completed request: CAD0.00348975 / 0.00698625 / 0.028782.
- Extraction reserve: CAD0.03/page, unverified.
- R2 storage: CAD0.02025/GB-month, with no tenant-specific free tier assumed.
- Support labour: CAD45/hour loaded, an assumption.
- Platform reserve: assumed shared hosting, database, auth, email, sync and logs. No assurance it covers every actual provider minimum or connector contract.
- Excludes acquisition, development, general administration, owner profit, chargebacks, currency conversion, supplier price changes and unknown contracts. Failed/refunded charge economics and tax on collected amounts need separate actual-cost reconciliation.

Formula:

Cost = payment cost + completed requests × AI scenario rate + pages × CAD0.03 + stored GB × CAD0.02025 + platform reserve + support minutes × CAD0.75.

Contribution = pre-tax plan revenue minus modeled cost. Contribution percentage = contribution / pre-tax revenue.

### Inputs per workspace

Values are low / typical / high monthly usage.

| Plan | AI requests | Extraction pages | Stored GB | Platform CAD | Support minutes |
|---|---|---|---|---|---|
| Starter | 10 / 25 / 50 | 0 / 0 / 0 | 0.1 / 0.5 / 1 | 1 / 2 / 5 | 2 / 5 / 15 |
| Growth | 50 / 150 / 250 | 25 / 80 / 200 | 0.5 / 2 / 5 | 2 / 4 / 10 | 3 / 10 / 25 |
| Pro | 200 / 400 / 750 | 100 / 300 / 750 | 1 / 10 / 20 | 4 / 8 / 20 | 5 / 15 / 45 |
| BookLoQ standalone | 20 / 60 / 100 | 25 / 80 / 200 | 0.5 / 2 / 5 | 1 / 3 / 8 | 3 / 8 / 20 |

### Results

| Plan | Low cost | Typical cost | High cost | Typical contribution | High contribution |
|---|---:|---:|---:|---:|---:|
| Starter, CAD49 | 4.60 | 8.00 | 19.77 | 41.00 / 83.7% | 29.23 / 59.6% |
| Growth, CAD99 | 9.05 | 18.85 | 45.91 | 80.15 / 81.0% | 53.09 / 53.6% |
| Pro, CAD179 | 18.21 | 37.99 | 104.99 | 141.01 / 78.8% | 74.01 / 41.3% |
| BookLoQ standalone, CAD59 | 6.50 | 14.28 | 34.40 | 44.72 / 75.8% | 24.60 / 41.7% |

The Starter zero-page model is contingent on a reviewed policy change for new customers; it is not a description of current route behaviour. With the 50-page alternative and low/typical/high consumption of 5/15/50 pages, Starter costs become CAD4.75/8.45/21.27, with typical contribution CAD40.55 (82.8%) and high contribution CAD27.73 (56.6%).

No standalone add-on margin is asserted. The CAD39 add-on shares the base invoice and infrastructure, and its incremental AI/document activity depends on the pooled allowance. On an existing invoice the additional domestic payment/Billing percentage is approximately CAD1.40, without allocating a second CAD0.30 transaction fee. Measure additional usage and support separately before assigning an add-on margin.

### Sensitivity and sustainable limits

- One extra support hour costs CAD45 under the labour assumption. It can matter more than ordinary text AI or storage.
- At approximately 400,000 input tokens and 3,200 output tokens, the assumed FX and 30% retry reserve yield about CAD0.187 per request. 750 such requests cost about CAD140 in AI alone. This is a stress calculation, not proof the current application sends a full context window.
- Pro with 1,000 high-cost AI requests and 2,000 document pages would cost approximately CAD149.68 under otherwise high assumptions, leaving about CAD29.32 or 16.4% before excluded overhead. Do not offer unlimited expensive processing.
- A 10% USD/CAD rise raises USD-denominated costs 10%, not all costs 10%. Support and domestic CAD fees are modeled separately.
- A one percentage point increase in revenue-based fees costs CAD0.49/0.99/1.79 per Starter/Growth/Pro workspace.
- As a planning target, seek at least 75% typical contribution after support and investigate cohorts below 50% under sustained high usage. These are proposed commercial thresholds, not industry guarantees.

Company break-even needs real fixed costs. At the modeled typical contribution and a hypothetical equal one-third mix of Starter/Growth/Pro, average contribution is about CAD87.39/workspace/month. Every CAD10,000 of monthly fixed operating cost would require about 115 such active workspaces before acquisition effects. Both the mix and CAD10,000 example are assumptions, not Vanteloq's actual overhead or a business forecast.

## 7. Public claims requiring correction or qualification

| Evidence | Finding | Concrete proposed action |
|---|---|---|
| [public-plan-cards.tsx](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/public-plan-cards.tsx:17) says “Compare every plan feature”; [pricing/page.tsx](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/pricing/page.tsx:11) defines seven comparison rows, versus 103 stable catalogue keys. | The destination does not compare every feature. | Either change the link to “Compare plans” or publish a comprehensive customer-oriented matrix with usage, capacity, support, data and availability rows. Do not expose raw developer keys as customer copy. |
| Public cards derive core prices from PLANS but repeat $39/$59 in prose at lines 10, 17 and 20. | Current amounts agree; repeated literals create future drift. | Render all product amounts from one versioned catalogue/formatter, including metadata and explanatory copy. |
| [Public pricing](https://vanteloq.com/pricing) retrieved snapshot says BookLoQ requires a base plan; [homepage](https://vanteloq.com/) and current source show standalone CAD59. | Conflicting public snapshots. The pricing retrieval was cached about two weeks earlier. | Check direct current rendering. If the old copy remains live, publish the already prepared standalone/add-on distinction and verify both routes. Do not call a stale web cache proof of a current production defect. |
| [Plan limits](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/entitlements/catalog.ts:136) have requestsPerMonth null and meteringStatus not_launched. | A finite monthly quota or “unlimited AI” claim is not supported by this catalogue. | Describe current capability accurately; display proposed quotas only after approval and tested enforcement. |
| [Integration public status](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/integration-catalog.ts:64) plus [preview list](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/integration-availability.ts:3). | Credentials or code alone do not establish public production access. Current public list shows Lightspeed R, Square, Slack and CSV as available; multiple commerce, marketing, banking and accounting providers remain upcoming/preview. | Keep provider-specific availability beside each integration. Do not use catalogue marketing entitlement keys as proof Google/Meta or another provider is publicly ready. Slack currently supports confirmed sharing, not automatic alerts or incoming-message analysis. |
| Catalogue Pro description includes automation; calendar.automation, workflow.rules, support.priority and reporting.custom_dashboards are keys. | This review has not established an individually delivered implementation/service for every key. Literal absence in the appendix is a review signal, not proof of absence. | Sell only verified workflows. Add implementation and acceptance evidence before publishing granular promises or SLAs. |
| [Terms](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/terms/page.tsx:69) allow a trial if shown in checkout or a signed order, while resolver grants no trialing access. | Conditional legal copy should not be interpreted as a currently supported trial lifecycle. | Do not launch or advertise trials without an explicit policy, resolver change and lifecycle tests. Keep the current no-public-trial checkout behaviour. |
| [Plan capacity counter](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/entitlements/engine.ts) counts several pending remote-login statuses, while public copy says team members. | Seat counting needs a clear customer definition. | Explain which active/pending accounts use capacity and show the actual count before an invitation or downgrade. |
| BookLoQ copy states it supports review, journals/statements and cash planning while disclaiming filing, money movement and certification. | These boundaries are consistent with the reviewed positioning. | Preserve them. Do not convert “reviewed books” into a completeness, tax-compliance or guaranteed forecast claim. |
| [Document processing](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/documents/route.ts:185) gates invoice.basic, although invoice.extraction is catalogued for Growth/Pro. | Commercial definitions and current route behaviour differ. | Resolve the intended policy explicitly, test it, and grandfather existing customers before advertising extraction as a paid-tier exclusion. |

No “most popular” customer adoption claim was verified. Growth's internal mostPopular flag can be a design recommendation, but customer-facing popularity language needs actual evidence.

## 8. Minimal implementation and migration contracts

### One commercial source of truth

Extend the existing catalogue rather than introduce parallel plan constants. Define a stable catalogue version with prices, intervals, features, seats, locations, usage units, reset periods, storage definitions, public descriptions and source/readiness references.

Separate commercial entitlement from readiness:

Effective operation access = active permitted commercial access or authorized exception, intersected with role and resource scope, intersected with implementation and provider readiness, subject to input quality and operation-specific consent.

Do not let a false readiness state erase a customer's purchased entitlement. Return a clear reason such as source not connected, provider preview, missing reviewed inputs, role restricted, usage limit reached or plan not included.

### Metering

- Reserve capacity atomically per workspace, billing period and operation id before provider work. Use a unique idempotency key.
- Settle a reservation once. Handle retries, concurrent requests, crashes, streaming disconnects and expired leases.
- Record provider/model, tokens, cached tokens, pages, storage bytes, success/failure, retry cost and cost-basis version. Unknown usage is nullable and reviewed.
- Separate customer allowance accounting from internal cost accounting. A failed operation can restore a customer's allowance while still incurring a real provider bill.
- Apply upper bounds before sending attachments. Do not trust a client-reported file/page/token count.
- Use subscription billing periods for customer allowances. Define monthly resets for annual subscribers explicitly; do not wait a year to reset monthly entitlements.
- Collect equivalent usage evidence for internal, complimentary and trial/test activity without silently creating charges.

### Migration and review

1. Inventory current live subscriptions, items, Stripe price IDs, billing dates, discounts, scheduled changes, complimentary/internal grants and capacities through authorized read-only tools.
2. Snapshot each customer's applicable commercial policy. Existing subscription state version is not sufficient to preserve commercial promises.
3. Create a proposed catalogue version and a dry-run report. Do not overwrite existing Stripe prices or reinterpret old lookup keys.
4. Preserve current users, locations, records and entitlements when a new limit is below current usage. Define a grace or no-new-capacity policy for approved changes; do not delete records or accounts automatically.
5. Keep legacy annual reconciliation entries. Confirm effective dates, proration and allowance periods for any optional migration.
6. Explicitly prevent standalone BookLoQ plus duplicate add-on charging. Preserve data when changing between standalone and bundle.
7. Present the final matrix, amounts, timing, expected invoices, subscriber impacts and rollback plan for review.
8. Only after approval, publish the matching copy and billing policy and verify actual readback. A source deployment alone does not prove the Stripe state or a complete subscription lifecycle.

### Required verification

| Area | Meaningful checks |
|---|---|
| Catalogue | Every stable key mapped; no unknown key; deterministic inheritance; addon union without duplicate billing; all public price surfaces match currency/amount/interval. |
| Access | Plan × subscription status × role × workspace/location × internal/complimentary × readiness; no client-only gate; no data leakage from hidden panes. |
| Quotas | Concurrent reservation at final unit, duplicate requests, retry after crash, partial stream, provider failure, unknown token usage, reset boundary, annual monthly reset, revoked access during processing. |
| Storage/documents | Shared original counted once, repeated extraction handled explicitly, retained recovery copies measured internally, existing originals preserved at limit, unauthorized provider call blocked. |
| Stripe test mode | Subscription creation, active confirmation, delayed/duplicate/out-of-order webhook, failed renewal, cancellation, scheduled downgrade, upgrade/proration, standalone/bundle change, invoice arithmetic and taxes when configured. No live charge for testing. |
| Migration | Dry-run before/after for every affected customer and exception, old annual IDs still recognized, capacity-over-limit behaviour, rollback restoration of policy mappings. |
| Public copy | Price/feature/add-on consistency on desktop/mobile; supported integration labels; no trial, unlimited, autonomous, accounting-completeness or unsupported SLA claims. |
| Cost | Invoice-to-telemetry reconciliation, support time samples, source-sync/database load, provider minimums, failure/retry rates and forecast model cost separately from AI explanations. |

## 9. Decision and release limitations

This document supports review of prices and packaging. It does not authorize a live commercial change and does not claim measured profitability.

The remaining material unknowns are actual customer usage distributions, paid conversion/retention, support time, supplier invoices/contracts, deployed AI model, production provider readiness, live Stripe mappings and historical promises. Review actual costs for at least a representative operating period before labeling allowances sustainable. Reconcile high-usage outliers rather than relying only on a workspace average.

Recommended review decisions are: retain the stated prices; preserve existing AI/forecast access; approve or revise the numerical allowances; decide Starter extraction treatment; define the BookLoQ shared pool; approve commercial versioning and migration treatment; and authorize a future live change only after the concrete dry run and tests.

## Appendix A. Complete stable feature entitlement matrix

The matrix is generated from the inspected catalogue, not reconstructed from marketing labels. “Yes” means the base plan contains the key. “Grant” means the BookLoQ add-on grants the key in addition to a Vanteloq base plan. “No” does not mean no related UI exists; it describes this exact catalogue key. A BookLoQ standalone base includes its own shell plus BookLoQ features.

Readiness classes are audit prompts, not implementation certifications:

- **CORE:** Confirm the individual workflow, role checks and source coverage.
- **SOURCE:** Requires approved sources, comparable dates/locations and complete relevant inputs.
- **INVENTORY:** Requires reviewed stock/lots/costs/reservations/receipts and relevant demand evidence.
- **DOCUMENT:** Requires document permissions, security processing, provider configuration and reviewed extracted fields.
- **PROVIDER:** Provider launch/readiness is separate from plan access.
- **FORECAST:** Requires eligible history, completeness, horizon/method checks and role/scope gates; stage 1 local work is not production proof.
- **AI:** Requires approved provider, user data settings, bounded evidence, permission checks and cost controls.
- **FINANCE:** Requires BookLoQ authorization, ledger/source review and finance permissions; external finance imports may remain preview.
- **SERVICE:** Requires an actual operational implementation or staffed service promise.

“Consumer” is an exact quoted-key reference found in server, domain, shared or API source, excluding the catalogue. It is a traceability lead, not proof of a complete implementation or correct security. “No exact consumer” means no literal match in that scan; dynamic/shared implementations can still exist. Every row remains subject to live and operation-level acceptance.

| Stable feature key | Starter | Growth | Pro | BookLoQ alone | BookLoQ add-on | Readiness | Exact consumer evidence |
|---|---|---|---|---|---|---|---|
| `dashboard.core` | Yes | Yes | Yes | Yes | No | CORE | [app/api/v1/command-centre/route.ts:102](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/command-centre/route.ts:102); [app/api/v1/commerce-intelligence/route.ts:32](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/commerce-intelligence/route.ts:32) |
| `business.profile` | Yes | Yes | Yes | Yes | No | CORE | [app/api/v1/organization-logo/route.ts:68](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/organization-logo/route.ts:68) |
| `business.settings` | Yes | Yes | Yes | Yes | No | CORE | [app/api/v1/backend/route.ts:8](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/backend/route.ts:8); [app/api/v1/integrations/route.ts:307](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/route.ts:307) |
| `business.brief.basic` | Yes | Yes | Yes | No | No | CORE | [domain/navigation-entitlements.ts:40](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/navigation-entitlements.ts:40) |
| `operations.basic` | Yes | Yes | Yes | No | No | CORE | [app/api/v1/operations/route.ts:107](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/operations/route.ts:107); [app/api/v1/tasks/route.ts:127](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/tasks/route.ts:127) |
| `communications.basic` | Yes | Yes | Yes | No | No | PROVIDER | [app/api/v1/integrations/slack/authorize/route.ts:23](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/slack/authorize/route.ts:23); [app/api/v1/integrations/slack/callback/route.ts:99](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/slack/callback/route.ts:99) |
| `pos.reporting.core` | Yes | Yes | Yes | Yes | No | PROVIDER | [app/api/v1/integrations/clover/authorize/route.ts:21](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/clover/authorize/route.ts:21); [app/api/v1/integrations/clover/locations/route.ts:42](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/clover/locations/route.ts:42) |
| `analytics.sales.basic` | Yes | Yes | Yes | No | No | SOURCE | [app/api/v1/daily-metrics/route.ts:36](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/daily-metrics/route.ts:36); [app/api/v1/retail-intelligence/route.ts:8](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/retail-intelligence/route.ts:8) |
| `analytics.sales.advanced` | No | Yes | Yes | No | No | SOURCE | [app/api/v1/commerce/route.ts:11](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/commerce/route.ts:11); [domain/navigation-entitlements.ts:67](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/navigation-entitlements.ts:67) |
| `products.basic` | Yes | Yes | Yes | No | No | SOURCE | No exact consumer found |
| `products.margin` | Yes | Yes | Yes | No | No | SOURCE | [app/api/v1/inventory-costs/route.ts:75](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/inventory-costs/route.ts:75) |
| `products.location_performance` | No | No | Yes | No | No | SOURCE | No exact consumer found |
| `inventory.basic` | Yes | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.lots` | No | Yes | Yes | No | No | INVENTORY | [app/api/v1/inventory-lifecycle/route.ts:217](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/inventory-lifecycle/route.ts:217); [app/api/v1/operations/route.ts:111](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/operations/route.ts:111) |
| `inventory.expiry` | No | Yes | Yes | No | No | INVENTORY | [server/retail-intelligence.ts:29](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/retail-intelligence.ts:29) |
| `inventory.shelf_life` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.fefo` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.turnover` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.sell_through` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.velocity` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.days_on_hand` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.dead_stock` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.stockout_risk` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.reorder_ai` | No | Yes | Yes | No | No | INVENTORY | [app/api/v1/purchasing/route.ts:889](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/purchasing/route.ts:889); [domain/navigation-entitlements.ts:71](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/navigation-entitlements.ts:71) |
| `inventory.bring_back` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.assortment` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.opportunity` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `inventory.transfers` | No | No | Yes | No | No | INVENTORY | No exact consumer found |
| `supplier.analytics` | No | Yes | Yes | No | No | INVENTORY | [domain/navigation-entitlements.ts:72](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/navigation-entitlements.ts:72); [domain/paid-feature-routing.ts:10](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/paid-feature-routing.ts:10) |
| `supplier.cost_trends` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `supplier.lead_time` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `supplier.fill_rate` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `supplier.reliability` | No | Yes | Yes | No | No | INVENTORY | No exact consumer found |
| `invoice.basic` | Yes | Yes | Yes | Yes | No | DOCUMENT | [app/api/v1/documents/route.ts:210](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/documents/route.ts:210); [app/api/v1/linked-files/route.ts:14](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/linked-files/route.ts:14) |
| `invoice.extraction` | No | Yes | Yes | No | No | DOCUMENT | No exact consumer found |
| `invoice.matching` | No | Yes | Yes | No | No | DOCUMENT | [app/api/v1/purchasing/route.ts:904](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/purchasing/route.ts:904) |
| `invoice.discrepancy` | No | Yes | Yes | No | No | DOCUMENT | No exact consumer found |
| `invoice.credit_opportunities` | No | Yes | Yes | No | No | DOCUMENT | No exact consumer found |
| `calendar.basic` | Yes | Yes | Yes | No | No | CORE | No exact consumer found |
| `calendar.automation` | No | Yes | Yes | No | No | SERVICE | No exact consumer found |
| `marketing.overview` | Yes | Yes | Yes | No | No | PROVIDER | No exact consumer found |
| `marketing.google_business` | Yes | Yes | Yes | No | No | PROVIDER | [server/integrations/marketing-routes.ts:1045](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/marketing-routes.ts:1045); [domain/paid-feature-routing.ts:30](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/paid-feature-routing.ts:30) |
| `marketing.google_ads` | No | Yes | Yes | No | No | PROVIDER | [domain/paid-feature-routing.ts:33](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/paid-feature-routing.ts:33) |
| `marketing.google_analytics` | No | Yes | Yes | No | No | PROVIDER | [domain/paid-feature-routing.ts:31](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/paid-feature-routing.ts:31) |
| `marketing.meta_ads` | No | Yes | Yes | No | No | PROVIDER | [server/integrations/marketing-routes.ts:988](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/marketing-routes.ts:988); [domain/paid-feature-routing.ts:34](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/paid-feature-routing.ts:34) |
| `marketing.search_intelligence` | No | Yes | Yes | No | No | PROVIDER | [domain/paid-feature-routing.ts:32](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/paid-feature-routing.ts:32) |
| `marketing.profit_attribution` | No | Yes | Yes | No | No | PROVIDER | No exact consumer found |
| `marketing.inventory_aware` | No | Yes | Yes | No | No | PROVIDER | No exact consumer found |
| `marketing.optimization` | No | No | Yes | No | No | PROVIDER | [server/integrations/marketing-routes.ts:1005](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/integrations/marketing-routes.ts:1005) |
| `marketing.advanced_attribution` | No | No | Yes | No | No | PROVIDER | No exact consumer found |
| `marketing.channel_allocation` | No | No | Yes | No | No | PROVIDER | No exact consumer found |
| `growth.strategy` | No | Yes | Yes | No | No | SOURCE | [app/api/v1/events/route.ts:52](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/events/route.ts:52); [app/api/v1/growth/route.ts:484](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/growth/route.ts:484) |
| `growth.strategy_graph` | No | Yes | Yes | No | No | SOURCE | No exact consumer found |
| `growth.goals` | No | Yes | Yes | No | No | SOURCE | No exact consumer found |
| `growth.opportunities` | No | Yes | Yes | No | No | SOURCE | No exact consumer found |
| `pulse` | No | Yes | Yes | No | No | SOURCE | No exact consumer found |
| `exceptions` | No | Yes | Yes | No | No | SOURCE | No exact consumer found |
| `forecasting.revenue` | No | Yes | Yes | No | No | FORECAST | [app/api/v1/advisor/chat/route.ts:213](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/advisor/chat/route.ts:213); [app/api/v1/forecasting/route.ts:37](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/forecasting/route.ts:37) |
| `forecasting.demand` | No | Yes | Yes | No | No | FORECAST | No exact consumer found |
| `forecasting.inventory` | No | Yes | Yes | No | No | FORECAST | [server/forecasting.ts:51](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/forecasting.ts:51) |
| `forecasting.cash_basic` | No | Yes | Yes | No | No | FORECAST | No exact consumer found |
| `forecasting.advanced` | No | No | Yes | No | No | FORECAST | No exact consumer found |
| `forecasting.scenarios` | No | No | Yes | No | No | FORECAST | [server/forecasting.ts:51](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/forecasting.ts:51); [domain/navigation-entitlements.ts:76](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/navigation-entitlements.ts:76) |
| `forecasting.future_obligations` | No | No | Yes | No | No | FORECAST | No exact consumer found |
| `ai.basic` | Yes | Yes | Yes | Yes | No | AI | [app/api/v1/advisor/chat/route.ts:301](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/advisor/chat/route.ts:301); [app/api/v1/advisor/conversations/route.ts:118](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/advisor/conversations/route.ts:118) |
| `ai.advanced` | No | Yes | Yes | No | No | AI | No exact consumer found |
| `ai.pro` | No | No | Yes | No | No | AI | No exact consumer found |
| `ai.tools.sales` | No | Yes | Yes | No | No | AI | No exact consumer found |
| `ai.tools.inventory` | No | Yes | Yes | No | No | AI | No exact consumer found |
| `ai.tools.products` | No | Yes | Yes | No | No | AI | No exact consumer found |
| `ai.tools.marketing` | No | Yes | Yes | No | No | AI | No exact consumer found |
| `ai.tools.suppliers` | No | Yes | Yes | No | No | AI | No exact consumer found |
| `ai.tools.invoices` | No | Yes | Yes | No | No | AI | No exact consumer found |
| `ai.tools.customers` | No | Yes | Yes | No | No | AI | [server/retail-intelligence.ts:27](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/retail-intelligence.ts:27); [domain/navigation-entitlements.ts:68](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/navigation-entitlements.ts:68) |
| `ai.tools.strategy` | No | Yes | Yes | No | No | AI | No exact consumer found |
| `multi_location.basic` | Yes | Yes | Yes | Yes | No | SOURCE | [app/api/v1/locations/route.ts:15](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/locations/route.ts:15); [domain/navigation-entitlements.ts:57](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/navigation-entitlements.ts:57) |
| `multi_location.advanced` | No | No | Yes | No | No | SOURCE | No exact consumer found |
| `multi_location.benchmarking` | No | No | Yes | No | No | SOURCE | No exact consumer found |
| `multi_location.forecasting` | No | No | Yes | No | No | FORECAST | No exact consumer found |
| `multi_location.marketing` | No | No | Yes | No | No | PROVIDER | No exact consumer found |
| `reporting.basic` | Yes | Yes | Yes | Yes | No | CORE | [app/api/v1/data-quality/route.ts:28](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/data-quality/route.ts:28); [app/api/v1/reports/route.ts:659](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/reports/route.ts:659) |
| `reporting.advanced` | No | No | Yes | No | No | CORE | No exact consumer found |
| `reporting.exports` | No | No | Yes | No | No | CORE | [app/api/v1/forecasting/route.ts:28](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/forecasting/route.ts:28); [server/forecasting.ts:51](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/server/forecasting.ts:51) |
| `reporting.custom_dashboards` | No | No | Yes | No | No | SERVICE | No exact consumer found |
| `workflow.advanced` | No | No | Yes | No | No | SERVICE | No exact consumer found |
| `workflow.rules` | No | No | Yes | No | No | SERVICE | No exact consumer found |
| `permissions.standard` | Yes | Yes | Yes | Yes | No | CORE | [app/api/v1/governance/route.ts:281](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/governance/route.ts:281); [domain/navigation-entitlements.ts:51](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/navigation-entitlements.ts:51) |
| `permissions.advanced` | No | No | Yes | No | No | CORE | [app/api/v1/governance/route.ts:285](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/governance/route.ts:285) |
| `support.priority` | No | No | Yes | No | No | SERVICE | No exact consumer found |
| `bookloq` | No | No | No | Yes | Grant | FINANCE | [app/api/v1/advisor/chat/route.ts:243](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/advisor/chat/route.ts:243); [app/api/v1/billing/route.ts:69](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/billing/route.ts:69) |
| `bookloq.dashboard` | No | No | No | Yes | Grant | FINANCE | [app/api/v1/bookloq/collections/route.ts:13](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/collections/route.ts:13); [app/api/v1/bookloq/route.ts:88](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/route.ts:88) |
| `bookloq.chart_of_accounts` | No | No | No | Yes | Grant | FINANCE | [domain/paid-feature-routing.ts:60](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/paid-feature-routing.ts:60) |
| `bookloq.transactions` | No | No | No | Yes | Grant | FINANCE | [app/api/v1/bookloq/journals/route.ts:112](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/journals/route.ts:112); [app/api/v1/bookloq/statements/route.ts:14](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/statements/route.ts:14) |
| `bookloq.expenses` | No | No | No | Yes | Grant | FINANCE | No exact consumer found |
| `bookloq.documents` | No | No | No | Yes | Grant | FINANCE | No exact consumer found |
| `bookloq.ap` | No | No | No | Yes | Grant | FINANCE | No exact consumer found |
| `bookloq.ar` | No | No | No | Yes | Grant | FINANCE | [app/api/v1/bookloq/invoices/email/route.ts:31](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/invoices/email/route.ts:31); [app/api/v1/bookloq/invoices/route.ts:29](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/bookloq/invoices/route.ts:29) |
| `bookloq.reconciliation` | No | No | No | Yes | Grant | FINANCE | [app/api/v1/integrations/deel/authorize/route.ts:20](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/deel/authorize/route.ts:20); [app/api/v1/integrations/deel/callback/route.ts:52](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/app/api/v1/integrations/deel/callback/route.ts:52) |
| `bookloq.financial_statements` | No | No | No | Yes | Grant | FINANCE | [domain/paid-feature-routing.ts:66](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/paid-feature-routing.ts:66) |
| `bookloq.cash_intelligence` | No | No | No | Yes | Grant | FINANCE | [domain/paid-feature-routing.ts:62](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/paid-feature-routing.ts:62) |
| `bookloq.anomaly_detection` | No | No | No | Yes | Grant | FINANCE | [domain/paid-feature-routing.ts:64](C:/Users/User/Documents/Codex/2026-09-10/vanteloq-sites-project-appgprj-6a6fac5e42a08191b37108223fc4b205-make/work/vanteloq/domain/paid-feature-routing.ts:64) |
| `bookloq.accountant_access` | No | No | No | Yes | Grant | FINANCE | No exact consumer found |
| `bookloq.ai` | No | No | No | Yes | Grant | FINANCE | No exact consumer found |


## Appendix B. Official source register

All accessed October 1, 2026.

| Source | Use and limitation |
|---|---|
| https://vanteloq.com/ | Public price and integration snapshot; not authenticated product verification. |
| https://vanteloq.com/pricing | Retrieved cached pricing snapshot conflicts with current source; direct live verification required. |
| https://www.shopify.com/ca/pricing | Canadian regular monthly and annual-equivalent prices; introductory offers excluded. |
| https://www.microsoft.com/en-ca/power-platform/products/power-bi/pricing | Canadian per-user yearly commitment prices and applicable-tax qualifier. |
| https://www.xero.com/ca/pricing-plans/ | Canadian regular monthly prices, forecasting scope and promotional distinction. |
| https://www.waveapps.com/pricing | Canadian monthly/annual Pro prices and accounting scope. |
| https://www.floatapp.com/pricing | USD monthly/annual prices and entity/scenario scope. |
| https://www.inventory-planner.com/pricing/ | Official quote-only pricing basis. |
| https://developers.openai.com/api/docs/models/gpt-5-mini | Model list token rates. Deployed override unknown. |
| https://stripe.com/en-ca/pricing | Domestic payment, Billing and optional Tax list fees. Contracted terms unknown. |
| https://developers.cloudflare.com/r2/pricing/ | Storage/operation list rates and shared allowances. |
| https://developers.cloudflare.com/workers/platform/pricing/ | Shared runtime subscription and consumption rates. |
| https://developers.cloudflare.com/d1/platform/pricing/ | Database storage/read/write rates and shared allowances. |
| https://azure.microsoft.com/en-ca/pricing/details/document-intelligence/ | Page-billing evidence only; regional numeric rate not established. |


## Owner-approved decision and implementation evidence, October 1, 2026

Retain Starter CAD49, Growth CAD99, Pro CAD179, BookLoQ add-on CAD39 and standalone CAD59 per month. Keep existing access, authorised complimentary grants and legacy annual reconciliation. No live Stripe prices or subscriber objects were modified. New quotas and overage billing were not enabled.

Live read-only Stripe checks identified Vanteloq account `acct_1Tk90iBmKMLpjFJQ` and five active, CAD, licensed per-unit monthly prices matching the catalogue:

| Product | Live price ID | CAD/month |
| --- | --- | ---: |
| Starter | `price_1U2T8MBmKMLpjFJQtHJONhDk` | 49 |
| Growth | `price_1U2T8hBmKMLpjFJQBsNcJl7E` | 99 |
| Pro | `price_1U2T99BmKMLpjFJQJ5KeSfMT` | 179 |
| BookLoQ add-on | `price_1U2T9QBmKMLpjFJQ7c7U0zOu` | 39 |
| BookLoQ standalone | `price_1UHXgnBmKMLpjFJQCulPcRRV` | 59 |

The subscription webhook was enabled at `https://vanteloq.com/api/v1/billing/stripe/webhook`. Account payout readiness and a new Stripe-hosted test payment were not established by these read-only checks. Synthetic lifecycle tests exercise the real application handler with a controlled provider adapter and isolated database; they are not represented as a new Stripe-hosted payment.

Fixed: exact recurring interval count, licensed usage, per-unit billing and no quantity transform are now mandatory; a recognized malformed add-on price fails before any subscription/add-on mutation; billing administration also requires the user's actual billing permission; existing annual subscriptions display their interval and renewal/cancellation date accurately. Shared customer-facing feature descriptions now come from one catalogue presentation module. Version `origin-1` labels the unchanged commercial catalogue; it is not a migration to new feature allowances.

Before considering new quotas, reconcile provider invoices and real token/page/storage/sync volumes over a representative billing month, including retries and failures. The included fictional OpenAI evaluations expose measured tokens and timings only for those examples. They do not establish a monthly cost per customer or production metering completeness.
