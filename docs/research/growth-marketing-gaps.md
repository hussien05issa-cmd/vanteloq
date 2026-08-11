# Growth and marketing product gap research

Updated: 2026-08-11

## Scope and method

This note compares official documentation for Google Analytics 4, Google Business Profile, Google Search Console, Google Ads, Shopify, Meta, HubSpot, Semrush, and Mailchimp. It uses first-party documentation only. Product recommendations below are Vanteloq design inferences from those documented capabilities and limits, not vendor claims.

## Executive conclusion

The strongest product opportunity is not another combined marketing dashboard. Each platform already reports its own channel well. The missing layer is a governed decision system that:

1. preserves the source, metric definition, attribution model, freshness, and known limitations of every number;
2. connects marketing evidence to verified sales, margin, inventory, cash, customer, and location records;
3. recommends a bounded next action without presenting correlation as causation;
4. measures the action after a defined review period; and
5. blocks advice when the required evidence, permission, or operational capacity is missing.

Vanteloq should keep vendor-reported metrics separate at ingestion. It can compare them in one decision packet, but it should not silently merge conversions, revenue, reach, customers, or sessions into a single total. Google Analytics, Google Ads, Shopify, Meta, HubSpot, and Mailchimp can all assign credit under different rules. Search Console can omit anonymized and lower-volume query rows. Semrush traffic is an external estimate. These differences are part of the answer, not data-cleaning noise.

## Platform capability and constraint matrix

| Platform | High-value evidence | Important boundary | Access gate |
|---|---|---|---|
| Google Analytics 4 | Event, session, acquisition, engagement, key-event, funnel, and revenue reporting can be queried by dimensions and date ranges through the Data API. [GA4 Data API report guide](https://developers.google.com/analytics/devguides/reporting/data/v1/basics) | Reports can be thresholded for privacy, and metric availability depends on correct event and revenue instrumentation. The API also has token, concurrency, and thresholded-request quotas. [GA4 thresholds](https://support.google.com/analytics/answer/9383630) and [Data API quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas) | Google Cloud project, OAuth authorization, property access, and a verified GA4 property identifier |
| Google Search Console | Clicks, impressions, CTR, average position, query, page, country, device, search appearance, and date dimensions support useful SEO opportunity analysis. [Performance report](https://support.google.com/webmasters/answer/7576553) | The API returns top rows rather than a guaranteed complete dataset. Some queries are anonymized, and detailed data can lag. [Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [query limitations](https://support.google.com/webmasters/answer/17011259), and [data retrieval guidance](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data) | OAuth 2.0 and read access to the verified Search Console property. Use the read-only scope for reporting. [Search Console authorization](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing) |
| Google Business Profile | Location-level Search and Maps impressions, calls, website clicks, direction requests, conversations, bookings, and monthly search-keyword impressions are available through performance endpoints. [Performance API](https://developers.google.com/my-business/reference/performance/rest) and [daily metrics](https://developers.google.com/my-business/reference/performance/rest/v1/DailyMetric) | API policy is unusually restrictive. Stored content must be temporary, secure, retained no more than 30 days, and not manipulated or aggregated. The policy also requires express authorization for account changes and quick disconnection. This needs product and legal review before any durable cross-module use. [Business Profile API policies](https://developers.google.com/my-business/content/policies) | Google approval is required. Applicants need an active verified profile, a website, a Cloud project, and an organization account. [Business Profile prerequisites](https://developers.google.com/my-business/content/prereqs) |
| Google Ads | Campaign, ad group, ad, keyword, spend, click, impression, conversion, and conversion-value reporting can be queried. Conversion results can be segmented by conversion action. Experiments expose treatment and control metrics plus statistical-significance fields. [Reporting overview](https://developers.google.com/google-ads/api/docs/reporting/overview), [conversion reporting](https://developers.google.com/google-ads/api/docs/conversions/reporting), and [experiment reporting](https://developers.google.com/google-ads/api/docs/experiments/reporting) | Google Ads conversions are provider-attributed and must retain the conversion action and attribution context. An accepted offline conversion upload does not guarantee attribution. [Conversion troubleshooting](https://developers.google.com/google-ads/api/docs/conversions/troubleshooting) | OAuth 2.0 plus a developer token. Production use and feature availability depend on the token access level and review. [OAuth requirements](https://developers.google.com/google-ads/api/docs/oauth/overview) and [access levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels) |
| Shopify | Orders expose financial status, line items, refunds, discounts, source, location, and customer journey data. Shopify reports also support marketing dimensions and attribution models. [Orders query](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders), [Order object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), and [marketing reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/marketing-reports) | Shopify documents discrepancies between its analytics and third-party tools. Attribution should remain labeled as Shopify attribution. Customer and order fields can be protected data and must be requested only when needed. [Analytics discrepancies](https://help.shopify.com/en/manual/reports-and-analytics/discrepancies) | App installation, OAuth or Shopify token exchange, merchant approval, and the minimum required Admin API scopes. Optional scopes can be requested later. [Shopify authorization](https://shopify.dev/docs/apps/build/authentication-authorization) and [access scopes](https://shopify.dev/docs/apps/build/authentication-authorization/app-installation/manage-access-scopes) |
| Meta Business and Ads | Meta's Marketing API and official Business SDK support ad-account reporting and Insights breakdowns across campaigns, ad sets, ads, actions, and placements. [Marketing API Insights breakdowns](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/) and [official Business SDK](https://github.com/facebook/facebook-python-business-sdk) | Meta attribution depends on the selected attribution settings and window. Vanteloq must retain those settings and must not treat Meta-reported conversions as identical to GA4 or POS conversions. [Meta attribution settings](https://www.facebook.com/business/help/460276478298895) and [attribution comparison](https://www.facebook.com/business/help/654970342692714) | A registered Meta app, the Marketing API product, access tokens, required permissions, and Advanced Access approval for permissions used outside app-role accounts. Advanced Access is reviewed per permission. [Meta access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/) |
| HubSpot | CRM records, standard and custom events, funnel stages, and contact, deal, and revenue attribution can connect lead activity to pipeline outcomes. [Events API](https://developers.hubspot.com/docs/api-reference/legacy/events/guide), [attribution reports](https://knowledge.hubspot.com/reports/create-attribution-reports), and [attribution definitions](https://knowledge.hubspot.com/reports/understand-attribution-reporting) | Deal and revenue attribution features are gated by higher HubSpot subscriptions. Consent choices can prevent individual visitor association while aggregate views remain. Some analytics update on a schedule rather than instantly. [Attribution availability](https://knowledge.hubspot.com/reports/create-attribution-reports), [consent impact](https://developers.hubspot.com/docs/api-reference/latest/account/settings/consent-banner/consent-banner-api), and [analytics update frequency](https://knowledge.hubspot.com/reports/how-often-do-analytics-in-hubspot-update) | HubSpot OAuth, requested scopes, account access, and an installing user who has every required permission. [HubSpot OAuth guide](https://developers.hubspot.com/docs/apps/legacy-apps/authentication/oauth-quickstart-guide) |
| Semrush | Domain rankings, organic and paid keywords, competitors, backlinks, site audits, position tracking, SERP features, and historical trends can strengthen SEO research. [available data](https://developer.semrush.com/api/v3/introduction/available-data), [domain reports](https://developer.semrush.com/api/v3/seo/domain-reports/), [position tracking](https://developer.semrush.com/api/v3/projects/position-tracking/), and [site audit](https://developer.semrush.com/api/v3/projects/site-audit/) | Semrush traffic and ranking data are third-party estimates, not the business's verified traffic. API calls consume plan-dependent units, often per returned line. Cache and query narrowly. [API units](https://www.semrush.com/kb/5-api) and [overview report pricing](https://developer.semrush.com/api/v3/seo/overview-reports/) | Paid Semrush access and API key or supported connected-account flow. The key must remain server-side. [API key guidance](https://www.semrush.com/kb/92-api-key) |
| Mailchimp | Campaign reports expose delivery, opens, clicks, bounces, unsubscribes, abuse, e-commerce orders, and revenue. Campaigns can be prepared, tested, scheduled, and sent through separate endpoints. [campaign reports](https://mailchimp.com/developer/marketing/api/reports/get-campaign-report/) and [campaign scheduling](https://mailchimp.com/developer/marketing/api/campaigns/schedule-campaign/) | Open and click tracking must be enabled. Bot activity can inflate engagement, and open measurement depends on email-client behavior. Email opens should never be presented as verified human attention. [Mailchimp report limitations](https://mailchimp.com/help/about-email-campaign-reports/) | OAuth 2.0 for third-party user accounts. Mailchimp discourages asking users to paste API keys. Tokens and server prefixes must stay server-side. [Mailchimp OAuth guide](https://mailchimp.com/developer/marketing/guides/access-user-data-oauth-2/) |

## Product gap Vanteloq can own

### 1. A source-aware marketing evidence layer

Every imported metric should retain the following fields:

- provider and provider metric key;
- masked provider account reference;
- organization and location scope;
- campaign, ad set, ad, page, query, product, or audience scope when available;
- metric value, unit, currency, and denominator;
- start date, end date, provider time zone, and retrieval time;
- attribution model, attribution window, and conversion action when applicable;
- freshness status;
- completeness status, including thresholded, sampled, truncated, estimated, preliminary, or unknown;
- consent or measurement dependency when relevant;
- original source record reference and normalized record version.

The interface should label facts in plain language:

- `Verified source` for a direct, authorized first-party record;
- `Provider-attributed` for a conversion credited by an ad or analytics platform;
- `External estimate` for Semrush and similar market data;
- `Manual import` for a validated CSV or owner-entered record;
- `Limited` when rows are omitted, thresholds apply, or the denominator is missing;
- `Stale` when the source exceeds its freshness policy;
- `Blocked` when the required source is not connected or not authorized.

Do not use the word `verified` for a number merely because the API returned it. Verification means the source, account, time range, units, and transformation passed Vanteloq's contract. It does not mean the provider's attribution is objectively true.

### 2. Actionable recommendation packets

Each recommendation should answer the following in this order:

1. **What changed:** the metric, baseline, comparison period, absolute change, percentage change, and affected scope.
2. **Why it matters:** the business impact that is directly supported, such as lower qualified leads, higher cost per purchase, weaker organic CTR, or promotion risk caused by low inventory.
3. **What might explain it:** ranked hypotheses, each labeled as supported, plausible, or untested.
4. **What to do next:** one bounded action with an owner, due date, channel, location, budget ceiling, inventory and cash check, and rollback condition.
5. **How to measure it:** the primary metric, guardrail metric, observation window, comparison method, and minimum evidence needed.
6. **Confidence:** high, medium, low, or blocked, with the reason shown.
7. **Sources and exclusions:** connected sources used, source freshness, and missing information that could change the conclusion.

Recommended confidence rules:

- **High:** recent direct records, correct denominator, consistent scope, sufficient observations, and no unresolved reconciliation issue.
- **Medium:** direct records with delay, partial coverage, provider attribution, or a strong association that is not causal.
- **Low:** external estimates, small samples, manual records, stale data, missing denominator, or unmatched entities.
- **Blocked:** the recommendation would require an unsupported metric, missing permission, unresolved identity match, or unavailable operational constraint.

No recommendation should promise revenue growth, ranking improvement, exact lead volume, or causal impact. Google explicitly says that SEO changes can take weeks or months and are not guaranteed to improve Search results. [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)

### 3. Cross-module decision rules

The defensible advantage is the ability to apply operational constraints to marketing evidence. These rules can be deterministic and explainable:

- Do not recommend promoting a product when available inventory, inbound stock, expiry risk, or supplier lead time makes fulfilment unsafe.
- For excess or slow-moving inventory, recommend a campaign experiment only when the proposed discount preserves the configured contribution-margin floor.
- Do not recommend a higher paid-media budget when available cash is below the owner's protected cash floor or near-term obligations are incomplete.
- Do not call a campaign profitable unless verified contribution after discounts, refunds, cost of goods, and directly attributable spend is available. Otherwise label the result as revenue return or platform-reported return.
- Compare campaign results by location only when marketing scope and POS location mapping are both verified.
- Do not infer regional demand from one location's sales history. Mark it as location-specific observed demand unless a broader source supports the conclusion.
- Connect lead recommendations to CRM stages only when lead identifiers, timestamps, consent, and stage definitions are mapped. Otherwise report anonymous sessions and form completions separately.
- Treat marketing demand as an input to inventory planning, not proof of future demand. Paid clicks, impressions, and search volume should affect scenario ranges, not directly create purchase orders.
- Require owner approval before campaign writes, budget changes, audience uploads, email sends, review responses, or other external actions.

### 4. SEO opportunity planner

#### Safe to build without vendor credentials

- Crawl only a domain the owner confirms they control.
- Check indexability signals, robots directives, canonical tags, sitemap references, status codes, headings, titles, meta descriptions, internal links, image text alternatives, and structured-data syntax.
- Validate that structured data describes visible page content. Google says hidden or misleading markup can be ineligible for rich results. [Structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- Create content briefs from the owner's real services, products, locations, audiences, questions, and evidence.
- Require a human review before publishing.
- Prevent thin, duplicated, or mass-generated pages. Google's spam policy identifies scaled low-value content, including low-value generative content, as abuse. [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- Maintain an internal-link plan that connects educational content to a relevant solution, product, location, or conversion page.

#### Stronger with Search Console connected

- High-impression, low-CTR page and query opportunities.
- Pages with material click, impression, CTR, or position changes.
- Branded versus non-branded visibility when Google exposes the classification.
- Device or country gaps.
- Query-to-page mismatches and competing pages.
- Change annotations with before and after measurement.

The interface must disclose that Search Console can omit anonymized and lower-volume queries. It should recommend focusing on clicks and impressions before average position alone, consistent with Google's own guidance. [Search Console common tasks](https://support.google.com/webmasters/answer/17010961)

#### Optional with Semrush connected

- Keyword and competitor discovery outside the site's existing Search Console footprint.
- SERP-feature and AI-search visibility research.
- Technical site-audit findings and position tracking.
- Keyword-gap hypotheses for human review.

All Semrush traffic, cost, search-volume, and competitor metrics must be labeled `External estimate`. Search Console remains the stronger source for the owner's actual Google Search performance.

### 5. Lead-generation planner

The planner should use an explicit funnel rather than a generic `more leads` score:

1. eligible reach or impressions;
2. visits or landing-page sessions;
3. engaged visits;
4. form, call, booking, message, or checkout-start events;
5. identified leads where consent and identity mapping permit;
6. qualified leads under an owner-defined rule;
7. deals or purchases;
8. contribution after directly supported costs.

Each stage needs its own numerator, denominator, source, identity rule, and time window. If HubSpot is absent, Vanteloq can still show anonymous web behavior and POS sales, but it must not imply that it knows lead quality. If GA4 key events are not configured, the funnel should explain the missing measurement rather than manufacture a conversion rate.

Useful recommendation types include:

- landing pages with traffic but weak verified conversion events;
- campaigns generating leads that do not progress to the qualified stage;
- high-cost ads with no supported downstream sale or deal evidence;
- email campaigns with strong clicks but weak verified purchase or lead outcomes;
- local profiles receiving calls or direction requests without corresponding location-level sales evidence;
- products with strong page or campaign engagement but low purchase conversion, subject to price, stock, and fulfilment checks;
- repeat-customer segments that are eligible for consented re-engagement.

No channel should receive credit beyond its documented attribution scope. A user may interact with multiple channels before purchase, so Vanteloq should show a journey timeline when identifiers allow it and avoid double-counting the same business outcome in totals.

### 6. Campaign and experiment calendar

The calendar should be a planning and measurement system, not a decorative schedule.

Each item should support:

- draft, approved, scheduled, live, paused, completed, cancelled, or blocked status;
- organization and one or more location scopes;
- channel and connected provider;
- objective and funnel stage;
- campaign, product, category, audience, offer, and landing-page references;
- start, end, review, and follow-up dates;
- planned budget, approved budget ceiling, and actual spend when connected;
- inventory, fulfilment, margin, and cash readiness checks;
- tracking plan, including UTMs, conversion action, key event, phone or booking source, and CRM stage;
- owner, approver, and execution role;
- experiment hypothesis, baseline, primary metric, guardrail metric, and stopping rule;
- provider sync status and external campaign reference;
- result, evidence, confidence, and lesson entered into the decision journal.

Safe first release:

- internal planning, reminders, evidence attachments, UTMs, and outcome reviews;
- read-only import of provider campaign dates and status after connection;
- annotations on performance timelines;
- collision warnings for overlapping offers, low stock, major purchase-order receipts, invoice due dates, or location staffing constraints.

Later release, after write permission and provider approval:

- prepare a provider draft;
- show an exact preview of proposed changes;
- require step-up owner approval;
- execute one idempotent write;
- record the external response and an audit event;
- offer a rollback or pause action when the provider supports it.

Mailchimp exposes separate test, checklist, schedule, send, and unschedule operations. Vanteloq should mirror that separation rather than make `Schedule` or `Send` a single ambiguous action. [Mailchimp campaign API](https://mailchimp.com/developer/marketing/api/campaigns/schedule-campaign/)

## Attribution and metric rules

### Never combine these without an explicit reconciliation view

- GA4 total revenue and POS or Shopify net sales;
- Google Ads conversions and Meta conversions;
- platform-reported return on ad spend and verified contribution;
- Mailchimp opens and verified human engagement;
- Search Console query rows and Search Console chart totals;
- Semrush traffic estimates and GA4 sessions;
- HubSpot attributed revenue and accounting revenue;
- calls or directions from Google Business Profile and unique customers at a location.

### Required comparison labels

- `Provider view`: exactly as defined by the connected platform.
- `Business record`: verified POS, commerce, CRM, or accounting outcome.
- `Matched outcome`: a business record linked by an approved identifier and time rule.
- `Associated change`: timing or segment evidence exists, but causation is not proven.
- `Unmatched`: no defensible identity or campaign mapping exists.

### Safe performance calculations

- CTR = clicks divided by impressions, using the same provider and scope.
- Cost per provider conversion = spend divided by provider conversions, retaining the conversion action and attribution window.
- Cost per verified lead = spend divided by matched leads, only after the matching contract passes.
- Revenue return = attributed revenue divided by spend, clearly labeled as provider-reported or matched business revenue.
- Contribution return = verified contribution after discounts, refunds, cost of goods, and included variable costs divided by spend.
- Lead-stage conversion = records entering the next stage divided by eligible records entering the prior stage under one stage definition.

When a denominator is zero or missing, show `Unavailable`, not zero percent. Currency comparisons require a common verified currency and conversion method. Period comparisons must align time zone, location, campaign state, and attribution lookback.

## Build and access sequence

| Phase | Safe product scope | Status boundary |
|---|---|---|
| Build now | Source registry, masked account references, business and marketing profile, manual imports, campaign calendar, UTM builder, SEO technical checks, recommendation packet, confidence labels, cash and inventory guards, decision journal | Can operate on tenant-owned records without claiming any live vendor connection |
| Read-only connection | GA4 reporting, Search Console, Shopify store data, HubSpot CRM and events, Mailchimp reports | Requires user authorization, minimum scopes, server-side tokens, revocation, freshness monitoring, and tenant-safe storage |
| Vendor approval required | Google Business Profile production access, Google Ads production access, Meta Advanced Access, Shopify distribution and protected-data requirements, Semrush paid API usage | Show `Coming soon` or `Setup required` until approval and a real test account pass exist |
| Write actions | Ad changes, budget changes, email schedules or sends, CRM writes, Business Profile changes, audience uploads | Separate write scopes from read scopes. Require owner preview, step-up approval, idempotency, audit, and recovery |

## Platform-specific implementation notes

### Google Analytics 4

- Begin with read-only core reports for acquisition, landing pages, events, key events, ecommerce, and date comparisons.
- Store the property identifier, property time zone, currency, metric metadata, retrieval time, threshold status, and quota state.
- Do not assume a GA4 purchase is reconciled to POS or Shopify. Match using transaction identifiers when the business has implemented them correctly.
- Label realtime data as preliminary and avoid using it for large budget or inventory decisions.

### Search Console

- Query and persist daily page-level and query-level facts separately.
- Mark query tables as incomplete because anonymized and lower-ranked rows can be omitted.
- Use date-based incremental imports and re-fetch a recent window because the newest data can change.
- Prefer read-only OAuth unless sitemap or other write behavior becomes a separately approved feature.

### Google Business Profile

- Do not promise a working connector until Google approves Vanteloq's project.
- Keep provider content isolated behind a 30-day retention policy unless Google provides written permission for another treatment.
- Do not use the GoogleLocations endpoint for prospecting or lead generation. Google expressly prohibits that use. [Business Profile API policies](https://developers.google.com/my-business/content/policies)
- Require express owner action for replies, questions, edits, and verification workflows.
- Provide a one-click disconnect and permission-removal flow.

### Google Ads

- Start with read-only reporting and connection diagnostics.
- Preserve customer, campaign, ad group, ad, keyword, conversion action, attribution segment, currency, and account time zone.
- Do not present recommendations as Google recommendations unless they come from the official Recommendations service and retain their source.
- Keep campaign mutations disabled until the developer token, permissible use, OAuth flow, and audit controls are approved.

### Shopify

- Request only the scopes needed for products, inventory, locations, orders, and marketing evidence used by the feature.
- Use order-level financial fields after refunds and discounts when calculating verified commerce outcomes.
- Keep customer-level data out of ordinary marketing views. Use aggregate segments and expose personal data only to authorized roles.
- Respect `customerAcceptsMarketing` and any channel-specific consent before creating a re-engagement audience. Shopify documents this field as the customer's consent state at purchase. [Order object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order)
- Keep Shopify attribution separate from GA4 attribution and explain discrepancies.

### Meta

- Keep the connector visibly unavailable until the app, requested permissions, Advanced Access, and production account test pass.
- Start with read-only campaigns, ad sets, ads, spend, delivery, actions, and breakdowns.
- Preserve the attribution setting and action type for every conversion metric.
- Avoid cross-channel reach totals because the same person can appear in multiple platform audiences.
- Any audience upload or campaign mutation should be a separate future scope with explicit owner approval and policy review.

### HubSpot

- Map contact, company, deal, event, and lifecycle-stage identifiers without importing unnecessary properties.
- Let the owner define `lead`, `qualified`, and `won` rules. Do not assume HubSpot defaults match the business process.
- Display subscription-gated metrics as unavailable rather than simulating them from incomplete records.
- Show consent-limited traffic and anonymous events separately from identified contacts.

### Semrush

- Use it for discovery and competitive context, not as the source of actual business traffic or revenue.
- Limit rows, cache within the provider's terms, monitor unit balance, and expose the unit cost of a refresh to administrators.
- Allow Vanteloq to work without Semrush. Search Console and site-owned crawl data should support the core SEO workflow.

### Mailchimp

- Start with read-only campaign reports and audience-level aggregate health.
- Use clicks, purchases, unsubscribes, bounces, and complaints as stronger operational signals than opens.
- Label opens and open rate as privacy and bot affected.
- Keep schedule, test, and send actions disabled until separate write authorization and owner approval are implemented.

## Legal, privacy, and trust guardrails

This section is a product checklist, not legal advice.

- The privacy notice should name each connected provider category, data purpose, retention approach, cross-module derivation, subprocessors, user controls, and disconnection behavior.
- The connector consent screen should explain exactly which accounts, properties, locations, and data types will be read or changed.
- Read access and write access should be separate choices.
- Tokens, API keys, account identifiers, customer identifiers, and raw provider responses must never be exposed in client logs or public error messages.
- Use aggregate reporting by default. Customer-level Shopify, HubSpot, Mailchimp, and advertising data should be minimized and role restricted.
- Marketing consent must be preserved as a source field. Vanteloq should not convert a sale or CRM record into marketing permission.
- Disconnect must revoke or delete stored credentials, stop scheduled syncs, and apply provider-specific deletion or retention rules.
- Google Business Profile needs its own compliance review because its official policy limits storage to 30 days and says stored content cannot be manipulated or aggregated. Do not ship cross-module GBP analytics until that use has been cleared.
- Do not imply that Google, Meta, Shopify, HubSpot, Semrush, or Mailchimp endorses, certifies, or partners with Vanteloq merely because an integration exists.
- Do not display a provider logo until the relevant brand and trademark requirements have been checked.
- Recommendations must state that they support business decisions and do not guarantee sales, leads, ranking, reach, or profit.

## Acceptance checklist for the growth workspace

- [ ] Every number shows provider, account or property, location when applicable, date range, time zone, freshness, and status.
- [ ] Provider-attributed results are visibly distinct from verified business outcomes.
- [ ] Attribution model, window, and conversion action are retained when provided.
- [ ] Estimated, thresholded, anonymized, truncated, preliminary, stale, and manually imported data are labeled.
- [ ] Zero and unavailable are never interchangeable.
- [ ] Recommendations show calculation, evidence, confidence, missing inputs, action, owner, due date, and review method.
- [ ] Advice is blocked when cash, inventory, location, consent, or identity mapping is missing and material.
- [ ] A campaign cannot be marked profitable from gross revenue alone.
- [ ] A product cannot be recommended for promotion without inventory and margin checks.
- [ ] A paid-media increase cannot be recommended without a budget ceiling and cash guard.
- [ ] Search Console query tables disclose omitted and anonymized rows.
- [ ] Semrush metrics are labeled external estimates.
- [ ] Mailchimp opens are labeled as bot and privacy affected.
- [ ] Google Business Profile data follows an isolated, reviewed retention contract.
- [ ] Read scopes and write scopes are separated.
- [ ] External writes require owner preview, step-up approval, idempotency, audit, and recovery.
- [ ] Disconnect removes credentials, stops sync, and applies provider-specific retention rules.
- [ ] Calendar items include objective, funnel stage, scope, budget, product, location, tracking plan, constraints, and review date.
- [ ] Outcome measurement enters the decision journal without claiming causality.
- [ ] No screen implies that an unavailable, unapproved, or untested connector is live.

## Recommended first release

1. Replace generic marketing checklists with the recommendation packet and source-status contract above.
2. Ship an internal campaign and experiment calendar tied to products, locations, inventory, cash, invoices, and purchase orders.
3. Add a technical SEO checker and owner-reviewed content brief workflow that need no vendor credentials.
4. Implement GA4 and Search Console as the first read-only marketing connectors because they provide complementary website behavior and search-performance evidence.
5. Add Shopify read-only marketing and order evidence after protected-data and scope review.
6. Keep Google Ads, Google Business Profile, and Meta marked as unavailable until the required production access and policy review pass.
7. Add HubSpot, Mailchimp, and Semrush as optional specialist connectors. Vanteloq's core value must not depend on a customer buying those products.

This sequence makes the growth workspace useful before every connector is live while preserving honest capability boundaries.
