# BookLoQ financial and dashboard review

Reviewed September 16, 2026. **Share with caveats. Coverage: Partial. Changes made.**

The reviewed financial workflows are suitable for a supervised pilot with the limits below. This is not certification of every integration, device, accounting treatment or production transaction. No fictional financial records were added to the live retail workspace.

## Completed changes

1. **Cash obligations and timing. Fixed:** overdue unpaid obligations no longer disappear from the cash plan. Daily closing cash determines the minimum, independent of the order of same-day events. Expected receipts remain separate from confirmed cash capacity.
2. **Budget comparisons and restricted access. Fixed:** actuals follow each budget's date, location, department and currency scope. Revenue performance and expense headroom are labelled separately. Complete-ledger output also requires receivables/payables access. Unavailable account balances remain unavailable instead of becoming zero.
3. **Matching and exports. Fixed:** pending transactions and mismatched currencies or data modes cannot be confirmed against bills or invoices. Draft invoices are excluded. Matching alone never posts a payment journal. CSV headings distinguish budgets from general-ledger reports, and export permissions apply to the visible controls.
4. **Dashboards. Added:** BookLoQ has 30-day, 90-day and 12-month cash views, selectable chart points, exact supporting tables, period totals, category observations and review coverage. The existing main dashboard's selected historical record was checked against its table. A banking timestamp conversion that displayed an incorrect year was corrected. Missing current-day records are not represented as a feed failure or fabricated sales.
5. **Bank statements. Added:** Documents includes Bank Statement as a document type. Banking and Reconciliation offer a three-step review and import path using a clean uploaded original, one manual cash account, a statement period, balances and reviewed transaction rows. Imported movements feed historical cash activity and the permitted AI aggregate context. They do not create current bank availability, sales, expenses, profit or journal entries by themselves.
6. **Correction and privacy. Added:** an unused statement import can be undone with a reason and typed confirmation. The source PDF and account remain. Posted, matched or reconciled movements block undo. AI receives only permitted dated aggregate cash values; document text, transaction descriptions, bank names and account digits are excluded. The expanded AI notice requires a fresh affirmative acceptance before the new aggregate context is used.

## Statement import boundaries

- Supported now: one complete cash-account statement per document, 1 to 500 nonzero movements, one workspace base currency and a manual statement account. Credit-card and loan statements are not supported by this cash-account import.
- The opening balance plus deposits minus withdrawals must equal the closing balance exactly in cents. Rows must fall inside the statement period and use valid dates. A balanced equation does not establish correct categories or an accountant-approved reconciliation.
- Only clean documents in the same workspace are eligible. Preview does not write financial records. Confirmation requires the same reviewed fingerprint. Replayed imports do not duplicate transactions, and overlapping periods on the same account are rejected.
- OCR tables are editable drafts. Review every date, description and signed amount against the original. Nonstandard date formats or extraction layouts may require manual correction.
- When any approved live Plaid source is active, statement activity is withheld from combined cash charts until account-level overlap can be resolved. This conservative boundary can exclude a separate manual account; it prevents claiming that duplicate-source mapping is complete.
- Outflows support expense review only after appropriate categorization. Transfers, loan principal and other balance-sheet movements are not automatically expenses.

## Verification scope and limits

Independent cent-based calculations covered ledger balances, contra accounts, tax/cash distinctions, overdue obligations, daily minima and scoped budget comparisons. Isolated database and built-API acceptance covered statement permissions, tenant isolation, clean-file evidence, duplicates, overlap, preview/confirmation, cash totals, AI projection and guarded undo. A fictional statement with CAD 400 in and CAD 150 out produced CAD 250 net movement, with an opening CAD 1,000 and closing CAD 1,250. It produced no journal entries or claimed current bank balance.

Desktop and 390 px phone layouts, period switching, chart inspection, required fields, source selection, statement review fields and undo controls were inspected. The embedded browser's native date picker crashed during the final form traversal. The final confirmation screen therefore remains unverified through that browser, although the server preview, confirmation and undo paths passed isolated acceptance. This is not a claim of physical iOS or Android certification.

The main dashboard was also inspected in the authenticated owner workspace. Historical chart values agreed with the corresponding table row. This establishes the application display path, not reconciliation to an external POS settlement report. No real statement was imported or undone during this review.

## Remaining active integrations

Provider administration status below was last observed September 15. The source and capability boundaries were reviewed September 16. These are not fresh provider-dashboard acceptance results. Coming-soon services are excluded.

| Integration | Remaining work |
| --- | --- |
| Plaid | Complete the security questionnaire, receive production approval, configure matching production credentials and reconcile a real Canadian institution sample. The last verified deployment was sandbox. |
| QuickBooks | Implement and reconcile the ledger import adapter, then complete production review and credentials. Existing company authorization alone does not import the ledger. |
| Shopify / Shopify POS | Finish app registration/listing review and authorize a real merchant. Validate location mapping, history, refunds and privacy events before advertising general production availability. |
| Moneris | Obtain the correct production read-only reporting access and reconcile a settlement sample. Current evidence is sandbox. |
| Clover | Confirm production app availability and complete real-merchant acceptance. Current evidence is a test merchant. |
| Lightspeed X-Series | Authorize a real merchant, map outlets and reconcile an approved sample. Callback health was verified; there were no merchant connections. |
| Lightspeed R-Series | The pilot is connected and historical records display. Complete backfill and reconcile a full source day and settlement coverage. A closed store can legitimately have no new sales. |
| Square / Stripe merchant reporting | Complete business-specific authorization, location mapping, history approval and source reconciliation. Test Square records remain excluded. Merchant reporting is separate from subscriber billing. |
| Google marketing | Locate the project owning the Vanteloq OAuth client, complete any Ads access requirements and select only resources belonging to the reported business. Then verify real reports. |
| Meta marketing | Complete app configuration, required permissions/review, business authorization and report acceptance. |
| Stripe subscriber billing | Isolated hosted checkout, signed events, plan/BookLoQ access and cancellation passed earlier acceptance. Fresh signup/email/MFA and production webhook delivery still require hosted acceptance. No real charge was made. |
| Document email forwarding (optional) | Configure inbound delivery and workspace routing. Manual upload and Azure Scan and Read already exist. |

## Prioritized remaining launch gates

1. **Production provider acceptance. Needs input:** provider approvals and merchant records are required for the integration steps above. Keep catalogue descriptions limited to actual availability.
2. **Recovery. Needs verification:** perform an isolated restore of the Sites-managed business database and document store. Supabase backups cover authentication infrastructure, not these business records. Record recovery time and file integrity, and confirm operational alert ownership.
3. **Accounting acceptance. Needs review:** have an accountant review a real pilot close, opening balances, bank reconciliation and tax working papers before treating BookLoQ as authoritative books.
4. **Hosted subscriber acceptance. Needs verification:** complete a genuinely new customer's verification/MFA cycle and production billing endpoint delivery. Prior test billing and a returning customer's sign-in do not prove this entire journey.

See [provider activation evidence](provider-activation-review-2026-09-15.md) and [V1 launch review](v1-launch-readiness-2026-09-15.md) for the retained observations. A limited assisted pilot is the supported launch scope until these gates close.

## Dashboard best practices and quality

Counts below come from the retained component-level coverage record. They describe the scoped inventory, not complete verification. `0 / N` means no remaining demonstrated defect was observed, not that every item passed every possible check. An unknown denominator preserves the broader unreviewed scope.

| Category | Observed defects | Assessment |
| --- | --- | --- |
| Usefulness and completeness | 0 / unknown | Charts, reviewed imports and correction exist. Production activation, recovery and final browser confirmation remain incomplete. |
| Analytical clarity | 0 / 6 | Cash movements, forecasts and ledger profit remain distinct. Final statement confirmation rendering was not traversed. |
| Visual and interaction consistency | 0 / 4 | Desktop/phone charts, period controls, statement fields and undo inspected. The embedded date-picker crash limits final form traversal. |

## Analytical correctness and robustness

| Category | Observed defects | Assessment |
| --- | --- | --- |
| Source authority and confidence | 0 / unknown | Synthetic controls and live display checks support the reviewed behavior. Provider reconciliation, recovery and accountant acceptance remain incomplete. |
| SQL and value accuracy | 0 / 6 | Independent cent-based calculations and isolated database/API checks cover the financial corrections. |
| Within-chart agreement | 0 / 4 | Selected points, period totals and supporting tables use matching scoped records. |
| Complete source details | 0 / unknown | Dates, source type and missingness are disclosed. External provider acceptance remains incomplete. |
| Cross-artifact consistency | 0 / 3 | Reviewed movements reach cash charts and permitted AI aggregates without being described as sales or profit. |
| Data-quality controls | 0 / 8 | Tenant, permission, clean-document, currency, duplicate and correction guards tested. The restore drill is still unverified. |
| Conclusion support | 0 / 7 | Missing current cash and profit remain unavailable. A real pilot close still requires accountant review. |
