# Document Processing Setup

Microsoft Defender for Storage scans temporary Azure Blob copies before Microsoft Azure Document Intelligence reads the originals. Service activation requires server-side credentials, configured scanning and retention, and successful live tests. Implementing this code does not establish live service readiness.

## Configuration

- `AZURE_DOCUMENT_SCAN_KEY`: base64 account key for a dedicated scanning storage account. This key can access that entire account, so the account must contain temporary scanning copies only. Keep it in the private Sites runtime and rotate through Azure when required.
- `AZURE_DOCUMENT_SCAN_ENDPOINT`: exact origin `https://<account>.blob.core.windows.net`. The application uses the private `document-scans` container and random `scan/` object names.
- `AZURE_DOCUMENT_INTELLIGENCE_KEY`: secret for the chosen Document Intelligence resource.
- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`: exact HTTPS resource origin ending in `.cognitiveservices.azure.com`.

Use Standard general-purpose v2 Blob Storage with hierarchical namespaces, anonymous access, cross-tenant replication, SFTP and NFS disabled. Require HTTPS and TLS 1.2 or higher. Enable Defender for Storage and on-upload malware scanning for this dedicated account, including scan-result blob tags. Verify `Microsoft.EventGrid` registration and the automatically created scanning identity and system topic. Configure a scanning cap and Azure cost alerts; reaching the cap must leave files quarantined. Do not enable Defender across unrelated accounts.

Create the private `document-scans` container before setting credentials. Set a lifecycle rule for block blobs under `document-scans/scan/` to delete after 1 day. Azure lifecycle processing is asynchronous. Keep the configured 7-day soft-delete recovery period disclosed in the subprocessor notice. Verify that lifecycle cleanup is enabled before activating credentials; API deletion alone cannot clean an interrupted upload that lost its reference.

Azure F0 is for evaluation and can return only the first 2 pages. Use an appropriate production extraction tier to process every page. The intended resource region is Canada Central; verify each actual resource region before claiming Canadian processing. Defender, storage, transactions and extraction have separate charges. No customer storage credentials are sent to these services.

## Flow and safeguards

1. An authenticated user uploads a supported file into private, tenant-scoped storage. Duplicate detection and MIME verification remain enforced.
2. The Microsoft-specific Scan and Read notice names the processor, purpose, region and review boundary. The specific action records the notice version, actor and time per document. Uploading alone does not send files to Azure. Older authorizations require the current notice before processing can resume.
3. A persistent claim prevents concurrent scan requests. The stored bytes must match the upload SHA-256. PDF preflight rejects scripts, embedded files, active form submissions and malformed or encrypted PDFs. The scanner upload uses a random name and an atomic create-only request. Polling verifies the original ETag, length, SHA-256 metadata and timestamped Defender verdict. Only `No threats found` releases a file. Missing, failed, stale, not-scanned and rejected results never release downloads or begin extraction. Scan waiting is limited to 10 minutes and then requires explicit retry.
4. Clean PDF, JPEG and PNG files can be extracted. WEBP can be scanned but needs reupload as a supported extraction format. PDFs above 50 pages are rejected before extraction, with a split-file instruction. Page counts are reconciled against the result, including detection of the F0 two-page limit.
5. The Azure operation reference persists across refreshes and is validated against the configured endpoint. Results include text, tables, fields, line items, confidence, page references and provisional total checks. Large previews disclose truncation. Values do not post accounting entries or enter the AI evidence snapshot automatically.
6. A confirmed scanning copy is deleted before the original is released; soft-delete recovery retention still applies. Extracted results are stored before requesting Azure analysis-result deletion. If analysis cleanup fails, its reference is retained for retry; Azure's documented 24-hour temporary retention still applies. Individual document deletion attempts cleanup of both provider copies. Account deletion and interrupted uploads are additionally covered by the scanning storage lifecycle policy.
7. Processing errors stop automatic retries. Users can resume or explicitly retry. Long-running requests have a bounded lease; interrupted submission is marked for explicit retry rather than silently sending a second billable request. Provider work is limited per workspace, independently from status polling.

Processing progresses while an authorized user has Documents open. Leaving the page preserves the current step and Azure operation. A user can resume later. This implementation does not claim a background queue that runs indefinitely after every browser closes.

## Activation checks

- Verify selected billing tiers, regions, scanning controls, lifecycle cleanup and vendor agreements before enabling credentials in production.
- Run a synthetic clean PDF and image through actual Defender scanning and Azure extraction. Read back the scan timestamp, blob identity, private container access, and cleanup result.
- Compare a 3-page PDF with the extracted page count and verify total, tax and line items against known fixture values.
- Verify scanner rejection using an appropriate harmless vendor test fixture, unknown responses and retry behavior.
- Verify workspace isolation, permission checks, notice recording, download release, extraction review and provider deletion.
- Test representative Canadian statements with layout extraction. The US-specific bank-statement model is not used by default. Mapping statements to accounting records remains a separate reviewed workflow.

Automated coverage: provider endpoint restrictions, signed and conditional storage requests, strict scan verdicts, changed file identity, malformed tag payloads, PDF active-content restrictions, math checks, page limits, async status handling, tenant isolation, consent boundary, hash verification, blocked scans, concurrent claims and missing-page detection. Mock provider tests do not substitute for a live provider round trip.

## Vendor references

- https://learn.microsoft.com/en-us/azure/defender-for-cloud/on-upload-malware-scanning
- https://learn.microsoft.com/en-us/azure/defender-for-cloud/understand-malware-scan-results
- https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-shared-key
- https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/analyze-document?view=rest-aiservices-v4.0+(2024-11-30)
- https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/document-intelligence/data-privacy-security
