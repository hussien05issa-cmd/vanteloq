# Private Document Email Receiver

This Worker accepts attachments sent to exact private workspace addresses on `documents.vanteloq.com`. It sends a signed request to Vanteloq's document intake endpoint. It does not expose a public HTTP endpoint, save email bodies, forward customer files to support, or authorize scanning, AI processing or accounting entries.

## Development

The application pins Postal Mime 3.0.0 in its root development dependencies, so the existing locked root installation covers TypeScript and tests. For a standalone Worker installation, use `pnpm --dir email-worker install --frozen-lockfile --ignore-scripts`. Both manifests pin the same version. Nested dependencies and Wrangler state are excluded from Git.

Run the document-email test suites from the application root. The maximum-size test uses the actual local Workers runtime and a fictional MIME message. Local wall time is not evidence of production CPU usage or successful email delivery.

## Deployment and activation

The configuration requests a 30-second CPU budget and requires Workers Paid. Set `DOCUMENT_EMAIL_SECRET` privately in both this Worker and the application. Never put it in source, a URL or a client environment variable. Deploy this Worker, then configure only the dedicated documents subdomain to invoke it. Do not change the root domain's support forwarding or enable subaddress matching.

Keep `DOCUMENT_EMAIL_ENABLED` and `DOCUMENT_EMAIL_VERIFIED` absent or false until live acceptance succeeds. A server-only `DOCUMENT_EMAIL_VALIDATION_ORGANIZATION_ID` can restrict the controlled test to one eligible workspace. This does not bypass identity, role, BookLoQ, consent or exact-address checks. Remove the validation setting when activating both public flags.

Live acceptance must include a fictional attachment at the advertised size limit, the correct workspace receipt, quarantine restrictions, independent scan/read approval, deletion, replay rejection and invalidated address rejection. Observe provider resource/error status. Do not describe forwarding as available merely because credentials or a route exist.

## Retention and recovery

Originals remain subject to Vanteloq's document retention controls. A durable minimal disposal reference is reserved before object storage writes. Returned failed writes can be cleaned up; an interrupted writer of unknown status must be reviewed before disposal. Do not release such records solely because time has elapsed. Account deletion cannot confirm completion while an unresolved ingestion intent remains.

The receiver rejects uncertain delivery rather than silently accepting it. A partially completed multi-attachment message may leave already accepted files in Documents. Users should check Documents before resending or uploading directly; replay markers prevent recreating a deleted original.
