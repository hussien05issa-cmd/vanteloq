import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ESSENTIAL_ANALYTICS_NETWORK_POLICY } from "../app/analytics-network-policy";

const directives = (value: string) => new Map(value.split(";").map(part => part.trim().split(/\s+/)).map(([key, ...values]) => [key, values]));

test("withdrawal CSP removes only Google measurement transports and retains essential connections", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const policy = worker.match(/"default-src 'self';[^\n]+"/)?.[0]?.slice(1, -1);
  assert.ok(policy);
  const original = directives(policy), essential = directives(ESSENTIAL_ANALYTICS_NETWORK_POLICY);
  for (const key of ["connect-src", "img-src"]) {
    assert.deepEqual(essential.get(key), original.get(key)?.filter(value => !/google-analytics\.com|analytics\.google\.com/.test(value)));
  }
  assert.deepEqual([...essential.keys()], ["connect-src", "img-src"]);
  assert.ok(essential.get("connect-src")?.includes("https://challenges.cloudflare.com"));
  assert.ok(essential.get("connect-src")?.includes("'self'"));
  assert.ok(!ESSENTIAL_ANALYTICS_NETWORK_POLICY.includes("google-analytics.com"));
});
