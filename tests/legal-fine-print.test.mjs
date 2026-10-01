import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TERMS_OF_SERVICE_VERSION, LEGAL_DOCUMENT_UPDATED_LABEL } from "../shared/legal-versions.ts";

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
    "financial-data authorization",
    "TLS 1.2",
    "additional application-level AES-GCM encryption layer",
    "Vanteloq AI data-use acceptance",
    "the agreement starts unchecked",
    "Clearing a conversation",
    "full account numbers",
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

test("legal and retention documents identify the operator and retain deletion limits", () => {
  const legal = read("../app/legal/page.tsx");
  const retention = read("../docs/DATA_RETENTION.md");
  const shell = read("../app/legal-shell.tsx");
  const versions = read("../shared/legal-versions.ts");

  assert.match(legal, /2855706 ALBERTA INC/);
  assert.match(legal, /does not guarantee sales, profit, legal compliance/);
  assert.match(retention, /Disconnection is not the same as deletion of lawfully retained accounting records/);
  assert.match(retention, /unsubscribe and suppression records/i);
  assert.match(retention, /six years from the end of the last tax year/);
  assert.match(retention, /DELETE PLAID DATA/);
  assert.match(retention, /quarterly operational review/);
  assert.match(shell, /LEGAL_DOCUMENT_UPDATED_LABEL/);
  assert.equal(LEGAL_DOCUMENT_UPDATED_LABEL, new Intl.DateTimeFormat("en-US", {month:"long", day:"numeric", year:"numeric", timeZone:"UTC"}).format(new Date(TERMS_OF_SERVICE_VERSION+"T00:00:00Z")));

  for (const document of [legal, retention, shell, versions]) assert.doesNotMatch(document, /\u2014/);
});
