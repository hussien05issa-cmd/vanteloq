# Marketing optimization and release review

Reviewed September 8, 2026. Vanteloq application only. Meta registration and activation are paused at the owner's request.

## Product decision

The useful differentiator is not another collection of platform totals. It is a short working cycle: understand the customer, inspect comparable evidence, plan a measurable action, assign responsibility, and review the result against business constraints.

This release adds that cycle to the existing marketing workspace without changing billing, authentication configuration, provider credentials, database schema, or the separate private console. It does not claim that Vanteloq replaces every specialist marketing platform or guarantees commercial results.

## Research and competitive context

The following are primary provider sources reviewed for this work. Vendor capability descriptions are not independent performance comparisons.

| Challenge | Evidence and interpretation | Product response |
| --- | --- | --- |
| Fragmented campaigns and reporting | HubSpot advertises CRM-connected marketing automation, campaign planning, and customer-journey reporting. These are established category expectations, not a unique invention. [HubSpot Marketing Hub](https://www.hubspot.com/products/marketing) | Connect an actionable report finding to a calendar draft with its source, reporting period, and review method. |
| Search technology keeps changing | Google states that its normal search fundamentals apply to AI search features; special AI markup is not required. Eligibility does not guarantee inclusion. [Google AI search guidance](https://developers.google.com/search/docs/appearance/ai-features) | Provide dated, source-linked review guidance and a manual planning action. Do not present a static checklist as live monitoring. |
| Campaign naming fragments acquisition reports | Google documents campaign parameters and their case sensitivity. Consistent labels make source comparisons easier. [Google campaign URL guidance](https://support.google.com/analytics/answer/10917952?hl=en) | Build consistent source, medium, campaign, and creative labels. Preserve ordinary destination parameters, reject common private link values, and warn against tagging internal navigation. |
| Multiple platforms can overstate success | Attribution models distribute credit differently. Reported credit is not evidence that advertising caused incremental sales. [Google attribution guidance](https://support.google.com/analytics/answer/10596866?hl=en) | Label matched revenue as recorded first-touch attribution. Show unmatched records and independent journey coverage rather than a fabricated conversion funnel. |
| Specialist tools have deep coverage | Semrush describes SEO, competitive traffic research, local visibility, paid marketing, and social capabilities. Vanteloq has not been independently benchmarked against that breadth. [Semrush product overview](https://www.semrush.com/) | Position Vanteloq around permitted business evidence and follow-through. Do not promise proprietary keyword databases, universal rank tracking, or social publishing that has not been implemented. |

Our inference from these sources and the existing product is that owners benefit more from an accountable, measurable next action than from indiscriminate channel expansion. This is a product hypothesis, not a measured conversion uplift.

## Implemented changes

### Planning and customer journey

- Added **Plan & measure** with a campaign brief, audience, business outcome, metric, baseline, responsible person, and review method.
- A brief becomes an explicitly unsaved calendar draft. The user supplies dates and saves it. No content or advertising is published by this action.
- Added report-to-calendar and recommendation-to-calendar handoffs with source context.
- Added planned, in-progress, completed, and cancelled status controls and visible saved review notes.
- Added distinct journey coverage counts. Repeated events are deduplicated within each stage. Stages are not assumed to be sequential, and missing events are not labelled lost customers.
- Added a campaign URL builder. It performs no network requests, installs no tracking, and does not replace website analytics consent.
- Added dated manual review guidance for search changes, campaign naming, and attribution discipline.

### Confirmed defects corrected

| Impact | Location | Confirmed issue | Correction |
| --- | --- | --- | --- |
| High | domain/growth-intelligence.ts | Unrelated search queries could be compared as a single trend. | Partition by exact query and source; compare dates within that group. Ambiguous duplicate-day observations are excluded. |
| High | domain/growth-intelligence.ts | Revenue could be assigned to a touchpoint that occurred after the transaction. | Compare parsed timestamps and require an earlier or simultaneous recorded touchpoint. |
| High | app/growth-workspace.tsx | Failed saves cleared user-entered data. | Preserve forms and CSV state on failure; clear only after a confirmed save. A post-save refresh failure warns against resubmission. |
| Medium | app/api/v1/growth/route.ts | Date-shaped strings could contain impossible calendar dates. | Validate real calendar dates and UTC timestamps; reject invalid positions and calendar states. |
| Medium | app/growth-workspace.tsx | Missing attributed revenue could look like a real zero. | Display unavailable until permitted, matched records exist. Preserve actual zero values when evidence exists. |
| Medium | app/vanteloq-app.tsx | Marketing state could remain mounted across location changes. | Remount the workspace by location, preventing an old location's interface state from carrying forward. |
| Medium | app/marketing-workbench.css | A populated attribution table stretched the page at 320 pixels. | Bound grid children and keep wide records inside their scrolling container. |
| Medium | app/marketing-workbench.css | Important numbers inherited small body typography. | Restore prominent numeric hierarchy while preserving the existing type system. |

### Homepage

Added a marketing section explaining discovery reports, measurement gaps, and planned actions. Its call to action opens the existing secure workspace form. Provider approval requirements and unavailable organic Meta insights remain explicit. Existing LexEdge ownership branding, social links, and legal links are preserved.

## Safety and evidence boundaries

- Existing authorization, organization separation, origin checks, rate limits, audit logging, provider sample approval, and financial permissions remain enforced.
- Planning writes require organization-wide owner or administrator access and the existing marketing management permission.
- The new coverage response contains aggregate counts, not customer identities or journey references.
- Search average position is not a guaranteed rank for every person. The UI does not interpolate missing observations into claimed measurements.
- The URL builder is a guard against common unsafe inputs, not a comprehensive personal-data scanner. Users must still review public URLs.
- Report refresh remains separate from saved integration synchronization. Gemini continues to use permitted, synchronized aggregate evidence; opening a report does not silently send search terms, page addresses, or profile content to Gemini.
- No real campaigns were published, accounts created, customer records imported, passwords changed, or production accounts deleted during testing.

## Verification record

The full npm run check pipeline passed after correcting stale homepage and Gemini-composer test references from earlier releases. It covers lint, TypeScript, production builds, operating and finance calculations, provider contracts, security boundaries, self-service deletion, migrations, OAuth races, onboarding, and integration flows.

The added marketing suite tests URL construction, unsafe inputs, dates, journey deduplication, chronological attribution, query isolation, duplicate observations, read-only planning, and report handoffs. The marketing API flow verifies persistent calendar entries, all supported statuses, impossible dates, unknown entry IDs, authentication, and cross-origin rejection.

Browser checks used the actual components with clearly labelled local fixtures for populated, empty, read-only, and failed-save states. Verified campaign drafts, saved notes, status changes, report handoffs, link validation, query selection, and keyboard tab navigation. Layouts were inspected at 1280, 768, 390, and 320 pixels. Screenshots are held in the task's marketing-optimization visualization folder.

The built production homepage was also opened locally. Its new call to action opens the existing account dialog. No account was submitted. Local preview does not contain production verification credentials.

The development server exposed a duplicate React-runtime error in its development dependency graph; the production-built server rendered and hydrated correctly. This was not treated as evidence that production was broken, and no framework dependency change was made to conceal it.

npm audit --omit=dev --audit-level=high reported zero known production dependency vulnerabilities. This is not proof that all security defects are absent. The production build still reports large chunks; further bundle optimization remains a separate performance task.

## Remaining activation and product limits

1. Meta registration, production credentials, permissions, and live account verification remain paused. Facebook and Instagram organic analytics are not activated by this release.
2. Google verification and approved customer resources still determine live data access. Code tests and fixture data do not certify provider approval or successful customer authorization.
3. Background synchronization while the application is closed is not added here. Existing optional report refresh works only while that report is open and visible.
4. Review guidance is dated and manually scheduled. It is not an automated platform-change feed or recurring task service.
5. Campaign briefs store owner and review details in calendar notes. This release does not add a separate campaign CRM, automatic experiment analysis, multi-channel publishing, or automatic advertising budget changes.
6. Production account creation, live payment, real provider authorization, and real data deletion were not performed as destructive launch tests.
7. No software release can honestly guarantee zero bugs, total security, legal immunity, or superiority to every competitor. Launch confidence comes from the tested boundaries, truthful limitations, and a rollback path.

## Follow-up measurement

Before claiming improved conversion, establish consented baselines for workspace creation, verified onboarding completion, first approved source, first useful report, and first completed marketing plan. Track completion and abandonment separately. Do not add new analytics events containing account identifiers or customer data without a separate privacy and instrumentation review.

Reassess the interface with a small set of real owners after provider access is available. Prioritize successful first value and completed reviews over time spent in the dashboard.
