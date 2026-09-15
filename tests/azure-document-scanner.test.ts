import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { beginAzureScan, deleteAzureScan, parseScannerTags, pollAzureScan, scannerConfiguration, storageAuthorization } from "../server/azure-document-scanner.ts";
import { scannerEnv, scannerFixture } from "./azure-scanner-fixture.ts";

test("scanner credentials cannot be sent to custom hosts or redirected requests", async () => {
  assert.equal(scannerConfiguration(scannerEnv), true);
  for (const endpoint of ["http://qastore.blob.core.windows.net", "https://qastore.blob.core.windows.net.attacker.example", "https://secret@qastore.blob.core.windows.net", "https://qastore.blob.core.windows.net/container", "https://qastore.blob.core.windows.net?key=anything", "https://127.0.0.1"]) assert.equal(scannerConfiguration({ ...scannerEnv, AZURE_DOCUMENT_SCAN_ENDPOINT: endpoint }), false);
  assert.equal(scannerConfiguration({ ...scannerEnv, AZURE_DOCUMENT_SCAN_KEY: "invalid" }), false);
  const operation = await beginAzureScan(scannerEnv, new Uint8Array([1, 2, 3]), "application/pdf", "a".repeat(64), (async (_url, init) => {
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("If-None-Match"), "*");
    assert.equal(new Headers(init?.headers).has("x-ms-tags"), false);
    return new Response(null, { status: 201, headers: { etag: '"0xABC"' } });
  }) as typeof fetch);
  assert.match(operation.blobName, /^scan\/[a-f0-9-]{36}\.pdf$/);
  await assert.rejects(beginAzureScan(scannerEnv, new Uint8Array([1]), "text/html", "a".repeat(64)), { message: "DOCUMENT_FORMAT_UNSUPPORTED" });
});

test("Azure authorization includes conditional writes and canonical service headers", async () => {
  const headers = new Headers({ "Content-Type": "application/pdf", "If-None-Match": "*", "x-ms-blob-type": "BlockBlob", "x-ms-date": "Tue, 15 Sep 2026 18:00:00 GMT", "x-ms-version": "2023-11-03" });
  const expected = "PUT\n\n\n3\n\napplication/pdf\n\n\n\n*\n\n\nx-ms-blob-type:BlockBlob\nx-ms-date:Tue, 15 Sep 2026 18:00:00 GMT\nx-ms-version:2023-11-03\n/qastore/document-scans/scan/test.pdf";
  const signature = createHmac("sha256", Buffer.from(scannerEnv.AZURE_DOCUMENT_SCAN_KEY, "base64")).update(expected).digest("base64");
  assert.equal(await storageAuthorization(new URL(`${scannerEnv.AZURE_DOCUMENT_SCAN_ENDPOINT}/document-scans/scan/test.pdf`), "PUT", headers, scannerEnv.AZURE_DOCUMENT_SCAN_KEY, 3), `SharedKey qastore:${signature}`);
});

test("only explicit completed Defender verdicts release matching bytes", async () => {
  const fixture = scannerFixture("");
  const operation = await beginAzureScan(scannerEnv, new Uint8Array([1, 2]), "application/pdf", "a".repeat(64), fixture.transport);
  assert.equal(await pollAzureScan(scannerEnv, operation, fixture.transport), null);
  fixture.setResult("No threats found");
  assert.equal(await pollAzureScan(scannerEnv, operation, fixture.transport), "clean");
  fixture.setResult("Malicious");
  assert.equal(await pollAzureScan(scannerEnv, operation, fixture.transport), "blocked");
  fixture.setResult("Not scanned");
  await assert.rejects(pollAzureScan(scannerEnv, operation, fixture.transport), { message: "SCAN_NOT_COMPLETED" });
  await deleteAzureScan(scannerEnv, operation, fixture.transport);
  assert.equal(fixture.blobs.size, 0);
  await deleteAzureScan(scannerEnv, operation, fixture.transport);
});

test("changed blobs, stale results and unsafe tag payloads remain quarantined", async () => {
  const fixture = scannerFixture();
  const operation = await beginAzureScan(scannerEnv, new Uint8Array([1, 2]), "application/pdf", "a".repeat(64), fixture.transport);
  await assert.rejects(pollAzureScan(scannerEnv, { ...operation, etag: '"changed"' }, fixture.transport), { message: "DOCUMENT_CHANGED" });
  await assert.rejects(pollAzureScan(scannerEnv, { ...operation, submittedAt: Date.now() - 11 * 60_000 }, fixture.transport), { message: "SCAN_TIMED_OUT" });
  await assert.rejects(pollAzureScan(scannerEnv, { ...operation, blobName: "../../other" }, fixture.transport), { message: "SCAN_REFERENCE_INVALID" });
  assert.throws(() => parseScannerTags('<!DOCTYPE Tags [<!ENTITY x "attack">]><Tags></Tags>'));
  assert.throws(() => parseScannerTags('<Tags><Tag><Key>Malware Scanning scan result</Key><Value>No threats found</Value></Tag><Tag><Key>malware scanning scan result</Key><Value>Malicious</Value></Tag></Tags>'));
});
