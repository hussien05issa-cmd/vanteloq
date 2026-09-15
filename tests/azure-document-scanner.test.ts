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
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("x-ms-blob-cache-control"), "private, no-store");
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

test("identity checks require the exact bounded range and full-file length", async () => {
  const fixture = scannerFixture();
  const operation = await beginAzureScan(scannerEnv, new Uint8Array([1, 2]), "application/pdf", "a".repeat(64), fixture.transport);
  for (const [status, range] of [[200, "bytes 0-0/2"], [206, "bytes 0-0/3"], [206, "bytes 0-1/2"]] as const) {
    let cancelled = false;
    const transport = (async (_url, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("x-ms-range"), "bytes=0-0");
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status, headers: { etag: operation.etag, "content-range": range, "x-ms-meta-sha256": operation.sha256 } });
    }) as typeof fetch;
    await assert.rejects(pollAzureScan(scannerEnv, operation, transport), { message: "DOCUMENT_CHANGED" });
    assert.equal(cancelled, true, "An unbounded or changed response must not be downloaded");
  }
});

test("scan identity remains authenticated when an edge strips standard GET conditions", async () => {
  const fixture = scannerFixture();
  const operation = await beginAzureScan(scannerEnv, new Uint8Array([1, 2]), "application/pdf", "a".repeat(64), fixture.transport);
  const edgeTransport = (async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("range");
    headers.delete("if-match");
    const expected = await storageAuthorization(new URL(String(input)), "GET", headers, scannerEnv.AZURE_DOCUMENT_SCAN_KEY);
    assert.equal(headers.get("authorization"), expected, "The signature must remain valid after edge normalization");
    if (!String(input).includes("comp=tags")) assert.equal(headers.get("x-ms-range"), "bytes=0-0");
    return fixture.transport(input, { ...init, headers });
  }) as typeof fetch;
  assert.equal(await pollAzureScan(scannerEnv, operation, edgeTransport), "clean");
  await assert.rejects(pollAzureScan(scannerEnv, { ...operation, etag: '"changed"' }, edgeTransport), { message: "DOCUMENT_CHANGED" });
});
