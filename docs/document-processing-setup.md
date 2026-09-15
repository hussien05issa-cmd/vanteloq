# Document Processing Setup

Cloudmersive scans file contents before Microsoft Azure Document Intelligence receives them. Service activation requires server-side credentials, exact region endpoints and successful live tests. Implementing this code does not establish live service readiness.

## Configuration

- `CLOUDMERSIVE_API_KEY`: secret from the Vanteloq Cloudmersive account.
- `CLOUDMERSIVE_ENDPOINT`: exact HTTPS endpoint shown under API Endpoints for the subscribed plan. Do not assume a Canadian endpoint from a plan name.
- `AZURE_DOCUMENT_INTELLIGENCE_KEY`: secret for the chosen Document Intelligence resource.
- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`: exact HTTPS resource origin ending in `.cognitiveservices.azure.com`.

Use a Cloudmersive plan that supports the 10 MB upload limit. Azure F0 is for evaluation, with a restricted page allowance; use an appropriate production tier to process every page. Configure spending alerts in both accounts. No customer storage credentials are sent to either provider.

## Flow and safeguards

1. An authenticated user uploads a supported file into private, tenant-scoped storage. Duplicate detection and MIME verification remain enforced.
2. The Scan and Read notice names both processors, the purpose, cross-border processing possibility and review boundary. The specific action records the notice version, actor and time per document. Uploading alone does not send files to either provider. Both new and older quarantined files require the Scan and Read action.
3. A persistent claim prevents concurrent scan requests. The stored bytes must match the upload SHA-256. Unknown, failed and rejected scans never release downloads or begin extraction. Advanced scanning rejects active content, encrypted files and invalid formats.
4. Clean PDF, JPEG and PNG files can be extracted. WEBP can be scanned but needs reupload as a supported extraction format. PDFs above 50 pages are rejected before extraction, with a split-file instruction. Page counts are reconciled against the result, including detection of the F0 two-page limit.
5. The Azure operation reference persists across refreshes and is validated against the configured endpoint. Results include text, tables, fields, line items, confidence, page references and provisional total checks. Large previews disclose truncation. Values do not post accounting entries or enter the AI evidence snapshot automatically.
6. Extracted results are stored before requesting Azure result deletion. If deletion fails, the operation reference is retained for retry; Azure's documented temporary retention still applies. Individual document deletion attempts provider cleanup as well.
7. Processing errors stop automatic retries. Users can resume or explicitly retry. Long-running requests have a bounded lease; interrupted submission is marked for explicit retry rather than silently sending a second billable request. Provider work is limited per workspace, independently from status polling.

Processing progresses while an authorized user has Documents open. Leaving the page preserves the current step and Azure operation. A user can resume later. This implementation does not claim a background queue that runs indefinitely after every browser closes.

## Activation checks

- Verify selected billing tiers, regions and vendor agreements before enabling credentials in production.
- Run a synthetic clean PDF and image through actual Cloudmersive scanning and Azure extraction.
- Compare a 3-page PDF with the extracted page count and verify total, tax and line items against known fixture values.
- Verify scanner rejection using an appropriate harmless vendor test fixture, unknown responses and retry behavior.
- Verify workspace isolation, permission checks, notice recording, download release, extraction review and provider deletion.
- Test representative Canadian statements with layout extraction. The US-specific bank-statement model is not used by default. Mapping statements to accounting records remains a separate reviewed workflow.

Automated coverage: provider endpoint restrictions, strict scan verdicts, protected request options, math checks, page limits, async status handling, tenant isolation, consent boundary, hash verification, blocked scans, concurrent claims and missing-page detection. Mock provider tests do not substitute for a live provider round trip.

## Vendor references

- https://api.cloudmersive.com/docs/virus.asp
- https://api.cloudmersive.com/configure-endpoint-client-configuration.asp
- https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/analyze-document?view=rest-aiservices-v4.0+(2024-11-30)
- https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/document-intelligence/data-privacy-security
