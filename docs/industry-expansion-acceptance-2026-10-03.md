# Industry expansion acceptance, 3 October 2026

Status: local verification passed, but production publication is blocked. Release 328 failed with `incomplete input: SQLITE_ERROR` before Worker upload; release 327 remains live. The host's exact applied/unapplied migration boundary is not available through the current database viewer tool. No migration history was rewritten and the failed archive was not retried. Details appear in the deployment evidence below. This record supplements [Vanteloq v1.0 Origin](Vanteloq-v1.0-Origin.md).

## Implemented and deferred scope

| Area | Implemented in source | Deferred or excluded |
| --- | --- | --- |
| Business configuration | Twelve versioned templates, business format, permitted optional tools, suggested measures, dealership age-review threshold; onboarding and preview/confirm settings with revision history | Selecting an industry never activates a paid feature, provider integration or legal certification |
| Preservation | Industry changes preserve stored records, personal layouts and accounting history; original Business overview and goals retained alongside the dealership dashboard | No automatic data conversion, deletion, accounting reclassification or universal industry benchmark |
| Setup recovery | Explicit authenticated unfinished-owner draft, 48-hour expiry, revision checks, user/workspace scope, resume/discard; excludes tax identifiers, passwords, payment details and legal acceptance | No unsaved-browser crash guarantee or continuously running draft-expiry service |
| Vehicle stock | Persistent identity and repeat stock episodes; independent ownership, physical, preparation and availability states; manual/CSV entry; explicit bounded legacy adoption; location transfer and exclusive reservations | No invented legacy delivery dates, automatic VIN/history/appraisal data, cross-currency transfer or zero-/three-decimal dealership currency support |
| Dealership work | Owned preparation/follow-up tasks, block reasons, customer leads, appointments, recorded deliveries, approved credit shares, reversals and explicit reacquisition | No outbound contact, marketing-consent workflow, automatically inferred lead conversion or full DMS replacement |
| Dealership finances | Separate cost states, reviewed posted coverage, delivery cost snapshots, exact credit allocation, scoped currency totals and full-scope bounded CSV exports | No ledger/payment posting, posted-cost correction or late-cost amendment workflow, floorplan accounting, F&I, trade-in tax, commissions payroll or funding integration |
| Foodservice | Reviewed recipes and matched-location periods, exact compatible unit conversion/yield costing, depletion, food/labour ratios, numerical variance, contribution, recorded waste and average check | No automatic POS/recipe-version reconciliation, nested recipes, inferred density, guest counts, table-turn timing, payroll processing, ledger posting or stock movement |
| Access | Existing paid entitlement, configured capability, role, sensitive financial/customer/payroll permissions, location scope, MFA and origin protections | No permission granted by a template, tab, client payload or visible amount |
| Deletion | Shared dealership financial evidence retained; deleted staff links cleared and credit names anonymized; organization deletion cascades | Customer records and financial retention have distinct purposes; deleting a login is not blanket erasure of unrelated shared business records |

## Verification evidence

The focused rollup includes the detailed domain/UI rows below, so those counts must not be added again. Earlier and final Worker runs are identified separately. No coverage percentage or universal release certification is inferred. Latest integrated evidence was supplied by the parent release lane.

| Evidence | Result and scope |
| --- | --- |
| Final focused rollup | **62/62 passed**: industry configuration 3, industry KPI guidance 3, vehicle UI 2, dealership domain/SQLite 7, dealership UI 16, foodservice domain/UI 23, migrations 5 and homepage 3 |
| `tests/dealership.test.ts` | **7/7 passed**, final source run 3.9 seconds. Real SQLite/D1-compatible transactions: exact allocation, imports/replay, 101-row full-scope counts/export, cost redaction/approval, exclusive reservation, delivery/reversal/reacquisition, legacy unknowns, customer work, deletion and an interleaved stock-transfer/task-write rollback |
| `tests/dealership-workspace-ui.test.tsx` | **16/16 passed**, reported by the UI implementation lane. Covers actionable payloads, role visibility, missing/restricted values, labelled scope and bounded lists; does not replace browser interaction |
| `tests/foodservice.test.ts` and `tests/foodservice-ui.test.tsx` | **23/23 passed**, reported by the foodservice lane, with focused lint passed. Covers exact units/yield/rounding, missing versus zero, mixed currencies, denominators, variance and reviewed presentation |
| `tests/dealership-flow.test.mjs` | **1/1 passed** against the initial built Worker, 69.6 seconds. Reviewed industry switch, role/location redaction, exports, live permission revocation, MFA, origin, cancelled subscription and retained sales after an industry change |
| Parent Worker/D1 run | **7/7 passed**: industry configuration 2, foodservice 2, onboarding 1 and existing vehicles 2. Reported by the integration lane; isolated test records only |
| Migrations | Registered schema-only migrations **0069, 0070 and 0071**, with generated snapshots matching their Drizzle schemas. No production-wide dealership backfill; legacy adoption is explicit and scoped |
| Typecheck and remaining lint | **Final typecheck passed.** Targeted lint passed with zero errors and three existing warnings in vanteloq-app.tsx. The changed dealership and industry settings components lint cleanly. The affected dealership UI suite passed 16/16 after lifecycle corrections |
| Final build | **Passed** after final UI lifecycle, mobile overflow and reduced-motion changes. Artifact validation passed. Drizzle generation reported no pending schema changes |
| Final affected-route rerun | **4/4 passed**: dealership 1 and industry configuration/draft 3, including stale draft deletion and organization-scope protection |
| Desktop/mobile browser acceptance | **Verified cases recorded below.** Final mobile table recheck: 375px viewport and 375px page width after detail open/close; Escape dismisses the editor and returns focus; unsaved-form resume remains available |
| Publication and live readback | **Blocked.** Saved release 328 failed during database migration; the industry expansion is not live |

Verified browser cases, using isolated preview records:

- Foodservice rejects zero portions while preserving the entered form. Correcting to 12 portions calculates CAD 6.00 total and CAD 0.50 per portion; the saved version 2 survives reload.
- A dealership preparation update to Ready persists as stock version 2. Closing the details surface returns focus to its trigger.
- The mobile homepage Retail-to-Dealership selection changes the relevant labels without page overflow. Mobile Retail onboarding shows SKU, lot and expiry guidance without VIN fields.
- Settings supports Dealership-to-Restaurant review, confirmation, save and reload. API tests separately verify that changing industry preserves the stored records.

Final browser error log was empty. Screens were inspected at 390 by 844 and 1440 by 900 viewport overrides. New motion is limited to transform/opacity/shadow feedback and respects reduced motion and Motion Off. These observations do not establish every form, keyboard sequence or production-device combination as accepted.

Reproduction from the repository, using its configured Node runtime:

```text
node scripts/test.mjs tests/dealership.test.ts tests/dealership-workspace-ui.test.tsx
node scripts/test.mjs tests/foodservice.test.ts tests/foodservice-ui.test.tsx
node scripts/test.mjs tests/dealership-flow.test.mjs
```

The Worker test requires a current successful build. It uses an isolated database and loopback authentication fixture. None of these commands authorizes live customer writes, provider mutations or production recovery drills.

## Deployment evidence and safe recovery boundary

- Sites project: `appgprj_6a6fac5e42a08191b37108223fc4b205`.
- Tested implementation source: `d1a0504fbc97a4ac337cabec558de72d29a2dc14`, tree `f6cd3d0c9064bb1b70bc5783bf946d6aa7f3d098`.
- Saved release 328: `appgprj_6a6fac5e42a08191b37108223fc4b205~appgver_c49b3c80aeb08191a61c89779c8c92f3`.
- Failed deployment: `appgdep_6ac1d512c46c8191b2a1b76c1a7a4889`, `2026-10-04T04:24:54.615677Z`, environment revision 64.
- Host failure: `incomplete input: SQLITE_ERROR`. Native status reports failure, not successful publication.
- Archive SHA-256: `45cf0e6a772868722438b4012b2a129907093f68f316b5027416f8438d7fabc0`.
- The read-only overview exposes 50 alphabetical user-table names, ending at `integration_connections`, without a migration ledger. No `dealership_*` tables appear in that alphabetical range. This does not distinguish whether migration 0069 failed or migration 0070 failed before its table creation.
- Prior migrations also contain multiple statements within trigger bodies. A trigger-format incompatibility is a hypothesis, not a confirmed root cause. Packaged migration 0069 is complete and matches committed SQL after normalizing checkout line endings.

Before a repair is published, obtain the last recorded migration and exact failing statement from hosting. Confirm whether any statements in the failed migration were committed. Modify only a specifically confirmed unapplied migration, preserve applied history, rerun the affected isolated checks, build a new archive and save a new version. Do not retry the same failing archive or add runtime schema repair.

## Data and permission acceptance rules

- A legacy sold flag never supplies a delivery date, revenue or complete cost coverage. Unknown financial values remain unavailable; recorded zero remains distinguishable.
- One delivery remains one vehicle regardless of credit splits. Amounts allocate to the cent, including two anonymized former members and an explicit unassigned remainder. Reversal activity remains dated separately from original delivery activity.
- Stock and delivery aggregates cover the authorized scope, not a loaded page. Currencies remain separate. CSV output either covers its complete selected scope or fails with a visible size boundary.
- Cost estimates and approvals do not become posted cost evidence. A reviewed cost snapshot is an operational calculation, not proof of an accounting posting or full compliance.
- Food-service inputs need compatible units, source dates and matching location/period. Missing denominators do not become zero; food contribution does not become net profit; unexplained variance does not become a theft/waste claim.
- Industry changes preserve stored records and do not bypass paid or role gates. Final browser checks must confirm the original Business overview and goals remain reachable.

## Research and remaining operational work

The [automotive research](research/industry-expansion-automotive-2026-10-03.md) links official CRA, Alberta, AMVIC, privacy regulator and relevant provider sources. The [foodservice research](research/industry-expansion-foodservice-2026-10-03.md) identifies calculation definitions and source limitations. Operational estimates, accounting policy and legal requirements are distinguished. No advanced regulated feature or compliance certification is claimed.

Production backup/restore, provider distribution approval, comprehensive dependency advisory coverage, field performance and operational retention execution remain separate unresolved items in the canonical release document. This feature acceptance record does not close them.
