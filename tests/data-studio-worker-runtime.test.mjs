import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, NoOpLog } from "miniflare";

test("the actual XLSX adapter executes in Workers with patched source dependencies and no external service", async () => {
  const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
    import { executiveReviewXlsx } from './server/data-studio-xlsx';
    export default {async fetch(request) {
      const n=Number(new URL(request.url).searchParams.get('rows')||10);
      const rows=Array.from({length:n},(_,i)=>({id:'00012345678901234567890'+i,businessDate:'2026-10-01',locationRef:'fictional',sourceKind:'owner_summary',netSalesCents:12345,costOfGoodsCents:5000,transactionCount:1,unitsSold:1}));
      const review={version:'studio-v1',metadata:{organizationId:'fictional',currency:'CAD',timeZone:'America/Denver',from:'2026-10-01',to:'2026-10-02',locationIds:['fictional'],generatedUtc:'2026-10-12T00:00:00.000Z',extractionUtc:'2026-10-12T00:00:00.000Z',specificationHash:'a'.repeat(64),snapshotHash:'b'.repeat(64),consistency:'component_read_transactions',calculationVersion:'studio-recorded-daily-v1',dataMode:'stored_records',rowCount:n,limit:2000,truncated:false,canExport:true,sourceAuthority:'canonical_selected_sources',providerHistoryCertified:false},sales:{state:'recorded',reason:null,rows,summary:{netSalesCents:12345*n,costOfGoodsCents:5000*n,grossProfitCents:7345*n,grossMargin:7345/12345,transactionCount:n,unitsSold:n}},margin:{state:'recorded',reason:'Fictional'},inventory:{state:'unavailable',reason:'Not recorded'},cash:{state:'unavailable',reason:'Not recorded'},limitations:['Fictional probe only']};
      try{const start=performance.now();const bytes=await executiveReviewXlsx(review);return new Response(bytes,{headers:{'X-Generation-Ms':String(performance.now()-start)}})}catch(e){return Response.json({code:e.code,message:e.message},{status:409})}
    }};` }, bundle: true, platform: "node", target: "es2020", format: "esm", write: false, logLevel: "error",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire('file:///studio-worker.mjs');" },
  });
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], log: new NoOpLog(), outboundService: () => { throw Error("No network access permitted in XLSX fixture."); } });
  try {
    for (const rows of [10, 500, 2000]) {
      const response = await runtime.dispatchFetch(`https://fixture.invalid/?rows=${rows}`);
      assert.equal(response.status, 200, response.status === 200 ? "" : await response.text());
      const bytes = new Uint8Array(await response.arrayBuffer()); assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]); assert.ok(bytes.length < 5 * 1024 * 1024);
    }
    const tooLarge = await runtime.dispatchFetch("https://fixture.invalid/?rows=2001"); assert.equal(tooLarge.status, 409); assert.equal((await tooLarge.json()).code, "STUDIO_EXPORT_INCOMPLETE");
  } finally { await runtime.dispose(); }
});
