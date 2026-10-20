# Historical cost protection

Verified against the existing version 355 source on 11 October 2026. This change protects operational sales margins. It does not implement a FIFO or weighted-average inventory subledger or automatically change posted accounting journals.

## Accounting basis

[IAS 2, IFRS Foundation](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/) distinguishes specific identification from FIFO and weighted-average cost formulas. Inventory expense belongs to the period of the related recognised revenue. A newly entered supplier price therefore does not, by itself, establish the acquisition or carrying cost of earlier sold stock. IAS 2 is a relevant benchmark; this implementation does not assert that every Canadian customer reports under IFRS.

## Implemented contract

- Each new manual or CSV owner cost has an append-only, tenant-scoped `inventory.cost_effective` event in the existing audit table. The current product field and its event are written in one D1 transaction. Invalid or no-longer-approved products abort the batch.
- The new value applies from its recorded instant. Repeated edits at the same millisecond receive strictly increasing cutovers. Existing seconds and millisecond timestamps are normalised before comparison.
- The selector reads owner history once per account, then uses the cost effective at the sale instant. Legacy owner prices with a known update time become the prior schedule baseline when the first new event is saved. Earlier recorded amounts remain intact; an undated legacy price does not establish a new historical fact.
- Offset timestamps are compared as instants. Provider wall-clock timestamps use the workspace business timezone. For X-Series and R-Series, the completed parent sale determines the sale time rather than the line's earlier creation time.
- Explicit zero and missing cost remain distinct. A current catalog cost no longer makes an old unknown zero complete. An ambiguous SKU cannot choose an arbitrary product. Provider, connection, product reference and tenant scope remain part of the identity.
- Receipt summaries require complete attributable line costs and a matching staged amount. A nonzero subtotal from only some lines cannot establish gross margin. Zero-revenue stock gifts still need cost evidence. Commerce product, inventory, customer and supplier aggregates share this distinction.
- Clover, Shopify and X-Series capture a fallback catalog amount once instead of repeatedly repricing old lines. Unchanged refreshes preserve the line timestamp. R-Series retains explicit transaction cost evidence, reports cost gaps, and preserves dated owner costs after refresh.
- Signed return quantities preserve the dated unit-cost basis when the provider reports the original sale timestamp. A later-dated return without original-sale linkage still needs source review; no universal original-lot allocation is inferred.
- Historical corrections cannot be smuggled into the ordinary cost API through `effectiveAt` or `historicalCorrection`. They require a reviewed accounting adjustment. There is no new backdating editor in this change.

## SQL and validation

[Cloudflare's D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) documents prepared bindings and sequential transactional batches with rollback on a failed statement. This implementation binds user values and uses the existing audit outcome constraint as a fail-closed eligibility guard.

[SQLite EXPLAIN QUERY PLAN](https://sqlite.org/eqp.html) distinguishes indexed searches from scans. [SQLite INDEXED BY](https://sqlite.org/lang_indexedby.html) is a query-plan regression requirement, not a general optimiser hint. The dated product lookup requires the already-existing product/date index, because a populated fixture demonstrated an account-wide scan for each product without this constraint. No new migration is introduced. The audit read uses the existing workspace index; history is not scanned separately for each line.

Runtime checks cover old and new prices, signed returns, repeated refreshes, business-local and UTC dates, legitimate zero, missing cost, ambiguous SKU, namespace/tenant isolation, atomic audit rollback and same-instant edits. A fictional populated fixture contains 20,000 lines, 100 costed products and 500 events. Its plan confirms indexed product and line lookup and a single workspace-indexed history read. Local SQLite timing is diagnostic evidence only, not hosted throughput or recovery proof.

## Remaining boundaries

The first captured provider catalog fallback remains operational source evidence, not proof of historical acquisition layers. Provider cost corrections can legitimately change transaction facts and need separate review. Previously corrupted margins cannot be reconstructed without source records. Full inventory layers, original-lot returns, write-downs, framework configuration and posted COGS correction workflows remain separate work. Production backup/restoration, provider reconciliation and unattended sync completion still require their own evidence.
