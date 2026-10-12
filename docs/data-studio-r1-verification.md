# Data Studio R1 verification record

Updated October 12, 2026. Publication and authenticated production acceptance remain separate gates from the following local evidence.

## Scope and boundaries

R1 implements an authorized Executive Review with seven real XLSX sheets: Overview, Sales, Margin, Inventory, Cash, Data Quality and Sources. Source facts are read-only. No migrations, persisted exports, new provider credentials, prices or plan changes are introduced. Saved workbooks, reviewed analytical imports, the executable SQL builder and AI analysis proposals remain R2, R3 and R4 respectively.

All accepted stored daily rows are extracted in one bounded D1 transaction. Posted BookLoQ figures use their own transaction and explicit timestamp. This is not a globally frozen database snapshot or a certification of provider history. Empty dates and missing costs remain unavailable. Operational totals and accrual accounting are not added together. Current membership, MFA, entitlements, permissions, location and approved source checks apply before execution and before returning download bytes.

## Evidence

| Check | Observed result |
| --- | --- |
| Final API and numerical/access checks | 25 passed after the timestamp correction, including exact values, authorization and dated-ledger checks |
| Final production-built route and Worker adapter | 2 passed against isolated migrated D1 and fictional workbook values |
| Corrected SQLite fixture and focused regressions | 76 passed; concurrent D1 batches are serialized by the test fixture instead of opening nested SQLite transactions |
| Lower-load rerun of timed-out existing flows | 18 passed, including accounting, cash contracts, journal/bank-match correction and permissions |
| Type checking and scoped lint | Passed after final client and fixture corrections |
| Production build and artifact validation | Passed with final timestamp normalization, weighted margin, text escaping and restored QuickBooks callback MFA checks |
| Recorded update timestamps | 18 source API/domain checks passed, including preview and XLSX normalization of existing seconds and legacy milliseconds to the same UTC instant |
| Independent workbook reader | openpyxl verified 2,000 fictional sales rows, exact cents, ISO dates, leading-zero identifiers, seven sheets, frozen headers, filters and no formulas/macros/external links |
| Sample reconciliation | Net sales CAD 246,900.00, canonical 24,690,000 cents; gross profit CAD 146,900.00 |
| Actual browser client | Preview and download completed with fictional rows; denied export cleared figures and preserved dates; empty and recovery states inspected; keyboard preview, unmounting return and clean reopen worked |
| Responsive appearance | 390-pixel mobile and 1,440-pixel desktop inspected in light/dark tokens; figures measured 24/26 px after correcting a legacy font clamp |
| Full accepted preview | Actual client rendered all 2,000 fictional rows; net sales CAD 113,450.00, gross profit CAD 69,450.00 and 25,000 transactions; one development-profiler table render measured 234 ms |
| Excel/LibreOffice GUI rendering | Not performed. This session has no native desktop-control access; independent file readback is the verified boundary |
| Production owner acceptance | Pending. The earlier owner session expired and the current public tab shows Sign in |
| Dependency advisory check | Zero known production npm advisories for the selected lockfile; not an independent security audit |

The initial broad 2,229-check run reported 2,193 passes, 28 failures and 8 cancellations at four-file concurrency. It is not a passing full-suite receipt. Timeouts were rerun separately and passed. Seven unit/UI and thirteen financial/provider failures reproduced at unchanged deployed source `e95bff89752cd9e53b862b8ab6981573d59c3cbf`. Stale fixtures were corrected to reflect current consent versions, historical-cost evidence, provisional obligations, provider publication versions and internal pilot grants. The isolated SQLite fixture now serializes concurrent D1 batches rather than opening nested transactions on one connection. No production financial or authorization rule was relaxed. The deployed baseline comparison used the same installed runtime dependencies, so it isolates application-source changes rather than proving every dependency is unchanged.

The subsequent complete run finished 2,231 checks at two-file concurrency: 2,227 passed, four failed, none cancelled or skipped. All four failed scenarios passed targeted reruns after diagnosis and correction. QuickBooks exposed a real saved-assurance regression for internal grants; the existing entitlement/MFA check is restored before token exchange, and its full callback fixture passed. The complete intelligence-to-action scenario and Square scenario passed after fixture corrections. Lightspeed's complete publication, warning refusal, corrected-version recovery, bounded 150-day historical publication and disconnect cycle passed with explicit retained quantities and line costs. No production financial validation was relaxed. This is full coverage plus corrected-scenario reruns, not a second single entirely green full-suite run.

## Limits and performance

Accepted scopes cover at most 366 calendar days and 2,000 stored daily rows, with 2 MiB result JSON and 5 MiB generated XLSX limits. Larger scopes are refused rather than truncated. Excel values exceeding the supported numeric precision remain exact text. POS quantities use integer thousandths with bounded normalization of binary floating residue, not unverified decimal rounding.

Twenty warm trials per shape ran in local workerd/Miniflare with `nodejs_compat`, Node 24.19.0, Windows x64 and concurrency one, with outbound service disabled:

| Daily rows | Non-empty cells | XLSX bytes | Generation p50 | Generation p95 | End-to-end local p95 |
| --- | --- | --- | --- | --- | --- |
| 10 | 239 | 13,868 | 9 ms | 11 ms | 17.5 ms |
| 500 | 6,609 | 40,280 | 42 ms | 50 ms | 55.1 ms |
| 2,000 | 26,109 | 119,196 | 167 ms | 214 ms | 218.9 ms |

These are simulator measurements of fictional daily summaries, not production guarantees, mobile-device benchmarks, database execution times or a load test. The first cold dispatch was about 442 ms. Worker peak memory is not exposed by the harness and remains unmeasured. The unminified probe bundle is 1,412,240 raw / 241,381 gzip bytes; production artifact chunks are measured separately. XLSX generation is loaded only on the server's download path. The client does not receive the spreadsheet library.

The maximum-row browser check is a single development-mode profiling observation, not p95 or mobile-device latency. Keyboard date changes survived return and reopening. Detailed browser boundaries are recorded in `evidence/data-studio-r1-browser.json`.

The final built Data Studio client chunk is 14,118 raw / 4,652 gzip bytes, with 3,538 raw / 1,080 gzip bytes of scoped CSS. Its server-only ExcelJS chunk is 486,426 raw / 128,377 gzip bytes. These chunks are loaded on demand and are distinct from the whole application bundle. Exact paths and sizes are in `evidence/data-studio-r1-bundle.json`.

Selected dependencies and exact registry integrities are recorded in `evidence/data-studio-r1-dependencies.json`; the full selected lockfile is authoritative. ExcelJS is MIT. JSZip's MIT option is used. All source-bundled workbook notices are preserved at `data-studio-third-party-notices.txt` and the packaged `/licences/data-studio-xlsx.txt`. No commercial grid licence is procured.

## Review and recovery

Standards and Spec reviewers independently inspected the pinned R1 patch. They found revoked-result retention, incomplete snapshot identity, fractional quantities, large Excel counts and standard cash-account recognition issues. Each was corrected and verified. Their final follow-up review found no further issue in the reviewed patch; it did not claim full-suite or deployed acceptance.

Their separate reports and resolved findings are preserved in [R1 review](data-studio-r1-review.md). Subsequent removal of an unused import has no runtime effect.

`DATA_STUDIO_ENABLED=false` disables the new analysis API while existing Reports and BookLoQ remain available. Exports are returned directly and are not stored. There are no R1 tables or migrations to roll back. Do not reset production, revoke existing provider access, overwrite financial history or change prices as a recovery step. Use the previously verified public Site version if a complete application rollback is required, and verify its live state separately.

Full evidence receipts and fictional workbook are kept in the task's output folder. This record must be updated with pushed source, artifact, saved version, deployment and authenticated acceptance before R1 is described as fully released.
