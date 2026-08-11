import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("privacy notice explains financial connections, document review, and consent controls", () => {
  const privacy = read("../app/privacy/page.tsx");

  for (const phrase of [
    "Plaid as a service provider",
    "read-only data products",
    "does not allow Vanteloq to move money",
    "provider access credentials",
    "uploaded source documents",
    "Processing outside Canada",
    "express or implied consent",
    "Document extraction can misread",
  ]) assert.match(privacy, new RegExp(phrase));
});

test("terms keep bookkeeping, extraction, and commercial messages within reviewed boundaries", () => {
  const terms = read("../app/terms/page.tsx");

  for (const phrase of [
    "approved read-only data categories",
    "does not automatically erase imported transactions",
    "an applicable CASL exception",
    "remain proposed values",
    "Vanteloq and BookLoQ do not replace",
    "does not move money",
  ]) assert.match(terms, new RegExp(phrase));
});

test("legal and retention documents keep professional review and deletion limits visible", () => {
  const legal = read("../app/legal/page.tsx");
  const retention = read("../docs/DATA_RETENTION.md");
  const shell = read("../app/legal-shell.tsx");

  assert.match(legal, /no website notice can guarantee that every legal issue has been resolved/);
  assert.match(retention, /Disconnection is not the same as deletion of lawfully retained accounting records/);
  assert.match(retention, /unsubscribe and suppression records/i);
  assert.match(retention, /six years from the end of the last tax year/);
  assert.match(shell, /August 11, 2026/);

  for (const document of [legal, retention, shell]) assert.doesNotMatch(document, /\u2014/);
});
