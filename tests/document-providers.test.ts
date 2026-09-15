import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { azureOperationUrl, documentProviderConfiguration, extractionModel, normalizeExtraction, pollExtraction, providerOrigin, scanDocument, scanVerdict, startExtraction } from "../server/document-providers.ts";
const env = { CLOUDMERSIVE_API_KEY: "test-scan-key", CLOUDMERSIVE_ENDPOINT: "https://api.cloudmersive.com", AZURE_DOCUMENT_INTELLIGENCE_KEY: "test-extraction-key", AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://vanteloq-test.cognitiveservices.azure.com" };
const operation = `${env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT}/documentintelligence/documentModels/prebuilt-layout/analyzeResults/00000000-0000-0000-0000-000000000001?api-version=2024-11-30`;

test("provider configuration rejects destinations that could disclose keys", () => {
  assert.deepEqual(documentProviderConfiguration(env), { scanning: true, extraction: true });
  assert.deepEqual(documentProviderConfiguration({}), { scanning: false, extraction: false });
  for (const value of ["http://api.cloudmersive.com", "https://api.cloudmersive.com.evil.example", "https://key@api.cloudmersive.com", "https://api.cloudmersive.com/scan", "https://127.0.0.1"]) assert.throws(() => providerOrigin(value, "cloudmersive"));
  assert.throws(() => azureOperationUrl(env, operation.replace("vanteloq-test", "other-tenant")));
  assert.throws(() => azureOperationUrl(env, `${operation}&forward=https://example.invalid`));
  assert.equal(azureOperationUrl(env, operation), operation);
});
test("only an explicit clean verdict releases a document", () => {
  assert.equal(scanVerdict({ CleanResult: true, FoundViruses: [] }), "clean");
  for (const body of [{}, { CleanResult: "true" }, null, { error: "failed" }]) assert.equal(scanVerdict(body), "unknown");
  for (const body of [{ CleanResult: false }, { CleanResult: true, ContainsScript: true }, { CleanResult: true, FoundViruses: [{ VirusName: "synthetic-test" }] }]) assert.equal(scanVerdict(body), "blocked");
});
test("scan blocks risky content, uses a generic filename and does not follow redirects", async () => {
  let calls = 0;
  const transport = (async (url, init) => {
    calls++;
    assert.equal(url, "https://api.cloudmersive.com/virus/scan/file/advanced");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("allowScripts"), "false");
    assert.equal(headers.get("allowPasswordProtectedFiles"), "false");
    assert.equal(headers.get("allowUnwantedAction"), "false");
    assert.equal((init?.body as FormData).get("inputFile") instanceof File, true);
    assert.equal(((init?.body as FormData).get("inputFile") as File).name, "document.pdf");
    return Response.json({ CleanResult: true });
  }) as typeof fetch;
  assert.equal(await scanDocument(env, new Uint8Array([1, 2]), "application/pdf", transport), "clean");
  assert.equal(calls, 1);
  await assert.rejects(scanDocument(env, new Uint8Array([1]), "text/html", transport));
  await assert.rejects(scanDocument(env, new Uint8Array([1]), "application/pdf", (async () => new Response("private bank data should not escape", { status: 403 })) as typeof fetch), { message: "PROVIDER_ACCESS_DENIED" });
});
test("Canadian statements use layout; extracted totals are checked without silently filling blanks", () => {
  assert.equal(extractionModel("other"), "prebuilt-layout");
  const currency = (amount: number) => ({ valueCurrency: { amount, currencyCode: "CAD" }, confidence: .98, boundingRegions: [{ pageNumber: 1 }] });
  const result = normalizeExtraction({ modelId: "prebuilt-invoice", pages: [{}], content: "Invoice", documents: [{ fields: { InvoiceTotal: currency(105), SubTotal: currency(100), TotalTax: currency(5), InvoiceId: { valueString: "TEST-001" } } }] });
  assert.equal(result.fields.InvoiceTotal.value, 105);
  assert.equal(result.fields.InvoiceTotal.currency, "CAD");
  assert.equal(result.fields.InvoiceId.confidenceBasisPoints, null);
  assert.equal(result.checks[0].state, "passed");
  const mismatch = normalizeExtraction({ modelId: "prebuilt-invoice", documents: [{ fields: { InvoiceTotal: currency(150), SubTotal: currency(100), TotalTax: currency(5) } }] });
  assert.equal(mismatch.checks[0].state, "review");
  const missing = normalizeExtraction({ modelId: "prebuilt-invoice", documents: [{ fields: { InvoiceTotal: currency(105), SubTotal: currency(100) } }] });
  assert.equal(missing.checks[0].state, "review");
  const large = normalizeExtraction({ modelId: "prebuilt-layout", content: "a".repeat(61000) });
  assert.equal(large.truncated, true);
  assert.ok(large.checks.some(check => check.label === "Statement mapping"));
});
test("Azure starts with full file bytes, tracks page coverage and rejects unsupported or oversized files before billing", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage(); pdf.addPage();
  const bytes = await pdf.save();
  let calls = 0;
  const transport = (async (_url, init) => {
    calls++;
    assert.equal(Buffer.from(JSON.parse(init?.body as string).base64Source, "base64").length, bytes.length);
    return new Response(null, { status: 202, headers: { "operation-location": operation } });
  }) as typeof fetch;
  const started = await startExtraction(env, bytes, "application/pdf", "other", transport);
  assert.equal(started.expectedPages, 3);
  assert.equal(started.operation, operation);
  await assert.rejects(startExtraction(env, bytes, "image/webp", "other", transport), { message: "EXTRACTION_FORMAT_UNSUPPORTED" });
  while (pdf.getPageCount() < 51) pdf.addPage();
  await assert.rejects(startExtraction(env, await pdf.save(), "application/pdf", "other", transport), { message: "EXTRACTION_PAGE_LIMIT" });
  assert.equal(calls, 1);
});
test("Azure running and failed results never masquerade as completed extraction", async () => {
  assert.equal(await pollExtraction(env, operation, (async () => Response.json({ status: "running" })) as typeof fetch), null);
  await assert.rejects(pollExtraction(env, operation, (async () => Response.json({ status: "failed", error: { message: "confidential" } })) as typeof fetch), { message: "EXTRACTION_FAILED" });
});
