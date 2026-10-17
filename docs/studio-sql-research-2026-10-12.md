# Studio SQL implementation and primary source research

Research checked October 12, 2026. The delivered SQL app is a bounded, read-only query tool for the authorized Executive Review snapshot. It is a deliberately limited SQL dialect. It does not connect the editor to D1, provide arbitrary database access, or claim compatibility with all SQLite syntax.

## Research and resulting decisions

| Primary source | Relevant guidance | Implementation decision |
| --- | --- | --- |
| [SQLite SELECT](https://www.sqlite.org/lang_select.html) | SELECT returns rows without modifying data. Its explanation separates input, filtering, grouping and output. SQLite permits ambiguous bare fields in some aggregate queries. | The engine parses the complete statement, reads the logical `sales` dataset, filters, groups, projects, sorts and applies LIMIT. Bare fields in aggregate queries are refused unless included in GROUP BY. |
| [SQLite aggregate functions](https://www.sqlite.org/lang_aggfunc.html) | COUNT(*) counts rows; COUNT(field) counts non-NULL values. SUM excludes NULL and returns NULL when there are no known values. MIN and MAX use known values. Integer SUM can fail on overflow. | Those semantics apply to supported functions. SUM uses checked integer arithmetic. Missing cost evidence produces NULL row profit and visible completeness warnings. Partial known sums are clearly distinguished from complete financial totals. |
| [SQLite expressions](https://www.sqlite.org/lang_expr.html) | Ordinary comparisons with NULL are not true; IS NULL and IS NOT NULL explicitly test missing values. | WHERE has typed field-to-literal comparisons plus AND and null tests. NULL comparisons exclude the row. There is no text-to-number coercion, arbitrary expression evaluation or JavaScript execution. |
| [SQLite implementation limits](https://www.sqlite.org/limits.html) | Explicit query limits help constrain resources controlled by untrusted input. Certain expanded grammar features have substantial resource costs. | The dialect refuses joins, subqueries, compound queries, pattern matching and functions beyond SUM/COUNT/MIN/MAX. It also bounds SQL size, tokens, projections, filters, sorting, rows, estimated work and result bytes. |
| [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html) | Parameterized database queries distinguish code from data. Table, field and sorting choices require controlled validation when they cannot be bound as ordinary values. | Editor SQL is never submitted to a database. A tokenizer and parser produce an allowlisted plan. Identifiers are mapped to explicit field readers. Escaped single-quoted text remains data. No raw string is evaluated or concatenated into executable database SQL. |
| [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | Least privilege, deny by default and checking permissions for each request are separate from authentication. Client checks alone are not a security boundary. | The existing server review remains responsible for organization/location authorization and source redaction. The local engine additionally reconstructs its permitted schema on every run. Restricted cost/profit fields cannot appear in selection, filters or aggregate arguments. Saved query content must be reparsed against each fresh authorized review. |

These sources informed implementation choices. They do not certify the implementation or establish superiority over other analysis products.

## Supported grammar

```sql
SELECT field [AS alias], SUM(numeric_field) [AS alias],
       COUNT(field_or_star) [AS alias], MIN(field) [AS alias], MAX(field) [AS alias]
FROM sales
[WHERE field comparison literal [AND field comparison literal ...]]
[GROUP BY business_date [, location_ref]]
[ORDER BY selected_result [ASC | DESC] [, selected_result [ASC | DESC] ...]]
[LIMIT integer]
[;]
```

`SELECT *` expands only the current permitted schema. It is a complete projection choice, rather than a wildcard embedded alongside other projections. Comparisons are `=`, `!=`, `<>`, `<`, `<=`, `>` and `>=`; `IS NULL` and `IS NOT NULL` are also supported. GROUP BY allows either listed field or both, in either order. Keywords, identifiers and aliases are case insensitive. Text retains its case. Aliases are unquoted names of up to 64 characters and must be unique. `ORDER BY` names a selected result key. SUM requires a numeric field. Only COUNT accepts `*` as a function argument.

Only one complete statement is accepted. Comments, writes, joins, subqueries, expressions, DISTINCT, HAVING, OR, OFFSET, qualified identifiers, quoted identifiers, windows, parameters and additional functions are refused. A trailing semicolon is optional; additional tokens after it cause failure. Semicolons and escaped quotes inside string literals remain literal content.

## Units, missing evidence and authorization

The schema includes `record_id`, `business_date`, `location_ref`, `source_kind`, `net_sales_cents`, `transaction_count`, `units_sold`, `discounts_cents` and `refunds_cents`. `cost_of_goods_cents` and `gross_profit_cents` exist only when `review.margin.state !== "restricted"`.

Money and transaction counts are safe integers. Each accepted sum intermediate and final integer must remain inside JavaScript's exact integer range, plus or minus 9,007,199,254,740,991. This is deliberately narrower than SQLite's signed 64-bit integer range. Arithmetic uses BigInt internally and checks before returning a number. Money remains integer cents in result records. The table formats cents with exact integer division to preserve the original decimal amount, including unusually large values. Currency comes from the authorized review.

Units follow the existing source contract: up to three decimal places, normalized to exact thousandths. SUM accumulates integer thousandths. Source quantities with extra precision, nonfinite values or values outside the existing per-row billion-unit bound are rejected.

Missing optional values stay NULL. Per-row gross profit is `net_sales_cents - cost_of_goods_cents` only where cost evidence exists. `SUM(gross_profit_cents)` is a sum of known recorded row profits, not a statement that every row has known costs. Result warnings identify missing values among matched daily rows. The Executive Review summary has its own completeness policy and should not be replaced with a partial known SQL sum.

All schema references are validated before reading values. COUNT(*) and counts in result metadata concern already authorized daily rows. The engine has no means to access another organization, connection or hidden source dataset. It receives no credentials and makes no network requests.

Text comparisons and sorting are deterministic JavaScript string ordering, not a claim of SQLite collation compatibility. Dates are validated YYYY-MM-DD calendar dates and sort chronologically as strings. NULL sorts first ascending and last descending. Ties retain source/group insertion order, within this snapshot. Neither tie order nor group insertion order promises an order across refreshed snapshots.

## Bounds and reporting

| Bound | Value |
| --- | --- |
| Source snapshot | At most 2,000 daily rows, accepted only with matching `metadata.rowCount` and `truncated: false` |
| SQL | 8,192 UTF-8 bytes and 512 tokens |
| Selected columns | 16 |
| WHERE predicates | 16 |
| Grouping fields | business_date and location_ref, once each |
| Sort results | 3 |
| LIMIT | Whole integer from 0 through 2,000; omitted default is 500 |
| Estimated work | At most 100,000 deterministic work units |
| Serialized query result | At most 2 MiB |
| Literal/source text field | At most 256 characters |

Work units are a conservative deterministic admission estimate derived from authorized row count, projection/filter/grouping width and `n log2(n)` sorting width. They are not a database execution plan, elapsed-time guarantee or exact count of JavaScript operations. Oversized SQL, unsupported grammar, unsafe values, overflow, incomplete snapshots, unavailable sales, excessive estimated work and oversized serialized results throw `StudioQueryError`. No partial query result is returned on these failures.

LIMIT alone can omit result rows. `matchedRows` counts authorized source rows satisfying WHERE. `totalResultRows` counts projected/grouped rows before LIMIT. `truncated` is true when LIMIT omitted result rows. The editor displays these counts and requires a complete, nonempty result before invoking the optional pin callback. It preserves the draft when a query fails. Loaded results are hidden if the review object or SQL draft changes, including changed permissions or scope.

## Integration contract

```ts
runStudioQuery(review: StudioExecutiveReview, sql: string): StudioQueryResult
parseStudioQuery(review: StudioExecutiveReview, sql: string): StudioQueryPlan
studioQuerySchema(review: StudioExecutiveReview): StudioQueryFieldSpec[]
studioQuerySourceRows(review: StudioExecutiveReview, sql: string): StudioSalesRow[]
```

The result has `columns: string[]`, `columnDetails` (key, label, field, type, aggregate, nullable), `rows: Record<string, string | number | null>[]`, `matchedRows`, `totalResultRows`, `truncated`, `plan`, `warnings`, `snapshotHash`, `currency` and `estimatedOperations`. Default aggregate keys are `sum_net_sales_cents`, `count_rows`, and equivalent function/field names. Aliases are result keys. The plan exposes `select`, `where`, `groupBy`, `orderBy`, `limit`, `normalizedSql`, version `studio-sql-v1` and table `sales`.

The editor default export accepts `review`, `initialSql?`, `onSqlChange?` and `onPin?`. Run and Ctrl/Command+Enter execute locally. Pin passes the normalized query string to the supplied callback. The component does not persist source rows, execute writes, post financials or add an export mechanism. The workspace owns saving query definitions and subsequent dashboard rendering.

Source drillthrough uses `studioQuerySourceRows`. It reparses the whole original query against current permissions, builds a normalized `SELECT record_id` query retaining every WHERE predicate, removes aggregate/group/result sorting, and sets LIMIT to the 2,000-row snapshot bound. It then uses the existing public query engine and maps only matching identifiers to authorized snapshot rows. The original chart LIMIT is deliberately omitted so Sheets can receive all underlying matched rows, then apply the selected point's dimension filter. Duplicate source identifiers are refused to prevent a matching identifier from including another location's row. Revoked permissions in an original financial projection or predicate cause refusal before drillthrough.

## Verification

The initial parser and editor tests failed before their implementation. The latest focused SQL suite passes 15 SQL/SSR editor cases: filtering/grouping/alias sorting, complete parsing, escaped literals, restricted schema and predicates, missing values, null tests, exact units and overflow, ambiguous grouping/alias handling, normalized-plan round trips, cost/output caps, snapshot/default-limit reporting, accessible editor/schema rendering, replay under changed permissions/date bounds, source drillthrough retaining all predicates, and drillthrough permission/identifier validation. Two drillthrough tests failed against a stub before the helper was implemented. The initial pass also checked 8 existing exact-value cases. Strict TypeScript checks and targeted ESLint passed for the parser/editor/tests seam. Browser interaction and deployment evidence belong to the workspace integration pass; they are not implied by domain tests.

A bare `node scripts/test.mjs` run was started, then stopped after repeated native `std::terminate() called with no exception` aborts in `tests/account-deletion-flow.test.ts`. The integration owner requested avoiding duplicate broad suites and owns the integration checks. This aborted run is not a broad-suite pass. The observed failures were:

- self-service deletion removes only the confirmed workspace, preserves console identity, and supports replay
- deletion reconciles a checkout completed after its original billing snapshot
- failed identity cleanup stays pending and can resume without a workspace login
- fresh MFA, exact consent, origin, and immutable server proof are required
- storage failure preserves database records and blocks normal work while the confirmed job retries
- ambiguous or changed membership fails before any remote or local deletion
- a teammate deletes only their own membership and keeps the employer workspace
- a saved workspace deletion cannot outlive the requesting owner's authority
- a saved personal deletion cannot erase data after membership moves to another workspace
- local deletion rolls back when scope changes after its final preflight
- an account without onboarding or a paid subscription can delete itself
- active provider connections require disconnection before a deletion job is created
- workspace deletion preserves pending document cleanup references and keeps Documents recoverable
- a held lease prevents competing deletion and a stale completed snapshot is harmless
- a successful provider HTTP response is not enough without verified removal

These native failures do not establish a defect in Studio SQL, and their underlying cause was not investigated as part of this scoped task. Node also emits its existing experimental transform-types warning during the focused tests.
