import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, NoOpLog, Response } from "miniflare";

test("document providers work in Workers and never forward credentials on redirects", async () => {
  const origin = "https://qa.cognitiveservices.azure.com";
  const operation = `${origin}/documentintelligence/documentModels/prebuilt-layout/analyzeResults/00000000-0000-0000-0000-000000000001?api-version=2024-11-30`;
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
      import {beginAzureScan,pollAzureScan,deleteAzureScan} from './server/azure-document-scanner';
      import {startExtraction,pollExtraction,deleteExtractionResult} from './server/document-providers';
      export default {async fetch(request,env) {
        try {
          const bytes=new Uint8Array([1,2,3]);
          const scan=await beginAzureScan(env,bytes,'image/png','a'.repeat(64));
          const verdict=await pollAzureScan(env,scan);
          await deleteAzureScan(env,scan);
          const reading=await startExtraction(env,bytes,'image/png','other');
          const extraction=await pollExtraction(env,reading.operation);
          await deleteExtractionResult(env,reading.operation);
          return Response.json({verdict,pages:extraction.pages});
        } catch(error) {return Response.json({code:error.code},{status:502});}
      }};` },
    bundle: true, platform: "browser", format: "esm", write: false, logLevel: "error",
  });
  let redirectAt = -1, redirectStatus = 302, calls = [];
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], log: new NoOpLog(),
    bindings: { AZURE_DOCUMENT_SCAN_KEY: Buffer.alloc(64, 7).toString("base64"), AZURE_DOCUMENT_SCAN_ENDPOINT: "https://qastore.blob.core.windows.net", AZURE_DOCUMENT_INTELLIGENCE_KEY: "fixture-reader-key", AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: origin },
    outboundService: async request => {
      calls.push({ url: request.url, method: request.method });
      if (calls.length - 1 === redirectAt) return new Response(null, { status: redirectStatus, headers: { Location: "https://credential-sink.invalid/" } });
      if (request.url.startsWith(origin)) {
        if (request.method === "POST") return new Response(null, { status: 202, headers: { "operation-location": operation } });
        if (request.method === "DELETE") return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ status: "succeeded", analyzeResult: { modelId: "prebuilt-layout", content: "Fixture", pages: [{}] } }));
      }
      if (request.method === "PUT") return new Response(null, { status: 201, headers: { etag: '"0xABC"' } });
      if (request.method === "DELETE") return new Response(null, { status: 202 });
      if (request.headers.get("range") === "bytes=0-0") return new Response(new Uint8Array([1]), { status: 206, headers: { etag: '"0xABC"', "content-range": "bytes 0-0/3", "content-length": "1", "x-ms-meta-sha256": "a".repeat(64) } });
      return new Response(`<Tags><TagSet><Tag><Key>Malware Scanning scan result</Key><Value>No threats found</Value></Tag><Tag><Key>Malware Scanning scan time UTC</Key><Value>${new Date().toISOString()}</Value></Tag></TagSet></Tags>`);
    },
  });
  try {
    const success = await mf.dispatchFetch("https://fixture.invalid");
    assert.equal(success.status, 200, await success.clone().text());
    assert.deepEqual(await success.json(), { verdict: "clean", pages: 1 });
    const expectedCalls = calls.length;
    assert.equal(expectedCalls, 8);
    for (redirectAt = 0; redirectAt < expectedCalls; redirectAt++) {
      for (redirectStatus of [301, 302, 303, 307, 308]) {
        calls = [];
        const response = await mf.dispatchFetch("https://fixture.invalid");
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { code: "PROVIDER_UNAVAILABLE" });
        assert.equal(calls.length, redirectAt + 1);
        assert.ok(calls.every(call => !call.url.includes("credential-sink")));
      }
    }
  } finally { await mf.dispose(); }
});
