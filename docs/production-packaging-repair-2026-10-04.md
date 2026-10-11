# Production packaging repair, October 4, 2026

## Confirmed asset defect

Fresh production HTML requested `/_next/static/chunks/dashboard-personalization-Vlze8d3c.js`, which returned 404. The other 35 discovered JavaScript/CSS assets returned 200. The local production build reproduced the same missing file in both generated RSC manifests.

With Vite 8.0.16 and @vitejs/plugin-rsc 0.5.34, the RSC plugin collected dependencies before Vite removed CSS-only JavaScript placeholders. The project now schedules that existing manifest hook after cleanup. It retains the original hook and its stylesheet dependencies. Both generated manifests are checked against actual client files before packaging. Missing assets fail the build.

## Migration packaging correction

The failed release 328 reported `incomplete input: SQLITE_ERROR`. Hosting has not supplied the failed statement or applied migration boundary. Support case 16393023 is escalated.

Six checkout SQL files contained CRLF despite their Git blobs and `.gitattributes` specifying LF: 0057, 0062, 0063, 0069, 0070 and 0071. Build output now normalizes CRLF to LF and rejects standalone CR characters. All 73 packaged migrations match the existing committed SQL bytes exactly. SQL definitions, triggers, checks, journal entries and snapshots are unchanged.

This addresses a verified artifact inconsistency; CRLF as the cause of the hosted SQL failure remains unconfirmed until deployment succeeds. This retry uses a newly built, byte-verified archive. It does not skip migrations, alter the migration ledger, add blanket `IF NOT EXISTS`, remove safeguards, reset data or initialize schema in application requests. A further migration error requires its specific diagnostics before schema repair.

## Validation

- Four packaging/asset contract tests pass.
- Five existing incremental migration tests pass in isolated D1.
- TypeScript and changed-file ESLint pass.
- Production build passes with all RSC JavaScript and CSS references present, including the dashboard stylesheet.
- SQLite comparison of all 73 original and canonical migrations yields identical schemas: 618 statements, 126 tables and 31 triggers. This is local evidence, not a production restoration test.

Production status is recorded in the deployment result, separately from this source document. Saving source or passing these tests does not by itself establish successful publication.
