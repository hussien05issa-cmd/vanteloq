# Origin source feature inventory

Generated 2026-10-01T09:49:29.354Z. Product: **Vanteloq v1.0 Origin**.

Supporting inventory for the single consolidated release document, not a separate sign-off. The [JSON inventory](origin-feature-inventory-2026-10-01.json) contains all paths, column definitions, registry expressions, hashes and test references. The [connector review](connector-capabilities-review-2026-10-01.md) records provider approval and capability gaps.

Source HEAD `d27c54b1bd48b8cae6da5961d9156810105fe0e4`, plus uncommitted changes at generation. Parent agents may still change files. Compare JSON input hashes or regenerate after final changes. This is not the deployed build identity.

Extraction parsed TypeScript and text references, then executed all migration SQL in an isolated in-memory SQLite database to inventory the final physical schema. No product code, providers, environment values, application tests or build were executed. A reference identifies a candidate test, not verified assertions for that method, action or role. Missing references are mapping gaps, not proof of missing tests. Helper authorization is not fully resolved.

## Snapshot

| Item | Count |
| --- | --- |
| pages | 20 |
| routeFiles | 146 |
| methodEntries | 199 |
| Drizzle schema declarations | 104 |
| migrationFiles | 68 |
| tests | 217 |
| features | 103 |
| roleTemplates | 12 |
| workspaceViews | 27 |
| Final physical database tables | 106 |

Drizzle declarations and actual physical tables are counted separately. Final suite, deployment, hosted actions and production backup/restore evidence remain pending the release owner. Every UI action has not been verified by this inventory.

## Commercial and access contracts

The owner now approves a **seven-day free trial**, superseding earlier denial. Source currently records 7 days, policy `first-subscription-7-days-v1`. Final checkout, eligibility, conversion, expiry, webhook races and public terms still require release verification. Prices/access remain owner-approved; new purchase intervals: ["month"]. Annual catalogue entries are legacy reconciliation data.

| Plan | Monthly CAD | Locations | Users | AI tier | Feature keys |
| --- | --- | --- | --- | --- | --- |
| Starter | $49.00 | 1 | 3 | basic | 19 |
| Growth | $99.00 | 3 | 10 | advanced | 69 |
| Pro | $179.00 | 10 | 25 | pro | 89 |
| BookLoQ | $59.00 | 1 | 3 | basic | 23 |

BookLoQ add-on: CAD $39.00/month, distinct from standalone BookLoQ. AI numerical metering is not launched in the catalogue; a null quota is not an unlimited performance guarantee. Declared entitlement does not establish an implemented report or populated data.

Base roles: `owner`, `admin`, `manager`, `employee`, `read_only`, `integration`. Custom permissions, active membership, location scope, subscription state, feature/provider gates and record readiness remain separate.

| Template | Source |
| --- | --- |
| `account_owner` | [server/permissions.ts](../server/permissions.ts) line 186 |
| `organization_administrator` | [server/permissions.ts](../server/permissions.ts) line 187 |
| `finance_administrator` | [server/permissions.ts](../server/permissions.ts) line 190 |
| `accountant_bookkeeper` | [server/permissions.ts](../server/permissions.ts) line 191 |
| `general_manager` | [server/permissions.ts](../server/permissions.ts) line 194 |
| `location_manager` | [server/permissions.ts](../server/permissions.ts) line 195 |
| `inventory_purchasing_manager` | [server/permissions.ts](../server/permissions.ts) line 200 |
| `marketing_manager` | [server/permissions.ts](../server/permissions.ts) line 208 |
| `team_lead` | [server/permissions.ts](../server/permissions.ts) line 215 |
| `employee` | [server/permissions.ts](../server/permissions.ts) line 216 |
| `external_advisor` | [server/permissions.ts](../server/permissions.ts) line 217 |
| `read_only_reviewer` | [server/permissions.ts](../server/permissions.ts) line 223 |

JSON preserves every permission group and exact template expression. No universal role × plan × billing-state pass is inferred.

## In-app workspace views

These are app-shell views, not distinct page routes. Navigation inputs do not replace server authorization.

| View | UI permission | Navigation feature | Candidate test text |
| --- | --- | --- | --- |
| Dashboard | `dashboard.view` | `dashboard.core` | `navigation-entitlements.test.ts`, `navigation-preferences.test.ts`, `workspace-design.test.tsx` |
| Forecasting | `sales.view` | `forecasting.revenue` | `navigation-entitlements.test.ts` |
| Intelligence | `insights.view` | `analytics.sales.advanced` | `navigation-entitlements.test.ts` |
| Action Centre | `operations.tasks` | `operations.basic` | `navigation-entitlements.test.ts` |
| Business Brief | `dashboard.view` | `business.brief.basic` | `navigation-entitlements.test.ts` |
| Advisor | `insights.view` | `ai.basic` | `display-labels.test.ts`, `navigation-entitlements.test.ts` |
| BookLoQ | `finance.statements` | `bookloq` | `display-labels.test.ts`, `interaction-integrity.test.mjs`, `navigation-entitlements.test.ts` +1 in JSON |
| Sales | `sales.view` | `analytics.sales.basic` | `bookloq-cash-regressions.test.ts`, `bookloq.test.ts`, `chart-accuracy-render.test.tsx` +4 in JSON |
| Profit | `metrics.profit` | `bookloq` | `navigation-entitlements.test.ts` |
| Cash | `metrics.cash` | `bookloq` | `bookloq-cash-regressions.test.ts`, `bookloq.test.ts`, `lightspeed-x-callback-flow.test.mjs` +2 in JSON |
| Bookkeeping | `finance.statements` | `bookloq` | `navigation-entitlements.test.ts` |
| Inventory | `inventory.view` | `inventory.lots` | `bookloq-dashboard-visuals.test.tsx`, `dashboard-chart-presentation.test.tsx`, `navigation-entitlements.test.ts` +4 in JSON |
| Customers | `customers.totals` | `ai.tools.customers` | `navigation-entitlements.test.ts`, `navigation-preferences.test.ts`, `paid-feature-routing.test.ts` +1 in JSON |
| Marketing | `marketing.view` | `growth.strategy` | `connector-guidance.test.ts`, `integration-catalog.test.ts`, `interaction-integrity.test.mjs` +3 in JSON |
| Communications | `customers.identity` | `communications.basic` | `connector-guidance.test.ts`, `navigation-entitlements.test.ts` |
| Team | `team.directory` | `permissions.standard` | `navigation-entitlements.test.ts` |
| Operations | `operations.tasks` | `operations.basic` | `governance-capacity-flow.test.mjs`, `navigation-entitlements.test.ts`, `public-journey.test.ts` |
| Suppliers | `purchasing.view` | `supplier.analytics` | `navigation-entitlements.test.ts`, `paid-feature-routing.test.ts` |
| Purchase Orders | `purchasing.view` | `inventory.reorder_ai` | `navigation-entitlements.test.ts` |
| Documents | `documents.view` | `invoice.basic` | `navigation-entitlements.test.ts` |
| Data Quality | `integrations.view` | `reporting.basic` | `navigation-entitlements.test.ts` |
| Locations | `locations.manage` | `multi_location.basic` | `navigation-entitlements.test.ts` |
| Decision Journal | `insights.view` | `growth.strategy` | `navigation-entitlements.test.ts` |
| Scenario Planner | `metrics.cash` | `forecasting.scenarios` | `navigation-entitlements.test.ts`, `subscription-access-flow.test.ts` |
| Reports | `reports.operational` | `reporting.basic` | `display-labels.test.ts`, `navigation-entitlements.test.ts`, `workspace-showcase.test.tsx` |
| Integrations | `integrations.view` | `business.settings` | `navigation-entitlements.test.ts` |
| Settings | `organization.settings` | `business.settings` | `navigation-entitlements.test.ts`, `navigation-preferences.test.ts`, `workspace-design.test.tsx` |

## App pages

| Route | Source | Candidate tests |
| --- | --- | --- |
| `/account/deletion-status` | [app/account/deletion-status/page.tsx](../app/account/deletion-status/page.tsx) | `rendered-html.test.mjs` |
| `/account/deletion` | [app/account/deletion/page.tsx](../app/account/deletion/page.tsx) | `rendered-html.test.mjs` |
| `/contact` | [app/contact/page.tsx](../app/contact/page.tsx) | `custom-plan-flow.test.mjs`, `homepage-presentation.test.ts`, `homepage-quality.test.mjs` |
| `/cookies` | [app/cookies/page.tsx](../app/cookies/page.tsx) | `analytics-consent-navigation.test.mjs`, `analytics-runtime.test.mjs`, `custom-plan-flow.test.mjs` +3 in JSON |
| `/custom-plan` | [app/custom-plan/page.tsx](../app/custom-plan/page.tsx) | `custom-plan-flow.test.mjs`, `homepage-presentation.test.ts`, `homepage-quality.test.mjs` |
| `/data-processing` | [app/data-processing/page.tsx](../app/data-processing/page.tsx) | `custom-plan-flow.test.mjs` |
| `/demo` | [app/demo/page.tsx](../app/demo/page.tsx) | `homepage-quality.test.mjs` |
| `/email/unsubscribe` | [app/email/unsubscribe/page.tsx](../app/email/unsubscribe/page.tsx) | `communications-flow.test.mjs` |
| `/features/[slug]` | [app/features/[slug]/page.tsx](../app/features/[slug]/page.tsx) | No direct text reference found |
| `/help` | [app/help/page.tsx](../app/help/page.tsx) | `homepage-presentation.test.ts`, `seo-rendered-html.test.mjs` |
| `/legal` | [app/legal/page.tsx](../app/legal/page.tsx) | `custom-plan-flow.test.mjs`, `legal-fine-print.test.mjs` |
| `/` | [app/page.tsx](../app/page.tsx) | `homepage-presentation.test.ts`, `homepage-quality.test.mjs`, `interaction-integrity.test.mjs` +3 in JSON |
| `/pricing` | [app/pricing/page.tsx](../app/pricing/page.tsx) | `analytics-runtime.test.mjs`, `custom-plan-flow.test.mjs`, `homepage-presentation.test.ts` +2 in JSON |
| `/privacy-requests` | [app/privacy-requests/page.tsx](../app/privacy-requests/page.tsx) | No direct text reference found |
| `/privacy` | [app/privacy/page.tsx](../app/privacy/page.tsx) | `analytics-consent-navigation.test.mjs`, `custom-plan-flow.test.mjs`, `google-analytics-consent.test.mjs` +4 in JSON |
| `/resources/[segment]` | [app/resources/[segment]/page.tsx](../app/resources/[segment]/page.tsx) | `interaction-integrity.test.mjs` |
| `/resources` | [app/resources/page.tsx](../app/resources/page.tsx) | `homepage-quality.test.mjs`, `interaction-integrity.test.mjs`, `seo-rendered-html.test.mjs` +1 in JSON |
| `/social` | [app/social/page.tsx](../app/social/page.tsx) | No direct text reference found |
| `/subprocessors` | [app/subprocessors/page.tsx](../app/subprocessors/page.tsx) | `custom-plan-flow.test.mjs`, `google-analytics-consent.test.mjs` |
| `/terms` | [app/terms/page.tsx](../app/terms/page.tsx) | `custom-plan-flow.test.mjs`, `homepage-quality.test.mjs`, `legal-fine-print.test.mjs` +1 in JSON |

## API endpoints and methods

Exported HTTP methods and named re-exports are extracted from each route. JSON records direct guard references and candidate tests. A helper may enforce additional boundaries that this inventory does not resolve.

| Endpoint | Methods | Source | Candidate tests |
| --- | --- | --- | --- |
| `/api/health` | GET | [app/api/health/route.ts](../app/api/health/route.ts) | No direct text reference found |
| `/api/internal/pos-sync` | POST | [app/api/internal/pos-sync/route.ts](../app/api/internal/pos-sync/route.ts) | `pos-sync-scheduler-flow.test.mjs` |
| `/api/readiness` | GET | [app/api/readiness/route.ts](../app/api/readiness/route.ts) | No direct text reference found |
| `/api/v1/account/deletion/plan` | POST | [app/api/v1/account/deletion/plan/route.ts](../app/api/v1/account/deletion/plan/route.ts) | `account-deletion-flow.test.ts` |
| `/api/v1/account/deletion/resume` | POST | [app/api/v1/account/deletion/resume/route.ts](../app/api/v1/account/deletion/resume/route.ts) | `account-deletion-flow.test.ts` |
| `/api/v1/account/deletion` | GET, POST | [app/api/v1/account/deletion/route.ts](../app/api/v1/account/deletion/route.ts) | `account-deletion-flow.test.ts`, `account-deletion.test.mjs` |
| `/api/v1/address` | GET, POST | [app/api/v1/address/route.ts](../app/api/v1/address/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/advisor/chat` | DELETE, GET, POST | [app/api/v1/advisor/chat/route.ts](../app/api/v1/advisor/chat/route.ts) | `advisor-client.test.tsx`, `advisor-completion-flow.test.mjs`, `advisor-experience-flow.test.mjs` +7 in JSON |
| `/api/v1/advisor/consent` | DELETE, GET, POST | [app/api/v1/advisor/consent/route.ts](../app/api/v1/advisor/consent/route.ts) | `advisor-completion-flow.test.mjs`, `advisor-experience-flow.test.mjs`, `advisor-history-flow.test.mjs` +5 in JSON |
| `/api/v1/advisor/conversations` | DELETE, GET, PATCH | [app/api/v1/advisor/conversations/route.ts](../app/api/v1/advisor/conversations/route.ts) | `advisor-completion-flow.test.mjs`, `advisor-experience-flow.test.mjs`, `advisor-history-flow.test.mjs` +1 in JSON |
| `/api/v1/advisor/preferences` | DELETE, GET, PUT | [app/api/v1/advisor/preferences/route.ts](../app/api/v1/advisor/preferences/route.ts) | `advisor-experience-flow.test.mjs` |
| `/api/v1/auth/signin` | POST | [app/api/v1/auth/signin/route.ts](../app/api/v1/auth/signin/route.ts) | `interaction-integrity.test.mjs` |
| `/api/v1/auth/signup` | GET | [app/api/v1/auth/signup/route.ts](../app/api/v1/auth/signup/route.ts) | `interaction-integrity.test.mjs`, `turnstile-loader.test.ts` |
| `/api/v1/backend` | GET | [app/api/v1/backend/route.ts](../app/api/v1/backend/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/billing/checkout` | POST | [app/api/v1/billing/checkout/route.ts](../app/api/v1/billing/checkout/route.ts) | `complimentary-workspace-flow.test.mjs`, `security-boundary.test.mjs`, `subscription-access-flow.test.ts` |
| `/api/v1/billing/portal` | POST | [app/api/v1/billing/portal/route.ts](../app/api/v1/billing/portal/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/billing` | GET | [app/api/v1/billing/route.ts](../app/api/v1/billing/route.ts) | `account-deletion-flow.test.ts`, `onboarding-identity-recovery-flow.test.mjs`, `security-boundary.test.mjs` +1 in JSON |
| `/api/v1/billing/stripe/webhook` | POST | [app/api/v1/billing/stripe/webhook/route.ts](../app/api/v1/billing/stripe/webhook/route.ts) | No direct text reference found |
| `/api/v1/bookloq/actions` | POST | [app/api/v1/bookloq/actions/route.ts](../app/api/v1/bookloq/actions/route.ts) | `bookloq-cash-regressions.test.ts`, `security-boundary.test.mjs` |
| `/api/v1/bookloq/collections` | GET | [app/api/v1/bookloq/collections/route.ts](../app/api/v1/bookloq/collections/route.ts) | `bookloq-cash-regressions.test.ts` |
| `/api/v1/bookloq/demo` | POST | [app/api/v1/bookloq/demo/route.ts](../app/api/v1/bookloq/demo/route.ts) | `bookloq-cash-regressions.test.ts`, `intelligence-flow.test.mjs`, `security-boundary.test.mjs` +1 in JSON |
| `/api/v1/bookloq/invoices/email` | POST | [app/api/v1/bookloq/invoices/email/route.ts](../app/api/v1/bookloq/invoices/email/route.ts) | `invoice-security-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/bookloq/invoices` | POST | [app/api/v1/bookloq/invoices/route.ts](../app/api/v1/bookloq/invoices/route.ts) | `interaction-integrity.test.mjs`, `invoice-security-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/bookloq/journals` | PATCH, POST | [app/api/v1/bookloq/journals/route.ts](../app/api/v1/bookloq/journals/route.ts) | `bookloq-cash-regressions.test.ts`, `intelligence-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/bookloq` | GET | [app/api/v1/bookloq/route.ts](../app/api/v1/bookloq/route.ts) | `bank-statement-flow.test.mjs`, `bookloq-cash-regressions.test.ts`, `intelligence-flow.test.mjs` +2 in JSON |
| `/api/v1/bookloq/statements` | GET, POST | [app/api/v1/bookloq/statements/route.ts](../app/api/v1/bookloq/statements/route.ts) | `bank-statement-flow.test.mjs` |
| `/api/v1/command-centre` | GET | [app/api/v1/command-centre/route.ts](../app/api/v1/command-centre/route.ts) | `bookloq-cash-regressions.test.ts`, `command-centre-sync-flow.test.mjs`, `intelligence-flow.test.mjs` +6 in JSON |
| `/api/v1/commerce-intelligence` | GET | [app/api/v1/commerce-intelligence/route.ts](../app/api/v1/commerce-intelligence/route.ts) | `intelligence-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/commerce` | GET | [app/api/v1/commerce/route.ts](../app/api/v1/commerce/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/communications/config` | GET | [app/api/v1/communications/config/route.ts](../app/api/v1/communications/config/route.ts) | `communications-flow.test.mjs` |
| `/api/v1/communications/preferences` | GET, POST | [app/api/v1/communications/preferences/route.ts](../app/api/v1/communications/preferences/route.ts) | `communications-flow.test.mjs` |
| `/api/v1/communications/signup-intent` | POST | [app/api/v1/communications/signup-intent/route.ts](../app/api/v1/communications/signup-intent/route.ts) | `communications-flow.test.mjs` |
| `/api/v1/communications/unsubscribe` | POST | [app/api/v1/communications/unsubscribe/route.ts](../app/api/v1/communications/unsubscribe/route.ts) | `communications-flow.test.mjs` |
| `/api/v1/custom-plan` | GET, POST | [app/api/v1/custom-plan/route.ts](../app/api/v1/custom-plan/route.ts) | `custom-plan-flow.test.mjs` |
| `/api/v1/daily-metrics` | GET, POST | [app/api/v1/daily-metrics/route.ts](../app/api/v1/daily-metrics/route.ts) | `intelligence-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/data-quality` | GET | [app/api/v1/data-quality/route.ts](../app/api/v1/data-quality/route.ts) | `intelligence-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/documents/email/deliver` | POST | [app/api/v1/documents/email/deliver/route.ts](../app/api/v1/documents/email/deliver/route.ts) | No direct text reference found |
| `/api/v1/documents/email` | GET, POST | [app/api/v1/documents/email/route.ts](../app/api/v1/documents/email/route.ts) | No direct text reference found |
| `/api/v1/documents` | DELETE, GET, PATCH, POST | [app/api/v1/documents/route.ts](../app/api/v1/documents/route.ts) | `document-deletion-flow.test.mjs`, `document-upload-boundary-flow.test.mjs`, `intelligence-flow.test.mjs` +3 in JSON |
| `/api/v1/entitlements` | GET | [app/api/v1/entitlements/route.ts](../app/api/v1/entitlements/route.ts) | `complimentary-workspace-flow.test.mjs`, `subscription-access-flow.test.ts` |
| `/api/v1/events` | GET, POST | [app/api/v1/events/route.ts](../app/api/v1/events/route.ts) | `intelligence-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/forecasting` | GET, POST | [app/api/v1/forecasting/route.ts](../app/api/v1/forecasting/route.ts) | `forecasting-flow.test.mjs` |
| `/api/v1/governance` | GET, POST | [app/api/v1/governance/route.ts](../app/api/v1/governance/route.ts) | `governance-capacity-flow.test.mjs`, `intelligence-flow.test.mjs`, `interaction-integrity.test.mjs` +1 in JSON |
| `/api/v1/growth` | GET, POST | [app/api/v1/growth/route.ts](../app/api/v1/growth/route.ts) | `google-business-policy.test.ts`, `google-business-storage-flow.test.mjs`, `interaction-integrity.test.mjs` +2 in JSON |
| `/api/v1/integrations/clover/authorize` | POST | [app/api/v1/integrations/clover/authorize/route.ts](../app/api/v1/integrations/clover/authorize/route.ts) | `customer-integration-availability-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/clover/callback` | GET | [app/api/v1/integrations/clover/callback/route.ts](../app/api/v1/integrations/clover/callback/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/clover/disconnect` | POST | [app/api/v1/integrations/clover/disconnect/route.ts](../app/api/v1/integrations/clover/disconnect/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/clover/locations` | GET, POST | [app/api/v1/integrations/clover/locations/route.ts](../app/api/v1/integrations/clover/locations/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/clover/sync` | POST | [app/api/v1/integrations/clover/sync/route.ts](../app/api/v1/integrations/clover/sync/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/clover/webhook` | POST | [app/api/v1/integrations/clover/webhook/route.ts](../app/api/v1/integrations/clover/webhook/route.ts) | No direct text reference found |
| `/api/v1/integrations/deel/authorize` | POST | [app/api/v1/integrations/deel/authorize/route.ts](../app/api/v1/integrations/deel/authorize/route.ts) | `deel.test.ts` |
| `/api/v1/integrations/deel/callback` | GET | [app/api/v1/integrations/deel/callback/route.ts](../app/api/v1/integrations/deel/callback/route.ts) | No direct text reference found |
| `/api/v1/integrations/deel/disconnect` | POST | [app/api/v1/integrations/deel/disconnect/route.ts](../app/api/v1/integrations/deel/disconnect/route.ts) | `deel.test.ts` |
| `/api/v1/integrations/deel/status` | GET | [app/api/v1/integrations/deel/status/route.ts](../app/api/v1/integrations/deel/status/route.ts) | No direct text reference found |
| `/api/v1/integrations/deel/sync` | POST | [app/api/v1/integrations/deel/sync/route.ts](../app/api/v1/integrations/deel/sync/route.ts) | No direct text reference found |
| `/api/v1/integrations/google/authorize` | POST | [app/api/v1/integrations/google/authorize/route.ts](../app/api/v1/integrations/google/authorize/route.ts) | `marketing-resource-selection-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/google/business-profile/reviews` | GET, POST | [app/api/v1/integrations/google/business-profile/reviews/route.ts](../app/api/v1/integrations/google/business-profile/reviews/route.ts) | No direct text reference found |
| `/api/v1/integrations/google/callback` | GET | [app/api/v1/integrations/google/callback/route.ts](../app/api/v1/integrations/google/callback/route.ts) | `marketing-resource-selection-flow.test.mjs` |
| `/api/v1/integrations/google/disconnect` | POST | [app/api/v1/integrations/google/disconnect/route.ts](../app/api/v1/integrations/google/disconnect/route.ts) | `marketing-resource-selection-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/google/resources` | POST | [app/api/v1/integrations/google/resources/route.ts](../app/api/v1/integrations/google/resources/route.ts) | `marketing-location-authorization-flow.test.mjs`, `marketing-resource-selection-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/google/sync` | POST | [app/api/v1/integrations/google/sync/route.ts](../app/api/v1/integrations/google/sync/route.ts) | `google-business-storage-flow.test.mjs`, `marketing-resource-selection-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/lightspeed-r/authorize` | POST | [app/api/v1/integrations/lightspeed-r/authorize/route.ts](../app/api/v1/integrations/lightspeed-r/authorize/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/lightspeed-r/callback` | GET | [app/api/v1/integrations/lightspeed-r/callback/route.ts](../app/api/v1/integrations/lightspeed-r/callback/route.ts) | `lightspeed-r-callback-flow.test.mjs`, `lightspeed.test.ts`, `oauth-callback-race.test.mjs` +1 in JSON |
| `/api/v1/integrations/lightspeed-r/disconnect` | POST | [app/api/v1/integrations/lightspeed-r/disconnect/route.ts](../app/api/v1/integrations/lightspeed-r/disconnect/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/lightspeed-r/shops` | GET, POST | [app/api/v1/integrations/lightspeed-r/shops/route.ts](../app/api/v1/integrations/lightspeed-r/shops/route.ts) | `intelligence-flow.test.mjs`, `interaction-integrity.test.mjs`, `lightspeed-r-callback-flow.test.mjs` +1 in JSON |
| `/api/v1/integrations/lightspeed-r/sync` | POST | [app/api/v1/integrations/lightspeed-r/sync/route.ts](../app/api/v1/integrations/lightspeed-r/sync/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/lightspeed/authorize` | POST | [app/api/v1/integrations/lightspeed/authorize/route.ts](../app/api/v1/integrations/lightspeed/authorize/route.ts) | `customer-integration-availability-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/lightspeed/callback` | GET | [app/api/v1/integrations/lightspeed/callback/route.ts](../app/api/v1/integrations/lightspeed/callback/route.ts) | `lightspeed-x-callback-flow.test.mjs`, `oauth-callback-race.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/lightspeed/disconnect` | POST | [app/api/v1/integrations/lightspeed/disconnect/route.ts](../app/api/v1/integrations/lightspeed/disconnect/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/lightspeed/outlets` | GET, POST | [app/api/v1/integrations/lightspeed/outlets/route.ts](../app/api/v1/integrations/lightspeed/outlets/route.ts) | `intelligence-flow.test.mjs`, `interaction-integrity.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/lightspeed/sync` | POST | [app/api/v1/integrations/lightspeed/sync/route.ts](../app/api/v1/integrations/lightspeed/sync/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/lightspeed/webhook` | POST | [app/api/v1/integrations/lightspeed/webhook/route.ts](../app/api/v1/integrations/lightspeed/webhook/route.ts) | No direct text reference found |
| `/api/v1/integrations/meta/authorize` | POST | [app/api/v1/integrations/meta/authorize/route.ts](../app/api/v1/integrations/meta/authorize/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/meta/callback` | GET | [app/api/v1/integrations/meta/callback/route.ts](../app/api/v1/integrations/meta/callback/route.ts) | No direct text reference found |
| `/api/v1/integrations/meta/campaigns` | GET, POST | [app/api/v1/integrations/meta/campaigns/route.ts](../app/api/v1/integrations/meta/campaigns/route.ts) | No direct text reference found |
| `/api/v1/integrations/meta/disconnect` | POST | [app/api/v1/integrations/meta/disconnect/route.ts](../app/api/v1/integrations/meta/disconnect/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/meta/resources` | POST | [app/api/v1/integrations/meta/resources/route.ts](../app/api/v1/integrations/meta/resources/route.ts) | `marketing-location-authorization-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/meta/sync` | POST | [app/api/v1/integrations/meta/sync/route.ts](../app/api/v1/integrations/meta/sync/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/moneris/connect` | POST | [app/api/v1/integrations/moneris/connect/route.ts](../app/api/v1/integrations/moneris/connect/route.ts) | `customer-integration-availability-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/moneris/disconnect` | POST | [app/api/v1/integrations/moneris/disconnect/route.ts](../app/api/v1/integrations/moneris/disconnect/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/moneris/sync` | POST | [app/api/v1/integrations/moneris/sync/route.ts](../app/api/v1/integrations/moneris/sync/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/plaid/delete-data` | POST | [app/api/v1/integrations/plaid/delete-data/route.ts](../app/api/v1/integrations/plaid/delete-data/route.ts) | `plaid.test.ts`, `security-boundary.test.mjs` |
| `/api/v1/integrations/plaid/disconnect` | POST | [app/api/v1/integrations/plaid/disconnect/route.ts](../app/api/v1/integrations/plaid/disconnect/route.ts) | `intelligence-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/plaid/exchange` | POST | [app/api/v1/integrations/plaid/exchange/route.ts](../app/api/v1/integrations/plaid/exchange/route.ts) | `intelligence-flow.test.mjs`, `plaid.test.ts`, `security-boundary.test.mjs` |
| `/api/v1/integrations/plaid/link-token` | POST | [app/api/v1/integrations/plaid/link-token/route.ts](../app/api/v1/integrations/plaid/link-token/route.ts) | `intelligence-flow.test.mjs`, `plaid.test.ts`, `security-boundary.test.mjs` |
| `/api/v1/integrations/plaid/sync` | POST | [app/api/v1/integrations/plaid/sync/route.ts](../app/api/v1/integrations/plaid/sync/route.ts) | `intelligence-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/plaid/webhook` | POST | [app/api/v1/integrations/plaid/webhook/route.ts](../app/api/v1/integrations/plaid/webhook/route.ts) | No direct text reference found |
| `/api/v1/integrations/quickbooks/authorize` | POST | [app/api/v1/integrations/quickbooks/authorize/route.ts](../app/api/v1/integrations/quickbooks/authorize/route.ts) | `quickbooks-callback-flow.test.mjs`, `quickbooks.test.ts` |
| `/api/v1/integrations/quickbooks/callback` | GET | [app/api/v1/integrations/quickbooks/callback/route.ts](../app/api/v1/integrations/quickbooks/callback/route.ts) | `quickbooks-callback-flow.test.mjs`, `quickbooks.test.ts` |
| `/api/v1/integrations/quickbooks/disconnect` | POST | [app/api/v1/integrations/quickbooks/disconnect/route.ts](../app/api/v1/integrations/quickbooks/disconnect/route.ts) | `quickbooks.test.ts` |
| `/api/v1/integrations` | GET, POST | [app/api/v1/integrations/route.ts](../app/api/v1/integrations/route.ts) | `customer-integration-availability-flow.test.mjs`, `google-business-storage-flow.test.mjs`, `intelligence-flow.test.mjs` +6 in JSON |
| `/api/v1/integrations/schedule` | POST | [app/api/v1/integrations/schedule/route.ts](../app/api/v1/integrations/schedule/route.ts) | `pos-sync-scheduler-flow.test.mjs` |
| `/api/v1/integrations/shopify-pos/authorize` | POST | [app/api/v1/integrations/shopify-pos/authorize/route.ts](../app/api/v1/integrations/shopify-pos/authorize/route.ts) | `customer-integration-availability-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/shopify-pos/callback` | GET | [app/api/v1/integrations/shopify-pos/callback/route.ts](../app/api/v1/integrations/shopify-pos/callback/route.ts) | `security-boundary.test.mjs`, `shopify-pos.test.ts`, `shopify-privacy-flow.test.mjs` |
| `/api/v1/integrations/shopify-pos/disconnect` | POST | [app/api/v1/integrations/shopify-pos/disconnect/route.ts](../app/api/v1/integrations/shopify-pos/disconnect/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/shopify-pos/locations` | GET, POST | [app/api/v1/integrations/shopify-pos/locations/route.ts](../app/api/v1/integrations/shopify-pos/locations/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/shopify-pos/sync` | POST | [app/api/v1/integrations/shopify-pos/sync/route.ts](../app/api/v1/integrations/shopify-pos/sync/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/shopify-pos/webhook` | POST | [app/api/v1/integrations/shopify-pos/webhook/route.ts](../app/api/v1/integrations/shopify-pos/webhook/route.ts) | `shopify-pos.test.ts`, `shopify-privacy-flow.test.mjs` |
| `/api/v1/integrations/shopify/authorize` | POST | [app/api/v1/integrations/shopify/authorize/route.ts](../app/api/v1/integrations/shopify/authorize/route.ts) | `customer-integration-availability-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/shopify/callback` | GET | [app/api/v1/integrations/shopify/callback/route.ts](../app/api/v1/integrations/shopify/callback/route.ts) | `shopify-privacy-flow.test.mjs` |
| `/api/v1/integrations/shopify/disconnect` | POST | [app/api/v1/integrations/shopify/disconnect/route.ts](../app/api/v1/integrations/shopify/disconnect/route.ts) | `security-boundary.test.mjs`, `shopify-privacy-flow.test.mjs` |
| `/api/v1/integrations/shopify/locations` | GET, POST | [app/api/v1/integrations/shopify/locations/route.ts](../app/api/v1/integrations/shopify/locations/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/shopify/privacy` | GET, POST | [app/api/v1/integrations/shopify/privacy/route.ts](../app/api/v1/integrations/shopify/privacy/route.ts) | `shopify-privacy-flow.test.mjs` |
| `/api/v1/integrations/shopify/sync` | POST | [app/api/v1/integrations/shopify/sync/route.ts](../app/api/v1/integrations/shopify/sync/route.ts) | `security-boundary.test.mjs`, `shopify-pos.test.ts` |
| `/api/v1/integrations/shopify/webhook` | POST | [app/api/v1/integrations/shopify/webhook/route.ts](../app/api/v1/integrations/shopify/webhook/route.ts) | `shopify-privacy-flow.test.mjs` |
| `/api/v1/integrations/slack/authorize` | POST | [app/api/v1/integrations/slack/authorize/route.ts](../app/api/v1/integrations/slack/authorize/route.ts) | `slack-sharing-flow.test.mjs`, `slack.test.ts` |
| `/api/v1/integrations/slack/callback` | GET | [app/api/v1/integrations/slack/callback/route.ts](../app/api/v1/integrations/slack/callback/route.ts) | `slack.test.ts` |
| `/api/v1/integrations/slack/disconnect` | POST | [app/api/v1/integrations/slack/disconnect/route.ts](../app/api/v1/integrations/slack/disconnect/route.ts) | `slack.test.ts` |
| `/api/v1/integrations/slack/share-workspace` | POST | [app/api/v1/integrations/slack/share-workspace/route.ts](../app/api/v1/integrations/slack/share-workspace/route.ts) | `slack-sharing-flow.test.mjs` |
| `/api/v1/integrations/slack/status` | GET | [app/api/v1/integrations/slack/status/route.ts](../app/api/v1/integrations/slack/status/route.ts) | `slack.test.ts` |
| `/api/v1/integrations/slack/test-notification` | POST | [app/api/v1/integrations/slack/test-notification/route.ts](../app/api/v1/integrations/slack/test-notification/route.ts) | `slack.test.ts` |
| `/api/v1/integrations/square/authorize` | POST | [app/api/v1/integrations/square/authorize/route.ts](../app/api/v1/integrations/square/authorize/route.ts) | `security-boundary.test.mjs`, `square-sync-flow.test.mjs` |
| `/api/v1/integrations/square/callback` | GET | [app/api/v1/integrations/square/callback/route.ts](../app/api/v1/integrations/square/callback/route.ts) | `security-boundary.test.mjs`, `square-sync-flow.test.mjs` |
| `/api/v1/integrations/square/disconnect` | POST | [app/api/v1/integrations/square/disconnect/route.ts](../app/api/v1/integrations/square/disconnect/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/square/locations` | GET, POST | [app/api/v1/integrations/square/locations/route.ts](../app/api/v1/integrations/square/locations/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/square/sync` | POST | [app/api/v1/integrations/square/sync/route.ts](../app/api/v1/integrations/square/sync/route.ts) | `security-boundary.test.mjs`, `square-sync-flow.test.mjs` |
| `/api/v1/integrations/square/webhook` | POST | [app/api/v1/integrations/square/webhook/route.ts](../app/api/v1/integrations/square/webhook/route.ts) | No direct text reference found |
| `/api/v1/integrations/stripe/authorize` | POST | [app/api/v1/integrations/stripe/authorize/route.ts](../app/api/v1/integrations/stripe/authorize/route.ts) | `customer-integration-availability-flow.test.mjs`, `security-boundary.test.mjs` |
| `/api/v1/integrations/stripe/callback` | GET | [app/api/v1/integrations/stripe/callback/route.ts](../app/api/v1/integrations/stripe/callback/route.ts) | `oauth-callback-race.test.mjs`, `pos-sync-scheduler-flow.test.mjs`, `security-boundary.test.mjs` +1 in JSON |
| `/api/v1/integrations/stripe/disconnect` | POST | [app/api/v1/integrations/stripe/disconnect/route.ts](../app/api/v1/integrations/stripe/disconnect/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/stripe/sync` | POST | [app/api/v1/integrations/stripe/sync/route.ts](../app/api/v1/integrations/stripe/sync/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/integrations/stripe/webhook` | POST | [app/api/v1/integrations/stripe/webhook/route.ts](../app/api/v1/integrations/stripe/webhook/route.ts) | No direct text reference found |
| `/api/v1/internal/team-access` | POST | [app/api/v1/internal/team-access/route.ts](../app/api/v1/internal/team-access/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/internal/team-provisioning` | GET | [app/api/v1/internal/team-provisioning/route.ts](../app/api/v1/internal/team-provisioning/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/inventory-costs` | POST | [app/api/v1/inventory-costs/route.ts](../app/api/v1/inventory-costs/route.ts) | `intelligence-flow.test.mjs`, `inventory-costs.test.ts` |
| `/api/v1/inventory-lifecycle` | GET, POST | [app/api/v1/inventory-lifecycle/route.ts](../app/api/v1/inventory-lifecycle/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/legal/acceptance` | GET, POST | [app/api/v1/legal/acceptance/route.ts](../app/api/v1/legal/acceptance/route.ts) | `legal-consent-controls.test.mjs` |
| `/api/v1/linked-files/google-files/callback` | GET | [app/api/v1/linked-files/google-files/callback/route.ts](../app/api/v1/linked-files/google-files/callback/route.ts) | `bookloq-cash-regressions.test.ts` |
| `/api/v1/linked-files/microsoft-files/callback` | GET | [app/api/v1/linked-files/microsoft-files/callback/route.ts](../app/api/v1/linked-files/microsoft-files/callback/route.ts) | `microsoft-linked-files-flow.test.mjs` |
| `/api/v1/linked-files` | GET, POST | [app/api/v1/linked-files/route.ts](../app/api/v1/linked-files/route.ts) | `bookloq-cash-regressions.test.ts`, `microsoft-linked-files-flow.test.mjs` |
| `/api/v1/locations` | GET | [app/api/v1/locations/route.ts](../app/api/v1/locations/route.ts) | `bookloq-cash-regressions.test.ts` |
| `/api/v1/marketing/reports` | GET | [app/api/v1/marketing/reports/route.ts](../app/api/v1/marketing/reports/route.ts) | `google-business-storage-flow.test.mjs`, `marketing-resource-selection-flow.test.mjs` |
| `/api/v1/onboarding` | GET, POST | [app/api/v1/onboarding/route.ts](../app/api/v1/onboarding/route.ts) | `bookloq-cash-regressions.test.ts`, `communications-flow.test.mjs`, `complimentary-workspace-flow.test.mjs` +11 in JSON |
| `/api/v1/openapi` | GET | [app/api/v1/openapi/route.ts](../app/api/v1/openapi/route.ts) | No direct text reference found |
| `/api/v1/operations` | GET, POST | [app/api/v1/operations/route.ts](../app/api/v1/operations/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/opportunities` | GET, PATCH, POST | [app/api/v1/opportunities/route.ts](../app/api/v1/opportunities/route.ts) | `opportunity-review-flow.test.mjs` |
| `/api/v1/organization-logo` | DELETE, GET, POST | [app/api/v1/organization-logo/route.ts](../app/api/v1/organization-logo/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/preferences` | GET, POST | [app/api/v1/preferences/route.ts](../app/api/v1/preferences/route.ts) | `bookloq-cash-regressions.test.ts` |
| `/api/v1/purchasing` | GET, POST | [app/api/v1/purchasing/route.ts](../app/api/v1/purchasing/route.ts) | `bookloq-cash-regressions.test.ts`, `intelligence-flow.test.mjs`, `interaction-integrity.test.mjs` +2 in JSON |
| `/api/v1/reports` | GET, POST | [app/api/v1/reports/route.ts](../app/api/v1/reports/route.ts) | `intelligence-flow.test.mjs`, `interaction-integrity.test.mjs`, `revenue-source-flow.test.mjs` +1 in JSON |
| `/api/v1/retail-intelligence` | GET | [app/api/v1/retail-intelligence/route.ts](../app/api/v1/retail-intelligence/route.ts) | `retail-intelligence-flow.test.mjs` |
| `/api/v1/retail-measurements` | GET, POST | [app/api/v1/retail-measurements/route.ts](../app/api/v1/retail-measurements/route.ts) | `retail-intelligence-flow.test.mjs` |
| `/api/v1/session` | DELETE, GET, POST | [app/api/v1/session/route.ts](../app/api/v1/session/route.ts) | No direct text reference found |
| `/api/v1/tasks` | GET, PATCH, POST | [app/api/v1/tasks/route.ts](../app/api/v1/tasks/route.ts) | `intelligence-flow.test.mjs`, `opportunity-review-flow.test.mjs`, `shopify-privacy-flow.test.mjs` |
| `/api/v1/team-invitations` | GET, POST | [app/api/v1/team-invitations/route.ts](../app/api/v1/team-invitations/route.ts) | `security-boundary.test.mjs` |
| `/api/v1/vehicles` | GET, PATCH, POST | [app/api/v1/vehicles/route.ts](../app/api/v1/vehicles/route.ts) | `vehicles-flow.test.mjs` |

## Database and migrations

Applied all 68 migration files in order to an isolated in-memory SQLite 3.53.3 database. Integrity check passed and foreign-key check returned no violations. This verifies an empty reconstructed schema, not populated migration safety, Cloudflare D1 behavior or production migration application. JSON contains each final table's CREATE SQL, columns, foreign keys and indexes, plus final triggers/views and migration hashes.

| Physical table | Drizzle declaration | Column count |
| --- | --- | --- |
| `access_roles` | `accessRoles` | 12 |
| `account_deletion_jobs` | `accountDeletionJobs` | 12 |
| `account_deletion_receipts` | `accountDeletionReceipts` | 9 |
| `account_notifications` | `accountNotifications` | 9 |
| `account_preferences` | `accountPreferences` | 8 |
| `accounting_periods` | `accountingPeriods` | 10 |
| `advisor_preferences` | Raw SQL / legacy, no current Drizzle declaration | 4 |
| `advisor_requests` | Raw SQL / legacy, no current Drizzle declaration | 8 |
| `assistant_conversations` | `assistantConversations` | 6 |
| `assistant_messages` | `assistantMessages` | 9 |
| `audit_events` | `auditEvents` | 11 |
| `bank_accounts` | `bankAccounts` | 21 |
| `bank_statement_imports` | `bankStatementImports` | 18 |
| `bank_statement_rows` | `bankStatementRows` | 3 |
| `billing_checkout_attempts` | `billingCheckoutAttempts` | 6 |
| `bookloq_alerts` | `bookloqAlerts` | 17 |
| `bookloq_budgets` | `bookloqBudgets` | 12 |
| `bookloq_category_rules` | `bookloqCategoryRules` | 10 |
| `bookloq_contacts` | `bookloqContacts` | 14 |
| `bookloq_role_assignments` | `bookloqRoleAssignments` | 8 |
| `bookloq_settings` | `bookloqSettings` | 12 |
| `bookloq_transaction_matches` | `bookloqTransactionMatches` | 15 |
| `business_events` | `businessEvents` | 12 |
| `cloud_file_connections` | `cloudFileConnections` | 13 |
| `commerce_customers` | `commerceCustomers` | 15 |
| `commerce_payments` | `commercePayments` | 15 |
| `commerce_products` | `commerceProducts` | 21 |
| `commerce_sale_lines` | `commerceSaleLines` | 20 |
| `commerce_suppliers` | `commerceSuppliers` | 15 |
| `complimentary_access` | `complimentaryAccess` | 6 |
| `customer_invoice_lines` | `customerInvoiceLines` | 12 |
| `customer_invoices` | `customerInvoices` | 25 |
| `daily_business_metrics` | `dailyBusinessMetrics` | 22 |
| `data_imports` | `dataImports` | 9 |
| `document_email_aliases` | `documentEmailAliases` | 10 |
| `document_email_deliveries` | `documentEmailDeliveries` | 9 |
| `document_email_sources` | `documentEmailSources` | 7 |
| `document_ingest_intents` | `documentIngestIntents` | 8 |
| `employee_pin_credentials` | `employeePinCredentials` | 12 |
| `financial_accounts` | `financialAccounts` | 17 |
| `financial_transactions` | `financialTransactions` | 28 |
| `forecasting_runs` | `forecastingRuns` | 9 |
| `forecasting_settings` | `forecastingSettings` | 5 |
| `forecasting_views` | `forecastingViews` | 4 |
| `goods_receipts` | `goodsReceipts` | 8 |
| `growth_touchpoints` | `growthTouchpoints` | 9 |
| `growth_transactions` | `growthTransactions` | 9 |
| `integration_connections` | `integrationConnections` | 23 |
| `integration_consents` | `integrationConsents` | 14 |
| `integration_location_mappings` | `integrationLocationMappings` | 11 |
| `integration_oauth_states` | `integrationOAuthStates` | 11 |
| `integration_secrets` | `integrationSecrets` | 9 |
| `integration_source_authorities` | `integrationSourceAuthorities` | 12 |
| `integration_staged_financial_records` | `integrationStagedFinancialRecords` | 19 |
| `integration_staged_sales` | `integrationStagedSales` | 17 |
| `integration_sync_runs` | `integrationSyncRuns` | 17 |
| `integration_sync_schedules` | `integrationSyncSchedules` | 21 |
| `integration_sync_ticks` | `integrationSyncTicks` | 2 |
| `integration_webhook_events` | `integrationWebhookEvents` | 11 |
| `internal_access` | `internalAccess` | 10 |
| `inventory_balances` | `inventoryBalances` | 11 |
| `inventory_lot_movements` | `inventoryLotMovements` | 10 |
| `inventory_lots` | `inventoryLots` | 26 |
| `inventory_movements` | `inventoryMovements` | 9 |
| `inventory_vehicles` | `inventoryVehicles` | 20 |
| `invoice_matches` | `invoiceMatches` | 10 |
| `journal_entries` | `journalEntries` | 21 |
| `journal_lines` | `journalLines` | 15 |
| `legal_acceptances` | `legalAcceptances` | 12 |
| `linked_files` | `linkedFiles` | 19 |
| `marketing_calendar_entries` | `marketingCalendarEntries` | 13 |
| `marketing_daily_metrics` | `marketingDailyMetrics` | 8 |
| `marketing_email_events` | `marketingEmailEvents` | 10 |
| `marketing_email_intents` | `marketingEmailIntents` | 8 |
| `marketing_email_preferences` | `marketingEmailPreferences` | 6 |
| `marketing_email_unsubscribe_tokens` | `marketingEmailUnsubscribeTokens` | 4 |
| `marketing_profiles` | `marketingProfiles` | 12 |
| `marketing_resource_selections` | `marketingResourceSelections` | 13 |
| `memberships` | `memberships` | 7 |
| `month_end_items` | `monthEndItems` | 11 |
| `operational_events` | `operationalEvents` | 10 |
| `opportunity_review_events` | `opportunityReviewEvents` | 8 |
| `opportunity_reviews` | `opportunityReviews` | 16 |
| `organization_locations` | `organizationLocations` | 21 |
| `organization_profiles` | `organizationProfiles` | 13 |
| `organizations` | `legacyOrganizations` | 24 |
| `outbound_messages` | `outboundMessages` | 14 |
| `purchase_order_lines` | `purchaseOrderLines` | 20 |
| `purchase_orders` | `purchaseOrders` | 20 |
| `rate_limit_buckets` | `rateLimitBuckets` | 6 |
| `reconciliations` | `reconciliations` | 16 |
| `retail_measurements` | `retailMeasurements` | 14 |
| `search_visibility_observations` | `searchVisibilityObservations` | 9 |
| `shopify_privacy_requests` | `shopifyPrivacyRequests` | 16 |
| `shopify_store_locks` | `shopifyStoreLocks` | 4 |
| `stripe_billing_events` | `stripeBillingEvents` | 9 |
| `supplier_bills` | `supplierBills` | 19 |
| `tasks` | `legacyTasks` | 11 |
| `team_members` | `teamMembers` | 29 |
| `tenant_addons` | `tenantAddons` | 11 |
| `tenant_subscriptions` | `tenantSubscriptions` | 21 |
| `users` | `users` | 8 |
| `workspace_documents` | `workspaceDocuments` | 18 |
| `workspace_sessions` | `workspaceSessions` | 7 |
| `workspace_tasks` | `workspaceTasks` | 15 |
| `workspaces` | `workspaces` | 23 |

Actual physical tables without a current Drizzle declaration: `advisor_preferences`, `advisor_requests`. These tables are included above, including `advisor_preferences` and `advisor_requests`.

Declared tables absent from the migrated database: none. Historical CREATE names absent from the final database: `__new_commerce_products`, `__new_daily_business_metrics`, `__new_financial_transactions`, `__new_integration_connections`, `__new_marketing_daily_metrics`, `__new_marketing_resource_selections`, `__new_organizations`, `__new_tenant_subscriptions`, `__new_workspace_documents`, `__new_workspace_tasks`, `marketing_reviews`. These are migration history, not additional current tables.

Latest migrations include [0066_vehicle_inventory.sql](../drizzle/0066_vehicle_inventory.sql) and [0067_shopify_privacy_requests.sql](../drizzle/0067_shopify_privacy_requests.sql). Their application to production remains a separate release step.

## Background work

| Work | Trigger | Source and limits | Test candidates |
| --- | --- | --- | --- |
| Signed POS synchronization | POST /api/internal/pos-sync | [server/integrations/sync-scheduler.ts](../server/integrations/sync-scheduler.ts). Signed, timestamped and replay-protected external tick. At most three due POS jobs; per-connection authorization and leases. External trigger activation is not verified. | `pos-sync-scheduler-flow.test.mjs` |
| Authorized document cleanup | Accepted signed POS tick | [server/document-cleanup-scheduler.ts](../server/document-cleanup-scheduler.ts). At most three existing authorized cleanup/failed-ingest jobs. Does not create general age-based disposal. | `document-cleanup-scheduler.test.ts`, `document-cleanup-scheduler-flow.test.mjs` |
| Expired rate-limit cleanup | Accepted signed POS tick | [server/integrations/sync-scheduler.ts](../server/integrations/sync-scheduler.ts). Runs cleanupExpiredRateLimits; actual scheduled production execution is not verified. | No direct text reference found |
| Inbound document email | Cloudflare Email Worker email event | [email-worker/worker.ts](../email-worker/worker.ts). Separate email worker forwards authorized routed mail for ingestion. Enabled/verified flags do not prove this release delivery, scan and extraction. | `document-email-client.test.ts`, `document-email-flow.test.mjs`, `document-email-standalone-entitlement.test.mjs` +2 in JSON |
| Provider notifications | Provider-specific webhook routes | Receipts and processing vary by provider. A route does not prove subscription, delivery, historical coverage or completed privacy fulfilment. | `lightspeed-r-callback-flow.test.mjs`, `lightspeed-x-callback-flow.test.mjs`, `oauth-callback-race.test.mjs` +2 in JSON |

The app Worker exposes fetch; a waitUntil interface is not a scheduled handler. The signed scheduler requires a configured external caller. A polling policy, webhook route or email flag does not prove live delivery or queue latency. Additional lexical background candidates are in JSON.

## Registries and verification gaps

| Registry | Test references |
| --- | --- |
| [server/entitlements/catalog.ts](../server/entitlements/catalog.ts) | `bookloq-standalone-pricing.test.tsx`, `checkout-concurrency.test.ts`, `entitlement-catalog.test.ts` +3 in JSON |
| [server/entitlements/engine.ts](../server/entitlements/engine.ts) | `complimentary-access.test.ts`, `entitlement-engine.test.ts`, `interaction-integrity.test.mjs` +3 in JSON |
| [server/permissions.ts](../server/permissions.ts) | `governance.test.ts`, `security-boundary.test.mjs` |
| [server/authorization.ts](../server/authorization.ts) | `account-deletion-flow.test.ts`, `interaction-integrity.test.mjs`, `internal-access.test.ts` +2 in JSON |
| [domain/navigation-entitlements.ts](../domain/navigation-entitlements.ts) | `navigation-entitlements.test.ts`, `subscription-access-flow.test.ts` |
| [domain/paid-feature-routing.ts](../domain/paid-feature-routing.ts) | `paid-feature-routing.test.ts` |
| [domain/integration-availability.ts](../domain/integration-availability.ts) | `customer-integration-availability.test.ts` |
| [domain/integration-capabilities.ts](../domain/integration-capabilities.ts) | `integration-capabilities.test.ts`, `integration-data-readiness.test.ts` |
| [domain/provider-feature-coverage.ts](../domain/provider-feature-coverage.ts) | `provider-feature-coverage.test.ts` |
| [domain/provider-report-contracts.ts](../domain/provider-report-contracts.ts) | `integration-capabilities.test.ts`, `integration-data-readiness.test.ts`, `provider-report-contracts.test.ts` |
| [domain/provider-privacy.ts](../domain/provider-privacy.ts) | `lightspeed-r-callback-flow.test.mjs`, `lightspeed-x-callback-flow.test.mjs`, `marketing-resource-selection-flow.test.mjs` +6 in JSON |
| [domain/privacy-controls.ts](../domain/privacy-controls.ts) | `advisor-client.test.tsx`, `interaction-integrity.test.mjs`, `plaid.test.ts` |
| [shared/legal-versions.ts](../shared/legal-versions.ts) | `checkout-concurrency.test.ts`, `checkout-legal-acceptance.test.ts`, `legal-fine-print.test.mjs` +2 in JSON |
| [shared/subscription-trial.ts](../shared/subscription-trial.ts) | `stripe-billing.test.ts`, `subscription-trial-persistence.test.ts` |
| [server/integrations/sync-policy.ts](../server/integrations/sync-policy.ts) | `lightspeed-r-recent-sync.test.ts`, `pos-sync-policy.test.ts` |
| [app/integration-catalog.ts](../app/integration-catalog.ts) | `customer-integration-availability.test.ts`, `integration-catalog.test.ts`, `interaction-integrity.test.mjs` |
| [domain/integration-data-readiness.ts](../domain/integration-data-readiness.ts) | `integration-data-evidence.test.ts`, `integration-data-readiness.test.ts` |
| [server/integrations/data-readiness.ts](../server/integrations/data-readiness.ts) | `integration-data-evidence.test.ts` |
| [server/integrations/shopify-privacy.ts](../server/integrations/shopify-privacy.ts) | `shopify-privacy.test.ts` |

3 pages and 18 route files have no exact textual source/path test reference in this extraction; all are listed in JSON. Manually map assertions for dynamic/delegated routes, two organizations, revoked permissions, empty/partial data, UI actions and source drill-downs. A fixture cannot prove provider approval.

The private Shopify queue adds `/privacy-requests` and GET/POST `/api/v1/integrations/shopify/privacy`; explicit owner/admin, privacy permission, export permission, location scope and tenant checks remain distinct from paid entitlements. Candidate Worker flows are recorded without claiming execution.

Final owner: attach executed manifest/logs, failures/skips/reruns, build identity and hosted observations to the consolidated release document. Current inventory test entries intentionally say not_run_by_inventory.

## Maintenance change triggers

| Change | Required follow-up |
| --- | --- |
| Provider scopes, purpose, write access, AI use, storage or subprocessors | Reconcile provider contracts and privacy duties, update accurate disclosure/consent version, review previous grants and deletion. |
| API version/sunset, access tier or quotas | Re-read official migration/approval documentation; replay pagination/correction fixtures; reassess availability and reauthorization. |
| Price, allowance, feature, role, add-on, trial or billing state | Version commercial contract when required; align Terms, UI, checkout and verified Stripe price data; test races and existing customers. |
| Migration or money/source mapping | Test incremental migration and correction/rebuild with isolated data; prove rollback/recovery; record actual production application separately. |
| Retention or deletion changes | Verify authorized scope, provider deadlines and retries; distinguish targets from enforced disposal; preserve records with a disclosed valid retention basis. |
| Storage, backups or infrastructure change | Produce actual production backup/restore evidence. Source archives and isolated restores are not production-data recovery proof. |
| New route, widget, action or background job | Regenerate inventory; map meaningful tenant/role/location/feature tests; inspect accessible loading/error/empty states. |
| Release or dependency update | Run appropriate checks, preserve unresolved risks, verify deployment identity and essential hosted flows; retain dated evidence/history. |

Final release status belongs in the owner-maintained consolidated release document.
