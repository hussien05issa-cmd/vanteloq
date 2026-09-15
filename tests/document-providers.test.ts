import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFName } from "pdf-lib";
import { azureOperationUrl, documentProviderConfiguration, extractionModel, normalizeExtraction, pollExtraction, providerOrigin, startExtraction, validateDocumentForProcessing } from "../server/document-providers.ts";
import { scannerEnv } from "./azure-scanner-fixture.ts";
const env = { ...scannerEnv, AZURE_DOCUMENT_INTELLIGENCE_KEY: "test-extraction-key", AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://vanteloq-test.cognitiveservices.azure.com" };
const operation = `${env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT}/documentintelligence/documentModels/prebuilt-layout/analyzeResults/00000000-0000-0000-0000-000000000001?api-version=2024-11-30`;

test("active PDF content is rejected before contacting either Azure service", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  await validateDocumentForProcessing(await pdf.save(), "application/pdf");
  pdf.catalog.set(PDFName.of("OpenAction"), pdf.context.obj({ S: "JavaScript", JS: "/* harmless synthetic test */" }));
  await assert.rejects(validateDocumentForProcessing(await pdf.save(), "application/pdf"), { message: "DOCUMENT_ACTIVE_CONTENT" });
});

test("provider configuration rejects destinations that could disclose keys", () => {
  assert.deepEqual(documentProviderConfiguration(env), { scanning: true, extraction: true });
  assert.deepEqual(documentProviderConfiguration({}), { scanning: false, extraction: false });
  for (const value of ["http://qa.cognitiveservices.azure.com", "https://qa.cognitiveservices.azure.com.evil.example", "https://key@qa.cognitiveservices.azure.com", "https://qa.cognitiveservices.azure.com/scan", "https://127.0.0.1"]) assert.throws(() => providerOrigin(value));
  assert.throws(() => azureOperationUrl(env, operation.replace("vanteloq-test", "other-tenant")));
  assert.throws(() => azureOperationUrl(env, `${operation}&forward=https://example.invalid`));
  assert.equal(azureOperationUrl(env, operation), operation);
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
