# Vanteloq Platform Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the final platform-hardening pass before Shopify, Moneris, Google, Meta, and other live connector credentials are added.

**Architecture:** Normalize every provider into shared commerce contracts, resolve all location filters on the server, store recoverable account preferences, and connect BookLoQ to Plaid through encrypted server-side tokens and reviewed records. Cross-module recommendations consume verified inputs and disclose missing evidence.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Vinext, Cloudflare D1 and R2, Drizzle ORM, Supabase Auth transition layer, Plaid Link, Node test runner.

## Global Constraints

- Do not display a connector as live without configured credentials and a successful real-data check.
- Do not expose provider access tokens or raw account identifiers to the browser.
- All money calculations use integer minor units.
- All tenant, permission, and location checks run on the server.
- Missing inputs produce an unavailable or needs-data state, not zero or a fabricated recommendation.
- Public copy contains no em dash characters, false guarantees, fake numbers, or legal, accounting, tax, ranking, or revenue promises.
- Generated images are supporting editorial art only. Data visuals remain code-driven.

---

### Task 1: Provider parity and location scope

**Files:**
- Create: `domain/provider-feature-coverage.ts`
- Create: `domain/location-scope.ts`
- Create: `server/location-access.ts`
- Create: `app/api/v1/locations/route.ts`
- Modify: `app/api/v1/commerce/route.ts`
- Modify: `app/api/v1/command-centre/route.ts`
- Test: `tests/provider-feature-coverage.test.ts`
- Test: `tests/location-scope.test.ts`

**Interfaces:**
- Produces: `buildProviderFeatureCoverage(provider, coverage)` and `resolveProviderLocationRefs(mappings, organizationLocationId)`.
- Produces: authenticated location lists and server-scoped command-centre metrics.

- [x] Write tests proving equivalent normalized data yields equivalent features and incomplete coverage names missing fields.
- [x] Run the focused tests and verify the new cases fail before implementation.
- [x] Implement canonical coverage and tenant-owned location resolution.
- [ ] Add route-level tests that reject another organization's location and preserve all-location scope.
- [ ] Run the focused provider and location suite.

### Task 2: Recoverable navigation and clearer workspace guidance

**Files:**
- Create: `domain/navigation-preferences.ts`
- Create: `app/api/v1/preferences/route.ts`
- Modify: `db/schema.ts`
- Modify: `app/vanteloq-app.tsx`
- Modify: `app/design-v2.css`
- Modify: `app/operating.css`
- Test: `tests/navigation-preferences.test.ts`

**Interfaces:**
- Produces: account-level `hiddenNavigation` and `preferredLocationId` preferences.
- Preserves: Dashboard and Settings as protected workspaces.

- [x] Write tests for protected, unknown, duplicate, hidden, and restored workspace states.
- [x] Verify the tests fail against the previous preference model.
- [x] Implement persisted hide and restore behavior.
- [ ] Finish grouped sidebar styling, mobile behavior, workspace outcome checklist, and number spacing.
- [ ] Add rendered interaction coverage for hide, restore, and location selection.

### Task 3: Plaid and reviewed document capture for BookLoQ

**Files:**
- Create: `server/integrations/plaid.ts`
- Create: `app/plaid-link-button.tsx`
- Create: `app/api/v1/integrations/plaid/link-token/route.ts`
- Create: `app/api/v1/integrations/plaid/exchange/route.ts`
- Create: `app/api/v1/integrations/plaid/sync/route.ts`
- Create: `app/api/v1/integrations/plaid/webhook/route.ts`
- Create: `app/api/v1/integrations/plaid/disconnect/route.ts`
- Modify: `app/api/v1/bookloq/route.ts`
- Modify: `app/bookloq-workspace.tsx`
- Modify: `db/schema.ts`
- Test: `tests/plaid.test.ts`

**Interfaces:**
- Produces: readiness, Link token, encrypted exchange, cursor sync, verified webhook, and revocation boundaries.
- Consumes: existing private document upload route and BookLoQ review queue.

- [x] Write normalization and fail-closed configuration tests.
- [x] Implement encrypted server-side Plaid flow and transaction lineage.
- [ ] Add tests for webhook signature rejection, cursor pagination restart, idempotent upsert, and token deletion.
- [ ] Add BookLoQ bank-feed and invoice-review interface with explicit limitation copy.
- [ ] Verify sandbox and missing-credential states without claiming a live connection.

### Task 4: Cash-aware purchasing and cross-module growth intelligence

**Files:**
- Modify: `domain/purchasing-intelligence.ts`
- Modify: `domain/marketing-recommendations.ts`
- Modify: `app/api/v1/command-centre/route.ts`
- Modify: `app/growth-workspace.tsx`
- Modify: `app/control-workspaces.tsx`
- Test: `tests/purchasing-intelligence.test.ts`
- Test: `tests/marketing-recommendations.test.ts`

**Interfaces:**
- Produces: `allocatePurchasingCapacity(assessments, verifiedPurchasingCapacityCents)`.
- Produces: recommendation packets with operational coverage, source, confidence, and guardrails.

- [x] Write tests for priority allocation, missing cash, and margin and inventory campaign guards.
- [x] Implement deterministic cash allocation and promotion safeguards.
- [ ] Wire verified capacity into the purchase-order workspace and display every included factor.
- [ ] Expand growth packets and calendar collision checks without adding external write actions.
- [ ] Run purchasing, cash, growth, and intelligence flow tests.

### Task 5: Editorial content, legal language, and purposeful visuals

**Files:**
- Modify: `app/resources/content.ts`
- Modify: `app/resources/components.tsx`
- Modify: `app/resources/resources.css`
- Modify: `app/legal-shell.tsx`
- Modify: `app/privacy/page.tsx`
- Modify: `app/terms/page.tsx`
- Create: `public/brand/scaling-decision-editorial-hero.png`
- Create: `public/brand/bookkeeping-month-end-editorial.png`
- Test: `tests/seo-content.test.ts`
- Test: `tests/seo-rendered-html.test.mjs`

**Interfaces:**
- Produces: one data-analysis and scaling article plus one bookkeeping article.
- Produces: truthful internal links to the relevant Vanteloq workspaces and legal disclosures.

- [ ] Write failing content tests for unique routes, titles, source links, internal links, and forbidden punctuation.
- [ ] Add human-edited articles with formulas, limitations, and official sources.
- [ ] Generate and visually inspect two text-free editorial images.
- [ ] Add responsive image placement and alt text.
- [ ] Run SEO rendering and copy-quality tests.

### Task 6: Final responsive, security, and deployment verification

**Files:**
- Modify: only files required by failures discovered during verification.

**Interfaces:**
- Produces: one tested, deployable Vanteloq checkpoint.

- [ ] Run `npm run lint` and fix every error.
- [ ] Run `npm run typecheck` and fix every error.
- [ ] Run `npm test` and confirm zero failures.
- [ ] Run `npm run test:security` and `npm run test:flow`.
- [ ] Run `npm run audit:dependencies` and inspect high-severity findings.
- [ ] Inspect the agent preview on desktop and mobile when available.
- [ ] Run the Sites checkpoint flow and verify the terminal deployment status directly.
