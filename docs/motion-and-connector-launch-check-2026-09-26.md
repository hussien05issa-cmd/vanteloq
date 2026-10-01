# Motion and connector launch check

Reviewed on September 26, 2026, for Vanteloq v1.0 Origin.

## Interface update

- Reused the existing shared motion controller for short entrance and scroll transitions across public sections, workspace panels, KPI cards, financial charts and integration cards.
- Kept the opening headline and hero image immediate. Content is visible without JavaScript and never depends on an animation finishing.
- Removed delayed animation starts, coalesced repeated mutation scans and settled containing animated panels when keyboard focus enters them.
- Added consistent button feedback, subtle pointer hover movement and short disclosure/modal transitions.
- Applied restrained glass to navigation and workspace toolbars, with opaque chart surfaces and simpler mobile/reduced-transparency treatment.
- Preserved reduced-motion preferences. No animation library, scroll listener, continuously animated blur, pricing change or financial calculation change was added.

## Verification

- TypeScript check passed.
- 55 focused homepage, connector availability, capability and source-guidance tests passed.
- Local browser review at desktop and 390 px mobile found no horizontal page overflow. Mobile header controls measured 44 px or larger.
- R-Series provider details opened correctly, including source limitations and owner attribution. No browser console errors were captured in that check.
- Desktop navigation uses the intended 16 px backdrop blur. The mobile treatment disables that blur.
- This is a scoped presentation and launch-gate check, not a new production payment, multi-merchant import, security certification or load-test result.

## Manual address entry and signup repair

- Removed the mandatory Canada Post lookup from onboarding and its server submission. Country and Canadian province/territory or U.S. state selections use dropdowns; street, city and postal/ZIP fields remain manually editable.
- Address lookup readiness now reports manual entry, and the paused lookup endpoint makes no Canada Post request. Existing address validation remains active. Addresses are stored as entered, never labelled externally verified.
- Identity verification, authenticator requirements, legal consent, same-origin protection, rate limits, subscription checkout and plan access remain enforced.
- Production build and TypeScript check passed. Another 14 focused onboarding, signup, legal-consent and subscription-access tests passed, including Canadian/U.S. address persistence with a configured lookup key, missing/stale lookup tokens, invalid address rejection and paid-access enforcement.
- The isolated browser signup advanced from a valid manual Canadian address to Security and Notifications. No production account or financial record was created by this browser check.
- A separate read-only code review found no actionable regression in this patch. These checks establish the repaired paths, not a blanket guarantee about all product functionality.

## Connector boundaries

| Connector | Current public position | Remaining work |
| --- | --- | --- |
| Lightspeed Retail R-Series | Available | Each customer must authorize their retailer, complete an import, map locations and review source totals. |
| Square | Available | Each customer must authorize their production seller, complete an import and review mapped source totals. Fictional test sales remain excluded. |
| Slack | Available | Channel authorization; only implemented, explicitly confirmed outbound messages are supported. |
| Lightspeed Retail X-Series | Coming Soon | Verify public distribution and a separate retailer installation before removing the preview gate. The importer and reporting review path exist. |
| Clover | Coming Soon | Developer account currently shows rejected. Resolve that provider restriction, distribution/billing requirements and the real review walkthrough. |
| Moneris | Coming Soon | Complete refund/settlement reconciliation and reporting promotion, then verify an authorized production account. Credentials alone do not enable reporting. |
| Stripe merchant records | Coming Soon | Review-only import exists. Complete reconciliation and reporting promotion. This is separate from Vanteloq subscription checkout. |
| Google | Coming Soon | Verify OAuth publication/customer access and selected resources. Analytics/Search Console, Ads and Business Profile require separate capability checks. |
| Meta | Coming Soon | Configure the app credentials, obtain required customer-business permissions and verify an approved ad-account sample. |

Hosted configuration was inspected for presence only. Square is configured for production. R-Series, X-Series, Google and Stripe configuration entries exist. Meta app ID and secret entries were absent. Configuration presence is not proof of provider approval or a successful import.

The shared availability gate and public directory remain aligned. No unfinished provider was relabelled Available, and no review or reporting protection was removed.
