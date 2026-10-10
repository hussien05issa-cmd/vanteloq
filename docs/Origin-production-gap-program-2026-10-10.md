# Vanteloq 1.0 Origin: production gap program

This supporting engineering record accompanies the canonical `Vanteloq-v1.0-Origin.md`. It distinguishes current source, local validation, hosted evidence and provider approval. It does not certify accounting accuracy, legal compliance or universal readiness.

## Phase 0 baseline

- Site: `appgprj_6a6fac5e42a08191b37108223fc4b205`, public at https://vanteloq.com.
- Live version 347, source `69e745b44629e55fa26a0bd8ab6d430c9c1e3d17`; deployment `appgdep_6acab7cdbfa08191b4c442f7d04261c3` succeeded, environment revision 64.
- Exact checkout was clean and reopened through the official Sites source workflow. The earlier version 345 and uncommitted-import descriptions in the supplied brief are historical. Preserve the committed upload hub and server-enforced import acknowledgement.
- Hosting declares D1 `DB` and R2 `BUCKET`. Secret values were not exposed. Configuration names do not prove providers or processing are operational.
- Sites reports no linked automations. A normal signed scheduler tick may invoke provider reads, authorised document cleanup and opted-in communications. It is unsuitable as an inspection-only canary.
- The available hosting connector does not expose a production migration ledger. Source migrations and a successful deployment are not proof of individual production applications. Applied migration status is **unverified**. Do not reset the database, rewrite old migrations, or introduce new financial schema until a populated migration/recovery path is verified.
- Existing manual journal reversal is implemented; an older handover's broad future-reversals statement needs qualification. Existing invoice matching is not settlement or ledger posting. BookLoQ currently renders cumulative reports, while the executive finance module already supports dated activity and closing balances.

## Implementation matrix at baseline

| Workstream | Classification | Existing contract and concrete gap |
| --- | --- | --- |
| Scheduling | Implemented but not production verified; partial | HMAC, timestamp, nonce and leases exist. Wrong-purpose/stale consent may authorise background sync; no durable tick completion receipts or proven external recurrence. |
| BookLoQ | Partial | Exact posted journals, reversals and close controls exist. Dated report UI, full postings/allocations, cash-basis transformations, FX, assets and dedicated accountant review remain incomplete. |
| Three industry pilots | Implemented locally, hosted/provider verification incomplete | Retail economics, reviewed recipe/waste and reviewed vehicle stock/deal flows have isolated source contracts. They do not replace POS, payroll, food-safety, lending or DMS authority. |
| Metric readiness | Partial | Shared integration readiness and authoritative-source selection exist. Location aggregates bypass authority and truncate without disclosure; catalog readiness and downstream coverage remain inconsistent. |
| Customer intelligence | Partial | Observed repeat behaviour, scoped identities and concentration exist. Longitudinal cohorts, RFM, LTV assumptions and messaging eligibility require explicit history/identity readiness. |
| Multi-business/location | Partial; general additional-business creation missing | Membership switching and role/location checks exist. Unique user membership requires a coordinated migration for additional businesses. Comparable trading calendars are incomplete. |
| Reports | Partial | Permission-safe date/location CSV, evidence and task links exist. Saved/delivered archives, share links, XLSX/PDF, consistent readiness metadata and dated BookLoQ drilldown are incomplete. |
| Collaboration | Partial | Scoped messages, cursor history, discussions, idempotency and polling exist. Empty refresh retains deleted messages; tasks silently cap at 200. Realtime, mentions, read state and approvals are incomplete. |
| Document intelligence | Configuration dependent; hosted execution unverified | Quarantine and explicit scan/extraction lifecycle exist. Configuration alone proves neither malware scanning nor OCR. HEIC/TIFF are disabled, not silently supported. |
| Read-only MCP | Missing; authentication bridge blocked | Public proxy identity headers cannot satisfy verified Supabase AAL2. Do not bypass session checks or map a matching email into an agent grant. Requires a revocable, scoped authentication bridge and verified hosting contract. |
| Public proof/activation | Partial | Fictional demos and source caveats exist. Consented funnels, permissioned case-study records and verified customer outcome evidence remain incomplete. |

## Safe release order

1. Correct source/coverage boundaries and background-consent validation; add inspection-only scheduling without enabling external actions. Repair collaboration recovery and truncation. No new financial writes or schema changes.
2. Add dated/as-of BookLoQ reporting using existing ledger rules, with exact currency, basis and source metadata; no payment or posting automation. Verify desktop and mobile controls.
3. Extend shared metric readiness into reports/exports and customer-history eligibility. Add derived customer analyses only when the observation and identity contract supports them.
4. After production migration/recovery evidence and a supported unattended auth path: durable schedules, saved/delivered reports, agent grants, additional-business creation, accounting allocation history and remaining stateful workflows.
5. Finish provider acceptance and read-only canaries independently, without changing unsupported availability badges.

## Provider readiness matrix

| Provider | Current public status | Evidence required before additional claims |
| --- | --- | --- |
| Square; Lightspeed R-Series | Available connection flows | Reverify resource selection, mapping, historical/incremental pagination, duplicate/correction/refund handling, source review, revocation and unrelated-tenant canaries. |
| Slack | Available connection flow | Reverify channel authorisation, bounded history, disconnect and tenant isolation. No new messages without explicit permission. |
| Financial connector | Production choice not yet established | Plaid production/Canadian institution coverage or another independently verified bank/accounting source; a configured credential is insufficient. |
| Clover, Deel, Google, X-Series, Meta, Moneris, QuickBooks, Shopify/POS, Stripe reporting | Gated pending independent production evidence | Provider access/acceptance plus a completed, reconciled reporting path. Billing Stripe is a separate product flow. |
| Xero; DoorDash; Uber Eats | Missing implementation or partner gate | Implemented source contract and authorised partner access, respectively. |

## Evidence register

Phase 0 pure checks: metric/industry/business/location/provider-report domains 56/56; BookLoQ, invoice arithmetic/rendering/document provider contracts 48/48; scheduler policy/timezone/collaboration domains 10/10. These are local checks, not provider acceptance. D1-backed audit fixtures could not start in the sandbox Workers runtime; later necessary cases must use the authorised local runtime and report actual outcomes. Live desktop/mobile verification is pending, using fictional local fixtures where needed. No real payments, customer communications or provider business records were changed.

## Recovery and monitoring rules

Retain exact source, saved version, deployment and environment revision for every release. Roll back application code only to an identified compatible saved version; this does not undo database writes. Never reset or delete production to repair a migration. Disable an affected optional schedule/connection through its owner-controlled settings, investigate the error receipt, revalidate current consent and source authority, then retry with the existing idempotency contract. Partial or missing source data must remain unavailable, not zero. Keep notices, freshness, suppressed actions and retry limits visible. Do not enable scheduled messages, financial actions or destructive cleanup as a side effect of a canary.

## Must not yet be marketed as proven

Unattended production recurrence, automatic invoice/bill posting or payment allocation, complete tax/payroll/FX/asset accounting, longitudinal retention without sufficient history, live OCR/malware extraction without a hosted receipt, multiple self-created businesses, operational agent access, unapproved provider connections, universal legal compliance or complete production restoration. Local tests and credentials alone cannot establish these claims.

Release-specific implementation, deployment and remaining-gap receipts will follow below after verification.

## October 10 bounded implementation receipt

Implemented source boundaries, recovery, dated read-only reporting and collaboration without new migrations or financial writes. Scheduler inspection records nonce/audit metadata only and starts no external actions; actual hosted recurrence is not claimed. Locations withholds mixed-currency monetary totals. Reports discloses unresolved currency alignment and withholds incomplete or incompatible comparisons; provider costs remain unavailable without evidence. BookLoQ reads exact posted accrual ledger records, preserves own-date reversals, protects sensitive detail and includes metadata in CSV. A trial-balance CSV mismatch found during independent review was corrected to match the screen's net balances.

The final keyboard/tablet pass identified a close-focus gap in the new BookLoQ account drill-down. The follow-up restores focus to its originating account button only when the same report context remains valid and the user has not deliberately moved focus elsewhere. Scope changes cancel pending restoration. The exact follow-up verification and publication receipt are recorded separately; these checks do not verify subscriber billing, third-party approval or a populated production ledger.

Local evidence: 17 location cases, 14 report readiness/provenance cases, 33 BookLoQ accounting/rendering regressions, 18 executive loading/recovery cases, 5 collaboration domain cases, 6 request-deadline cases, and import/privacy plus missing-cost chart regressions passed in their focused runs. Independent review identified and corrected stale report scope, task-page polling, burst-message history and CSV balance defects. Final aggregate checks and built-Worker fixtures are recorded in the publication receipt, not inferred from these counts.

Authenticated live version 347: the Supplement World owner workspace was inspected in the selected tab. Import reports opens authorised import destinations. Sales CSV cannot be saved before its current privacy acknowledgement; no real files were imported. The executive request showed a persistent refreshing state alongside server 409 authority conflicts and 503 source-sync gates. The new client recovery path must be read back after publication; these logs do not establish a database migration fault.

Fictional desktop/mobile component review verified 207 accessible tasks through pagination, deleted-message empty recovery, location coverage expansion and dated BookLoQ journal drilldown. These are synthetic records outside production. Remaining limitations and provider status above are unchanged; no connector was relabelled Available by this increment.
