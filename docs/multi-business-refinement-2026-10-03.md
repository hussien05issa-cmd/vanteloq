# Multi-business workflow refinement

Status: the bounded refinements below are implemented and locally verified. The broader multi-business brief is not complete. The source is based on the tested industry expansion in draft PR #3. Release 327 remains the last confirmed live publication; release 328 failed during a database migration. GitHub synchronization is not production publication.

## Delivery checklist

- [x] Read the owner's complete multi-business brief and audit current industry workflows.
- [x] Identify cross-business authorization, billing, preference and account lifecycle dependencies.
- [x] Reject ambiguous or mismatched workspace context rather than silently choosing another membership.
- [x] Enable supported mixed activities through one validated capability registry and reviewed settings.
- [x] Improve café modifier calculations and preserve recipe revision evidence.
- [x] Improve restaurant count/usage explanations without claiming inventory posting.
- [x] Connect blocked, unassigned and due dealership tasks to their stock or lead record through a scoped attention queue.
- [ ] Add appointment-specific readiness and funding workflows with their own evidence and permissions.
- [x] Supply validated mixed capabilities to AI analysis and refine settings, privacy wording and UI. Existing public industry descriptions remain bounded by supported features.
- [x] Run affected domain, API, build and responsive checks.
- [ ] Synchronize tested source and acceptance evidence to GitHub.
- [ ] Publish only after the failed production migration and applied boundary are identified.

## Scope and evidence map

| Surface | Existing evidence | Refinement / boundary |
| --- | --- | --- |
| Business identity and switching | One D1 membership per user; account bootstrap selects one Supabase organization | Full multi-business creation needs explicit remote organization mapping, scoped invitation/deletion contracts and per-business preferences. Do not remove the uniqueness constraint alone. |
| Onboarding and shared settings | Versioned templates, 48-hour setup draft, reviewed configuration changes | Add supported mixed activities without converting records or changing entitlement. |
| Retail | Purchasing/partial receiving, lot review, source imports, product costs | Receipt records do not imply authoritative inventory movements. Provider `available` stock must not be relabelled physical stock. |
| Café | Exact recipe units, yields, costs and review forms | Modifiers must replace/add/remove ingredients deterministically; unknown mappings must remain visible. |
| Restaurant | Period depletion, food/labour ratios, waste and contribution | Count-based usage already includes waste; distinguish unexplained usage from its cause. No implied payroll, allergen or service-time certification. |
| Dealership | Stock episodes, tasks, leads, appointments, reservations, deliveries and credit | Add actionable record continuity. No funding, deposit, quote or formal approval module currently exists. |
| AI, dashboard and reports | Workspace-scoped records and permission checks | Industry guidance must describe enabled activities, unknown sources and financial boundaries. |
| Billing | Organization-based subscriptions, Free and approved exceptions | Switching activities must not trigger checkout or change prices. |
| Deployment | Saved source and local checks | Production migration repair remains a separate blocking dependency. |

## Decisions and safety boundaries

1. Business switching is not just a selector. `memberships_user_unique`, invitation upserts, remote organization bootstrap, account deletion and personal preferences contain single-business assumptions. Enabling another membership before these contracts are migrated can select or revoke the wrong business. Preserve the existing constraint while adding explicit fail-closed context validation and documenting the remaining lifecycle work.
2. Industry is a default, capability is a configured activity, entitlement is purchased access, and permission is an actor's authority. No new capability grants either paid access or a role.
3. Existing recipe edits replace current values. Retained revisions must snapshot the actual persisted values, with no fabricated historical versions. A saved calculation does not consume inventory or post to BookLoQ.
4. An appointment currently identifies a lead, not a vehicle. Reservation-derived vehicle context is provisional, and multiple or absent reservations cannot prove readiness.
5. The host must identify the failed unapplied migration before publication. Existing migrations 0069–0071 and their metadata remain unchanged during this refinement.

The full owner brief includes substantial further operational scope: multi-entity creation/switching, group reporting, nested preparation/stock transformations, authoritative stock movements, service sessions, historical inventory valuation and dealer funding. These must remain explicitly unfinished until their persistence, UI, permissions and scenario checks exist. A successful build does not complete those workflows.

## Implemented UI details

- Navy and blue framing, restrained translucent surfaces, opaque inputs and financial cards, stronger labels, consistent rounded edges and inherited type.
- Recipe entry and business settings use a single-column field layout with 48 px controls. Mobile form text is 16 px. Actions wrap instead of overflowing.
- Four primary period metrics stay visible. Supporting labour, waste and check ratios open on demand. Money uses grouped digits; figures remain static while controls provide brief feedback.
- Save feedback uses status messages. Recipe saves focus the saved record; dealership saves focus the surviving workspace heading. Modal close retains an unsaved form and returns focus to its opener.
- Recipe modifiers provide a reviewed preview, not automatic POS consumption. Earlier retained versions expose source dates, quantities, purchase costs and yield basis. The 100-version display limit is explicit.
- No new animation library, remote font or heavy blur was introduced. Existing reduced-motion and application motion-off rules remain in place.

## Verification completed

- TypeScript: passed after final behaviour changes.
- Production build: passed, including Sites manifest, Worker entry and asset-path validation. Existing chunks larger than 500 kB still produce a warning; this is not a measured production speed pass.
- 68 targeted tests passed across business context, modifiers, exact financial calculations, tenant/location permissions, stale/racing writes, dealership records, identity recovery, industry settings, onboarding drafts and incremental migrations.
- 18 affected UI tests re-run after the final focus and progressive-disclosure changes: passed.
- Targeted ESLint on changed TypeScript files: zero errors and zero warnings after cleanup.
- Browser: 1365 px desktop, 390 px phone and 320 px narrow form. Task editor controls measured 48 px; settings controls measured 48 px with 16 px text. No page overflow in checked views.
- Browser save cycle: changed a fictional recipe cost, verified the calculation and saved revision, with focus returning to its record. Earlier-version values were retained in the isolated fixture.
- Browser task cycle: opened a blocked vehicle task, changed its status, closed and resumed the unsaved form, saved completion, verified removal from the queue, and verified focus on Vehicle operations.
- Browser console: no error entries in the final isolated preview. This does not certify every production pathway or every assistive technology.
- Reduced motion: source rules inspected; OS preference switching was not available through the browser test controls in this pass.

## Research and publication

The UI uses official [W3C form guidance](https://www.w3.org/WAI/tutorials/forms/labels/), [status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) and [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion), interpreted through Vanteloq's existing design system. These sources guide implementation; they are not a certification or proof of commercial effectiveness.

OpenAI Support case 16393023 replied asking which product was affected. A clarification was sent in the existing, owner-approved diagnostic thread identifying ChatGPT Sites hosting. No failed statement or applied migration boundary has been supplied. No production retry, database reset or rewrite of migrations 0069–0071 occurred in this refinement.
