# Free integrations and AI controls: 4 October 2026

**Status: implemented and locally verified. Production publication is recorded separately in the corresponding dated release receipt.** This report describes the inspected code and recorded isolated verification. It does not establish production provider approval, a successful customer bank connection, a microphone test, or completion of the BookLoQ master brief. Deployment identifiers and hosted checks belong in the subsequent release receipt.

## Free provider choices and server enforcement

Free includes **two available integration providers of the owner's choice**. Multiple accounts belonging to one provider use one choice. Stripe subscription billing is separate from the optional Stripe data connector and does not consume a choice. Free retains one owner, one active location, 100 supported CSV/manual daily sales records and 10 basic AI replies per calendar month. Choosing a connector does not grant paid BookLoQ, inventory, file-question or reporting features.

The catalogue is not an availability guarantee. New connections still require the provider's supported route, configured credentials, rollout eligibility, customer permissions and the applicable privacy/consent acknowledgement. Current Free-start readiness checks cover Square, Lightspeed R-Series, Slack and Plaid; the actual available choices depend on hosted configuration and rollout. Plaid additionally requires its production-readiness gate. No provider approval is inferred from this list.

`server/integrations/free-selection.ts` enforces the two-provider limit in a conditional database reservation, including competing requests. The reservation is tenant scoped and carries a unique grant generation. Reusing the same selection renews its short reservation without consuming another choice. Connected accounts, retained provider credentials and current authorization/exchange attempts keep the slot occupied. Abandoned attempts are revoked before their unused slot is released. Disconnecting one account does not release a provider that still has another occupied account.

Connection and callback checks bind current Free selections to their saved generation. A stale attempt cannot use a newly selected generation merely by omitting its connection ID. Callback continuation preserves the existing verified authorization context; it does not invent a fresh MFA claim. An unpaid or otherwise recoverable subscription does not fall back to Free to bypass billing recovery.

Plaid Link carries the selection generation through its response, browser session state and exchange request. Claim, credential persistence and finalization check the pending connection/version and expected selection. Failure cleanup targets the attempt's own secret; separate cleanup credentials can be retained when provider revocation fails. This is cleanup state, not a usable or approved reporting connection.

Additive migration `0074_blue_lucky_pierre.sql` creates `free_integration_selections` with a workspace foreign key and unique grant ID, and adds `integration_connections.free_grant_id`. It does not rewrite customer financial records. The release receipt records production application separately from local migration tests.

## Plaid cash in the overview and BookLoQ

The executive overview receives a separate **Latest connected bank cash** snapshot. BookLoQ uses the same balance-eligibility helper. The underlying reads correlate the authenticated workspace, approved current Plaid Item and its bank accounts, and exclude active synchronization leases. A replacement Item does not authorize retained accounts from the old Item.

The snapshot uses healthy, non-demonstration depository balances in the base currency, synchronized within 48 hours. Available balance is preferred, with current balance as the fallback. Credit availability, loans, unsupported currencies and demonstration records do not become cash. Recorded zero and overdrafts retain their actual signs. A missing, future-dated, unhealthy or stale relevant live account withholds the aggregate rather than presenting a favourable partial balance. Source timestamps describe eligible included accounts; BookLoQ's cash timestamp uses the oldest included balance.

The executive snapshot requires cash and bank-balance permissions and organization-wide scope with All locations selected. It requires the BookLoQ entitlement or an eligible Free workspace's selected Plaid provider. This Free snapshot does not unlock the BookLoQ workspace. BookLoQ retains its own entitlement, role, source-mode and financial permission checks.

Latest bank cash is separate from selected-period ledger cash, posted cash flow, revenue and profit. A current bank balance does not establish a historical trend, complete history, accounting earnings or purchasing capacity. The snapshot response therefore omits purchasing-capacity, reserve and obligation fields. Successful synchronization still stages the source for review; a connection alone is not reporting approval. Live provider round trips and institution coverage were not verified by this increment.

## AI appearance and the existing smile

AI Settings exposes **System, Light and Dark**. The preference is stored in the current browser's local storage, not synchronized as an account setting. System follows device colour changes; explicit Light or Dark stays fixed. Same-tab subscribers and storage events keep open instances consistent. If storage is unavailable, the selected appearance applies to the open page with a notice that it could not be saved.

The AI surface uses restrained purple for focus, typing, controls and status, with separate light/dark text, panel and border colours. Controls retain visible focus treatment, readable code/tables/source details and explicit disabled states. Reduced-motion and forced-colour rules remain supported. These source treatments are not a claim of a complete accessibility certification or exhaustive browser review.

The dashboard greeting reuses the existing `/brand/vantatalk-greeting-smile.png` artwork. A mask based on that same asset applies a single 650 ms glint; the smile is not redrawn. The image is 36 px, reducing to 30 px on smaller layouts. The glint is disabled for reduced motion, the app's motion-off setting and forced colours.

## Reviewed dashboard layout proposals

`domain/advisor-dashboard-actions.ts` recognizes a bounded set of explicit dashboard/overview requests: show or hide known metric cards, choose line/bar charts, choose supported default periods, or focus the cards on sales, finance or inventory. This is a deterministic proposal parser, not unrestricted AI execution. It does not interpret a provider's generated text as authority to write financial data.

**Review dashboard changes** loads the current personal preferences and authenticated user/workspace scope. **Apply dashboard changes** saves only after explicit review. **Undo layout change** requests restoration of the reviewed earlier layout. Both include the expected layout and scope. The preferences endpoint rejects stale or foreign reviews and uses a database compare-and-swap condition to catch a change that occurs after its initial read. A 409 response requires a new review instead of overwriting another session.

These proposals concern the user's overview in that workspace. Existing goals, saved views, BookLoQ collections/layout, navigation and unrelated account preferences are preserved by the bounded transformation and section-specific write. They do not post journals, change data sources, pay invoices, alter permissions or override missing financial evidence.

## Optional browser dictation

The microphone opens an explanation first. Recognition starts only after **Start dictation** and browser microphone permission. Recognized words populate the editable message box; dictation never sends a message automatically. The existing typed prefix is preserved, revised interim results replace earlier wording, and the 800-character limit is retained. A session ends after 30 seconds or sooner when stopped, edited, submitted, disabled, hidden or left. Late callbacks are invalidated so a stopped session cannot overwrite subsequent typing.

The browser or operating system may send audio to its own speech service under that provider's terms. Vanteloq's implementation does not record or upload audio; the resulting text reaches Vanteloq AI only through the normal explicit send and data-use controls. Unsupported browsers and permission/service failures retain a typed-input path. The privacy page contains the same caveat. No real microphone or production speech-provider round trip was tested in the recorded batches.

## Verification and remaining evidence

The release team records three current passing batches: **68 targeted tests**, **27 appearance/client/dictation tests**, and **7 tests against the real preferences handlers with isolated migrated D1 and authentication fixtures**. These are separate evidence sets, not a sum with earlier overlapping release runs. Relevant test sources include Free selection concurrency/generation tests, bank snapshot eligibility, AI appearance, dictation and reviewed preference Apply/Undo tests. Preferences coverage includes foreign scope, stale review, execution-time changes and concurrent first-save rejection.

The final affected migration, Free-plan and security batch passed **49/49 tests**; the final provider callback and AI-control batch passed **36/36 tests**. Typecheck, production build and artifact validation passed. Full lint completed with zero errors and 16 existing warnings. Desktop (1360 px) and mobile (390 px) browser checks verified Light/Dark selection, persistence after reload, no horizontal overflow, and the review/apply/Undo cycle using fictional records. Seven checked normal-text theme pairs exceed 4.5:1 contrast; this is scoped verification, not a full accessibility certification.

Primary implementation pointers are `server/entitlements/catalog.ts`, `server/integrations/free-selection.ts`, the Plaid Link/exchange paths, `domain/bank-cash-snapshot.ts`, the command-centre and BookLoQ routes, `app/advisor-appearance.ts`, `app/advisor-appearance.css`, `app/advisor-dashboard-actions.tsx`, `app/api/v1/preferences/route.ts`, and `app/advisor-dictation.tsx`.

Production publication and hosted migration readback are recorded in the corresponding release receipt. Real customer/provider acceptance remains separate from the isolated tests. **Actual production backup restoration remains unverified.** Preserve the unresolved accounting workflows in [BookLoQ refinement](bookloq-refinement-2026-10-04.md) and the [accounting audit](bookloq-audit/accounting-2026-10-04.md), including opening balances, posting/payment lifecycles, full statement reconciliation, tax components, accountant exports and the remaining payroll/asset/multi-entity work. This UI and integration increment does not complete those gaps.
