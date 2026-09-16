# Document cleanup and QuickBooks review

This September 16 follow-up closes specific application gaps. It is not overall launch certification or provider approval.

## Live infrastructure observations

- Supabase's existing `vanteloq-pos-sync` job is enabled every minute. Recent dispatch receipts returned HTTP 200, including real POS backfill work. No scheduler credential or provider configuration was changed for this review.
- Supabase's security advisor returned no warning or error findings. Its two informational RLS notices concern `operations_alert_events` and `operations_monitor_state`. Direct permission checks confirmed that `anon` and `authenticated` have no select, insert, update or delete privileges. Both tables have RLS enabled; service access remains separate.
- The hosting TLS report remains escalated to an OpenAI support specialist. No fix or case number has been supplied in the support conversation. The earlier protocol evidence remains an unresolved release condition.
- The owner completed sign-in during this review. Before publication, the live workspace correctly separated missing current-day sales from historical figures. Documents loaded its existing test files as clean and extracted. The 5-page fictional bank statement opened with source tables and a clear notice that no accounting entries were posted. No fictional figures were approved into the real workspace.

## Implementation and verification

The existing signed scheduler now also selects bounded batches of document cleanup work. It resumes only deletion requests or temporary provider-copy cleanup that already have recorded authorization. It does not initiate scanning, extraction or a new retention policy. Conditional claims, expiring leases, increasing retry delays and tenant-aware selection limit overlap and repeated provider calls. Audit events exclude file contents, source names and provider references. Documents displays automatic retry status while retaining manual recovery controls.

Migration 0055 adds three partial indexes. A real SQLite fixture with malformed historical JSON, active leases and unrelated audit rows verified bounded selection and indexed query plans. It does not rewrite or remove documents. A 24-hour abandoned-original purge remains unimplemented and must not be advertised as active.

QuickBooks grants are now bound to the selected environment, application and authorization generation. Credential-bearing requests refuse redirects. Refresh, reconnect and removal serialize their writes and recheck ownership, preventing late responses from recreating removed credentials or activating cancelled grants. Local removal reports when separate removal in Intuit is still needed. Older unbound QuickBooks connections require reconnection before further access. Company verification still does not import a ledger or populate BookLoQ financial statements.

Shopify and Shopify POS now show "App review pending" in the unconnected setup guidance and status footer. Saved application credentials do not establish public installation approval.

The production build, full TypeScript check and full lint passed. Focused checks passed for cleanup authorization, leases, backoff, safe audit data, manual recovery, migration behavior, QuickBooks grant isolation and races, credential redirects, and product guidance. The final integrated run passed all 5 workflow tests: bank-statement access/review/replay boundaries, signed cleanup execution, document deletion recovery, durable POS job authorization and retries, and QuickBooks callback authorization and concurrency. These used isolated databases and fictional provider responses, not live Intuit financial records.

Independent review also exercised migration 0055 against 22 malformed or non-object historical JSON cases. Creation and later updates succeeded, and discovery selected only the authorized row through the intended indexes. The migration must be included before the released scheduler runs. The validated deployment archive contains all migrations, including 0055, with LF line endings.

## Clover review preparation

A refreshed isolated review harness passed 15 credential-free startup, HTTP access-boundary and expiration checks against the built application. It creates a fictional local workspace, keeps reporting disabled, and closes its listeners and test environment at its hard lifetime limit. No Clover credential was entered, no provider request was made, and no tunnel was started. This is preparation for the authorized walkthrough, not evidence of successful Clover OAuth, import, reconciliation or listing review.

Newsletters are excluded from the remaining work at the owner's request. Enrollment and sending remain disabled.
