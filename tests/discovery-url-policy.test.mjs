import assert from "node:assert/strict";
import test from "node:test";
import { isEligibleDiscoveryUrl, selectDiscoveryUrls } from "../scripts/discovery-url-policy.mjs";

test("discovery accepts the public Workspace landing page and canonical marketing routes", () => {
  for (const path of ["/", "/workspace", "/advisory", "/resources/inventory", "/features/financial-review", "/privacy"]) {
    assert.equal(isEligibleDiscoveryUrl(`https://vanteloq.com${path}`), true, path);
  }
});

test("selective notification includes only requested changed pages already in the live sitemap", () => {
  const sitemap = ["https://vanteloq.com/", "https://vanteloq.com/advisory", "https://vanteloq.com/workspace"];
  assert.deepEqual(selectDiscoveryUrls(sitemap, ["/advisory", "/advisory"]), ["https://vanteloq.com/advisory"]);
  assert.deepEqual(selectDiscoveryUrls(sitemap, ["/workspace", "/advisory"]), ["https://vanteloq.com/workspace", "https://vanteloq.com/advisory"]);
  for (const path of ["/missing-page", "/workspace/private", "/advisory?contact=private", "//example.com/advisory", "https://vanteloq.com/advisory", ""]) {
    assert.throws(() => selectDiscoveryUrls(sitemap, [path]), undefined, path);
  }
  assert.throws(() => selectDiscoveryUrls([...sitemap, "https://vanteloq.com/account/deletion"], ["/advisory"]));
});

test("discovery excludes private routes and sensitive query or fragment variants", () => {
  for (const path of ["/workspace/", "/workspace/document/123", "/api", "/api/data", "/account/deletion", "/datstudio", "/datstudio/table/123", "/auth/callback", "/email/unsubscribe", "/privacy-requests", "/?start=signin", "/advisory?email=private", "/advisory#private", "/work%73pace/document/123", "/workspace%2Fdocument/123"]) {
    assert.equal(isEligibleDiscoveryUrl(`https://vanteloq.com${path}`), false, path);
  }
  for (const url of ["https://example.com/advisory", "http://vanteloq.com/advisory", "https://user:password@vanteloq.com/advisory", "/advisory", "not a URL"]) {
    assert.equal(isEligibleDiscoveryUrl(url), false, url);
  }
});
