import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalUrl, run } from "../scripts/submit-indexnow.mjs";

const origin = "https://vanteloq.com";
const valid = "/resources";
const file = (await readdir(new URL("../public/", import.meta.url))).find(name => /^indexnow-[a-f0-9]{64}\.txt$/.test(name));
const key = await readFile(new URL(`../public/${file}`, import.meta.url), "utf8");

test("IndexNow rejects other domains, API paths and noncanonical URL variants", () => {
  assert.equal(canonicalUrl(valid), origin + valid);
  for (const input of ["https://example.com/", "/api/health", valid + "/", valid + "?q=test", valid + "#section", "/insights"]) {
    assert.throws(() => canonicalUrl(input), input);
  }
});

test("IndexNow preview never makes a network request", async () => {
  let output;
  await run([valid, valid], { fetchImpl: () => { throw new Error("Unexpected network request"); }, log: value => { output = JSON.parse(value); } });
  assert.equal(output.mode, "dry-run");
  assert.equal(output.urlCount, 1);
});

test("IndexNow does not transmit a notification when a page is unavailable", async () => {
  let posts = 0;
  await assert.rejects(run(["--submit", valid], { fetchImpl: async (url, options) => {
    if (url === `${origin}/${file}`) return new Response(key);
    if (options.method === "POST") posts++;
    return new Response("Not found", { status: 404 });
  }, log() {} }), /Only live, indexable HTTP 200/);
  assert.equal(posts, 0);
});

test("IndexNow transmits only the canonical list after ownership and page checks", async () => {
  let payload;
  await run(["--submit", valid], { fetchImpl: async (url, options) => {
    if (url === `${origin}/${file}`) return new Response(key);
    if (options.method === "HEAD") return new Response(null, { status: 200 });
    assert.equal(url, "https://api.indexnow.org/indexnow");
    payload = JSON.parse(options.body);
    return new Response(null, { status: 200 });
  }, log() {} });
  assert.deepEqual(payload.urlList, [origin + valid]);
  assert.equal(payload.host, new URL(origin).hostname);
});
