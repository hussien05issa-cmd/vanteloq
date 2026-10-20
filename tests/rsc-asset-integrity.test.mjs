import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertRscAssetFiles, orderRscAssetManifest } from "../build/rsc-asset-integrity.mjs";

test("RSC manifest collects the final bundle after CSS-only placeholders are removed", () => {
  const context = { seen: null };
  const handler = function (_options, bundle) { this.seen = Object.keys(bundle); };
  const plugin = { name: "rsc:virtual:vite-rsc/assets-manifest", generateBundle: handler };
  orderRscAssetManifest([plugin]);
  assert.equal(plugin.generateBundle.order, "post");
  assert.equal(plugin.generateBundle.handler, handler);
  const bundle = { "dashboard.js": {}, "dashboard.css": {} };
  delete bundle["dashboard.js"];
  plugin.generateBundle.handler.call(context, {}, bundle);
  assert.deepEqual(context.seen, ["dashboard.css"]);
  orderRscAssetManifest([plugin]);
  assert.equal(plugin.generateBundle.handler, handler);
  assert.throws(() => orderRscAssetManifest([]), /hook changed/);
});

test("artifact validation rejects missing JS or CSS instead of suppressing references", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vanteloq-rsc-assets-"));
  try {
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "assets", "app.js"), "export {};");
    await writeFile(join(directory, "assets", "app.css"), "body{}");
    const manifest = { clientEntryUrl: "/assets/app.js", clientReferenceDeps: { dashboard: { js: ["/assets/app.js"], css: ["/assets/app.css"] } } };
    assert.equal(await assertRscAssetFiles(manifest, directory), 2);
    manifest.clientReferenceDeps.dashboard.js.push("/assets/phantom.js");
    await assert.rejects(assertRscAssetFiles(manifest, directory), /missing client asset/);
    manifest.clientReferenceDeps.dashboard.js.pop();
    manifest.clientReferenceDeps.dashboard.css.push("/assets/missing.css");
    await assert.rejects(assertRscAssetFiles(manifest, directory), /missing client asset/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
