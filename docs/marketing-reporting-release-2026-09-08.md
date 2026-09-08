# Marketing reporting release

Date: September 8, 2026

## Implemented

The authenticated Marketing workspace has a Reports tab with source selection, location-aware access, 7-, 28- and 90-day windows, comparisons, charts, exact-value tables, source warnings and recovery controls.

| Source | Reports | Important boundary |
| --- | --- | --- |
| GA4 | Daily activity, acquisition channels, pages, devices, rolling realtime activity | Consent and tagging affect coverage. Key events are not automatically customers or sales. Page-level sessions are not additive. |
| Search Console | Daily search performance, queries, pages, devices | Finalized web-search results; average position is not a fixed keyword rank. Top rows and anonymized queries are limited by Google. |
| Business Profile | Original daily discovery and customer-action series, previous-month search terms | On-demand report responses are not persisted or sent to Gemini. Thresholded terms remain unavailable, not zero. |
| Google Ads | Daily and campaign performance with the account currency | Developer-token approval and account authorization are required. Attributed conversions are not verified profit. |
| Meta Ads | Daily, campaign and publisher-platform performance | Paid advertising only. Unique reach is requested for the whole reporting scope, not summed from daily rows. |

Detailed report retrieval does not edit campaigns or grant permissions. Existing campaign controls still require their existing management checks and explicit confirmation.

## Calculation and privacy decisions

CTR is calculated from clicks divided by impressions. Engagement rate uses engaged sessions divided by sessions. Cost per link click uses the selected ad account's spend divided by link clicks. Missing denominators and zero comparison baselines return unavailable, not infinite changes.

Provider totals are fetched separately from dimension rows. Currency comes from the provider account. Google Ads cost micros are converted exactly once. Fractional attributed conversions are retained. Comparison periods have equal lengths and do not overlap. Non-realtime reports deliberately leave a processing delay: three UTC calendar days for Search Console and two for other daily reports.

Google Business Profile overview cards show the latest original daily series for the selected location instead of combining devices and dates. The pre-existing persisted Business Profile sample/performance path is not replaced by the new on-demand endpoint; its cache-retention lifecycle needs a separate review against the current provider policy before claiming full provider compliance. This release does not perform a historical data purge.

Gemini now receives allowed, synchronized marketing totals through the actual chat endpoint. The evidence excludes search queries, page addresses, Business Profile content, raw records, resource identifiers and advertising amounts without verified currency. Period coverage is explicit and incomplete comparisons are withheld. Gemini cannot independently identify causation, guaranteed rankings or financial return from this evidence.

The Gemini data-use notice has a new version. Conversation context is forwarded only when the current evidence, permission set and location scope match its saved fingerprint. Cross-user conversation identifiers are rejected. Gemini's API credential is sent in a header, not a URL.

## Refresh behaviour

Users can refresh the open report manually. Optional visible-tab refresh runs every ten minutes, or every minute for GA4 realtime, and stops on errors. Business Profile reports remain manually requested.

This is not an unattended background scheduler. Refreshing a detailed report does not update the saved marketing snapshot used by Gemini. Owners must refresh approved connections in Integrations to update that snapshot.

## Verified

- Lint and TypeScript checks.
- Production build and artifact validation.
- Fifteen dedicated reporting, calculation, provider-contract, privacy and rendering tests.
- Existing marketing connector contracts and release-security tests.
- Thirty-two operating-intelligence and presentation regressions.
- Four homepage presentation regressions.
- Actual built-worker flow: authorization, resource selection, staged sample, approval, report retrieval, no-store response, rejection before approval, unknown-resource rejection and unauthenticated rejection.
- Actual built-worker Gemini flow: the provider request contains approved Analytics and Search Console totals and coverage metadata, but no selected property identifiers or credentials.
- Local browser fixtures at desktop, 768-pixel tablet and 390-pixel phone widths. Verified source/report controls, chart selection, gaps, keyboard chart scrolling, contained table overflow, loading/empty/error states, retry and navigation to Integrations and Advisor.

Provider calls in automated tests are mocked; these are not live customer-account certifications. UI fixture data is fictional and never published as business evidence. There are no account, subscription, billing, public-signup or private-console migrations in this release.

## Remaining production setup

The signed-in live workspace showed Google as “Ready to connect” and Meta as “Configuration required” during inspection. Neither had approved marketing measurements. A real-account end-to-end validation therefore remains outstanding.

1. An authorized owner connects Google, selects eligible resources, assigns location scope, reviews the sample and approves it.
2. Configure the existing Meta application credentials and approved redirect on the server, then authorize and approve a selected ad account.
3. Google Ads additionally needs an approved developer token and eligible customer access.
4. Organic Facebook Page and Instagram insights are **not implemented** in this release. They need a separate approved permissions flow, Page/professional-account resource discovery, selection and retention design. Do not market paid-ad reporting as complete Meta Business Suite coverage.
5. Search Console URL inspection, crawl audits, local rank-grid monitoring and broader technical SEO diagnostics are not supplied by the search-performance reports.
6. Unattended background synchronization and monitoring require a separate scheduled-worker implementation and provider-quota review.

Existing build warnings about large application chunks remain. This release is not a complete security, load, legal or zero-bug certification.

## Primary references

- [GA4 metric and dimension schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema): reporting fields and metric meanings.
- [GA4 realtime reporting](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runRealtimeReport): rolling activity reporting.
- [Search Console Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query): property scopes, dimensions, final data and result limits.
- [Business Profile monthly search keywords](https://developers.google.com/my-business/reference/performance/rest/v1/locations.searchkeywords.impressions.monthly/list): monthly counts and reporting thresholds.
- [Business Profile API policies](https://developers.google.com/my-business/content/policies): content-use and storage restrictions.
- [Meta Insights API](https://developers.facebook.com/docs/marketing-api/insights/): paid-ad reporting reference; the documentation endpoint rate-limited automated retrieval during research, so live organic compatibility is not asserted.

## Local verification fixture

Run `node scripts/marketing-reporting-preview.mjs` and open `http://127.0.0.1:5182`. The fixture binds to loopback, aliases authentication calls to its mock API and does not use customer credentials. Stop the process after testing. Run `npm run test:marketing-reporting` for the dedicated regression suite.
