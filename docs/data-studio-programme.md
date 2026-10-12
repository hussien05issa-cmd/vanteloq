# Vanteloq Data Studio implementation programme

Prepared October 11, 2026. This is an implementation record, not a claim that planned releases are available.

## Verified baseline

Existing public Sites project `appgprj_6a6fac5e42a08191b37108223fc4b205`, version 364, source `e95bff89752cd9e53b862b8ab6981573d59c3cbf`, tree `af43b4513da18a051d1d236ee581b82c143b4b9f`. The dedicated source checkout is clean. The previous version 363 research is historical. The 364 artwork, consent and performance changes are preserved. D1 DB and R2 BUCKET remain the declared bindings; no new provider or infrastructure is provisioned.

Runtime packages remain React 19.2.8, Vinext 1.0.0-beta.9, Vite 8.0.16 and TypeScript 5.9.3; the local probe uses Node 24.19.0. Nineteen existing dated-ledger, source-contract, entitlement-routing and location checks passed before source changes.

| Area | Current classification | Source seam |
| --- | --- | --- |
| Operational reporting and CSV | Implemented | reports API, source authority, recorded readiness |
| Posted accrual reports and CSV | Implemented | bookloq-reports and its organization-wide policy |
| Provider-specific reports | Implemented with exact source/readiness restrictions | commerce intelligence and provider report catalogue |
| Real XLSX export | Missing at baseline | R1 |
| Saved analytical workbooks and mappings | Missing at baseline | R2 |
| Reviewed analytical XLSX imports | Missing at baseline | R2; current operational CSV destinations remain separate |
| Visual builder and editable executable SQL | Missing at baseline | R3 |
| AI analysis proposals through that compiler | Missing at baseline | R4; existing Advisor/consent is reused |
| Private Google/Microsoft documents | Configuration dependent | Existing linked-files connector, distinct from structured workbook APIs |
| Scheduled delivery / PDF / MCP / cloud write-back | Separate future work | No new public availability claim |

## Release order and evidence

1. R1: bounded Executive Review, authorized source extraction, typed real XLSX, independent readback, numerical and two-tenant tests, production build and deployment verification.
2. R2: saved versioned definitions and assumptions, safe formula subset, conflict/draft recovery, reviewed CSV/XLSX mapping, normalized reference datasets and replay controls, additive populated migration and deletion coverage.
3. R3: curated dataset catalogue, strictly validated QuerySpec, full supported SQL grammar translation, one execution/compiler policy, result/chart/export parity, current permissions, query-work limits and plan measurements.
4. R4: existing consent-bound Advisor creates reviewable proposals; accepted plans execute deterministically through R3. Semantic and injection corpus precedes release.

Do not publish a later release as completed before its gates pass. Preserve exact source/archive provenance, current public audience and original prices/export entitlements. Optional provider credentials do not block independent core work.

## Architectural decisions

- Money stays in exact integer minor units, with overflow refusal, weighted ratios and explicit unavailable costs. Excel values exceeding safe 15-digit precision remain exact text with an explanation. Calendar dates and UTC instants are separate types.
- Dataset names are logical business contracts. Source rows remain read-only; assumptions and imports are separate analytical evidence. Joins require a reviewed cardinality template.
- Bounded D1 transactional read batches provide the initial export extraction boundary. Sequential sessions/pagination alone are not called snapshots. Settings/source/access changes must fail or be revalidated. Component timestamps are explicit if no shared boundary exists.
- Identity, tenant, membership, plan, location and column access come from the verified server session. Execution and export separately enforce existing grants. Client-visible columns do not authorize server data.
- Exports initially return directly through a private authenticated response. They are not retained in R2, so no downloadable bearer URL or new artifact retention lifecycle is created.
- Heavy tooling stays on demand. Evaluate ExcelJS first, and use the existing accessible tables/charts before adding a grid. Commercial engines, broad browser SQL and provider write-back remain optional procurement decisions.
- Supported SQL is parsed completely into a typed plan, never executed or spliced directly into D1. Unknown AST constructs fail explicitly.
- A server runtime flag can disable Data Studio without changing existing Reports or BookLoQ.

## User stories and observable checks

| ID | Actor and benefit | Acceptance evidence |
| --- | --- | --- |
| DS01 | Owner opens Executive Review to inspect the business | Authorized sections, clear source and unavailable states |
| DS02 | Manager selects dates/locations matching their operation | Denied locations fail closed; scope persists across views |
| DS03 | Finance user distinguishes operational and posted results | Ledger labels, all-location and disclosure rules preserved |
| DS04 | Viewer sees missing inputs rather than fabricated zeros | Missing-cost and no-data fixtures |
| DS05 | Analyst filters, groups and charts a question | Exact table/chart aggregate parity |
| DS06 | Analyst saves and reopens recurring definitions | Save/duplicate/reopen with current rights |
| DS07 | Analyst edits supported SQL and executes it | Builder/SQL deterministic parity |
| DS08 | Query author corrects unsupported syntax without losing text | Whole-statement rejection and draft preservation |
| DS09 | Owner changes assumptions without changing facts | Assumption-only writes; exact formula fixtures |
| DS10 | Importer selects sheets/ranges and reviews mapping | Row errors and exact control totals before commit |
| DS11 | Importer reuses mappings without duplicate records | Preset, fingerprint and replay tests |
| DS12 | Exporter receives a real multi-sheet workbook | Independent reader, totals, typed dates/IDs and source notes |
| DS13 | Exporter understands limits and completeness | Full accepted scope or explicit refusal, never silent truncation |
| DS14 | Keyboard/screen-reader user completes the workflow | Focus, semantic tables/forms and announcements |
| DS15 | Returning user retains work after save conflict | Optimistic version conflict and retained draft |
| DS16 | Administrator governs view/create/export independently | Existing/new explicit grants with role fixtures |
| DS17 | Revoked member cannot reuse old analyses or caches | Current access checks; protected client reset |
| DS18 | Owner pins an analysis and links a permitted task | Existing authorized APIs; matching scope/evidence |
| DS19 | Advisor user reviews an evidence-bound proposal | Consent, semantic/injection evaluation and deterministic numbers |
| DS20 | Future connected-file user controls refresh/revocation | Separate provider pilot, not claimed in core releases |
| DS21 | Importer handles oversize/malformed/unsafe workbooks | Actual expanded byte/cell/string/package limits |
| DS22 | User cancels work without stale results appearing | Abort/stale sequence handling; no false database-cancel claim |
| DS23 | User understands stale/conflicting sources | Existing source authority and readiness gates |
| DS24 | User handles schema change or permission denial | Version validation and actionable errors |
| DS25 | User switches accounts/workspaces safely | Clears protected workers/results/drafts scoped to identity |

Each story is pending until linked to a real implementation and test receipt. No score, disabled control or mock is treated as completion.

## Probe and research register

Official npm metadata fetched October 11, 2026 (America/Denver): ExcelJS 4.4.0 MIT; fflate 0.8.3 MIT; node-sql-parser 5.4.0 Apache-2.0; fast-xml-parser 5.11.2 MIT. Candidate packages are installed only in the disposable probe folder until selected. Exact registry tarballs/integrities and notices will be preserved in the selected dependency record and lockfile.

The initial prebuilt browser-document probe was compatible with workerd/Miniflare, but that bundle was not selected. The selected source-module adapter inherits the patched UUID dependency and runs only on the server download path. Repeated measurements, independent readback, typed-value and isolation checks are recorded in [R1 verification](data-studio-r1-verification.md). Worker peak memory and desktop Excel/LibreOffice rendering were not measured.

### R1 implementation evidence before publication

- The actual source-module ExcelJS adapter runs under workerd with `nodejs_compat` for 10, 500 and 2,000 rows. Over-limit scopes fail before workbook generation. The browser Web Worker candidate produced a 23,863-byte, 500-row workbook in one observed 92.1 ms run. This single sample is a compatibility comparison, not p95 or a production guarantee.
- Selected boundary: lazy server generation through current authenticated report access, with fresh policy checks before returning bytes. The prebuilt browser library is not shipped because its embedded dependency cannot inherit the patched UUID override. No XLSX library enters the ordinary dashboard or sign-in bundle.
- Selected production dependency: ExcelJS 4.4.0, official npm registry, MIT, exact integrity in `package-lock.json`. Thirty-two source-bundled dependencies have licence notices preserved in `docs/data-studio-third-party-notices.txt` and `/licences/data-studio-xlsx.txt`. JSZip's MIT option is selected. No commercial spreadsheet/grid licence is procured.
- Dependency advisory assessment led to Next 16.3.8 and overrides for sharp 0.35.5, source-map-js 1.2.2, brace-expansion 1.1.21 and ExcelJS's UUID 11.1.1. npm's production advisory result is zero known vulnerabilities after the patches. This is dependency evidence, not a claim of a completed independent security audit.
- Source API fixtures verify exact totals, missing versus zero cost, negative periods, overflow, tenant/location isolation, role/column restrictions, independent export entitlement, MFA, revocation during extraction, stale fingerprints and over-limit refusal. A concurrent BookLoQ profile change now prevents a report whose balances and profile would disagree.
- The final built route and Worker adapter passed their isolated checks, alongside 25 API/numerical/dated-ledger checks. The complete 2,231-check run had four failures; all four passed focused reruns after diagnosis, fixture corrections and a restored QuickBooks internal-grant MFA check. This is not labelled a second entirely green full-suite run. The matching final build and artifact validation passed.
- The actual client component generated and downloaded a fictional seven-sheet file through its browser controls. Independent openpyxl readback verified exact leading-zero IDs, ISO text dates, numeric monetary cells, negative values, filters, frozen headers and zero formula cells. Sum of the two included sale rows is CAD 113.45; gross profit is CAD 69.45. No desktop Excel/LibreOffice rendering is claimed.
- Desktop and 390-pixel mobile fixtures use existing dark/light workspace tokens. Mobile review collapses filters and retains a visible back action. Keyboard preview, denied-download reset, empty and recovery states were inspected. The authenticated deployed owner workflow remains a release gate.
- R1 limits: 366 calendar days, 2,000 stored daily records, 2 MiB JSON and 5 MiB XLSX. Refused scopes produce no partial report. Ledger components retain separate read timestamps and an aggregate/source-account fingerprint; this is not a globally frozen database snapshot.
- Review corrections have passing focused checks: POS quantities preserve thousandths and refund quantities, transaction counts beyond Excel's 15-digit limit stay text, the standard `operating_cash` account uses the shared ledger classifier, preview identity includes reporting scope/settings/effective policy, and failed exports discard protected results. Permission refresh also remounts the Data Studio panel without clearing the parent reporting filters. Quantity rows are bounded to one billion units; values outside the exact supported thousandth scale are refused. Existing seconds and legacy millisecond update times normalize to the same actual UTC instant in preview and XLSX, with no source-record mutation.
- New persistence, schedules, external tokens and migrations: none in R1. `DATA_STUDIO_ENABLED=false` pauses the new API without breaking existing reporting. Earlier provider, restoration and normal subscriber acceptance gaps are not resolved by this export implementation.

Primary patch references: [Next advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), [Saxes 5.0.1 licence](https://raw.githubusercontent.com/lddubeau/saxes/v5.0.1/LICENSE).

Primary sources: [ExcelJS README](https://github.com/exceljs/exceljs/blob/v4.4.0/README.md), [ExcelJS MIT licence](https://github.com/exceljs/exceljs/blob/v4.4.0/LICENSE), [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Excel limits](https://support.microsoft.com/en-us/excel/excel-specifications-and-limits), [OWASP SQL injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html).

Companion historical research: `C:/Users/User/Documents/Codex/2026-10-11/br/outputs/Vanteloq-Data-Studio-Research.md`.

### SQL decision probe, not an R3 release

The disposable `node-sql-parser` 5.4.0 SQLite probe accepted one representative date-grouped net-sales question, validated every node in its supported shape and translated it to a fixed prepared statement. The visual plan and SQL-derived plan produced identical totals from a two-tenant fixture. Eight unsupported/injection shapes were refused. This establishes a candidate direction only, not the complete grammar, production catalogue, budgets, permissions or a deployed SQL editor. The parser remains outside the production dependencies until R3 satisfies its own gates.
