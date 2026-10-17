# Industry brief coverage and release review

Source audit dated 4 October 2026. This document maps the café, restaurant and dealership requests to the current working source. It does not certify a live provider connection, production completeness, a deployed migration or a successful customer workflow.

**The repository implements industry-specific records, calculations and reviewed manual operations. It does not implement the complete café POS/KDS, full-service restaurant system or DMS integration described in the briefs.** An interface update does not close those operational gaps.

## Scope and status meanings

The café brief was read from `C:/Users/User/.codex/attachments/f1f9596b-1df7-4f0d-9445-7bba5d8b2dbb/Pasted text.txt`. The restaurant brief was read from `C:/Users/User/.codex/attachments/1784ea36-3685-4b93-981e-0ce7effa9fa2/Pasted text.txt`. The dealership section follows the user brief's section list supplied to this audit: DMS, automotive CRM, vehicle inventory, desking, F&I, fixed operations, parts, accounting and analytics. Competitor examples and illustrative figures are requirements context, not evidence of Vanteloq functionality. Competitor claims were not independently verified here.

| Status | Meaning |
| --- | --- |
| Implemented | A corresponding model, calculation or UI path exists in source. This is not a fresh runtime or production test. |
| Manual | Explicit, reviewed user-entered or uploaded evidence is required. No automatic synchronization or external execution is implied. |
| Partial | Some requested parts exist. The missing parts are stated. |
| Pending | No complete native implementation was found. Both internal development and external access may be required. |
| External | The authoritative action belongs in a POS, KDS, payment processor, DMS, payroll, lender or another system. Connections still require implementation, authorization and live verification where applicable. |

Release 330 is the baseline identified by the release owner. This audit did not recheck that hosted release. It inspected the current working tree, including later unpublished changes. The [earlier workflow implementation register](business-workflow-implementation-2026-10-04.md) contains historical test/publication statuses that this audit does not refresh. No build, browser session or deployment was run for this document.

## Source map

- **F1, food records/calculations:** [domain](../domain/foodservice.ts), [schema](../db/foodservice-schema.ts), [server](../server/foodservice.ts), [route](../app/api/v1/foodservice/route.ts), [workspace](../app/foodservice-workspace.tsx).
- **F2, recipe modifiers/history:** [calculations](../domain/foodservice-modifiers.ts), [editor and history](../app/foodservice-record-tools.tsx).
- **F3, reviewed food operating measures:** [calculations](../domain/food-analytics.ts), [prep/service/delivery review](../app/food-operations-overview.tsx), [sector workspace integration](../app/sector-operations.tsx).
- **S1, reviewed sector operations:** [definitions/calculations](../domain/sector-operations.ts), [writes and batch stock movements](../server/sector-operations.ts), [schema](../server/sector-operations-schema.ts), [workspace](../app/sector-operations.tsx).
- **I1, managed stock/purchasing:** [domain](../domain/workflow-inventory.ts), [server](../server/workflow-inventory.ts), [workspace](../app/inventory-workflows.tsx), [schema](../server/workflow-inventory-schema.ts).
- **C1, connected commerce:** [Square sync](../server/integrations/sync/square.ts), [Shopify POS sync](../server/integrations/sync/shopify-pos.ts), [source authority](../server/integrations/source-authority.ts), [feature coverage](../domain/provider-feature-coverage.ts), [report contracts](../domain/provider-report-contracts.ts).
- **T1, industry configuration:** [templates](../domain/industry-templates.ts), [service](../server/industry-configuration.ts), [UI](../app/industry-configuration.tsx), [workspace routing](../app/vanteloq-app.tsx).
- **D1, dealership operations:** [domain/boundaries](../domain/dealership.ts), [schema](../db/dealership-schema.ts), [server](../server/dealership.ts), [workspace](../app/dealership-workspace.tsx), [route](../app/api/v1/dealership/route.ts).
- **D2, dealership measures:** [aging, eligible gross and appointment calculations](../domain/dealer-analytics.ts), [presentation](../app/dealership-workspace.tsx).
- **W1, general operations:** [definitions](../domain/business-workflows.ts), [server](../server/business-workflows.ts), [workspace](../app/business-workflows.tsx), [follow-up service](../server/workflow-followup.ts).

A source reference identifies the implementation or bounded model inspected for an absent capability. Generic notes, labels and manual checklists do not count as dedicated operational workflows.

## Café: workflow and system requirements

| ID | Requirement | Current coverage | Remaining work and boundary |
| --- | --- | --- | --- |
| C01 | Counter, website, mobile, DoorDash and Uber Eats orders in one stream | **Partial / external.** C1 normalizes supported commerce sales, lines, payments and locations. S1 stores reviewed delivery order/provider/settlement references. | Completed-sales imports are not an active order stream. Multi-channel open-order intake, fulfillment states and delivery-marketplace feeds are not complete. A provider label/report contract does not prove a connector. |
| C02 | Card/cash payment, tender and order total | **Partial / external.** Supported imports preserve payment evidence; delivery review separates sales from remitted tax/tips. | Taking payment, cash drawer operation, processor refunds and authorizations remain external. S1 does not collect or disburse money. |
| C03 | Menu management for finished drinks/food | **Partial / manual, F1/T1.** Named recipes, portions and menu-oriented inventory labels exist. | Menu publishing, selling-price versions, availability/86 control and POS menu synchronization are not established by these records. |
| C04 | Barista/KDS queue, elapsed time and preparation instructions | **Pending / external.** S1 has a manually entered prep station; F2 has costing modifiers. | No persisted active ticket, barista queue, timer, queue assignment or ticket lifecycle. A station label is not a KDS. |
| C05 | Bar, Kitchen and Pastry routing | **Pending / external.** | Item-to-station rules, dispatch, acknowledgements and order aggregation are not executable workflows. |
| C06 | Order → prep → completion → pickup/delivery timestamps | **Pending / external.** S1 has period completed-order and late-order counts. | No lifecycle timestamps for actual order/prep/completion/pickup durations. Late-order ratio is a different measure. |
| C07 | Menu item → recipe → ingredients | **Implemented / manual, F1.** Ingredients have purchase quantities/costs, recipe quantities, yield and portions; recipe/per-portion costs use exact quantities. | Automatic POS item/modifier ID mapping to stock and effective recipe versions is pending. |
| C08 | Weight, volume and unit stock: beans, milk, syrup, cups, lids | **Implemented / manual, F1/I1.** Costing supports g/kg/mass oz/lb/ml/l/each. Managed stock supports each/g/ml in thousandths. | No mass-to-volume density is invented. Stock identifiers and compatible units must be established. Packaging is included only if entered. |
| C09 | Latte sale automatically deducts every ingredient | **Pending.** F1/F2 calculate cost; S1 consumes entered ingredients on reviewed batch approval. | No POS-sale-triggered, recipe-version/modifier-aware depletion. Batch approval is a separate stock event. Duplicate/cancelled/refunded/remade sales need explicit handling. |
| C10 | Sizes, oat-milk substitution, extra shots/syrup, removals | **Implemented / manual cost preview, F2.** Add/replace/remove mappings are saved; conflicting changes and unknown modifiers are rejected. A separate base recipe represents each size. | No automatic POS mapping, order pricing, kitchen instruction delivery or stock deduction. Allergen safety is not certified. |
| C11 | Expected demand, target, prepared quantity and remaining prep | **Partial / manual, S1.** Plans use demand/buffer/usable/planned portions and batch rounding; batches retain produced/unusable portions, dates and costs. | Demand is entered, not forecast. Plans/batches do not form automatic demand/production reconciliation. Capacity and safe shelf life require review. |
| C12 | Batch consumes ingredients and increases finished inventory | **Implemented / manual, S1/I1.** Approval consumes explicit managed-stock inputs and creates output atomically. Reopening/cancellation reverses eligible movements with stock/version guards. | Stock must first be opened. POS balances are unchanged. No automatic nested recipe expansion or journal posting. Review output stock quantity against usable production. |
| C13 | Made/sold/remaining/wasted; waste cost, retail loss and quantity waste rate | **Partial / manual.** F1 has waste at cost and a cost-based waste/available-inventory ratio. S1/F3 show produced/usable/unusable portions and weighted production-loss percentage by recipe/currency from reviewed batches. | Full made/sold/remaining reconciliation, retail loss and event-level causes remain pending. Production loss is unusable ÷ prepared, not later spoilage/remakes or current unsold stock. Cost-based waste has a different denominator. |
| C14 | Suppliers, PO, receipts and restocking | **Implemented / manual, I1/S1.** Partial receipts, accepted/rejected quantities, stock movements/reversal, PO invoice differences and outstanding supplier credits exist. | No automatic supplier order dispatch, return shipment, bill payment or supplier-credit posting. |
| C15 | Consumption forecast, days of supply, safety stock, suggested PO | **Partial / manual, I1.** Proposal uses entered observed demand/in-stock days, lead/review days, safety stock, inbound/commitments, case/MOQ and cash/storage/shelf-life constraints. | No automatic recipe-based ingredient forecast or PO dispatch. Units, observations and assumptions need review. |
| C16 | Employee scheduling/labour | **Partial / manual, F1/S1.** Labour cost, planned/paid minutes, sales/paid hour and labour/sales exist. | No staff rota, time-clock capture or payroll computation in these workflows. |
| C17 | Customers, loyalty and CRM | **Partial / external.** C1 has supported customer/sale facts and shared customer views. | No café-specific loyalty earn/redeem program or loyalty execution in the food model. Customer data alone is not a loyalty integration. |
| C18 | Business-type onboarding changes the underlying workspace | **Implemented in part, T1.** Café/restaurant templates, food-costing capability, menu/ingredient labels and food-cost workspace exist; retail, dealership and services are distinct templates. | Café/restaurant costing remains substantially shared. Selecting a type does not create KDS/table workflows or activate credentials. |

### Café dashboard and AI examples

| ID | Requested measure/insight | Coverage and next evidence needed |
| --- | --- | --- |
| C19 | Revenue, orders, average order value, gross margin | **Partial.** Source-backed commerce KPIs and matched-period average check/food-cost measures exist. Dates/source/completeness control availability. Food contribution is not company gross/net margin without the matching cost definition. |
| C20 | Average order time, in-queue count, average prep time, order accuracy | **Pending.** No ticket events, active queue or correct/remade-order cohort. Do not display the sample figures as live measures. |
| C21 | Low/critical ingredient stock counts | **Partial.** Product stock views and managed positions exist. Recipe-driven thresholds/current ingredient coverage and sale/production depletion reconciliation remain needed. |
| C22 | Waste today and top products | **Partial.** Reviewed waste and sale-line product reporting exist, but current-day ingredient waste and production/sales reconciliation are not automatic. Use the location business date and complete interval. |
| C23 | Oat milk 21% above forecast, 1.4 days remaining | **Pending as automated insight.** Requires ingredient forecast, measured usage, stock and coverage. An entered supplier proposal cannot establish these assertions. |
| C24 | Matcha contribution 18% above beverage average | **Pending as verified comparison.** Recipe costing exists; matched menu prices, mix, modifier costs, variable costs and comparable cohort remain needed. |
| C25 | 8–9 AM orders 37% slower than daily average | **Pending.** Requires lifecycle timestamps, station/channel and complete comparable cohorts. |
| C26 | Four Mondays of excess production; reduce 30 to 25 | **Pending as forecasting/AI.** Plans and batches provide a foundation; matched production/sales/waste/stockouts and demand history are needed. The example is not a recommendation for actual records. |
| C27 | DoorDash revenue share versus contribution share | **Partial / manual, S1/F3.** Provider/currency summaries show reviewed net food sales, contribution/sales, source orders and settlement gaps. Complete all-channel share of sales/profit, live fees/costs and whole-location coverage remain separate requirements. Current filter uses source as-of date, not necessarily order or payout date. Missing cost is not zero. |
| C28 | Labour 31% versus four-week 26% average | **Partial / manual.** Period ratios exist; a matched historical comparison needs consistent wage/employer-cost policy and complete nonoverlapping periods. |

## Restaurant: every numbered section and lifecycle

| ID | Brief section/requirement | Current coverage | Remaining work and boundary |
| --- | --- | --- | --- |
| R01 | Reservation/walk-in → host seating → server/table opening | **Pending.** No dining table, seat, restaurant reservation or waitlist model found. | S1 hotel room/stay `reservation` records must not stand in for restaurant reservations/occupancy. |
| R02 | 1. Floor plan, table, guests, server, seating time, reservation, status, course, bill, time seated | **Pending / external.** | Needs dedicated tables/seats, layout, service sessions, server assignment and temporal occupancy. Static drawings/counts do not satisfy it. |
| R03 | 2. Orders with table/seat/server, modifiers, allergies, courses, pricing | **Partial only for manual recipe modifiers, F2.** | No transactional restaurant order/seat/course model, allergy instruction handling, table bill or menu price version. Ingredient removal is not allergen safety. |
| R04 | 3. Drinks/appetizers/entrees/dessert hold, send, fire | **Pending / external.** | No course state machine, release authorization, fire event or kitchen acknowledgement. |
| R05 | 4. Grill, fry, sauté, salad/pantry, bar routing | **Pending / external.** S1 prep plans have a station label. | No routing rules, independent ticket status, station load or dispatch. |
| R06 | 5. Expediter sees dish readiness and releases complete meal | **Pending / external.** | Needs item readiness, order/course grouping, partial-ready state and serve/release events. |
| R07 | 6. Entered/fired/cooking/ready/picked-up/served timestamps | **Pending / external.** S1 has entered period order/late-order counts. | No event chain for ticket time, kitchen-to-table or order-to-table. Define interval start/end explicitly. |
| R08 | Station averages, weekday/hour bottlenecks | **Pending.** | Needs complete event cohorts, timezone-aware service periods and cancellations/remakes. Late-order rate is different. |
| R09 | 7. Recipe-driven inventory, food cost, COGS, margin | **Partial / manual, F1/F2/S1/I1.** Exact recipe costing, physical-count depletion and batch stock movements exist. | Automatic sale depletion is pending. Food-cost calculation does not post COGS or prove accounting recognition. |
| R10 | 8. Prep recipe: sauce batch used in final dish | **Partial / manual.** F1 costs batches/portions. S1 can create prepared-stock output and explicitly consume stock in another batch. | No nested recipe graph with automatic version/yield/cost propagation. Manually entered prepared ingredients are not automatic mapping. |
| R11 | 9. Spoilage, overproduction, wrong orders, remakes, comps, theft, portion inconsistency, expiry | **Partial / manual.** F1 total waste cost, S1 unusable portions and I1 lot/expiry actions exist. | No full event taxonomy and item/shift/source attribution for all causes. Comp/refund/theft suspicion must not automatically become physical waste. |
| R12 | Waste by category; multiweek and closing-shift AI trends | **Pending as complete workflow.** | Aggregate waste lacks event cause/item/time data to establish shift attribution or causes. |
| R13 | 10. Dine-in, takeout, website, Uber Eats, DoorDash, Skip, phone | **Partial / external.** C1 imports specific supported commerce sources; S1 stores manual provider order evidence. | Full channel order normalization/dispatch and provider order/fee/settlement feeds are not complete. |
| R14 | Channel sales, average check, contribution and contribution share | **Partial / manual, S1/F3.** Delivery provider/currency summaries show net food sales, contribution, weighted contribution/sales and settlement review. | All-channel average checks/contribution shares and complete reconciled cohorts remain needed. Source as-of date can differ from order date. Contribution excludes fixed overhead. |
| R15 | 11. Tables/seats, seated guests, reservations, walk-ins, wait time | **Pending / external.** | No dining capacity/occupancy/arrival/waitlist event model. Hotel occupancy cannot substitute. |
| R16 | Peak occupancy forecast connected to prep/labour | **Pending.** | Needs reservation/walk-in/no-show history, seat/turn events, constraints and validation. Entered prep demand is not this forecast. |
| R17 | 12. FOH/kitchen wage costs, total labour and labour/sales | **Partial / manual, F1/S1.** Aggregate cost, paid minutes and labour/sales exist. | Structured FOH/kitchen segmentation, time-clock/payroll linkage and roster planning remain needed. |
| R18 | Server sales, tables, average check, tips, workload, coaching | **Pending as restaurant workflow.** | No server-check/seat/tip allocation model. Dealership credit allocation is unrelated. Use staffing/workload/coaching, not simplistic ranking from unmatched sales. |
| R19 | Bill, split check, payment/tip, table reset | **Pending / external.** Imported payment facts/manual tax-tip settlement evidence are foundations. | No split-check/tender/gratuity/check-close/table-reset lifecycle. Processor/POS authority stays explicit. |
| R20 | Accounting/inventory/analytics after service | **Partial.** F1 food-cost review, I1 managed stock, C1 commerce data and separate BookLoQ exist. | No automatic table-close recipe depletion/accounting chain. Operational completion does not post journals. |
| R21 | Requested navigation hierarchy | **Partial, T1.** Overview, food costs/recipes/modifiers, product inventory, prep/service, shared customer/financial/analytics/AI surfaces exist. | FOH floor plan/tables/reservations/waitlist/servers; channel orders; KDS/stations/expediter; full menu pricing/profitability and labour remain pending. Navigation must not imply these features are live. |

### Restaurant dashboard and AI examples

| ID | Requested measure/insight | Coverage and next evidence needed |
| --- | --- | --- |
| R22 | Net sales, covers, average check, table turn, food/labour cost | **Partial.** Sales/closed checks and reviewed food/labour costs exist. Checks/orders are not covers. Covers and table-turn events are missing. Food-cost ratio must identify its sales denominator. |
| R23 | Seats occupied/available, current wait, open tables | **Pending.** Requires R01/R02/R15. No invented live counts. |
| R24 | Kitchen tickets, average ticket time, Grill/Sauté/Fry/Cold timing | **Pending.** Requires R04–R08. |
| R25 | Low/critical ingredients, waste today | **Partial.** Same threshold, stock coverage and waste-event limitations as C21–C22. |
| R26 | Grill 41% slower than today's average | **Pending.** Comparable station-event cohorts and defined baseline are absent. |
| R27 | Ribeye cost rises 28% → 34% after supplier delivery | **Partial foundations.** Recipe cost/revisions and supplier review exist. Automatic receipt-to-recipe effective costing, price basis and matched comparisons are missing. Timing alone does not establish cause. |
| R28 | Friday 5–6 PM overstaffing relative to covers | **Pending as verified recommendation.** Aggregate labour exists; cover/clock/roster history and service-level comparison do not. |
| R29 | 7–8 PM table turns 19 minutes longer | **Pending.** Requires occupancy events and matched service cohorts. |
| R30 | Alfredo #4 seller, #1 contribution; improve menu visibility | **Pending as complete menu engineering.** Requires matched prices, mix, recipe/modifier costs and variable-cost allocation. Item ranking plus recipe cost is insufficient. |
| R31 | DoorDash weekly contribution 12 points below dine-in | **Partial / manual foundation.** Requires complete matched weekly dine-in/delivery cost and channel cohort evidence before asserting the comparison. |

## Dealership: intelligence and operations above the DMS

The requested strategy retains the DMS as system of record and adds unified intelligence, operational follow-up, forecasts and alerts. Manual records must not imply a replacement DMS or verified DMS feed.

| ID | Requirement | Current coverage | Remaining work and boundary |
| --- | --- | --- | --- |
| D01 | DMS systems of record: CDK, Reynolds, Tekion, PBS, Dealertrack | **Pending / external.** D1 sources are manual, CSV or legacy. | No production-ready adapter/auth/ingestion contract or reconciled live feed for these systems was found. Brand names do not establish access. |
| D02 | Unified records above DMS/CRM/service/parts/accounting | **Partial architecture.** Scoped industry/commerce records and D1 operations are foundations. | Automotive entity keys, source authority, effective dates, corrections/deletions, backfill, reconciliation and reliable refresh remain needed. |
| D03 | CRM leads, contact, owner, stage, follow-up | **Implemented / manual, D1.** Customer/contact reference, location, stage, assignee, next action and linked tasks exist. | No automotive CRM ingestion or outbound contact execution. Contact data is not messaging consent. |
| D04 | Lead source/channel and lost-opportunity reasons | **Partial.** Lost stage exists. | Dedicated lead-source attribution and structured lost reason/cohort are not in the lead model. Sale channel is only retail/wholesale. |
| D05 | Appointments and test drives | **Partial / manual, D1/D2.** Appointment scheduling/status and recorded attendance exist. | No dedicated test-drive vehicle/customer/time/status/outcome workflow. Attendance is not a test drive. |
| D06 | VIN, stock number, year/make/model, location, ownership | **Implemented / manual or reviewed CSV, D1.** Vehicle identity is separate from stock episode; active identity/stock uniqueness and scope guards exist. | These are not independently verified DMS facts without reconciled source evidence. |
| D07 | New/used/in-transit/trade-in inventory | **Partial.** In-transit/on-lot/offsite and owned/consignment/unknown are modeled. | Explicit new/used condition and a linked trade-in transaction/equity model remain incomplete. Ownership, location and preparation are separate concepts. |
| D08 | Aging, reconditioning/preparation, availability | **Implemented / manual, D1/D2.** Acquisition date, prep state/tasks, reservation/delivery availability and location-calendar aging exist. | Loaded-page aging is not the full dealership when paginated. Readiness is a recorded state, not mechanical/safety certification. |
| D09 | Inventory cost/value and holding cost | **Partial / manual.** Estimated/approved/posted evidence and complete-cost flags exist. D2 shows permitted owned posted costs by age. S1 estimates entered daily holding cost over explicit calendar dates. | No live floorplan feed/accounting valuation certification. Consignment stays outside owned value; unknown costs stay unknown. Avoid double-counting holding estimates and actual deal costs. |
| D10 | Desking: price, discounts, trade allowance/equity, fees, taxes, down payment, financed amount, term/APR, payment scenarios | **Pending as desking.** Asking/final sale amounts exist in D1; funding/contribution evidence exists in S1. | No quote worksheet, trade-equity/tax/fee engine, amortization/lease scenarios or lender-approved quote. Asking/sale amount is not a desking model. |
| D11 | F&I: loans, leases, lenders, warranties, GAP, e-contracts | **Pending / external.** S1 records funding/payoff/document/release evidence. | No credit application, lender decision, loan/lease servicing, F&I catalog, warranty/GAP execution or e-contracting. Funding review does not provide these. |
| D12 | Fixed operations: service appointments, repair orders, technician labour | **Pending / external.** General preparation tasks exist. | Preparation tasks are not repair orders, customer-pay/warranty labour, dispatch or technician clocks. Sales appointments are not service scheduling. |
| D13 | Parts: quantities, compatibility, aged stock, repair-order linkage | **Pending as automotive parts operations.** General product inventory exists. | No fitment graph, automotive parts/core workflow or repair-order parts issue linkage. SKU stock alone is insufficient. |
| D14 | Accounting: vehicle sale, inventory, revenue, COGS | **Partial operational evidence, D1.** Delivery snapshots amount/reviewed costs for gross. BookLoQ is separate. | D1 does not post journals. Delivery is not proof of revenue recognition or inventory/COGS posting. Reconciled DMS/ledger mapping remains pending. |
| D15 | Trade inventory, loan receivable, commissions, F&I accounting | **Pending / external.** D1 sales allocation shares and S1 funding/payoff evidence exist. | Sales credit is not commission/payroll accounting. Full trade accounting, lender/customer receivables, commission accrual and F&I revenue/chargeback model are absent. |
| D16 | Reservation, preparation, delivery, reversals | **Implemented / manual, D1.** Exclusive reservation, readiness/cost checks, delivery and explicit reversal exist. | No title transfer, payment, contracts or legal certification. Late costs/accounting corrections remain separate authoritative workflows. |
| D17 | Funding, trade/floorplan payoff, customer contribution, release | **Implemented / manual evidence, S1.** Differences and required checks block completion. | Completion records review; it does not execute payout, obtain lender approval or validate legal documents. |
| D18 | Forecasts and alerts above existing systems | **Partial.** Due/blocked/unassigned task attention and bounded aging review exist; shared AI is separate. | Automotive forecasts, conversion/service-capacity/F&I alerts require missing models/feeds. An assistant cannot supply absent source facts. |

### Dealership analytics checklist

| ID | Requested KPI | Coverage and correct interpretation |
| --- | --- | --- |
| D19 | Units sold and vehicle sales | **Implemented operationally, D1.** Recorded deliveries/sales and reversals are separate by period/location/currency. Not certified accounting totals. |
| D20 | Front-end gross and average gross | **Partial.** Operational gross and eligible-unit average require complete reviewed posted costs; missing-cost units stay explicit. Not the full DMS front-end accounting definition. |
| D21 | F&I gross | **Pending.** Needs product income/costs, lender reserve, chargebacks, cancellations and timing rules. |
| D22 | Leads, appointments, test drives, lead close rate | **Partial.** Lead/appointment records and show rate exist. Test drives and linked lead-to-delivery cohort are missing. Show rate is attended ÷ (attended + no-show), excluding scheduled/cancelled, not close rate. |
| D23 | Inventory aging/value | **Implemented with bounds, D2.** Loaded active stock by age/currency, separate owned/consignment/unknown and known/reviewed cost coverage. Search/pagination scope stays visible. |
| D24 | Days to sale | **Pending as delivered-cohort KPI.** Acquisition/delivery dates are foundations; active-stock age does not satisfy a matched, reversal-aware days-to-sale report. |
| D25 | Channel conversion | **Pending.** Needs lead source, stable opportunity/outcome links and matched denominators. Retail/wholesale sale channel is insufficient. |
| D26 | Sales representative workload | **Partial / manual.** Assigned leads/tasks, overdue work and credits support work distribution. They are not a fair performance ranking or verified capacity measure. |
| D27 | Technician utilization | **Pending.** Needs paid/available technician time, productive clocked labour, repair-order state and a defined denominator. Task counts cannot substitute. |

## Current additional food measures

F3 now exposes reviewed batch yield/production loss by recipe/currency, service-period labour and late-order ratios, and delivery provider/currency contribution and settlement review. It excludes drafts/cancelled records, uses the highest loaded version per record, retains source detail links and shows partial-page warnings. Missing quantities/costs and invalid denominators remain unavailable.

The date filters deliberately differ: batch preparation date, service business date, and delivery source as-of date. “Location today” uses the configured location timezone. Service periods are shown separately because their windows can overlap; their sales are not summed and their ratios are not averaged. These additions close presentation/analysis gaps for reviewed records, not KDS, occupancy, POS depletion or autonomous forecasting requirements. Tests reported by the implementing agent are separate evidence; this audit only inspected the source.

## Cross-cutting requirements

| Requirement | Current treatment | Release implication |
| --- | --- | --- |
| Distinct operating models, not only themes | T1 capabilities; F1/S1 recipe/food-cost/production; D1 vehicle/stock episode/lead/sale | Structural separation exists. Restaurant tables/KDS and automotive service/parts still need dedicated models. |
| Source-backed, current numbers | Source/as-of/period/version/scope and missing values are retained | Entered historical evidence is not live. Last successful sync does not prove complete coverage. |
| Financial meaning | Tax/tips separate from food sales; waste already inside depletion; contribution separate from profit; gross cost eligibility; explicit currencies | Visually similar KPIs must not silently change denominators/cost bases. |
| Team/location/plan access | F1/S1/I1/D1 server-side scope and permission checks; cost/labour access separately gated | UI hiding is supplementary. New models/APIs must preserve these checks. |
| Concurrency/history | Versions, scoped uniqueness, revisions/events, replay records and atomic stock guards | External event ingestion needs its own replay/correction/source reconciliation contract. |
| Clear responsive industry UI | Shared dashboard plus specialized workspaces, explicit sample/source boundaries | This audit did not run desktop/mobile/accessibility acceptance. Mockups/navigation cannot close missing workflows. |
| AI recommendations | Existing assistant/insight surfaces explain supported inputs and route to sources | Each brief example needs the underlying matched data. Do not convert illustrative numbers into asserted customer outcomes. |
| General automation | W1 controlled workflows/outcomes and owner-authorized follow-up preferences | Generic tasks/notifications do not provide KDS dispatch, supplier execution, lender decisions or customer messaging consent. |

## Step-by-step completion and acceptance order

1. **Finish the bounded increment.** Review current food/dealer calculations against persisted records, preserving source/date/location/currency and incomplete coverage. Release owner runs targeted calculation/permission/interaction tests and desktop/mobile checks.
2. **Record source authority.** Identify exact café/restaurant POS/KDS/recipe/inventory/roster systems and automotive DMS/CRM/F&I/service/parts systems, available objects and permitted APIs/exports. Keep DMS/POS authoritative.
3. **Implement ingestion contracts before live labels.** Account/location mapping, IDs, timestamps, backfill, pagination, replay, deletions/cancellations/corrections, reconciliation and constrained live readback are required. A provider name or CSV import does not satisfy this gate.
4. **Complete café sale-to-recipe consumption.** Version item/size/modifier mappings, link stock and distinguish made-to-order from batch depletion. Test duplicate, void, refund, remake, offline replay and late correction without double-consuming prepared ingredients.
5. **Add restaurant service models/events.** Tables/seats, reservations/walk-ins/waitlist, service sessions/covers, servers, order lines/allergies/modifiers, courses, stations, expediter, bills/tips and reset need persisted records/provider mappings. Capture genuine events before timing KPIs.
6. **Complete waste/menu/channel economics.** Dated cause/item waste events, effective recipe/price costs, produced/sold/wasted reconciliation, fees/variable costs, complete cohorts and payout reconciliation are required. Preserve accounting/food-safety boundaries.
7. **Complete labour/capacity analytics.** Verified rosters, paid time, costs, covers and service constraints support FOH/kitchen and workload/coaching measures. Validate forecasts before issuing recommendations.
8. **Complete the automotive layer.** Source-linked lead attribution/outcomes/test drives, desking/F&I entities, repair orders/technician time, parts/fitment and ledger links remain required. Retain manual evidence/external IDs without implying replacement DMS capability.
9. **Add missing KPIs/AI after their inputs.** Conversion, F&I gross, days to sale, technician utilization, bottlenecks, table turns, occupancy forecasts and menu contribution need definitions, denominators and coverage tests. Unknown is not zero.
10. **Record production acceptance separately.** Exact commit/artifact, migrations, deployed release, authenticated access, authorized provider results and reconciled live responses are required. Preserve sample/live separation. Close each pending requirement only with matching evidence.

The [17-table workflow migration](../drizzle/0073_careless_daimon_hellstrom.sql) adds reviewed operating records and managed stock. It does not add dining/KDS event tables, a DMS ingestion layer, F&I contracts, repair orders or automotive fitment. These are substantive remaining work, not hidden activation switches. A successful build or migration alone does not complete the briefs.
