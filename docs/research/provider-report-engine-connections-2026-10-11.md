# Executable provider report connections

Source review and local verification: 11 October 2026, based on existing Sites version 355. This record describes recorded views, not provider approval, complete-history certification or a published deployment.

## Existing engines connected

| Catalogue entry | Query | Scope and output | Boundary |
| --- | --- | --- | --- |
| Provider product performance | `commerce_intelligence`, `products`, API `mode=Sales` | Product totals and a bounded transaction preview | Costs must be attributable for every included line before profit appears |
| Inventory health | `commerce_intelligence`, `inventory`, API `mode=Inventory` | Current dated stock, selected-period movement, fresh cover estimates and stock alerts | Current stock is not a historical inventory snapshot; missing demand is not a verified quiet day |
| Customer activity | `commerce_intelligence`, `customers`, API `mode=Customers` | Linked purchases and revenue for the exact period | Does not claim complete lifetime retention or identify unlinked customers |
| Supplier coverage | `commerce_intelligence`, `suppliers`, API `mode=Suppliers` | Product links, period movement, sales and low-stock follow-up | Does not certify supplier delivery speed, invoice correctness or settlement |

The request retains `from`, `to` and authorised `location`. Provider-specific requests also pass `connection`. The API requires integration access, tenant-owned mapped source candidates, approved publication, no active sync lease and an accessible outlet. It selects that account's facts even when the workspace uses another account for consolidated reporting. Canonical requests still enforce source authority and do not silently combine overlapping accounts.

`sourceScope` returns connection, provider, account label, locations, period, business timezone, currency and source mode. `readiness` remains `not_certified`: recorded amounts and a successful query do not prove complete provider pagination, late-arriving history or reconciliation. Product, stock, customer and supplier source reports reject oversized dimension results with an instruction to narrow dates or location. The newest 1,000 transaction lines are explicitly a preview; aggregate product amounts use all matching stored lines.

Period controls cap explicit source reports at 366 past or current days. Bound parameters and JSON source tuples retain provider/connection/outlet identity. Customer and supplier catalogue reads also bind the exact connection; another account's zero-activity catalogue does not leak into the result. Profit, identity and cost permissions remain independent of report navigation.

## Entries that remain planned

- Location comparison needs a dedicated compatible-location comparison contract, including currency and period coverage. Opening a one-location sales report does not complete it.
- Moneris settlement reconciliation needs explicit settlement and bank matching evidence. Payment records do not establish reconciliation.
- Delivery fees and net proceeds need verified fee, refund and payout facts. Order sales are insufficient.
- Delivery-store comparison needs a complete store comparison view and explicit channel authority.

## Evidence

The actual authenticated route was exercised against migrated, disposable SQLite and a fictional identity transport. Checks cover known-zero cost, mixed missing-cost totals across all four modes, overlapping source authority, exact account/location/date scope, forbidden sources, an injected connection value, changed approval and withheld permissions. No customer records, hosted account credentials or external providers were used. Full hosted visual, provider reconciliation and restoration evidence remain separate checks.
