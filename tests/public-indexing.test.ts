import assert from "node:assert/strict";
import test from "node:test";
import { authEntryRobots } from "../server/public-indexing";

test("root authentication entries are excluded from indexing while links remain followable", () => {
  for (const query of ["start=signin", "start=signup", "auth=signin", "auth=signup", "recovery=1", "team_invite=1", "start=signin&utm_source=campaign", "start=invalid&auth=signin"]) {
    assert.equal(authEntryRobots(new URL(`https://vanteloq.com/?${query}`)), "noindex, follow", query);
  }
});

test("the canonical homepage and ordinary marketing query variants keep existing indexing behavior", () => {
  for (const path of ["/", "/?utm_source=google", "/?gclid=example", "/?start=overview", "/?auth=other", "/?recovery=0", "/?team_invite=0", "/?start=SIGNIN", "/?v=397"]) {
    assert.equal(authEntryRobots(new URL(`https://vanteloq.com${path}`)), null, path);
  }
});

test("authentication-looking query parameters do not change unrelated routes", () => {
  for (const path of ["/advisory?start=signin", "/workspace?auth=signup", "/resources?recovery=1", "/book-demo?team_invite=1", "/api/session?start=signin"]) {
    assert.equal(authEntryRobots(new URL(`https://vanteloq.com${path}`)), null, path);
  }
});
