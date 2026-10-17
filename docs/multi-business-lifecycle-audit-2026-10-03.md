# Vanteloq multi-business lifecycle audit

Audit date: October 3, 2026

Repository: `.`

Brief reviewed: `C:/Users/User/Downloads/Vanteloq_Multi_Business_Refinement_Codex_Prompt.md`

## Scope and evidence

This is a read-only source audit of business switching, membership lifecycle, onboarding, settings, capabilities, AI scope, billing, and deletion. The only file created by this audit is this report. No repository files were edited; no tests, builds, browser checks, deployments, or live data changes were performed.

Code references identify the source inspected during this audit. They describe that snapshot, before subsequent implementation, and line numbers may move as work continues. Existing tests listed here are observed coverage, not newly passing results.

The parent task reported saved release 328 blocked by an unidentified SQLite migration error. This audit did not reproduce or diagnose that error. Canonical migration files must remain unchanged; proposed schema changes require a new migration after the migration failure is resolved.

## Decision

Multiple businesses cannot safely be enabled by dropping the single-membership index and adding a switcher alone. Core data queries usually accept an organization context, but membership creation, invitations, personal preferences, remote organization provisioning, and internal employee revocation still assume one workspace per person.

Request-scoped authorization, a business selector, separate preferences and drafts, and corrected local membership writes are implementable source work. Safe remote workspace deletion additionally requires an explicit D1-to-Supabase organization mapping and verification of a compatible deployed identity bridge. Preparing those changes locally does not establish that the external bridge or Supabase policy is active.

## Coverage map

| Area | Observed coverage | Gap or implication | Evidence |
|---|---|---|---|
| Identity and authorization | Active user and membership checks, MFA, workspace session leases, entitlements, and permissions | Authorization chooses one active membership implicitly; no requested workspace selection | `server/authorization.ts:23-45,82-112` |
| Membership schema | User/workspace composite uniqueness | A separate unique user index prevents any second membership | `db/schema.ts:135-151`; `drizzle/0002_absent_shard.sql:50` |
| First-workspace onboarding | Stable identifiers, retry protection, empty workspace, owner checks, source preferences | Existing completed business is rejected; identifiers depend on user alone; membership upsert depends on the single-user index | `app/api/v1/onboarding/route.ts:87-91,169-174,278-285` |
| Browser scope | Dashboard request aborts, response identity checks, full loading boundary on location changes | No business context is sent by the shared API client; shell state assumes one mounted business | `app/supabase-browser.ts:53-66`; `app/vanteloq-app.tsx:714-819` |
| Session scope | Session lease ID includes authenticated subject, session ID, and organization | This existing separation can be reused for business switching | `server/session-policy.ts:6-24` |
| Dashboard and navigation preferences | Server binds dashboard JSON to organization; location access validated; independent dashboard sections patched | One account row contains only one workspace envelope; another business's layout replaces it; navigation and preferred location remain user-global | `app/api/v1/preferences/route.ts:34-57,111-144`; `domain/dashboard-personalization.ts:44-47`; `db/schema.ts:271` |
| Onboarding drafts | Input allowlist, expiry, revisions, stale-delete protection, server-bound workspace ID | User-primary-key draft permits one business only; accessing a different business removes its stored draft | `domain/onboarding-draft.ts:3-19`; `app/api/v1/onboarding/draft/route.ts:5-8`; `drizzle/0069_industry_configuration.sql:1-12` |
| Capabilities | Versioned template registry, supported capabilities, preview fingerprints, concurrent-save conflicts, history | Template-specific allowlist prevents mixed retail and food costing; dealership API also checks template identity | `domain/industry-templates.ts:3-60`; `app/api/v1/industry-configuration/route.ts:14-35`; `app/api/v1/dealership/route.ts:11` |
| Business identity settings | Operating/legal name, contact details, structure, brand colour, audit event | No revision check or before/after values; onboarding website, hours, address, timezone, currency and fiscal settings lack equivalent editing in this organization form | `app/governance-workspaces.tsx:1411-1510`; `app/api/v1/governance/route.ts:313-326,467` |
| AI | Tenant/user conversation keys, permitted locations, field redaction, consent, request deduplication and completion authority checks | New business context must stay captured from request initiation through completion; never substitute a subsequently selected business | `app/api/v1/advisor/chat/route.ts:188-205,251-283,309-315`; `app/api/v1/advisor/conversations/route.ts:69-89`; `server/advisor-completion.ts:24-42` |
| Billing | Free enrollment creates no Stripe customer/subscription; plan, quota and Stripe metadata are organization-scoped | Checkout and portal return URLs lose originating business; destination entitlements must reload when switching | `app/api/v1/billing/free/route.ts:10-42`; `server/billing/stripe.ts:154-166,198-200`; `app/billing-onboarding-gate.tsx:75-89` |
| Regular team administration | Employee role/status updates scope membership to user and organization | Reuse this narrower pattern for internal management | `app/api/v1/governance/route.ts:428` |
| Remote integration callbacks | Representative Stripe, Square, Shopify POS, Lightspeed and marketing callbacks resolve stored actor and organization | These stored-origin patterns support cross-tab safety; return navigation must retain that origin too | `app/api/v1/integrations/stripe/callback/route.ts:49-58`; `server/integrations/marketing-routes.ts:133-165` |

## Blocking one-workspace assumptions

### 1. Index and SQL conflict targets

`db/schema.ts:147` declares `memberships_user_unique` on `userId`, while `:148` also declares the useful `(userId, organizationId)` unique index. The original SQL index is in `drizzle/0002_absent_shard.sql:50`.

Both `app/api/v1/onboarding/route.ts:280` and `server/team-invitations.ts:276` use `ON CONFLICT(user_id)`. Dropping the index without updating these statements makes membership creation fail. Use the composite conflict target and business-scoped membership identifiers.

### 2. Implicit membership selection and business creation

`server/authorization.ts:23-45` selects the first active membership with `.limit(1)`. It does not read a requested business context. An invalid requested business must fail rather than fall back to a different membership.

`app/api/v1/onboarding/route.ts:90` rejects an already completed workspace. Lines `:169-174` derive the workspace, membership, audit and legal-acceptance identifiers from the user alone. Add business needs an explicit creation operation and an idempotent attempt identity; it must not reuse the initial user's workspace key or silently reset shared identity details.

### 3. Invitation origin and verification

`server/team-invitations.ts:92-109` selects the inviter's first founder-owned workspace. Its external invitation row does not supply an explicit organization binding. Lines `:248-252` reject users already attached elsewhere. `liveTeamMembershipAllowed` at `:359-368` checks a workspace-scoped local receipt, then derives external provisioning proof through the inviter-selected workspace.

Bind an invitation to the originating workspace throughout acceptance and live verification. If the external invitation contract cannot provide that binding, reject ambiguous invitations rather than selecting an arbitrary business. Do not weaken the live invitation check to permit switching.

### 4. Internal employee revocation crosses every business

`server/team-access-management.ts:34-43` chooses the employee's first membership. Lines `:59-66` revoke internal access and memberships for the whole user, update all matching team records, and suspend the global user record.

Scope relationship updates to the authorized originating workspace. Preserve the global user and unrelated memberships. An internal console request must carry or resolve an unambiguous workspace using trusted evidence; its current first-membership lookup is insufficient.

### 5. Remote organization provisioning and deletion mapping

`server/supabase.ts:114-119` returns the first active remote organization. `app/api/v1/onboarding/route.ts:140` calls the bootstrap function but does not persist its returned organization ID.

The deletion bridge, `supabase/functions/vanteloq-account-deletion/handler.ts:32-47`, derives its remote target from the requesting person's memberships, owned organizations, and business name. It rejects more than one owned organization. Local business names are editable, and a name is not a durable identity mapping. Reusing the first remote organization for another local business could also create an incorrect deletion target when names coincide.

Implement a stored verified remote organization ID per local workspace and include it in the server-owned encrypted deletion plan. The bridge must verify the exact mapped target, current ownership and relevant members. Creating a distinct remote organization must be idempotent across retries and recoverable when a remote call succeeds before the local save.

This is both source work and an external deployment dependency. A local patch or test does not prove that remote policies allow multiple organizations or that the deployed bridge accepts the new contract. Until verified, retain conservative deletion restrictions and explicitly block any ambiguous multi-business deletion before destructive processing.

### 6. Deletion safeguards need deliberate scope

Existing safe elements:

- `app/api/v1/account/deletion/route.ts:79` refuses non-owner account deletion with multiple memberships.
- `server/account-deletion.ts:97` deletes a workspace member's local user only when no memberships remain.
- `server/account-deletion.ts:190-191` preserves the marketing profile while another active Vanteloq membership remains.
- The bridge checks other remote relationships before deleting the requesting person's sign-in identity (`supabase/functions/vanteloq-account-deletion/handler.ts:70-86`).

Other predicates match a deletion job by user regardless of job scope. A workspace-A deletion therefore freezes that person's workspace B too. Examples: `server/authorization.ts:93-94`, `server/billing/checkout.ts:58,78`, `server/advisor-completion.ts:38`, `server/document-email.ts:26,58`, and `server/linked-files.ts:99,106,154`.

Distinguish account-global jobs from workspace-local jobs consistently. This is initially an availability limitation, not a reason to remove the fences. The account-deletion cleanup path also contains user-wide preference/history deletes (`server/account-deletion.ts:100-105`), so do not remove its existing multiple-membership restriction without redesigning that scope.

### 7. Founder access identifiers

`server/internal-access.ts:44-45` builds grant and audit IDs from user alone. A second owned workspace collides with the first record; the conflict update does not change organization. Scope the IDs and conflict target to user plus workspace while retaining explicit revocations. Grant propagation is a product policy that must remain consistent with the existing verified-founder exception, not an accidental billing bypass.

### 8. Origin must survive billing and navigation

Checkout success/cancel URLs at `server/billing/stripe.ts:155-156` and portal return URL at `:200` contain no organization. Include a server-validated originating business in these return paths. The webhook already uses organization metadata; browser selection must not redirect the subscription mutation to a different business.

The shared request function currently awaits authentication before calling `fetch`. Capture workspace context before that await. Deferred saves, task creation, uploads and AI completions must use their original scope even if the shell switches in the meantime. Scope plain URLs such as the organization logo, authenticated exports, deep links and notification actions as well as JSON requests.

## Safe implementation sequence

1. Resolve and reproduce the outstanding migration failure. Keep canonical migration bytes unchanged. Establish the old-schema and full-new-schema fixture paths before broad feature work.
2. Introduce explicit workspace resolution and a permitted-business listing endpoint. Resolve identity first, then validate the requested membership. Preserve legacy defaulting only for an account with exactly one permitted workspace; return a selection-required result for ambiguity. Failed or suspended target selection never falls back.
3. Prepare a new migration that removes only the single-user membership index, retains composite uniqueness, adds workspace preferences and drafts keyed by `(user_id, organization_id)`, and adds creation-attempt and remote-mapping records. Copy eligible legacy settings to their original workspace without overwriting account-wide preferences.
4. Update all membership conflict targets and user-only business identifiers before activating the migration. Fix invitation origin, internal revocation, founder grants and the corresponding test fixtures.
5. Implement explicit Add business using existing input validation, an idempotency key and a stored attempt. Treat legal/accounting boundaries explicitly. Preserve the first business and shared identity. A new business starts with empty operational data.
6. Implement a scoped request client and URL context. Initially remount the business boundary on switching, including onboarding/billing gates and entitlements. Cancel reads, preserve or resolve unsaved work, and retain original scope on in-flight writes. Keep location scope distinct from business scope.
7. Restore each business's layout, last usable view and location from workspace preferences. If a destination lacks the current capability, open its overview with a concise explanation. Do not overwrite either business's setup draft.
8. Persist and verify remote organization mappings. Prepare the compatible Supabase provisioning/deletion contract and test both sides. Verify remote policy and deploy/read back the bridge through the authorized deployment workflow. Keep ambiguous deletion blocked until this external dependency is satisfied.
9. Extend the capability registry with supported combinations and dependencies. Reuse industry defaults without making the template an immutable business boundary. Keep capability, entitlement, permission and data coverage checks separate.
10. Add revisioned shared profile updates and before/after audit values. Restore harmless missing editing paths first. Currency, accounting ownership and historical reporting definitions require impact handling, not a generic free-form save.

## Acceptance tests

| Test | Required result |
|---|---|
| One identity with owner access to A and read-only access to B | Each business uses its own role, permissions, plan and location scope. Unauthorized or suspended targets fail without fallback. |
| Two independent browser tabs | A switch in one tab never changes the other tab's active business or the target of its pending edit. |
| Delayed reads and writes during a switch | A response from A cannot render in B; an already initiated A write remains bound to A or is explicitly cancelled before submission. |
| Duplicate Add business submission | Retries and concurrent identical requests create one workspace, one membership, one initial location and one remote mapping. A failed remote/local boundary resumes safely. |
| Preferences and setup drafts | Distinct A/B layouts, locations, hidden navigation and unfinished setup survive repeated switching and browser refresh. Stale revisions conflict instead of overwriting. |
| Invitation and internal employee revocation | Acceptance targets the invitation's exact business. Revoking A leaves B's membership, user identity and internal grants unchanged. Ambiguous external invitations fail closed. |
| Free A, paid B | No Stripe object is fabricated for A. Switching starts no checkout. Features and quotas are distinct. Checkout and portal return to their originating business. |
| Founder exception | New scoped IDs preserve existing grant/revocation state and do not grant another person the founder's entitlement. |
| AI conversation and delayed completion | A's sources, history, consent, attachments and completion never appear in B. Permission/location revocation still fences both response and history writes. |
| Logo, exports, uploads and notifications | Every operation displays and validates originating business. A deep link into B cannot act using A's current scope. |
| Mixed activities | A supported retail-and-café configuration exposes both workflows without rewriting or deleting existing products. Unsupported capabilities remain rejected. |
| Concurrent profile administrators | A stale shared-settings save returns a conflict; successful history records actor, prior/new values and time. A rejected backend save never shows success. |
| Workspace deletion fixture | Deleting A leaves B's records, membership, identity, subscription and remote organization intact. Unmapped or ambiguous remote targets are blocked before destructive processing. |
| Backward compatibility | Existing single-workspace accounts and account recovery continue to work after the new migration; old data remains reachable. |

Existing suites that provide useful regression coverage include `tests/industry-configuration-flow.test.mjs`, `tests/industry-configuration.test.ts`, `tests/onboarding-identity-recovery-flow.test.mjs`, `tests/team-invitation-flow.test.ts`, `tests/team-invitation-security.test.ts`, `tests/account-deletion-flow.test.ts`, `tests/advisor-completion-flow.test.mjs`, `tests/advisor-history-flow.test.mjs`, `tests/entitlement-engine.test.ts`, `tests/stripe-billing.test.ts`, and `tests/location-scope.test.ts`. These need new same-user/multiple-business fixtures; separate users in separate tenants do not prove safe business switching.

## Verification boundary

Verified by this audit: the cited source paths, schema assumptions, current guards and existing test definitions.

Not verified by this audit: migration execution, test outcomes, build output, preview behaviour, live permissions, provider access, deployed Supabase bridge version, or production readiness.

The recommended source changes can be implemented and tested independently. Completion of multi-business provisioning and deletion requires the external mapping/policy/bridge dependency to be verified, or a clearly documented conservative restriction on the unavailable operation.
