# Vanteloq v1.0 Origin: AI attachments

## Scope

The existing authenticated Vanteloq AI chat now accepts user-selected PDF, JPEG, PNG, WEBP, UTF-8 TXT and CSV attachments. Limits: 4 files, 5 MiB per file, 8 MiB total, 20 PDF pages combined, and 64 KiB for each text/CSV file. The user must supply a question and affirm the separate attachment notice for that message. Changing the files clears that acknowledgement.

## Data boundaries

The server verifies the session, plan, role, location scope and current AI agreement, bounds the actual request body, validates file signatures/text/PDF structure, and builds the provider input itself. Files cannot supply provider URLs, file IDs, tools, system instructions or executable actions. PDF scripts and embedded files are rejected. This is structural validation, not antivirus certification. The existing Documents quarantine, malware scanning and reviewed import pipeline is unchanged.

Files are passed inline to OpenAI Responses with store:false. No Files API, R2 upload, workspace document, extraction record or financial record is created. File bytes, filenames and derived answer content are excluded from Vanteloq persistence for attachment turns. The user question and answer are not saved even if a client submits memoryEnabled:true. Audit events contain notice version, user/workspace, counts and byte totals only. OpenAI safety retention and exceptions still apply. The open browser retains the visible exchange until it is cleared or closed.

## Verification

- Live existing text AI answered in Supplement World before changes, identified partial Lightspeed coverage and unavailable costs/BookLoQ evidence.
- TypeScript, lint and production build passed.
- 31 targeted tests passed, covering multipart/size/type validation, PDF active content/page limits, invalid UTF-8, provider payloads, no tools, cancellation, timeouts, tenant separation, revoked consent/access, and forced no-memory attachment turns.
- Desktop and 390 x 844 mobile composer inspected. Send remains disabled until both required permissions are satisfied; removing a file resets attachment permission. No mobile horizontal overflow observed.
- Final live fictional PDF/photo/CSV reading test remains to be recorded after publication.

## Provider references

- https://developers.openai.com/api/docs/guides/file-inputs
- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/your-data

This verifies the bounded AI attachment change, not production disaster recovery, TLS enforcement or pending integration approvals.
