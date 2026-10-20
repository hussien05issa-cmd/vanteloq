# Business workflow implementation

Updated 4 October 2026. User-approved scope: implement the findings from the source and primary-documentation review while preserving existing financial, provider, privacy and access boundaries.

**Current status:** implemented in the working source with focused local and isolated runtime verification. The integrated build, artifact validation and typecheck have passed. Remaining presentation checks, publication and GitHub/source synchronization are separate gates and are not marked complete by this document. Existing production records and subscriptions were not changed by the isolated tests.

## Implemented workflows

The Operations screen keeps Tasks & priorities and adds relevant, lazily loaded tools. Stock & purchasing appears only with the product capability, inventory plan access and both inventory-view/value permissions. Sector labels adapt to the business: Prep & service, Orders & delivery, Funding & handover or Rooms & stays. Work & results provides the permitted general workflows; Daily briefings is an owner control. BookLoQ exposes collection follow-up alongside its existing receivables work. The server independently checks plan, role, permission and location scope.

| Business or job | Implemented working flow | Decision and boundary |
| --- | --- | --- |
| Retail receiving | Explicit opening count, count corrections, partial PO receipt, accepted/rejected quantities, source reference, immutable movements and receipt reversal | Accepted quantities update the separate managed-stock balance and PO received quantity atomically. Rejected quantities do not add stock. An impossible negative-stock reversal is refused. Connected POS balances are unchanged. |
| Supplier planning | Reviewed observed demand, usable stock, confirmed inbound/committed units, lead/review days, safety stock, case pack, MOQ, cash, storage and usable shelf-life limits | The proposal rounds to cases and obeys the entered limits. An infeasible MOQ yields no feasible proposed order. Missing limits are visible. The calculation does not send a PO, model lost sales or certify safe shelf life. |
| Purchasing exceptions | Invoice line review against the saved PO, its accepted quantity and agreed unit cost; retained review history | Trusted PO facts replace submitted claims. Quantity and unit-price differences remain separate. Review does not create, approve or pay a supplier bill. |
| Supplements and grocery | Best-before quality review distinct from actual expiration; dated lot action cases, affected units, responsible person/next action, evidence link, resolution and recorded credit | Actual expired inventory retains its quarantine recommendation. A past best-before date alone does not imply unsafe food. Choosing quarantine applies to the whole linked lot. Closing a case does not release stock, subtract a supplier return or post a credit. |
| Clothing | Style/variant/size/colour cohort records, matched sales and returns, fit/defect/other reasons, inspection disposition and refund evidence | Return rate uses the matched sales cohort; the remaining return window and missing reasons stay visible. It does not automatically restore stock or infer margin loss. Existing product records remain the source of availability. |
| Café preparation | Source-linked preparation plans and production batches with recorded recipe version, ingredients, output, measured cost and reviewed dates | Batch review consumes and produces explicitly opened managed-stock positions in the same transaction as approval/history. Reopening or cancelling a reviewed batch reverses those movements; insufficient remaining output blocks reversal. It does not change a POS or post a journal. |
| Restaurant service | Service-period expected/actual sales, planned/paid minutes, wage costs, order counts and late orders; supplier receipt/credit review | Sales per paid hour, labour ratio and late-order rate require complete coverage and valid denominators. These are reviewed operational inputs, not payroll calculation or automatic staff scheduling. |
| Delivery orders | Provider order and settlement references, net food sales, remitted taxes/tips, withheld fees/adjustments, allocated payout and variable costs | Expected settlement and contribution are separate. Taxes/tips do not become food revenue. Contribution excludes fixed overhead, and each payout allocation requires review. |
| Furniture and appliances | Customer order and specification, linked supplier PO, received deposit, remaining payments, supplier cost, delivery date/status and acceptance | Completion requires delivery acceptance and either a settled balance or reviewed credit terms. It records evidence without collecting money, dispatching goods or automatically allocating customer payments. |
| Dealership | Funding and release record linked to an existing stock episode; expected/received lender funding, trade/floorplan payoff, customer contribution, optional reviewed daily holding-cost period and document/release checks | Unresolved differences block completion. Holding cost is an exact constant-rate estimate, separate from posted actual costs. No lender connectivity, credit application, accounting accrual or legal title/document certification is implied. Existing vehicle, preparation and delivery controls remain. |
| Professional services | Approved client scope/changes, time and work status, direct costs, milestones, reviewed revenue and actual BookLoQ invoice references | Shows completed work still needing invoicing, direct cost, job contribution and linked outstanding balances. Missing costs stay unknown; job contribution is not company net profit. Saving a job does not send an invoice or recognise revenue. |
| E-commerce and product businesses | Payout components with provider transaction references, bank amount/reference and mapping type; order-level refunds, shipping, COGS, recovered stock cost and variable costs | Settlement reconciliation does not count a bank deposit as additional revenue. Contribution requires reviewed cost coverage. Refunds and confirmed resaleable stock recovery are distinct. |
| Hospitality | Room readiness, inspection/block/occupancy state; reservation/folio references, room nights, arrival/departure, payments and recorded AR transfers | Reviewed bookings prevent overlapping room-night claims. Check-in requires a current inspected, unblocked, unoccupied room. Active folio amendments preserve stay identity; departure requires a resolved balance and marks the room dirty. No PMS feed or payment execution is implied. |
| All supported businesses | Controlled custom checklists and action-outcome records | Supported checklist types identify an owner, trigger, due date, required evidence and next action. Outcome reviews retain comparable baseline/follow-up periods, target, intervention cost and a trade-off measure. They do not run arbitrary code or establish causation. |
| Collections | Invoice-linked contact history, payment promises, dispute ownership, next action, pause and reminder approval | Promises do not record payment. Reminder eligibility is checked against current invoice status, balance, recipient, dispute and contact interval. Collection history is not an automated debt-collection service. |

## Calculation and integrity controls

- Monetary inputs use validated currency scales and integer minor units. Inventory monetary review records currently require a two-decimal currency. Managed-stock quantities use integer thousandths with explicit `each`, `g` or `ml` units. No density conversion is assumed.
- Managed stock begins with a reviewed count, never an automatic copy of a provider snapshot. Every receipt/correction records its source and business date. Backdated changes cannot silently alter a later count. Even an unchanged count advances the stock version and invalidates pending changes.
- Receipt changes, line quantities, stock balances and retry receipts commit in one atomic D1 batch. Guards reject changed PO quantity/cost/SKU, stale stock versions, duplicate source references, over-receiving and negative balances. The shared preparation helper must remain in the caller's same atomic business transaction.
- Supplier need uses observed units per in-stock selling day over lead plus review days, with entered safety stock, less usable on-hand plus inbound less commitments. Case/MOQ rounding and cash/storage/shelf-life caps are explicit planning assumptions, not externally verified demand forecasts.
- The optional vehicle holding-cost estimate multiplies an entered daily minor-unit amount by whole calendar days, including the start and excluding the end. The date calculation is DST-independent, the end cannot exceed the source as-of date, and incomplete rate/period inputs block approval. All three absent leaves cost unknown; an explicit zero remains zero. It does not post an expense or add itself to deal profitability. Avoid double-counting actual costs already included in the deal.
- The same workspace and location scope applies to drafts, reads, writes, references and history. Sector source approval checks the saved recipe/vehicle/room version again within the write transaction. Missing or changed evidence requires another review.
- Draft, review, completion, reopening and cancellation have explicit permitted transitions. Original movements and revisions remain available; a correction does not silently erase the original record.

## Owner-authorized scheduling and email

All new opening, closing, briefing-email and invoice-reminder preferences default to **off**. A verified Supabase workspace owner must review and save the service grant. Current owner identity, membership, subscription/add-on, preference version, approved email and account-deletion state are checked again by the scheduler. The stored grant does not fabricate a user session or an MFA claim.

Opening and closing slots use the workspace time zone and saved operating hours, with up to 40 exceptional dates, closures, lead/delay minutes and quiet hours. Stable business-date keys prevent repeated-hour duplicates; the calculation accounts for overnight opening periods and daylight-saving transitions. The worker attaches to the existing signed scheduler, which validates its signature and nonce. This source wiring alone does not prove that a production scheduler is delivering these new jobs.

Owner briefings use supported saved overdue invoices, bills and tasks. The in-app summary states its preparation time and its limits. Optional email is a sign-in notification without customer or financial figures. Absence of supported overdue records is not a sales-completeness or bank-balance all-clear.

Customer invoice reminders additionally require workspace reminder opt-in and owner approval for each real invoice and its saved recipient. Changed recipient/total/currency, payment, dispute, future promise, pause, plan/access loss or changed authorization can suppress a pending send. Team members with appropriate roles may maintain notes or pause reminders; they cannot silently approve a new recipient or widen frequency. Demonstration invoices are ineligible.

Delivery uses the existing configured Resend sender, bounded leases, stable provider idempotency keys, at most four attempts and a 12-hour expiry. States distinguish in-app readiness, pending/failed/suppressed attempts, provider acceptance and the owner's in-app acknowledgement. **Provider acceptance does not prove mailbox delivery or reading.** No real customer reminder or owner schedule was enabled by the synthetic tests. Production mail configuration and an authorized delivery check remain operational evidence gates.

## Database and route additions

`drizzle/0073_careless_daimon_hellstrom.sql` is an additive generated migration with 17 tables. It does not reset production data, backfill customer activity or rewrite an applied migration. Its snapshot is `drizzle/meta/0073_snapshot.json` and it is registered in the migration journal.

| Module | Added tables |
| --- | --- |
| General work | `business_workflow_records`, `business_workflow_revisions` |
| Collection and delivery | `collection_followups`, `collection_followup_events`, `workflow_delivery_preferences`, `workflow_deliveries` |
| Sector operations | `sector_operation_records`, `sector_operation_requests`, `sector_operation_revisions`, `sector_room_nights` |
| Managed inventory | `workflow_inventory_positions`, `workflow_inventory_movements`, `workflow_inventory_receipts`, `workflow_inventory_records`, `workflow_inventory_history`, `workflow_inventory_mutations`, `workflow_inventory_guards` |

The tables preserve scoped uniqueness, versions, JSON/quantity constraints, foreign keys and the atomic write guards required by their module. Room-night uniqueness is enforced in the database. Managed-stock source references and mutation keys prevent duplicate changes.

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /api/v1/business-workflows` | Scoped job, payout, order contribution, outcome and controlled checklist records, transitions and history |
| `GET/POST /api/v1/inventory-workflows` | Scoped stock, receipts, supplier/lot/returns/invoice reviews and history |
| `GET/POST /api/v1/sector-operations` | Scoped preparation, service, delivery, furniture, dealer and room/stay records and history |
| `GET/POST /api/v1/workflow-followup` | Collection notes, owner delivery preferences, delivery history and acknowledgement |

All new API mutations retain authentication, same-origin enforcement, rate limits, applicable feature/permission checks and audit events. Scheduler execution is private and uses the existing signed entry point, not a public customer action endpoint.

## Privacy and retention changes

Privacy policy version is **2026-10-04**; Terms of Service remains **2026-10-01**. The updated policy describes workflow source references, quantities, costs, responsible people, review history, inventory movements, batch records, room/stay dates, invoice follow-up and delivery attempts. It distinguishes manual evidence from completed external actions, and describes separate managed stock and owner-approved delivery. Existing legal-acceptance version checks remain applicable; changing text does not create a compliance certification.

Applicable workspace deletion removes the operating records and revision history. Account-only deletion retains shared employer evidence while clearing the removed member's actor references; owner delivery preferences and queued delivery records are removed for that account. No automatic age-based purge of operating history is claimed. Free-text references and downloaded evidence still require the operator's data-minimization and retention process. This increment does not introduce a universal workflow export or automate every customer-data request.

## Interface and motion

The new panels use scoped styles, readable navy text, consistent single-column forms, labelled inputs, minimum touch-target sizing, visible loading/error states and explicit source boundaries. Tabs and disclosures defer module loading until needed. Forms preserve entered values after a failed save and require refreshed review after a conflicting revision. Focus returns after closing inventory forms, and reduced-motion preferences disable nonessential motion.

The homepage's industry preview illustrates the relevant workflow with fictional records and interactive stages. It is not evidence of a live connector, actual customer metrics or an executed external action. Browser review of each complete workflow remains distinct from testing its domain and API.

## Verification register

This register records known results at this document update. Do not combine overlapping batches into an invented total.

| Evidence | Confirmed result | Scope / limit |
| --- | --- | --- |
| Inventory and deletion batch | **35/35 passed** | 24 inventory/date/calculation/SQLite/real Miniflare D1 cases plus 11 account-deletion flows. Includes receipt/reversal atomicity, replay, changed stock, tenant/location rejection, account-only actor removal and workspace cascade. |
| General business workflows | **6 domain tests and 1 isolated flow passed** | Formula/validation and source-linked record transitions; synthetic inputs, not production data. |
| Follow-up and delivery | **6 domain tests and 8 isolated flow tests passed** | Opt-in, schedule dates, authorization, invoice changes, retries and privacy boundaries; no real customer send. |
| Sector operations | **10 domain tests and 4 final isolated flow tests passed** | Final-build D1 flows include persisted/reloaded/reviewed/reopened holding-cost evidence, five days × CAD $12.34 = CAD $61.70, and rejection of partial inputs. Domain cases include leap/DST dates, zero, unknowns and overflow. |
| Combined regression batch | **41/41 passed** | General work, follow-up, homepage, migrations, sign-in and onboarding. Saved outer-workspace log: `output/business-workflow-regression-2026-10-04.log`. This overlaps component results above. |
| Existing rendering/motion/presentation | **9/9 passed** | Focused pre-existing rendering and motion contracts after narrow UI lint repairs. |
| Final domain/UI batch | **22/22 passed** | Final focused domain and UI regression batch, reported separately because component coverage overlaps. |
| Lint | **Zero errors; 17 pre-existing warnings in the full pass** | Inventory changed-file lint separately passed with zero errors. Final changed source still needs the final integrated gate. |
| Integrated build, artifact and TypeScript | **Passed** | Includes the final holding-cost implementation. The last workflow-heading/select-caption correction changes presentation only; the release owner will rebuild that final presentation before publication. |
| Narrow stock UI | **390px save and cancel passed** | Local fictional managed-stock interaction; does not certify every mobile form. |
| Homepage preview | **Desktop keyboard and narrow layout checks passed** | Enter advances the workflow; a 390px viewport has 375px content width without horizontal overflow. Motion-off disables playback and preserves manual stepping. Café/hospitality switching was checked. Other complete workflow acceptance remains pending. |
| Production migration / publication | **Pending** | Isolated migration success is not proof that 0073 has been applied to production. |
| GitHub/source synchronization | **Pending** | Record the exact final commit and remote confirmation separately. |

Relevant test files: `tests/workflow-inventory.test.ts`, `tests/inventory-lifecycle.test.ts`, `tests/workflow-inventory-flow.test.ts`, `tests/workflow-inventory-d1.test.ts`, `tests/account-deletion-flow.test.ts`, `tests/business-workflows.test.ts`, `tests/business-workflows-flow.test.mjs`, `tests/workflow-followup.test.ts`, `tests/workflow-followup-flow.test.mjs`, `tests/sector-operations.test.ts` and `tests/sector-operations-flow.test.mjs`.

## Explicit remaining boundaries

This increment does not establish new provider approvals, automatic recall lookup, health-product licensing verification, nested recipe/POS depletion matching, supplier return shipment execution, automatic credit posting, a lender/floorplan feed, automatic holding-cost journal accrual, dealership late-cost accounting corrections, a PMS feed or arbitrary workflow automation. Manual records must be labelled and reviewed. Existing plan prices and customer access are preserved.

Actual production backup and isolated restoration of current records/files remain governed by the existing recovery register. No production reset or restore over the live database is authorized by this change. Legal certification, zero-defect guarantees, unlimited capacity and general competitor superiority are not claimed.

## Final release evidence to complete

- [x] Final sector flow result recorded.
- [x] Integrated lint/typecheck/build/artifact result recorded.
- [ ] Final presentation-only rebuild after the workflow copy correction recorded.
- [ ] Remaining desktop/mobile keyboard, form recovery and reduced-motion checks recorded.
- [ ] Hosting version/deployment, migration result and post-publication smoke checks recorded.
- [ ] GitHub commit and remote synchronization confirmed.
- [ ] Any real owner schedule or email delivery separately authorized and verified.

Publication / version: **pending**. Source commit / remote confirmation: **pending**. The release owner will record the deployment, migration readback, final source identity and remote synchronization in the outer workspace's final release report under `output/`. No publication receipt is implied here.
