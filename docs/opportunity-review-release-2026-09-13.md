# Saved opportunity reviews

This extends the existing Opportunities view and Action Centre. It does not introduce another analytics engine or change financial formulas, billing, provider approval or AI consent.

## Completed

- Start a review from a server-generated, permission-filtered finding. Preserve the original evidence, location scope, reporting period and capture date.
- Search findings, switch between active items and saved reviews, and use separate Evidence and Follow-up tabs.
- Save review notes, monitor, snooze, resolve, dismiss and reopen. Closing requires a reason or observed outcome. Snoozed findings become active when their review time arrives. These are in-app reminders, not scheduled email.
- Keep versioned activity with an actor and time. Simultaneous edits use an atomic version check, and repeated requests cannot create duplicate activity.
- Create one linked action per saved opportunity using the existing assignment form. The review displays its owner, deadline and current status where task access is allowed. Source evidence and period remain attached to the task.
- Open a report or AI question for the saved period and selected location. AI receives currently permitted records for those dates; saved notes and activity are not added to its payload.
- Recheck tenant, location and financial permissions on every read and write. Saved reviews use the existing organization-wide operations boundary. Location-limited accounts retain live findings but do not receive organization-wide saved notes. Permission loss also hides associated tasks.
- Preserve review evidence when source records change. A historical finding is explicitly labeled as saved evidence and must not be mistaken for a current report.
- Add the workflow to the shared public help and AI product guide.

The additive migration creates two review tables and a uniqueness constraint for opportunity-linked tasks. Workspace deletion cascades to the new records. No existing customer records are changed by the migration.

## Import reliability

Production logs showed automatic POS requests cancelled near the one-minute request limit. Inspection found the R-Series history rebuild making an individual database write and lease-renewal request for every business date. It now uses the existing bounded batch writer and renews the lease per batch. Publication remains closed until all writes finish. Provider authorization, scope, reconciliation and approval gates remain intact. A post-deployment manual sync completed successfully in approximately 43 seconds and refreshed approved records. Historical backfill remains resumable and must be checked separately from connection success.

## AI evidence accuracy

Live verification identified an AI response describing a retail window without observations as zero sales. The provider projection now sends absent current/prior summaries, product/category counts and sales-dependent inventory measures as null. Verified stock quantities remain available, and a genuine recorded zero sale remains zero. This removes ambiguous zero aggregates from empty retail windows without changing source calculations or permissions.

## Verification

- Type checking, lint and production build, including the migration and Worker artifact.
- Review lifecycle API against an isolated database: capture deduplication, immutable evidence, period/scope validation, cross-tenant rejection, stale/concurrent writes, identical concurrent retries, action deduplication, permission changes, location restrictions, anonymous/cross-origin rejection and deletion cascades.
- Bounded lookups with 120 saved reviews and 121 linked tasks, including returning a replayed review outside the latest page.
- Existing decision calculations, AI rendering and KPI rules, security boundaries, source interaction contracts and migration chain.
- Fictional-data browser checks for snoozing, saved-history access, required outcome notes, linked actions and responsive layouts. Phone controls use a 44-pixel minimum and 16-pixel form text.
- An additional R-Series flow checks rebuilding 150 historical dates without losing another merchant's records.
- Nineteen retail calculation tests pass, including absent observations versus a recorded zero, prior-only evidence and stock quantities without sales velocity.

## Still outside this release

The list loads up to 100 recently updated reviews and bounded recent activity. Full archive pagination and export, structured member assignment, external reminders, automatic outcome measurement and cross-module opportunity aggregation remain. Review status is a user's assessment, not an audit opinion, a verified financial gain or proof of causation. Business health scoring, historical trading calendars, richer customer cohorts, additional inventory metrics, saved report views and provider production approvals remain tracked in the full brief audit.
