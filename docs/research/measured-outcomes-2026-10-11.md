# Measured action outcomes

Implemented in the existing Business workflows screen and `/api/v1/business-workflows` endpoint. No database schema or accounting journal changes.

## Link the actual action

Action outcomes can select saved workspace tasks and saved findings. The server checks organization, current task visibility, selected location and the financial permissions retained by a finding. Task/finding mismatches are rejected. A location outcome cannot represent a company-wide finding as though the scopes were identical. Historical external references remain available as explicitly manual evidence.

The task and finding selectors show at most the 100 most recent choices, with a visible limit notice. Existing older links are resolved by exact ID. Record and revision reads resolve references in batches of at most 80 IDs, with organization predicates on every query.

## Supported source-prefilled comparison

Recorded net sales are the initial supported metric. Both periods must have equal calendar-day lengths, must not overlap, must end before the current location-local day and must fit within the existing 364-day reviewed history window.

The implementation reuses `server/forecasting.ts` and its existing authoritative sales selection, approved-publication, location and currency rules. Every day in both requested windows must be explicitly reviewed and complete or confirmed closed. Missing dates, incomplete publications, overlapping sources, changed imports and current partial days never become zero. Negative refund days remain negative. Unreconciled location time zones or currencies block automatic values.

Saved values are computed again by the server, not accepted from client-entered totals. The existing workflow JSON retains exact period boundaries, source IDs, source cutoff, review timestamp, capture timestamp, location, currency, minor-unit totals and a fingerprint. Reviewing or completing an outcome checks its current source fingerprint. Changed or no-longer-complete evidence requires reopening, refreshing and reviewing the outcome again. Prior retained revisions are not silently recalculated.

## Boundaries

This is a source-backed observation. It does not establish causal impact, advertising attribution or accounting revenue recognition. Seasonality and business changes still require the user's review. Targets, intervention costs, guardrails and unsupported metrics remain owner-reviewed inputs, explicitly labelled manual where applicable.

Sales/revenue permissions are rechecked before preview, save, retained-record reads and revision reads. Losing a finding's required financial permission hides the linked result. Read-only access does not permit saving or completing work.

## Validation

Focused tests cover equal/historical periods, exact currency totals including negative refunds and zero days, missing/partial/duplicate coverage, immutable snapshot matching, manual-evidence labels, tenant and location boundaries, restricted financial access, saved-finding permissions, link mismatches, save retries, revision consistency, source-change blocking, reopening, refreshed values and completion. Tests use only fictional records in a disposable local D1 database. Production and visual acceptance remain separate release checks.
