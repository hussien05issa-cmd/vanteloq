# Vanteloq v1.0 Origin: workspace and financial-integrity update

Prepared October 9, 2026. This supplements the existing Origin handover; it does not certify every production pathway or third-party approval.

## Workspace

- Sidebar sections have visible dividers, a compact business/location context, readable labels, and a bordered Sign out pill. Existing navigation entitlements remain enforced.
- Settings > My profile > Workspace appearance offers Dark, Light and System. Dark is the default. The device preference is shared by the workspace, BookLoQ and Vanteloq AI. It does not change the public homepage. Storage failures retain the current choice and show a notice; System reacts to the device setting.
- Scoped theme tokens preserve blue and purple accents, green gains and red losses. Status is also expressed with text. Reduced motion and forced colours are supported.
- Tasks support a verified member assignment, location, due date, evidence links and version-based concurrent edits. Messages are plain text, scoped to the workspace/location and optionally a task. Sending has content-bound idempotency and preserves failed drafts.
- Visible tasks refresh every 30 seconds and messages every 20 seconds, with focus refresh. This is polling, not an instantaneous delivery guarantee. Removing a teammate deletes that member's messages and clears their task assignments while retaining shared tasks and other members' messages.

## Financial records and connector security

- Shopify and Lightspeed R publication checks coherent completed imports before reporting their financial totals. Net revenue excludes sales tax, cancelled orders cannot retain earlier revenue, removed sale lines are pruned, and fractional quantities are retained. Missing legacy quantities remain unknown.
- Existing approved Shopify/Shopify POS and Lightspeed R connections return to staging for a fresh sync and review. Stored source and canonical records are retained. This deliberate migration prevents prior approval from certifying legacy calculations.
- Clover and Deel refresh operations claim single-use grants before exchange and fence replacement against changed tenant, connection, generation and lease state. An ambiguous interrupted rotation can require reconnection. No live provider verification is claimed by local tests.
- Plaid and Clover collection requests reject unexpected redirects. Plaid exposes safe application messages rather than unfiltered provider error text.
- Slack local disconnection withdraws sending access first. If provider revocation fails, a separate encrypted removal-only credential permits retry and is removed after confirmed cleanup. Provider withdrawal is not guaranteed by local disconnection alone.
- The privacy notice is dated October 9, 2026 and reflects team messages, task retention and Slack removal-only credential handling. The terms version remains unchanged. Existing users may need to acknowledge the updated privacy notice.

## Verification and remaining production gates

Release evidence records the exact source tree, deployment, GitHub branch, targeted tests and desktop/mobile visual checks. Test fixtures use fictional records and do not demonstrate completed customer billing or real provider approvals.

Still require separate evidence: production database and uploaded-file backup/restoration, ordinary subscriber Checkout/invoice/webhook/trial-conversion/cancellation, hosted TLS enforcement, and each provider's production eligibility/distribution plus a real connection canary. A prior isolated recovery test does not verify restoration of production files.

This update introduces one incremental migration, 0075_busy_zarda.sql. It adds collaboration messages and task scope/version fields, nullable POS quantities and the described staging transition. It does not reset the database or delete stored POS records.
