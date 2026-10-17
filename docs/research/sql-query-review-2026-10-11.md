# SQL correctness and performance review

## Changes

Bank statement selection now reads an authorised source by its exact organisation, source kind and ID. It no longer depends on finding that source in the 200 most recent imports. Two completed reconciliation rows are treated as a conflict instead of arbitrarily selecting one. The recent chooser remains explicitly bounded.

Provider report coverage asks whether eligible records exist rather than counting every matching row. Seven scoped reads are submitted through one D1 batch. Table names and source kinds are server-owned; tenant IDs, connections, periods and location lists are bound. JSON arrays keep mapped-location reads below D1's placeholder limit. Coverage is presence only, not completeness.

Historical-cost work uses tenant/product/line indexes and bounded audit history. Source-backed outcomes resolve records and revisions in batches of at most 80 IDs and retain snapshots rather than recalculating prior decisions. Correction and posting paths keep state changes and audit/accounting writes in atomic batches, rechecking conditions at commit time.

No existing applied migration was changed and no new index migration was introduced without production migration/recovery evidence.

## Evidence and limits

Migrated SQLite query-plan tests cover 260 imports, cross-tenant IDs, exact older-source lookup, conflicting reconciliations, correction rollback and retained source evidence. Provider presence tests use 10,000 dated records and tenant/connection/location/timezone predicates. Cost tests exercise 20,000 lines, signed returns, missing costs and 500 historical events.

The cost test observed 301 ms for a populated local SQLite fixture with 20,000 lines, 100 costed products and 500 history events. This is a reproducible local fixture result, not a production latency, Cloudflare capacity or concurrency claim. Hosted query statistics, realistic network conditions and representative workloads still need measurement.

## Primary references

- [Cloudflare D1 indexes](https://developers.cloudflare.com/d1/best-practices/use-indexes/): inspect indexed predicates and query plans rather than assuming an index improves every query.
- [Cloudflare D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/): batch prepared statements and retain transaction/error boundaries.
- [SQLite query planner](https://www.sqlite.org/optoverview.html): constrain leading index columns and inspect actual plans.
- [OWASP multi-tenant guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html): tenant isolation is required at every data access boundary.

Implementation choices are engineering inferences from those sources, verified by the repository's focused tests. They do not provide independent security certification.
