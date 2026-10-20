# Vanteloq Studio apps

Owner clarification, October 12, 2026: Studio is Vanteloq's own analytics workspace, with separate Dashboards, Sheets and SQL apps. Executive Review is a template, not the whole product. This release extends the existing Site and preserves the premium Dark, Light and System design.

## Shared foundation

Each app reads the existing authenticated Executive Review extraction. Organization, current membership, location, source authority and column permissions remain server controlled. Source data is bounded to a complete accepted scope of at most 2,000 recorded daily rows and 366 days. Provider history is not certified by a successful extraction. No source cells, financial journals, stock records or integrations are changed by analytical edits.

Dashboards and SQL use one read-only query engine over that extraction, rather than separate calculations. Sheets recomputes declared assumptions from current authorized source totals. Saved definitions contain user-authored settings, SQL and assumptions, not materialized source rows or results. They are private to their author, version checked on update and revalidated when reopened. Pins reread the source and retain their clearly labelled saved period. They do not imply unattended provider refresh.

## Working scope

- Dashboards: select a measure, date/location grouping and line/bar visualization; inspect exact result values; open the source sheet; open generated SQL; save and pin a view.
- Sheets: sort, filter, choose columns and page through read-only daily records; edit a separate assumption sheet with supported formulas and undo/redo; save definitions and pin scenarios.
- SQL: edit and execute the documented SELECT subset over the logical `sales` dataset; review permitted fields, result counts, NULL warnings and execution limits; retain drafts after errors; send supported results to Dashboards.
- Executive Review: existing seven-section template and permission-bound source XLSX export retained.
- Navigation: a dedicated Studio sidebar group and stable routes, with the existing reporting feature and role boundary.
- Reports: category disclosure, comfortable card spacing, readable labels and wrapped statuses. Shared dense-card layouts retain their financial semantics.

This is a bounded first app release. Full Excel compatibility, arbitrary database SQL, external warehouses, analytical XLSX imports, multi-user cell collaboration, complex joins, scheduled refresh and AI-authored queries remain separate development work. The earlier programme's R2, R3 and R4 gates must not be called fully complete based on this subset.

## Research and decisions

- [Microsoft dashboard design](https://learn.microsoft.com/en-us/power-bi/create-reports/service-dashboards): use a focused visual canvas with saved tiles and routes to supporting records.
- [Microsoft drillthrough](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-drillthrough): preserve the date/location/source context from summary to detail.
- [W3C grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/): avoid an incomplete ARIA grid. Start with semantic tables and native labelled editors; add composite grid navigation only with its complete keyboard contract.
- [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): controls and cards reflow; wide data tables scroll within labelled regions.
- [OWASP SQL prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html): no user SQL is spliced into D1. A whole-statement parser refuses unsupported identifiers and syntax before executing a bounded logical plan over authorized data.

These are implementation recommendations, not evidence that Vanteloq outperforms established products. Conversion, retention, analyst-free task completion and cross-surface reconciliation require measured user outcomes.
